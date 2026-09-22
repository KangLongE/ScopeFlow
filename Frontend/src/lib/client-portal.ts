import { backendApi } from "./api";
import type { Comparison, ScopeDocument } from "./model";

type Portal = {
  project: { name: string; status: string };
  workspaceName: string;
  purpose: "QUESTIONS" | "SCOPE" | "CHANGE";
  expiresAt: string;
  scope: { id: string; majorVersion: number; minorVersion: number; document: ScopeDocument; status: string; approvedAt: string | null; approvedBy: string | null } | null;
  change: { number: number; request: string; review: Comparison | null; amount: number; status: string; approvedAt: string | null; approvedBy: string | null; baseDeadline: string | null; newDeadline: string | null } | null;
  questions: { id: string; question: string; reason: string; answer: { content: string } | null }[];
};

export async function portalData(token: string) {
  const data = await backendApi<Portal>(`/api/v1/client-access/${encodeURIComponent(token)}`);
  return { ...data, scope: data.scope ? { ...data.scope, version: data.scope.minorVersion + 1 } : null, questions: data.questions.map((question) => ({ ...question, answer: question.answer?.content ?? null })) };
}
