import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, notFound } from "@/lib/errors";
import { requireEditable, requireOwner } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { calculateAmount, comparisonSchema, hoursSchema, idSchema, moneySchema, ratesSchema, requirementInputSchema, textSchema, titleSchema } from "@/lib/model";
import { aiWorkflowService } from "./ai-workflow.service";
import { clientService, projectService, rateCardService, requirementService } from "./core.service";
import { projectFor } from "./shared";
import { changeRequestService, clientAccessService, scopeService } from "./workflow.service";
import { workspaceService } from "./workspace.service";

const optionalMoney = z.union([moneySchema, z.literal(""), z.null()]).transform((value) => value === "" ? null : value);
const optionalDate = z.union([z.string().date(), z.literal(""), z.null()]).transform((value) => value ? new Date(`${value}T00:00:00.000Z`) : null);
const notes = z.string().trim().max(5000).default("");
const clientInput = z.object({ name: titleSchema, email: z.string().email().max(320), company: z.string().trim().max(160).default(""), phone: z.string().trim().max(50).default(""), notes });
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
  z.object({ action: z.literal("project.create"), ...projectInput.shape, content: textSchema }),
  z.object({ action: z.literal("project.update"), projectId: idSchema, ...projectInput.shape }),
  z.object({ action: z.literal("project.status"), projectId: idSchema, status: z.enum(["COMPLETED", "CANCELLED", "ACTIVE"]) }),
  z.object({ action: z.literal("project.delete"), projectId: idSchema }),
  z.object({ action: z.literal("initial.save"), projectId: idSchema, content: textSchema }),
  z.object({ action: z.literal("question.save"), projectId: idSchema, questionId: idSchema.optional(), question: textSchema, reason: notes }),
  z.object({ action: z.literal("question.delete"), projectId: idSchema, questionId: idSchema }),
  z.object({ action: z.literal("answer.save"), projectId: idSchema, questionId: idSchema, content: textSchema }),
  z.object({ action: z.literal("requirement.save"), projectId: idSchema, requirementId: idSchema.optional(), ...requirementInputSchema.shape }),
  z.object({ action: z.literal("requirement.delete"), projectId: idSchema, requirementId: idSchema }),
  z.object({ action: z.literal("rates.save"), rates: ratesSchema }),
  z.object({ action: z.literal("credits.save"), creditLimit: z.coerce.number().int().min(0).max(10000), userCreditLimit: z.coerce.number().int().min(0).max(10000) }),
  z.object({ action: z.literal("estimate.item"), projectId: idSchema, requirementId: idSchema, hours: hoursSchema, reason: textSchema }),
  z.object({ action: z.literal("estimate.total"), projectId: idSchema, overrideTotal: optionalMoney, adjustmentReason: notes }),
  z.object({ action: z.literal("scope.create"), projectId: idSchema, description: textSchema, excluded: notes, assumptions: notes, integrations: notes, deliverables: textSchema, durationDays: z.coerce.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("scope.edit"), projectId: idSchema, scopeId: idSchema, description: textSchema, excluded: notes, assumptions: notes, integrations: notes, deliverables: textSchema, durationDays: z.coerce.number().int().min(1).max(3650) }),
  z.object({ action: z.literal("scope.withdraw"), projectId: idSchema, scopeId: idSchema }),
  z.object({ action: z.literal("share.create"), projectId: idSchema, purpose: z.enum(["QUESTIONS", "SCOPE", "CHANGE"]), targetId: idSchema.optional() }),
  z.object({ action: z.literal("share.revoke"), projectId: idSchema, tokenId: idSchema }),
  z.object({ action: z.literal("ai.run"), projectId: idSchema, task: z.enum(["initial", "questions", "requirements", "estimate"]), force: z.boolean().default(false) }),
  z.object({ action: z.literal("ai.apply"), projectId: idSchema, task: z.enum(["initial", "questions", "requirements", "estimate"]), force: z.boolean().default(false) }),
  z.object({ action: z.literal("change.create"), projectId: idSchema, request: textSchema }),
  z.object({ action: z.literal("change.analyze"), projectId: idSchema, changeId: idSchema, force: z.boolean().default(false) }),
  z.object({ action: z.literal("change.review"), projectId: idSchema, changeId: idSchema, request: textSchema, classification: comparisonSchema.shape.classification, confidence: z.coerce.number().min(0).max(1), reason: textSchema, newRequirements: requirementArray, affectedExistingRequirements: z.preprocess((value) => typeof value === "string" ? value.split(",").filter(Boolean) : value, z.array(idSchema).max(30)).default([]), removedExclusions: stringArray.default([]), estimatedWork: hoursSchema, scheduleImpactDays: z.coerce.number().int().min(0).max(365), overrideAmount: optionalMoney, adjustmentReason: notes }),
  z.object({ action: z.literal("change.withdraw"), projectId: idSchema, changeId: idSchema }),
  z.object({ action: z.literal("change.cancel"), projectId: idSchema, changeId: idSchema }),
]);

