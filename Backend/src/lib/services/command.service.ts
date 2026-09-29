import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiError, notFound } from "@/lib/errors";
import { requireOwner } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { comparisonSchema, hoursSchema, idSchema, moneySchema, ratesSchema, requirementInputSchema, textSchema, titleSchema } from "@/lib/model";
import { aiWorkflowService } from "./ai-workflow.service";
import { clientService, projectService, questionService, rateCardService, requirementService } from "./core.service";
import { editDraft, lockProject, projectFor } from "./shared";
import { changeRequestService, clientAccessService, scopeService } from "./workflow.service";
import { workspaceService } from "./workspace.service";

const optionalMoney = z.union([moneySchema, z.literal(""), z.null()]).transform((value) => value === "" ? null : value);
const optionalDate = z.union([z.string().date(), z.literal(""), z.null()]).transform((value) => value ? new Date(`${value}T00:00:00.000Z`) : null);
const notes = z.string().trim().max(5000).default("");
const clientInput = z.object({ name: titleSchema, email: z.string().email().max(320), company: z.string().trim().max(160).default(""), phone: z.string().trim().max(50).default(""), notes });
const requirementFields = requirementInputSchema.extend({ status: z.enum(["CONFIRMED", "PENDING", "EXCLUDED"]).default("CONFIRMED") });
const projectInput = z.object({ name: titleSchema, clientId: idSchema, budget: optionalMoney, deadline: optionalDate, referenceUrl: z.union([z.literal(""), z.string().url().max(2000)]).default(""), notes });
const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);
const parseJson = (value: unknown) => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return null; } };
const requirementArray = z.preprocess(parseJson, z.array(requirementInputSchema).max(30));
const stringArray = z.preprocess(parseJson, z.array(textSchema).max(30));

export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("workspace.create"), name: titleSchema }),
  z.object({ action: z.literal("workspace.update"), name: titleSchema }),
  z.object({ action: z.literal("workspace.switch"), workspaceId: idSchema }),
  z.object({ action: z.literal("member.add"), email: z.string().email() }),
  z.object({ action: z.literal("client.save"), clientId: idSchema.optional(), ...clientInput.shape }),
  z.object({ action: z.literal("client.delete"), clientId: idSchema }),
  z.object({ action: z.literal("project.create"), ...projectInput.shape, clientId: idSchema.optional(), newClient: clientInput.optional(), content: textSchema }),
  z.object({ action: z.literal("project.update"), projectId: idSchema, ...projectInput.shape }),
  z.object({ action: z.literal("project.status"), projectId: idSchema, status: z.enum(["COMPLETED", "CANCELLED", "ACTIVE"]) }),
  z.object({ action: z.literal("project.delete"), projectId: idSchema }),
  z.object({ action: z.literal("initial.save"), projectId: idSchema, content: textSchema }),
  z.object({ action: z.literal("question.save"), projectId: idSchema, questionId: idSchema.optional(), question: textSchema, reason: notes }),
  z.object({ action: z.literal("question.delete"), projectId: idSchema, questionId: idSchema }),
  z.object({ action: z.literal("answer.save"), projectId: idSchema, questionId: idSchema, content: textSchema }),
  z.object({ action: z.literal("requirement.save"), projectId: idSchema, requirementId: idSchema.optional(), ...requirementFields.shape }),
  z.object({ action: z.literal("requirement.delete"), projectId: idSchema, requirementId: idSchema }),
  z.object({ action: z.literal("rates.save"), rates: ratesSchema, projectId: idSchema.optional() }),
  z.object({ action: z.literal("credits.save"), creditLimit: z.coerce.number().int().min(0).max(10000), userCreditLimit: z.coerce.number().int().min(0).max(10000) }),
  z.object({ action: z.literal("estimate.item"), projectId: idSchema, requirementId: idSchema, hours: hoursSchema, reason: textSchema }),
  z.object({ action: z.literal("estimate.total"), projectId: idSchema, overrideTotal: optionalMoney, adjustmentReason: notes }),
  z.object({ action: z.literal("scope.create"), projectId: idSchema, description: textSchema, excluded: notes, assumptions: notes, integrations: notes, deliverables: textSchema, durationDays: z.coerce.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("scope.edit"), projectId: idSchema, scopeId: idSchema, description: textSchema, excluded: notes, assumptions: notes, integrations: notes, deliverables: textSchema, durationDays: z.coerce.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("scope.withdraw"), projectId: idSchema, scopeId: idSchema }),
  z.object({ action: z.literal("share.create"), projectId: idSchema, purpose: z.enum(["QUESTIONS", "SCOPE", "CHANGE"]), targetId: idSchema.optional() }),
  z.object({ action: z.literal("share.revoke"), projectId: idSchema, tokenId: idSchema }),
  z.object({ action: z.literal("ai.run"), projectId: idSchema, task: z.enum(["initial", "questions", "requirements", "estimate"]), force: z.boolean().default(false) }),
  z.object({ action: z.literal("ai.apply"), projectId: idSchema, task: z.enum(["initial", "questions", "requirements", "estimate"]), revision: z.coerce.number().int().min(0), result: z.preprocess(parseJson, z.unknown()) }),
  z.object({ action: z.literal("change.create"), projectId: idSchema, request: textSchema }),
  z.object({ action: z.literal("change.analyze"), projectId: idSchema, changeId: idSchema, force: z.boolean().default(false) }),
  z.object({ action: z.literal("change.review"), projectId: idSchema, changeId: idSchema, request: textSchema, classification: comparisonSchema.shape.classification, confidence: z.coerce.number().min(0).max(1), reason: textSchema, newRequirements: requirementArray, affectedExistingRequirements: z.preprocess((value) => typeof value === "string" ? value.split(",").filter(Boolean) : value, z.array(idSchema).max(30)).default([]), removedExclusions: stringArray.default([]), estimatedWork: hoursSchema, scheduleImpactDays: z.coerce.number().int().min(0).max(365), overrideAmount: optionalMoney, adjustmentReason: notes }),
  z.object({ action: z.literal("change.withdraw"), projectId: idSchema, changeId: idSchema }),
  z.object({ action: z.literal("change.cancel"), projectId: idSchema, changeId: idSchema }),
]);

