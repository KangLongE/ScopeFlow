import assert from "node:assert/strict";
import test from "node:test";

test("workspace exports are owner-only, contain only that company's data and exclude access credentials and AI diagnostics", { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET ??= `test-only-${"x".repeat(32)}`;
  process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
  process.env.FRONTEND_URL ??= "http://localhost:3100";
  process.env.GROQ_API_KEY = "test-only";
  const [{ prisma }, { exportWorkspace }] = await Promise.all([import("@/lib/db/prisma"), import("@/lib/services/workspace-export.service")]);
  const suffix = crypto.randomUUID();
  const user = await prisma.user.create({ data: { id: suffix, name: "Export owner", email: `${suffix}@example.invalid` } });
  const companies = await Promise.all(["A", "B"].map(name => prisma.workspace.create({ data: { name: `Company ${name} ${suffix}`, members: { create: { userId: user.id, role: "OWNER" } } } })));
  const ids = companies.map(c => c.id);
  try {
    for (const company of companies) {
      const client = await prisma.client.create({ data: { workspaceId: company.id, name: company.name, email: "client@example.invalid" } });
      const project = await prisma.project.create({ data: { workspaceId: company.id, clientId: client.id, name: company.name, aiDrafts: { rawResponse: "private-diagnostic" }, initialRequest: { create: { content: "Customer original request" } } } });
      await prisma.clientAccessToken.create({ data: { projectId: project.id, purpose: "QUESTIONS", tokenHash: `secret-hash-${company.id}`, expiresAt: new Date(Date.now() + 60000) } });
      await prisma.aIUsage.create({ data: { workspaceId: company.id, userId: user.id, projectId: project.id, action: "QUESTIONS", provider: "mock", model: "mock", promptVersion: "test", creditsUsed: 0, status: "FAILED", rawResponse: "private-provider-response", inputSnapshot: { mustNotExport: true } } });
    }
    const context = { userId: user.id, workspaceId: companies[0].id, role: "OWNER" as const };
    await assert.rejects(exportWorkspace({ ...context, role: "MEMBER" }), /소유자/);
    const body = await exportWorkspace(context), result = JSON.parse(body);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.workspace.id, companies[0].id);
    assert.equal(result.clients.length, 1); assert.equal(result.projects.length, 1); assert.equal(result.usage.length, 1);
    assert.equal(result.projects[0].initialRequest.content, "Customer original request");
    assert.equal(result.projects[0].name, companies[0].name);
    assert.ok(!body.includes(companies[1].id)); assert.ok(!body.includes(companies[1].name));
    for (const hidden of ["tokenHash", "accessTokens", "aiDrafts", "rawResponse", "inputSnapshot", "private-diagnostic", "private-provider-response", "secret-hash", "password", "accounts", "sessions"]) assert.ok(!body.includes(hidden), hidden);
    assert.equal(await prisma.auditLog.count({ where: { workspaceId: context.workspaceId, event: "WORKSPACE_EXPORTED" } }), 1);
  } finally {
    const where = { workspaceId: { in: ids } };
    const projects = await prisma.project.findMany({ where, select: { id: true } });
    const projectWhere = { projectId: { in: projects.map(p => p.id) } };
    await prisma.clientAccessToken.deleteMany({ where: projectWhere }); await prisma.aIUsage.deleteMany({ where }); await prisma.auditLog.deleteMany({ where });
    await prisma.initialRequest.deleteMany({ where: projectWhere }); await prisma.project.deleteMany({ where }); await prisma.client.deleteMany({ where });
    await prisma.workspaceMember.deleteMany({ where }); await prisma.workspace.deleteMany({ where: { id: { in: ids } } }); await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
