import assert from "node:assert/strict";
import test from "node:test";

test("project to scope approval persists atomically", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET ??= `test-only-${"x".repeat(32)}`;
  process.env.BETTER_AUTH_URL ??= "http://localhost:3001";
  process.env.FRONTEND_URL ??= "http://localhost:3000";
  process.env.GROQ_API_KEY ??= "test-only";
  const [{ prisma }, { scopeService, clientAccessService }] = await Promise.all([import("@/lib/db/prisma"), import("@/lib/services/workflow.service")]);
  const suffix = crypto.randomUUID();
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), name: "Integration Owner", email: `${suffix}@example.invalid` } });
  const workspace = await prisma.workspace.create({ data: { name: `Integration ${suffix}`, members: { create: { userId: user.id, role: "OWNER" } }, rateCard: { create: { rates: { frontend: 50000, backend: 60000, design: 45000, qa: 40000 } } } } });
  const client = await prisma.client.create({ data: { workspaceId: workspace.id, name: "Client", email: "client@example.invalid" } });
  const project = await prisma.project.create({ data: { workspaceId: workspace.id, clientId: client.id, name: "Project" } });
  const requirement = await prisma.requirement.create({ data: { projectId: project.id, category: "기능", title: "로그인", description: "이메일로 로그인한다.", type: "FEATURE", priority: "HIGH", source: "OWNER_MANUAL" } });
  const estimate = await prisma.estimate.create({ data: { projectId: project.id, rates: { frontend: 50000, backend: 60000, design: 45000, qa: 40000 } } });
  await prisma.estimateItem.create({ data: { estimateId: estimate.id, requirementId: requirement.id, hours: { frontend: 2, backend: 2, design: 0, qa: 1 } } });
  const context = { userId: user.id, workspaceId: workspace.id, role: "OWNER" as const };
  const scope = await scopeService.create(context, project.id, {});
  const link = await scopeService.requestApproval(context, project.id, scope.id);
  await clientAccessService.decide(link.token, "APPROVE", "Client Approver", "");
  assert.equal((await prisma.scope.findUnique({ where: { id: scope.id } }))?.status, "APPROVED");
  assert.equal((await prisma.project.findUnique({ where: { id: project.id } }))?.status, "ACTIVE");
  await prisma.$disconnect();
});