type Command = z.infer<typeof commandSchema>;
type Result = { message?: string; redirect?: string; link?: string; workspaceId?: string };
export async function executeCommand(context: SessionContext, command: Exclude<Command, { action: "workspace.create" | "workspace.switch" }>): Promise<Result> {
  if (!["question.save", "question.delete", "answer.save", "requirement.save", "requirement.delete"].includes(command.action)) requireOwner(context);
  switch (command.action) {
    case "workspace.update": await workspaceService.update(context, command.name); break;
    case "member.add": {
      const user = await prisma.user.findUnique({ where: { email: command.email.toLowerCase() } });
      if (!user) throw notFound("USER_NOT_FOUND", "먼저 서비스에 가입한 사용자의 이메일을 입력해주세요.");
      await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: context.workspaceId, userId: user.id } }, create: { workspaceId: context.workspaceId, userId: user.id }, update: {} });
      break;
    }
    case "client.save": {
      const input = clientInput.parse(command);
      if (command.clientId) await clientService.update(context, command.clientId, input);
      else await clientService.create(context, input);
      break;
    }
    case "client.delete": await clientService.remove(context, command.clientId); break;
    case "project.create": {
      const { newClient, ...input } = command;
      const project = await projectService.create(context, { name: input.name, clientId: input.clientId, budget: input.budget, deadline: input.deadline, referenceUrl: input.referenceUrl, notes: input.notes }, input.content, newClient);
      return { message: "프로젝트가 생성되었습니다. 고객 요청을 분석해주세요.", redirect: `/projects/${project.id}/requirements` };
    }
    case "project.update": {
      const input = projectInput.omit({ clientId: true }).parse(command);
      await projectService.update(context, command.projectId, input);
      break;
    }
    case "project.status": await projectService.setStatus(context, command.projectId, command.status); break;
    case "project.delete": await projectService.remove(context, command.projectId); return { redirect: "/projects" };
    case "initial.save": await aiWorkflowService.saveRequest(context, command.projectId, command.content); break;
    case "question.save":
    case "question.delete": {
      await editDraft(context, command.projectId, async tx => {
        if (command.questionId) {
          if (!await tx.clarificationQuestion.count({ where: { id: command.questionId, projectId: command.projectId } })) throw notFound("QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
          if (command.action === "question.delete") await tx.clarificationQuestion.delete({ where: { id: command.questionId } });
          else {
            await tx.clarificationAnswer.deleteMany({ where: { questionId: command.questionId } });
            await tx.clarificationQuestion.update({ where: { id: command.questionId }, data: { question: command.question, reason: command.reason } });
          }
        } else if (command.action === "question.save") {
          const count = await tx.clarificationQuestion.count({ where: { projectId: command.projectId } });
          if (count >= 8) throw new ApiError("QUESTION_LIMIT", "질문은 최대 8개입니다.", 409);
          await tx.clarificationQuestion.create({ data: { projectId: command.projectId, question: command.question, reason: command.reason, position: count } });
        }
        await tx.requirement.updateMany({ where: { projectId: command.projectId, status: "CONFIRMED" }, data: { status: "PENDING" } });
      });
      break;
    }
    case "answer.save": await questionService.answer(context, command.projectId, command.questionId, command.content, context.userId); break;
    case "requirement.save": {
      const input = requirementFields.parse(command);
      if (command.requirementId) await requirementService.update(context, command.projectId, command.requirementId, input);
      else await requirementService.create(context, command.projectId, { ...input, source: "OWNER_MANUAL" });
      break;
    }
    case "requirement.delete": await requirementService.remove(context, command.projectId, command.requirementId); break;
    case "rates.save": {
      if (command.projectId) await projectFor(context, command.projectId);
      await rateCardService.update(context, command.rates);
      return { message: "작업 단가를 저장했습니다.", redirect: command.projectId ? `/projects/${command.projectId}/estimate` : undefined };
    }
    case "credits.save": await prisma.workspace.update({ where: { id: context.workspaceId }, data: { creditLimit: command.creditLimit, userCreditLimit: command.userCreditLimit } }); break;
    case "estimate.item": await aiWorkflowService.updateEstimate(context, command.projectId, { items: [{ requirementId: command.requirementId, hours: command.hours, reason: command.reason, complexity: "MEDIUM", reviewed: true }] }); break;
    case "estimate.total": await aiWorkflowService.updateEstimate(context, command.projectId, { overrideTotal: command.overrideTotal, adjustmentReason: command.adjustmentReason }); break;
    case "scope.create":
    case "scope.edit": {
      const document = { description: command.description, excluded: lines(command.excluded), assumptions: lines(command.assumptions), integrations: lines(command.integrations), deliverables: lines(command.deliverables), durationDays: command.durationDays };
      if (command.action === "scope.create") await scopeService.create(context, command.projectId, { document });
      else await scopeService.update(context, command.projectId, command.scopeId, { document });
      break;
    }
    case "scope.withdraw": await scopeService.withdraw(context, command.projectId, command.scopeId); break;
    case "share.create": {
      if (command.purpose !== "QUESTIONS" && !command.targetId) throw new ApiError("TARGET_REQUIRED", "승인 대상 ID가 필요합니다.", 422);
      const link = command.purpose === "SCOPE" ? await scopeService.requestApproval(context, command.projectId, command.targetId!) : command.purpose === "CHANGE" ? await changeRequestService.requestApproval(context, command.projectId, command.targetId!) : await clientAccessService.create(context, command.projectId, "QUESTIONS");
      return { message: "고객 공유 링크를 발급했습니다.", link: `/client/${link.token}` };
    }
    case "share.revoke": {
      await prisma.$transaction(async tx => {
        await lockProject(tx, command.projectId);
        await projectFor(context, command.projectId, tx);
        const result = await tx.clientAccessToken.updateMany({ where: { id: command.tokenId, projectId: command.projectId }, data: { revokedAt: new Date() } });
        if (!result.count) throw notFound("ACCESS_LINK_NOT_FOUND", "공유 링크를 찾을 수 없습니다.");
      });
      break;
    }
    case "ai.run": {
      const project = await projectService.get(context, command.projectId);
      if (!project) throw notFound("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
      if (command.task === "initial") { if (!project.initialRequest) throw new ApiError("INITIAL_REQUEST_REQUIRED", "고객 원문 요청이 필요합니다.", 409); await aiWorkflowService.analyzeRequest(context, project.id, project.initialRequest.content, command.force); }
      if (command.task === "questions") await aiWorkflowService.generateQuestions(context, project.id, command.force);
      if (command.task === "requirements") await aiWorkflowService.generateRequirements(context, project.id, command.force);
      if (command.task === "estimate") await aiWorkflowService.estimate(context, project.id, command.force);
      return { message: "AI 검토 초안이 준비되었습니다. 내용을 확인한 뒤 반영해주세요." };
    }
    case "ai.apply": await aiWorkflowService.apply(context, command.projectId, command.task, command.revision, command.result); return { message: "검토한 결과를 반영했습니다." };
    case "change.create": {
      const change = await changeRequestService.create(context, command.projectId, command.request);
      return { message: "변경 요청을 만들었습니다.", redirect: `/projects/${command.projectId}/changes#${change.id}` };
    }
    case "change.analyze": await aiWorkflowService.compareChange(context, command.projectId, command.changeId, command.force); return { message: "비교 초안이 준비되었습니다. 담당자가 검토해 확정해주세요." };
    case "change.review": await changeRequestService.review(context, command.projectId, command.changeId, { request: command.request, review: comparisonSchema.parse(command), overrideAmount: command.overrideAmount, adjustmentReason: command.adjustmentReason }); break;
    case "change.withdraw":
    case "change.cancel": await changeRequestService.withdraw(context, command.projectId, command.changeId, command.action === "change.cancel"); break;
  }
  return { message: "저장했습니다." };
}

export async function createWorkspace(userId: string, name: string): Promise<Result> {
  const workspace = await workspaceService.create(userId, name);
  return { message: "Workspace가 생성되었습니다.", redirect: "/dashboard", workspaceId: workspace.id };
}
