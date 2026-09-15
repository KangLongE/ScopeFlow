import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as s from "../db/schema";
import { AppError, audit, owner, projectFor, type Context } from "../security";
import { bump, editable, ensureEstimate } from "../commands";
import { id, initialSchema, questionsSchema, requirementsSchema, workSchema, requirementSchema, type ActionResult } from "../model";
import { generate } from "./service";
import { prompts } from "./prompts";

export const aiCommandSchema = z.object({ action: z.enum(["ai.run", "ai.apply"]), projectId: id, task: z.enum(["initial", "questions", "requirements", "estimate", "summary"]), force: z.boolean().default(false) });
export async function executeAI(ctx: Context, input: unknown): Promise<ActionResult> {
  owner(ctx); const cmd = aiCommandSchema.parse(input);
  if (cmd.action === "ai.apply") return db.transaction(async tx => {
    const project = await projectFor(ctx, cmd.projectId, tx, true); await editable(tx, project.id);
    const [draft] = await tx.select().from(s.aiDrafts).where(and(eq(s.aiDrafts.projectId, project.id), eq(s.aiDrafts.action, cmd.task)));
    if (!draft) throw new AppError("적용할 AI 초안이 없습니다.");
    if (draft.appliedAt) return { message: "이미 반영한 초안입니다." };
    if (draft.revision !== project.revision) throw new AppError("원본 정보가 변경되었습니다. 분석을 다시 실행해주세요.", 409);
    if (cmd.task === "initial" || cmd.task === "questions") {
      const generated = cmd.task === "initial" ? initialSchema.parse(draft.result).missingInformation : questionsSchema.parse(draft.result).questions;
      const existing = await tx.select().from(s.questions).where(eq(s.questions.projectId, project.id));
      const added = generated.filter(q => !existing.some(e => e.question === q.question));
      if (existing.length + added.length > 8) throw new AppError("기존 질문을 정리해주세요. 질문은 최대 8개까지 반영할 수 있습니다.");
      if (added.length) await tx.insert(s.questions).values(added.map((q, i) => ({ projectId: project.id, question: q.question, reason: q.reason, position: existing.length + i })));
    } else if (cmd.task === "requirements") {
      const generated = requirementsSchema.parse(draft.result).requirements;
      const existing = await tx.select().from(s.requirements).where(eq(s.requirements.projectId, project.id));
      const added = generated.filter(r => !existing.some(e => e.title === r.title));
      if (existing.length + added.length > 100) throw new AppError("한 프로젝트는 최대 100개의 요구사항을 관리할 수 있습니다.");
      if (added.length) await tx.insert(s.requirements).values(added.map(r => ({ ...r, projectId: project.id, source: "CLIENT_ANSWER" })));
    } else if (cmd.task === "estimate") {
      const generated = workSchema.parse(draft.result).items;
      const requirements = await tx.select({ id: s.requirements.id }).from(s.requirements).where(eq(s.requirements.projectId, project.id));
      if (generated.length !== requirements.length || new Set(generated.map(i => i.requirementId)).size !== requirements.length || generated.some(i => !requirements.some(r => r.id === i.requirementId))) throw new AppError("AI가 요구사항과 일치하지 않는 작업 시간을 반환했습니다. 직접 입력하거나 다시 생성해주세요.");
      const estimate = await ensureEstimate(tx, project.id, ctx.workspaceId);
      for (const item of generated) await tx.insert(s.estimateItems).values({ ...item, estimateId: estimate.id, reviewed: false }).onConflictDoUpdate({ target: [s.estimateItems.estimateId, s.estimateItems.requirementId], set: { hours: item.hours, complexity: item.complexity, reason: item.reason, reviewed: false } });
    } else throw new AppError("Scope 요약은 문서 편집 양식에서 검토 후 저장해주세요.");
    await tx.update(s.aiDrafts).set({ appliedAt: new Date() }).where(eq(s.aiDrafts.id, draft.id));
    await bump(tx, project.id); await audit(tx, ctx, project.id, "AI_DRAFT_APPLIED", cmd.task);
    return { message: cmd.task === "estimate" ? "견적 초안을 반영했습니다. 각 항목의 시간을 검토·저장해주세요." : "검토한 초안을 반영했습니다." };
  });
  const source = await db.transaction(async tx => {
    const project = await projectFor(ctx, cmd.projectId, tx, true); await editable(tx, project.id);
    if (["COMPLETED", "CANCELLED"].includes(project.status)) throw new AppError("종료된 프로젝트에는 AI 분석을 실행할 수 없습니다.");
    const [initial] = await tx.select().from(s.initialRequests).where(eq(s.initialRequests.projectId, project.id));
    const questions = await tx.select({ question: s.questions.question, answer: s.answers.content }).from(s.questions).leftJoin(s.answers, eq(s.questions.id, s.answers.questionId)).where(eq(s.questions.projectId, project.id));
    const requirements = await tx.select().from(s.requirements).where(eq(s.requirements.projectId, project.id));
    const compact = requirements.map(r => ({ id: r.id, ...requirementSchema.parse(r) }));
    if (["estimate", "summary"].includes(cmd.task) && !compact.length) throw new AppError("먼저 요구사항을 확정해주세요.");
    const input = cmd.task === "initial" ? { content: initial.content, budget: project.budget, deadline: project.deadline } : cmd.task === "estimate" || cmd.task === "summary" ? { requirements: compact } : { initialRequest: initial.content, questions, existingRequirements: compact };
    return { project, input };
  });
  const generated = await generate(ctx, source.project.id, cmd.task, source.input, { force: cmd.force });
  const result = prompts[cmd.task].schema.parse(generated.result);
  await db.transaction(async tx => {
    const current = await projectFor(ctx, cmd.projectId, tx, true); await editable(tx, current.id);
    if (current.revision !== source.project.revision) throw new AppError("분석 중 프로젝트가 수정되었습니다. 최신 내용으로 다시 분석해주세요.", 409);
    if (cmd.task === "initial") await tx.update(s.initialRequests).set({ analysis: result, updatedAt: new Date() }).where(eq(s.initialRequests.projectId, current.id));
    await tx.insert(s.aiDrafts).values({ projectId: current.id, action: cmd.task, result, revision: current.revision }).onConflictDoUpdate({ target: [s.aiDrafts.projectId, s.aiDrafts.action], set: { id: crypto.randomUUID(), result, revision: current.revision, appliedAt: null, createdAt: new Date() } });
  });
  return { message: generated.cached ? "저장된 분석 결과를 불러왔습니다. 추가 Credit은 사용하지 않았습니다." : "AI 초안이 준비되었습니다. 검토한 뒤 반영해주세요." };
}
