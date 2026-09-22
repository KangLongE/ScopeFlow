import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { backendApi, BackendError } from "./api";
import type { Comparison, Hours, Rates, ScopeDocument } from "./model";

export type Client = { id: string; name: string; email: string; company: string; phone: string; notes: string; createdAt: string };
export type Change = { id: string; projectId: string; number: number; baseScopeId: string; resultScopeId: string | null; request: string; analysis: Comparison | null; review: Comparison | null; status: string; rates: Rates; amount: number; adjustmentReason: string; reviewedBy: string | null; approvedAt: string | null; approvedBy: string | null; revision: number; createdAt: string };
export type ProjectSummary = { id: string; name: string; clientId: string; clientName: string; status: string; budget: number | null; deadline: string | null; referenceUrl: string; notes: string; revision: number; updatedAt: string; client: Pick<Client, "id" | "name" | "company">; changeRequests: Change[] };
type WorkspaceSummary = { id: string; name: string; creditLimit: number; userCreditLimit: number; members: { role: "OWNER" | "MEMBER" }[] };
type WorkspaceDetail = Omit<WorkspaceSummary, "members"> & { members: { id: string; role: "OWNER" | "MEMBER"; user: { id: string; name: string; email: string } }[]; auditLogs: { id: string; event: string; metadata: Record<string, unknown>; createdAt: string }[] };
type Session = { user: { id: string; name: string; email: string } } | null;
type Scope = { id: string; projectId: string; majorVersion: number; minorVersion: number; status: string; document: ScopeDocument; approvedAt: string | null; approvedBy: string | null; createdAt: string };
type EstimateItem = { id: string; requirementId: string; hours: Hours; complexity: string; reason: string; reviewed: boolean; amount?: number };
type ProjectDetail = Omit<ProjectSummary, "clientName" | "changeRequests"> & {
  client: Client;
  initialRequest: { id: string; content: string; analysis: unknown; updatedAt: string } | null;
  questions: { id: string; question: string; reason: string; position: number; answer: { id: string; content: string; author: string } | null }[];
  requirements: { id: string; category: string; title: string; description: string; type: string; priority: string; source: string; createdAt: string }[];
  estimate: { id: string; rates: Rates; overrideTotal: number | null; adjustmentReason: string; items: EstimateItem[] } | null;
  scopes: Omit<Scope, "version">[];
  changeRequests: Change[];
  accessTokens: { id: string; purpose: string; expiresAt: string; revokedAt: string | null; createdAt: string }[];
  feedback: { id: string; name: string; message: string; decision: string; createdAt: string }[];
  auditLogs: { id: string; event: string; metadata: Record<string, unknown>; createdAt: string }[];
};
export type Usage = { id: string; action: string; model: string; inputTokens: number; outputTokens: number; cachedTokens: number; estimatedCost: number; creditsUsed: number; promptVersion: string; status: string; createdAt: string };
type UsageResponse = { items: Usage[]; config: { provider: string; fastModel: string; standardModel: string; reasoningModel: string; timeoutMs: number } };

const dateOnly = (value: string | null) => value?.slice(0, 10) ?? null;

export const currentUser = cache(async () => {
  const session = await backendApi<Session>("/api/auth/get-session");
  if (!session) redirect("/login");
  return session.user;
});

export const currentContext = cache(async () => {
  const user = await currentUser();
  const memberships = await backendApi<WorkspaceSummary[]>("/api/v1/workspaces");
  if (!memberships.length) redirect("/onboarding");
  const selected = (await cookies()).get("scopeflow-workspace")?.value;
  const active = memberships.find((workspace) => workspace.id === selected) ?? memberships[0];
  const workspace = await backendApi<WorkspaceDetail>(`/api/v1/workspaces/${active.id}`, { workspaceId: active.id });
  return { user, workspace, workspaceId: workspace.id, role: active.members[0]?.role ?? "MEMBER", memberships: memberships.map(({ id, name }) => ({ id, name })) };
});

export const listClients = cache(async (workspaceId: string) => backendApi<Client[]>("/api/v1/clients", { workspaceId }));

export const listProjects = cache(async (workspaceId: string) => {
  const projects = await backendApi<(Omit<ProjectSummary, "clientName" | "deadline"> & { deadline: string | null })[]>("/api/v1/projects", { workspaceId });
  return projects.map((project) => ({ ...project, clientName: project.client.company || project.client.name, deadline: dateOnly(project.deadline) }));
});

export const getProject = cache(async (projectId: string) => {
  const ctx = await currentContext();
  try {
    const project = await backendApi<ProjectDetail>(`/api/v1/projects/${projectId}`, { workspaceId: ctx.workspaceId });
    return { ctx, project: { ...project, deadline: dateOnly(project.deadline) }, client: project.client };
  } catch (error) { if (error instanceof BackendError && error.status === 404) notFound(); throw error; }
});

export async function projectData(projectId: string) {
  const base = await getProject(projectId);
  const estimate = base.project.estimate;
  return {
    ...base,
    initial: base.project.initialRequest,
    questions: base.project.questions.map(({ answer, ...question }) => ({ question, answer })),
    requirements: base.project.requirements,
    scopes: base.project.scopes.map((scope) => ({ ...scope, version: scope.minorVersion + 1, document: scope.document as ScopeDocument })),
    changes: base.project.changeRequests,
    estimate,
    items: estimate?.items ?? [],
    tokens: base.project.accessTokens,
    feedback: base.project.feedback,
    audit: base.project.auditLogs,
  };
}

const usageResponse = cache(async (workspaceId: string) => backendApi<UsageResponse>("/api/v1/ai/usage", { workspaceId }));
const actions: Record<string, string> = { INITIAL_ANALYSIS: "initial", QUESTIONS: "questions", REQUIREMENTS: "requirements", ESTIMATE: "estimate", SCOPE_SUMMARY: "summary", SCOPE_COMPARISON: "compare" };
export async function monthlyUsage(workspaceId: string) { return (await usageResponse(workspaceId)).items.map((item) => ({ ...item, action: actions[item.action] ?? item.action })); }
export async function aiConfiguration(workspaceId: string) { return (await usageResponse(workspaceId)).config; }
export async function rateCard(workspaceId: string) { return backendApi<{ rates: Rates }>("/api/v1/rate-card", { workspaceId }); }
