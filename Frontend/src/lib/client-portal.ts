import { backendApi } from "./api";
import type { Comparison, ScopeDocument } from "./model";
import type { ChangeApprovalImpact } from "./change-approval-impact";

type Portal = {
  receipt: { decision: string; name: string; createdAt: string } | null;
  project: { name: string; status: string };
  workspaceName: string;
  purpose: "QUESTIONS" | "SCOPE" | "CHANGE";
  expiresAt: string;
  scope: { id: string; majorVersion: number; minorVersion: number; document: ScopeDocument; status: string; approvedAt: string | null; approvedBy: string | null } | null;
  change: { id: string; number: number; request: string; review: (Pick<Comparison, "classification" | "reason" | "scheduleImpactDays" | "removedExclusions"> & { newRequirements: { title: string; description: string }[] }) | null; amount: number | null; status: string; approvedAt: string | null; approvedBy: string | null; baseVersion: string; resultScope: { id: string; majorVersion: number; minorVersion: number } | null; baseDeadline: string | null; newDeadline: string | null; impact: ChangeApprovalImpact } | null;
  questions: { id: string; question: string; reason: string; answer: { content: string; author: string } | null }[];
};

export async function portalData(token: string) {
  const data = await backendApi<Portal>(`/api/v1/client-access/${encodeURIComponent(token)}`);
  return { ...data, scope: data.scope ? { ...data.scope, version: `${data.scope.majorVersion}.${data.scope.minorVersion}` } : null, questions: data.questions.map((question) => ({ ...question, author: question.answer?.author ?? "", answer: question.answer?.content ?? null })) };
}
