import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError, notFound } from "@/lib/errors";
import { requireEditable } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { audit, projectFor } from "./shared";

export const clientService = {
  list(context: SessionContext) { return prisma.client.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "desc" } }); },
  create(context: SessionContext, input: Omit<Prisma.ClientCreateManyInput, "workspaceId">) { return prisma.client.create({ data: { ...input, workspaceId: context.workspaceId } }); },
  async get(context: SessionContext, id: string) {
    const client = await prisma.client.findFirst({ where: { id, workspaceId: context.workspaceId }, include: { projects: { where: { deletedAt: null }, select: { id: true, name: true, status: true } } } });
    if (!client) throw notFound("CLIENT_NOT_FOUND", "고객을 찾을 수 없습니다.");
    return client;
  },
  async update(context: SessionContext, id: string, input: Prisma.ClientUpdateManyMutationInput) {
    const result = await prisma.client.updateMany({ where: { id, workspaceId: context.workspaceId }, data: input });
    if (!result.count) throw notFound("CLIENT_NOT_FOUND", "고객을 찾을 수 없습니다.");
    return this.get(context, id);
  },
  async remove(context: SessionContext, id: string) {
    await this.get(context, id);
    if (await prisma.project.count({ where: { workspaceId: context.workspaceId, clientId: id, deletedAt: null } })) throw new ApiError("CLIENT_IN_USE", "프로젝트가 있는 고객은 삭제할 수 없습니다.", 409);
    await prisma.client.delete({ where: { id } });
  },
};

export const projectService = {
  list(context: SessionContext) { return prisma.project.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, include: { client: { select: { id: true, name: true, company: true } }, changeRequests: { orderBy: { number: "desc" } } }, orderBy: { updatedAt: "desc" } }); },
  async create(context: SessionContext, input: Omit<Prisma.ProjectUncheckedCreateInput, "workspaceId">, initialContent?: string) {
    const client = await prisma.client.findFirst({ where: { id: input.clientId, workspaceId: context.workspaceId } });
    if (!client) throw notFound("CLIENT_NOT_FOUND", "고객을 찾을 수 없습니다.");
    return prisma.$transaction(async (tx) => {
      const project = await tx.project.create({ data: { ...input, workspaceId: context.workspaceId } });
      if (initialContent) await tx.initialRequest.create({ data: { projectId: project.id, content: initialContent } });
      await audit(tx, context, "PROJECT_CREATED", "Project", project.id, project.id, { name: project.name });
      return project;
    });
  },
  async get(context: SessionContext, id: string) {
    await projectFor(context, id);
    return prisma.project.findUnique({ where: { id }, include: { client: true, initialRequest: true, questions: { include: { answer: true }, orderBy: { position: "asc" } }, requirements: { orderBy: { createdAt: "asc" } }, estimate: { include: { items: true } }, scopes: { orderBy: [{ majorVersion: "desc" }, { minorVersion: "desc" }] }, changeRequests: { orderBy: { number: "desc" } }, accessTokens: { select: { id: true, purpose: true, expiresAt: true, revokedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } }, feedback: { orderBy: { createdAt: "desc" } }, auditLogs: { orderBy: { createdAt: "desc" }, take: 20 } } });
  },
  async update(context: SessionContext, id: string, input: Prisma.ProjectUpdateInput) {
    const project = await projectFor(context, id);
    requireEditable(project.status);
    return prisma.project.update({ where: { id }, data: { ...input, revision: { increment: 1 } } });
  },
  async remove(context: SessionContext, id: string) {
    const project = await projectFor(context, id);
    requireEditable(project.status);
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date(), revision: { increment: 1 } } });
  },
};

export const requirementService = {
  async list(context: SessionContext, projectId: string) { await projectFor(context, projectId); return prisma.requirement.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }); },
  async create(context: SessionContext, projectId: string, input: Prisma.RequirementUncheckedCreateWithoutProjectInput) {
    const project = await projectFor(context, projectId); requireEditable(project.status);
    return prisma.$transaction(async (tx) => {
      const requirement = await tx.requirement.create({ data: { ...input, projectId } });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      await audit(tx, context, "REQUIREMENT_CREATED", "Requirement", requirement.id, projectId, { title: requirement.title });
      return requirement;
    });
  },
  async update(context: SessionContext, projectId: string, id: string, input: Prisma.RequirementUpdateInput) {
    const project = await projectFor(context, projectId); requireEditable(project.status);
    const requirement = await prisma.requirement.findFirst({ where: { id, projectId } });
    if (!requirement) throw notFound("REQUIREMENT_NOT_FOUND", "요구사항을 찾을 수 없습니다.");
    return prisma.$transaction(async (tx) => {
      const updated = await tx.requirement.update({ where: { id }, data: input });
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      await audit(tx, context, "REQUIREMENT_UPDATED", "Requirement", id, projectId);
      return updated;
    });
  },
  async remove(context: SessionContext, projectId: string, id: string) {
    const project = await projectFor(context, projectId); requireEditable(project.status);
    if (await prisma.scopeRequirement.count({ where: { requirementId: id, scope: { status: { in: ["WAITING_APPROVAL", "APPROVED"] } } } })) throw new ApiError("REQUIREMENT_FROZEN", "승인 문서에 포함된 요구사항은 삭제할 수 없습니다.", 409);
    const result = await prisma.requirement.deleteMany({ where: { id, projectId } });
    if (!result.count) throw notFound("REQUIREMENT_NOT_FOUND", "요구사항을 찾을 수 없습니다.");
    await prisma.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
  },
};

export const questionService = {
  async list(context: SessionContext, projectId: string) { await projectFor(context, projectId); return prisma.clarificationQuestion.findMany({ where: { projectId }, include: { answer: true }, orderBy: { position: "asc" } }); },
  async answer(context: SessionContext, projectId: string, questionId: string, content: string, author: string) {
    const project = await projectFor(context, projectId); requireEditable(project.status);
    const question = await prisma.clarificationQuestion.findFirst({ where: { id: questionId, projectId } });
    if (!question) throw notFound("QUESTION_NOT_FOUND", "질문을 찾을 수 없습니다.");
    return prisma.clarificationAnswer.upsert({ where: { questionId }, create: { questionId, content, author }, update: { content, author } });
  },
};

export const rateCardService = {
  async get(context: SessionContext) { return (await prisma.rateCard.findUnique({ where: { workspaceId: context.workspaceId } })) ?? prisma.rateCard.create({ data: { workspaceId: context.workspaceId, rates: { frontend: 50_000, backend: 60_000, design: 45_000, qa: 40_000 } } }); },
  update(context: SessionContext, rates: Prisma.InputJsonValue) { return prisma.rateCard.upsert({ where: { workspaceId: context.workspaceId }, create: { workspaceId: context.workspaceId, rates }, update: { rates } }); },
};