type Command = z.infer<typeof commandSchema>;
type Result = { message?: string; redirect?: string; link?: string; workspaceId?: string };
const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function requireQuestion(context: SessionContext, projectId: string, questionId: string) {
  await projectFor(context, projectId);
  const question = await prisma.clarificationQuestion.findFirst({ where: { id: questionId, projectId } });
  if (!question) throw notFound("QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
  return question;
}

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
      const input = projectInput.parse(command);
      const project = await projectService.create(context, input, command.content);
      return { redirect: `/projects/${project.id}` };
    }
    case "project.update": {
      const input = projectInput.omit({ clientId: true }).parse(command);
      await projectService.update(context, command.projectId, input);
      break;
    }
    case "project.status": {
      const project = await projectFor(context, command.projectId);
      if (["WAITING_SCOPE_APPROVAL", "WAITING_CHANGE_APPROVAL"].includes(project.status)) throw new ApiError("APPROVAL_PENDING", "진행 중인 승인 요청을 먼저 처리해주세요.", 409);
      if (command.status !== "CANCELLED" && !await prisma.scope.count({ where: { projectId: project.id, status: "APPROVED" } })) throw new ApiError("SCOPE_APPROVAL_REQUIRED", "Scope 승인 후 변경할 수 있는 상태입니다.", 409);
      await prisma.project.update({ where: { id: project.id }, data: { status: command.status } });
      break;
    }
    case "project.delete": await projectService.remove(context, command.projectId); return { redirect: "/projects" };
    case "initial.save": {
      const project = await projectFor(context, command.projectId); requireEditable(project.status);
      await prisma.$transaction([prisma.initialRequest.upsert({ where: { projectId: project.id }, create: { projectId: project.id, content: command.content }, update: { content: command.content, analysis: Prisma.JsonNull } }), prisma.project.update({ where: { id: project.id }, data: { revision: { increment: 1 } } })]);
      break;
    }
    case "question.save": {
      const project = await projectFor(context, command.projectId); requireEditable(project.status);
      if (command.questionId) { await requireQuestion(context, project.id, command.questionId); await prisma.clarificationQuestion.update({ where: { id: command.questionId }, data: { question: command.question, reason: command.reason } }); }
      else { const count = await prisma.clarificationQuestion.count({ where: { projectId: project.id } }); if (count >= 8) throw new ApiError("QUESTION_LIMIT", "질문은 최대 8개까지 관리할 수 있습니다.", 409); await prisma.clarificationQuestion.create({ data: { projectId: project.id, question: command.question, reason: command.reason, position: count } }); }
      await prisma.project.update({ where: { id: project.id }, data: { revision: { increment: 1 } } });
      break;
    }
    case "question.delete": {
      const project = await projectFor(context, command.projectId); requireEditable(project.status); await requireQuestion(context, project.id, command.questionId);
      await prisma.clarificationQuestion.delete({ where: { id: command.questionId } });
      await prisma.project.update({ where: { id: project.id }, data: { revision: { increment: 1 } } });
      break;
    }
    case "answer.save": await requireQuestion(context, command.projectId, command.questionId); await prisma.$transaction([prisma.clarificationAnswer.upsert({ where: { questionId: command.questionId }, create: { questionId: command.questionId, content: command.content, author: context.userId }, update: { content: command.content, author: context.userId } }), prisma.project.update({ where: { id: command.projectId }, data: { revision: { increment: 1 } } })]); break;
    case "requirement.save": {
      const input = requirementInputSchema.parse(command);
      if (command.requirementId) await requirementService.update(context, command.projectId, command.requirementId, input);
      else await requirementService.create(context, command.projectId, { ...input, source: "OWNER_MANUAL" });
      break;
    }
    case "requirement.delete": await requirementService.remove(context, command.projectId, command.requirementId); break;
    case "rates.save": await rateCardService.update(context, command.rates); break;
    case "credits.save": await prisma.workspace.update({ where: { id: context.workspaceId }, data: { creditLimit: command.creditLimit, userCreditLimit: command.userCreditLimit } }); break;
    case "estimate.item": {
      await projectFor(context, command.projectId);
      if (!await prisma.requirement.count({ where: { id: command.requirementId, projectId: command.projectId } })) throw notFound("REQUIREMENT_NOT_FOUND", "요구사항을 찾을 수 없습니다.");
      const rateCard = await rateCardService.get(context);
      const estimate = await prisma.estimate.upsert({ where: { projectId: command.projectId }, create: { projectId: command.projectId, rates: rateCard.rates as Prisma.InputJsonValue }, update: {} });
      await prisma.estimateItem.upsert({ where: { estimateId_requirementId: { estimateId: estimate.id, requirementId: command.requirementId } }, create: { estimateId: estimate.id, requirementId: command.requirementId, hours: jsonValue(command.hours), reason: command.reason, reviewed: true }, update: { hours: jsonValue(command.hours), reason: command.reason, reviewed: true } });
      break;
    }
    case "estimate.total": await aiWorkflowService.updateEstimate(context, command.projectId, { overrideTotal: command.overrideTotal, adjustmentReason: command.adjustmentReason }); break;
    case "scope.create":
    case "scope.edit": {
      const document = { description: command.description, excluded: lines(command.excluded), assumptions: lines(command.assumptions), integrations: lines(command.integrations), deliverables: lines(command.deliverables), durationDays: command.durationDays };
      if (command.action === "scope.create") await scopeService.create(context, command.projectId, { document });
      else await scopeService.update(context, command.projectId, command.scopeId, { document });
      break;
    }
    case "scope.withdraw": {
      const scope = await scopeService.get(context, command.projectId, command.scopeId);
      if (scope.status !== "WAITING_APPROVAL") throw new ApiError("SCOPE_NOT_WAITING", "승인 대기 중인 Scope가 아닙니다.", 409);
      await prisma.$transaction([prisma.scope.update({ where: { id: scope.id }, data: { status: "DRAFT" } }), prisma.project.update({ where: { id: command.projectId }, data: { status: "REQUIREMENT_GATHERING" } }), prisma.clientAccessToken.updateMany({ where: { scopeId: scope.id, revokedAt: null }, data: { revokedAt: new Date() } })]);
      break;
    }
    case "share.create": {
      if (command.purpose !== "QUESTIONS" && !command.targetId) throw new ApiError("TARGET_REQUIRED", "승인 대상 ID가 필요합니다.", 422);
      const link = command.purpose === "SCOPE" ? await scopeService.requestApproval(context, command.projectId, command.targetId!) : command.purpose === "CHANGE" ? await changeRequestService.requestApproval(context, command.projectId, command.targetId!) : await clientAccessService.create(context, command.projectId, "QUESTIONS");
      return { message: "고객 공유 링크를 발급했습니다.", link: `/client/${link.token}` };
    }
    case "share.revoke": {
      await projectFor(context, command.projectId);
      const result = await prisma.clientAccessToken.updateMany({ where: { id: command.tokenId, projectId: command.projectId }, data: { revokedAt: new Date() } });
      if (!result.count) throw notFound("ACCESS_LINK_NOT_FOUND", "공유 링크를 찾을 수 없습니다.");
      break;
    }
    case "ai.run": {
      const project = await projectService.get(context, command.projectId);
      if (!project) throw notFound("PROJECT_NOT_FOUND", "프로젝트를 찾을 수 없습니다.");
      if (command.task === "initial") { if (!project.initialRequest) throw new ApiError("INITIAL_REQUEST_REQUIRED", "고객 원문 요청이 필요합니다.", 409); await aiWorkflowService.analyzeRequest(context, project.id, project.initialRequest.content, command.force); }
      if (command.task === "questions") await aiWorkflowService.generateQuestions(context, project.id, command.force);
      if (command.task === "requirements") await aiWorkflowService.generateRequirements(context, project.id, command.force);
      if (command.task === "estimate") await aiWorkflowService.estimate(context, project.id, command.force);
      return { message: "AI 결과를 생성해 프로젝트에 반영했습니다." };
    }
    case "ai.apply": return { message: "AI 결과는 생성과 동시에 반영됩니다." };
    case "change.create": {
      const change = await changeRequestService.create(context, command.projectId, command.request);
      return { message: "변경 요청을 만들었습니다.", redirect: `/projects/${command.projectId}/changes#${change.id}` };
    }
    case "change.analyze": await aiWorkflowService.compareChange(context, command.projectId, command.changeId, command.force); return { message: "비교 초안이 준비되었습니다. 담당자가 검토해 확정해주세요." };
    case "change.review": {
      await projectFor(context, command.projectId);
      const change = await prisma.changeRequest.findFirst({ where: { id: command.changeId, projectId: command.projectId } });
      if (!change || !["DRAFT", "WAITING_INTERNAL_REVIEW"].includes(change.status)) throw new ApiError("CHANGE_NOT_EDITABLE", "검토할 수 없는 변경 요청입니다.", 409);
      const base = await prisma.scope.findFirst({ where: { id: change.baseScopeId, projectId: command.projectId, status: "APPROVED" } });
      if (!base) throw new ApiError("SCOPE_VERSION_CHANGED", "기준 Scope가 변경되었습니다.", 409);
      const review = comparisonSchema.parse(command);
      const document = base.document as { requirements?: { id: string; title: string }[]; excluded?: string[] };
      if (review.affectedExistingRequirements.some((id) => !document.requirements?.some((item) => item.id === id)) || review.removedExclusions.some((item) => !document.excluded?.includes(item))) throw new ApiError("INVALID_REVIEW", "현재 Scope에 없는 항목이 포함되어 있습니다.", 422);
      if (review.classification === "IN_SCOPE" && (review.newRequirements.length || review.removedExclusions.length || Object.values(review.estimatedWork).some(Boolean) || review.scheduleImpactDays || command.overrideAmount)) throw new ApiError("INVALID_IN_SCOPE_REVIEW", "기존 범위 요청에는 추가 작업·비용·일정을 넣을 수 없습니다.", 422);
      if (!["IN_SCOPE", "UNCERTAIN"].includes(review.classification) && !review.newRequirements.length) throw new ApiError("NEW_REQUIREMENT_REQUIRED", "추가되는 요구사항을 하나 이상 입력해주세요.", 422);
      if (command.overrideAmount !== null && !command.adjustmentReason) throw new ApiError("ADJUSTMENT_REASON_REQUIRED", "추가 금액 조정 이유가 필요합니다.", 422);
      const amount = command.overrideAmount ?? calculateAmount(review.estimatedWork, ratesSchema.parse(change.rates));
      await prisma.changeRequest.update({ where: { id: change.id }, data: { request: command.request, review: jsonValue(review), amount, adjustmentReason: command.adjustmentReason, reviewedBy: review.classification === "UNCERTAIN" ? null : context.userId, status: review.classification === "UNCERTAIN" ? "WAITING_INTERNAL_REVIEW" : "DRAFT", revision: { increment: 1 } } });
      break;
    }
    case "change.withdraw":
    case "change.cancel": {
      await projectFor(context, command.projectId);
      const change = await prisma.changeRequest.findFirst({ where: { id: command.changeId, projectId: command.projectId } });
      if (!change) throw notFound("CHANGE_NOT_FOUND", "변경 요청을 찾을 수 없습니다.");
      await prisma.$transaction([prisma.clientAccessToken.updateMany({ where: { changeRequestId: change.id, revokedAt: null }, data: { revokedAt: new Date() } }), prisma.changeRequest.update({ where: { id: change.id }, data: { status: command.action === "change.cancel" ? "CANCELLED" : "DRAFT", revision: { increment: 1 } } }), prisma.project.update({ where: { id: command.projectId }, data: { status: "ACTIVE" } })]);
      break;
    }
  }
  return { message: "저장했습니다." };
}

export async function createWorkspace(userId: string, name: string): Promise<Result> {
  const workspace = await workspaceService.create(userId, name);
  return { message: "Workspace가 생성되었습니다.", redirect: "/dashboard", workspaceId: workspace.id };
}
