import { z } from "zod";

export const text = z.string().trim().min(1).max(5000);
export const title = z.string().trim().min(1).max(160);
export const id = z.string().min(1).max(100);
export const money = z.number().int().min(0).max(1_000_000_000_000);
export const hoursSchema = z.object({ frontend: z.number().min(0).max(2000), backend: z.number().min(0).max(2000), design: z.number().min(0).max(2000), qa: z.number().min(0).max(2000) });
export const rateSchema = z.object({ frontend: money, backend: money, design: money, qa: money });
export const requirementSchema = z.object({
  category: title, title, description: text,
  type: z.enum(["FEATURE", "NON_FUNCTIONAL", "DESIGN", "INFRA", "EXTERNAL_INTEGRATION"]),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
});
export const questionSchema = z.object({ key: title, question: text, reason: text });
export const initialSchema = z.object({ projectType: title, summary: text, features: z.array(requirementSchema.extend({ confidence: z.number().min(0).max(1) })).min(1).max(40), budget: z.object({ amount: money.nullable(), currency: z.literal("KRW") }), desiredDeadline: z.string().nullable(), missingInformation: z.array(questionSchema).max(8) });
export const questionsSchema = z.object({ questions: z.array(questionSchema).max(8) });
export const requirementsSchema = z.object({ requirements: z.array(requirementSchema).min(1).max(60) });
export const workSchema = z.object({ items: z.array(z.object({ requirementId: id, hours: hoursSchema, complexity: z.enum(["LOW", "MEDIUM", "HIGH"]), reason: text })).min(1).max(60) });
export const summarySchema = z.object({ description: text, excluded: z.array(text).max(30), assumptions: z.array(text).max(30), integrations: z.array(text).max(30), deliverables: z.array(text).min(1).max(30) });
export const classificationSchema = z.enum(["IN_SCOPE", "PARTIALLY_IN_SCOPE", "OUT_OF_SCOPE", "UNCERTAIN"]);
export const comparisonSchema = z.object({ classification: classificationSchema, confidence: z.number().min(0).max(1), reason: text, newRequirements: z.array(requirementSchema).max(30), affectedExistingRequirements: z.array(id).max(30), removedExclusions: z.array(text).max(30), estimatedWork: hoursSchema, scheduleImpactDays: z.number().int().min(0).max(365) });
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "올바른 날짜를 입력해주세요.");
export const roles = ["frontend", "backend", "design", "qa"] as const;
export const roleLabels = { frontend: "Frontend", backend: "Backend", design: "Design", qa: "QA" };
export const defaultRates = { frontend: 50000, backend: 60000, design: 45000, qa: 40000 };
export const zeroHours = { frontend: 0, backend: 0, design: 0, qa: 0 };
export type Hours = z.infer<typeof hoursSchema>;
export type Rates = z.infer<typeof rateSchema>;
export type RequirementInput = z.infer<typeof requirementSchema>;
export type RequirementSnapshot = RequirementInput & { id: string; source: string };
export type EstimateLine = { requirementId: string; title: string; hours: Hours; complexity: string; reason: string; amount: number };
export type ScopeDocument = z.infer<typeof summarySchema> & { requirements: RequirementSnapshot[]; estimate: { items: EstimateLine[]; rates: Rates; subtotal: number; total: number; adjustmentReason: string }; durationDays: number; deadline: string | null };
export type Comparison = z.infer<typeof comparisonSchema>;
export type ActionResult = { error?: string; message?: string; redirect?: string; link?: string };

export function calculateAmount(hours: Hours, rates: Rates) {
  hoursSchema.parse(hours); rateSchema.parse(rates);
  const total = roles.reduce((sum, role) => sum + Math.round(hours[role] * rates[role]), 0);
  return money.parse(total);
}
export function addDays(date: string | null, days: number) {
  if (!date) return null;
  dateSchema.parse(date); z.number().int().min(0).max(3650).parse(days);
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const won = (value: number) => new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
export const dateLabel = (value: Date | string | null) => value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value)) : "미정";
export const labels: Record<string, string> = {
  DRAFT: "초안", REQUIREMENT_GATHERING: "요구사항 정리", WAITING_SCOPE_APPROVAL: "Scope 승인 대기", ACTIVE: "진행 중", WAITING_CHANGE_APPROVAL: "변경 승인 대기", COMPLETED: "완료", CANCELLED: "취소",
  WAITING_APPROVAL: "승인 대기", APPROVED: "승인 완료", SUPERSEDED: "이전 버전", WAITING_INTERNAL_REVIEW: "내부 검토", WAITING_CLIENT_APPROVAL: "고객 승인 대기", REJECTED: "거절됨",
  IN_SCOPE: "기존 범위에 포함", PARTIALLY_IN_SCOPE: "일부 포함", OUT_OF_SCOPE: "추가 범위", UNCERTAIN: "담당자 확인 필요",
  FEATURE: "기능", NON_FUNCTIONAL: "비기능", DESIGN: "디자인", INFRA: "인프라", EXTERNAL_INTEGRATION: "외부 연동", HIGH: "높음", MEDIUM: "보통", LOW: "낮음",
  CLIENT_INITIAL: "최초 문의", CLIENT_ANSWER: "고객 답변", OWNER_MANUAL: "직접 입력", CHANGE_REQUEST: "변경 요청",
  initial: "요구사항 분석", questions: "추가 질문", requirements: "요구사항 생성", estimate: "작업량 추정", summary: "Scope 요약", compare: "Scope 비교", SUCCESS: "완료", FAILED: "실패", PENDING: "처리 중",
};
