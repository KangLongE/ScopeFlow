import { z } from "zod";
import { fingerprint } from "@/lib/fingerprint";
import { addDays, calculateAmount, comparisonSchema, estimateResultSchema, hoursSchema, initialAnalysisSchema, implementationSchema, moneySchema, questionsResultSchema, ratesSchema, requirementsResultSchema, scopeAIResultSchema, scopeSummarySchema } from "@/lib/model";
import type { ProjectAIContext } from "@/lib/services/ai-context.service";
import { sameExclusion, exclusionKind, publicExclusions, carryExclusions, type ExclusionReview } from "@/lib/scope-exclusions";
import { changeConditionProposals } from "@/lib/change-condition-proposals";

export const RULE_SET_VERSION = "1.2.0";
export type ValidationIssue = { issueId: string; ruleId: string; severity: "ERROR" | "WARNING" | "REVIEW_REQUIRED"; fieldPaths: string[]; message: string; sourceRefs: string[]; evidence: unknown; suggestions: string[]; issueFingerprint: string };
export type WarningAcknowledgement = { issueId: string; issueFingerprint: string; reason: string; userId: string; confirmedAt: string; candidateRevision: number; contextFingerprint: string; ruleSetVersion: string };
export type ValidationResult = { status: "blocked" | "review_required" | "passed" | "passed_with_warnings"; ruleSetVersion: string; contextFingerprint: string; candidateRevision: number; issues: ValidationIssue[]; evaluatedRules: string[] };
export const warningInputSchema = z.object({ issueId: z.string().max(200), issueFingerprint: z.string().max(100), reason: z.string().trim().min(1).max(5000) });
export type ValidationPolicy = {
  exclusionReview?: ExclusionReview;
  kind?: "AI" | "CHANGE" | "SCOPE" | "ESTIMATE";
  candidateRevision?: number; previousCandidate?: unknown; acknowledgements?: WarningAcknowledgement[];
  amounts?: { calculated: number; final: number; adjustmentReason: string };
  expectedScope?: { total: number; durationDays: number | null; items?: unknown[]; requirements?: unknown[]; rates?: unknown; deadline?: string | null };
  expectedDocumentFingerprint?: string;
  ruleSetVersion?: string;
};
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const list = (v: unknown): Obj[] => Array.isArray(v) ? v.map(obj) : [];
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
const roles = ["frontend", "backend", "design", "qa"] as const;
const normal = (v: string) => v.toLowerCase().replace(/[\s_.-]/g, "");
const excludedKey = (title: string) => `excluded:${fingerprint(title).slice(0, 16)}`;
const at = (value: unknown, path: string) => path.split(".").reduce<unknown>((v, key) => obj(v)[key] ?? (Array.isArray(v) ? v[Number(key)] : undefined), value);
const aliases: Record<string, string[]> = { PAYMENT: ["결제", "결제기능", "온라인결제", "payment", "paymentprocessing"], SIGNUP: ["회원가입", "회원가입기능", "signup", "userregistration"], ADMIN: ["관리자", "관리자기능", "관리자페이지", "관리자화면", "admin", "adminpage", "adminpanel"], EXTERNAL_INTEGRATION: ["외부연동", "외부프로젝트관리도구연동", "externalintegration", "externalintegrations"], SERVER: ["별도서버", "별도서버구현", "서버구현", "separateserverimplementation", "serverimplementation"] };
const featureKind = (title: string) => exclusionKind(title) ?? Object.entries(aliases).find(([, names]) => names.includes(normal(title)))?.[0];
const isExcluded = (v: unknown) => v === false || ["excluded", "none", "제외", "미포함"].includes(String(v).toLowerCase());
const isIncluded = (v: unknown) => v === true || ["included", "include", "포함"].includes(String(v).toLowerCase());
const suspect = (text: string, pattern: RegExp) => text.split(/[\n.!?]/).some(sentence => pattern.test(sentence) && !/제외|않|아닌|not\b|without\b|excluded\b/i.test(sentence));
const schemas = { INITIAL_ANALYSIS: initialAnalysisSchema, QUESTIONS: questionsResultSchema, REQUIREMENTS: requirementsResultSchema, ESTIMATE: estimateResultSchema, SCOPE_SUMMARY: scopeAIResultSchema, SCOPE_COMPARISON: comparisonSchema };
const scopeDocumentSchema = scopeSummarySchema.extend({ requirements: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), implementation: implementationSchema.nullable().optional() }).passthrough()), estimate: z.object({ items: z.array(z.object({ requirementId: z.string(), hours: hoursSchema, amount: moneySchema, reason: z.string(), calculatedAmount: moneySchema.optional(), rates: ratesSchema.optional(), adjustmentReason: z.string().optional() }).passthrough()), rates: ratesSchema, subtotal: moneySchema, total: moneySchema, adjustmentReason: z.string() }), durationDays: z.number().int().min(1).max(3650), deadline: z.string().nullable().optional() });
type Fact = { id: string; key: string; value: unknown; sourceRefs: string[]; title?: string; valid: boolean };

/** Deterministic and side-effect free: no provider call, DB access, coercion, or candidate rewrite. */
export function validateAIResult(context: ProjectAIContext, candidate: unknown, policy: ValidationPolicy = {}): ValidationResult {
  const ruleSetVersion = policy.ruleSetVersion ?? RULE_SET_VERSION;
  const result: ValidationResult = { status: "blocked", ruleSetVersion, contextFingerprint: context?.inputFingerprint ?? "UNVERIFIED", candidateRevision: policy.candidateRevision ?? 0, issues: [], evaluatedRules: [] };
  const c = obj(candidate);
  const replacements = () => [...list(obj(c.reviewNotes).constraints), ...changeConditionProposals(context, candidate)];
  function issue(ruleId: string, severity: ValidationIssue["severity"], fieldPaths: string[], message: string, sourceRefs: string[] = [], evidence: unknown = {}, suggestions: string[] = []) {
    const issueFingerprint = fingerprint({ ruleSetVersion, ruleId, severity, fieldPaths, evidence, values: fieldPaths.map(path => at(candidate, path)), sources: sourceRefs.map(id => context.sources.find(s => s.id === id)) });
    result.issues.push({ issueId: `${ruleId}:${issueFingerprint.slice(0, 24)}`, issueFingerprint, ruleId, severity, fieldPaths, message, sourceRefs, evidence, suggestions });
  }
  try {
    const stage = policy.kind ?? "AI";
    const schema = stage === "SCOPE" ? scopeDocumentSchema : schemas[context.operation];
    const parsed = schema.safeParse(candidate);
    result.evaluatedRules.push("RV-001");
    if (!parsed.success) {
      for (const error of parsed.error.issues) issue("RV-001", "ERROR", [error.path.join(".")], "필수 필드·형식·숫자 범위를 확인해주세요.", [], { code: error.code }, ["빈 값·문자열·음수를 0으로 바꾸지 말고 올바른 값을 입력하세요."]);
    } else {
      validateReferences();
      validateComparison();
      validateConditions();
      validateAmounts();
      validateScope();
      validateExplanations();
      if (context.operation === "SCOPE_COMPARISON" && stage !== "SCOPE" && context.approvedBaseline && context.approvedBaseline.isCurrent) validateProposedDocument();
    }
    if (!context.inputFingerprint) issue("RV-004", "REVIEW_REQUIRED", [], "입력 기준이 없습니다. 최신 Context로 다시 검토해주세요.");
  } catch {
    issue("RV-000", "ERROR", [], "검증 실행에 실패했습니다. 확인 없이 확정할 수 없습니다.", [], {}, ["검증 기준과 서버 상태를 확인하고 다시 검증하세요."]);
  }
  const warnings = result.issues.filter(i => i.severity === "WARNING");
  const accepted = (i: ValidationIssue) => policy.acknowledgements?.some(a => a.issueId === i.issueId && a.issueFingerprint === i.issueFingerprint && a.ruleSetVersion === ruleSetVersion && a.reason.trim() && a.userId);
  result.status = result.issues.some(i => i.severity === "ERROR") ? "blocked" : result.issues.some(i => i.severity === "REVIEW_REQUIRED") || warnings.some(i => !accepted(i)) ? "review_required" : warnings.length ? "passed_with_warnings" : "passed";
  return result;

  function validateReferences() {
    result.evaluatedRules.push("RV-002");
    const known = new Set(context.sources.map(s => s.id));
    const requirements = new Set([...context.existingRequirements.map(r => r.id), ...list(obj(context.approvedBaseline?.document).requirements).map(r => r.id)]);
    const visit = (v: unknown, path = "") => {
      if (Array.isArray(v)) { v.forEach((x, i) => visit(x, `${path}.${i}`)); return; }
      for (const [key, value] of Object.entries(obj(v))) {
        const p = path ? `${path}.${key}` : key;
        if (key === "sourceRefs" && strings(value).some(id => !known.has(id))) issue("RV-002", "ERROR", [p], "전달된 Context에 없는 출처입니다.");
        if (["existingRequirementId", "requirementId"].includes(key) && value && !requirements.has(value as string) && !(policy.kind === "SCOPE" && (policy.expectedScope?.items ?? []).some(i => obj(i).requirementId === value))) issue("RV-002", "ERROR", [p], "대상 프로젝트에 없는 요구사항 참조입니다.");
        if (policy.kind === "SCOPE" && key === "id" && /^requirements\.\d+$/.test(path) && !requirements.has(value as string)) issue("RV-002", "ERROR", [p], "대상 프로젝트에 없는 요구사항 스냅샷입니다.");
        if (["baseScopeId", "baselineScopeId"].includes(key) && value !== context.approvedBaseline?.id) issue("RV-002", "ERROR", [p], "지정 승인 Scope가 아닌 참조입니다.");
        if (key === "scopeId" && value !== context.approvedBaseline?.id && value !== context.scopeDraft?.id) issue("RV-002", "ERROR", [p], "대상 프로젝트에 없는 Scope 참조입니다.");
        if (key === "projectId" && value !== context.projectId || key === "workspaceId" && value !== context.workspaceId) issue("RV-002", "ERROR", [p], "다른 프로젝트 또는 Workspace 참조입니다.");
        visit(value, p);
      }
    };
    visit(candidate);
    if (policy.kind !== "SCOPE" && policy.kind !== "ESTIMATE" && !strings(obj(c.reviewNotes).sourceRefs).length) issue("RV-002", "REVIEW_REQUIRED", ["reviewNotes.sourceRefs"], "검토 결과의 실제 출처 기준을 연결해주세요.");
    for (const name of ["features", "requirements", "items", "questions", "newRequirements"]) list(c[name]).forEach((entry, i) => {
      if (!strings(entry.sourceRefs).length && policy.kind !== "ESTIMATE" && policy.kind !== "SCOPE") issue("RV-002", "ERROR", [`${name}.${i}.sourceRefs`], "항목의 실제 출처가 필요합니다.");
    });
    list(c.requirements).forEach((r, i) => {
      if (policy.kind !== "SCOPE" && (r.change === "ADD" && r.existingRequirementId || r.change !== "ADD" && !r.existingRequirementId)) issue("RV-002", "ERROR", [`requirements.${i}.existingRequirementId`], "신규 추가와 기존 항목 수정·제외 참조를 구분해주세요.");
    });
    const notes = obj(c.reviewNotes);
    for (const entry of [...list(notes.constraints), ...list(notes.excludedScope)]) {
      if (!strings(entry.sourceRefs).some(id => context.sources.find(s => s.id === id)?.text.includes(String(entry.evidence)))) issue("RV-002", "ERROR", ["reviewNotes"], "고객 조건의 인용 문장을 출처에서 확인할 수 없습니다.", strings(entry.sourceRefs));
      const previous = context.explicitCustomerConstraints.find(v => v.id === entry.id);
      const allowed = new Set([...context.explicitCustomerConstraints.map(v => v.id), ...context.confirmedExcludedScope.map(v => v.id), ...strings(obj(context.approvedBaseline?.document).excluded).map(excludedKey)]);
      if (strings(entry.supersedes).some(id => !allowed.has(id) || id === entry.id) || previous && (entry.key !== previous.key || entry.value !== previous.value || fingerprint([...strings(entry.supersedes)].sort()) !== fingerprint([...previous.supersedes].sort()))) issue("RV-002", "ERROR", ["reviewNotes.constraints"], "조건 변경은 새 ID와 올바른 대체 근거가 필요합니다.");
    }
    if (context.operation === "ESTIMATE" && policy.kind !== "SCOPE") {
      const ids = list(c.items).map(i => i.requirementId);
      if (ids.length !== context.confirmedRequirements.length || new Set(ids).size !== ids.length || context.confirmedRequirements.some(r => !ids.includes(r.id))) issue("RV-002", "ERROR", ["items"], "확정 요구사항마다 작업량이 정확히 한 번 필요합니다.");
    }
  }
  function validateComparison() {
    if (context.operation !== "SCOPE_COMPARISON" || policy.kind === "SCOPE") return;
    result.evaluatedRules.push("RV-003", "RV-004", "RV-014");
    const hours = hoursSchema.parse(c.estimatedWork);
    const calculated = calculateAmount(hours, ratesSchema.parse(context.changeRequest?.rates));
    const final = policy.amounts?.final ?? calculated;
    const changes = list(c.newRequirements).length + strings(c.removedExclusions).length;
    const paths = [...(changes ? ["newRequirements", "removedExclusions"] : []), ...roles.filter(r => hours[r] !== 0).map(r => `estimatedWork.${r}`), ...(final !== 0 ? ["additionalCost"] : []), ...(c.scheduleImpactDays !== 0 ? ["scheduleImpactDays"] : [])];
    if (c.classification === "IN_SCOPE" && paths.length) issue("RV-003", "ERROR", ["classification", ...paths], "기존 범위에 포함된 요청에는 추가 기능·작업량·금액·기간을 넣을 수 없습니다.", context.approvedBaseline ? [`scope:${context.approvedBaseline.id}`] : [], { features: list(c.newRequirements).map(r => r.title), hours, calculated, final, additionalDays: c.scheduleImpactDays, baselineVersion: context.approvedBaseline?.version }, ["기존 포함이 맞으면 추가 범위·청구 시간·금액·일수를 직접 제거하세요.", "새 범위가 맞으면 승인 문서 근거를 확인하고 판정을 수정하세요."]);
    if (!context.approvedBaseline || !context.approvedBaseline.isCurrent || !String(c.reason ?? "").trim() || c.classification === "UNCERTAIN") issue("RV-004", "REVIEW_REQUIRED", ["classification", "reason"], "승인 기준과 범위 판정 근거를 보완해주세요.");
    if (c.classification === "IN_SCOPE" && context.approvedBaseline && !strings(obj(c.reviewNotes).sourceRefs).includes(`scope:${context.approvedBaseline.id}`) && !strings(c.affectedExistingRequirements).length) issue("RV-004", "REVIEW_REQUIRED", ["reason", "affectedExistingRequirements"], "기존 포함 판정의 승인 Scope 근거를 연결해주세요.", [`scope:${context.approvedBaseline.id}`]);
    const baseline = obj(context.approvedBaseline?.document);
    if (strings(c.affectedExistingRequirements).some(id => !list(baseline.requirements).some(r => r.id === id)) || strings(c.removedExclusions).some(title => !strings(baseline.excluded).includes(title))) issue("RV-002", "ERROR", ["affectedExistingRequirements", "removedExclusions"], "승인 기준에 없는 항목입니다.");
    if (["OUT_OF_SCOPE", "PARTIALLY_IN_SCOPE"].includes(String(c.classification))) {
      if (!list(c.newRequirements).length) issue("RV-001", "ERROR", ["newRequirements"], "추가할 승인 범위 변경분을 입력해주세요.");
      if (changes && final === 0 && !String(c.noCostReason || policy.amounts?.adjustmentReason || "").trim()) issue("RV-014", "REVIEW_REQUIRED", ["noCostReason", "additionalCost"], "무상 범위 변경의 사유를 입력해주세요.", [], { calculated, final });
      if (changes && c.scheduleImpactDays === 0 && !String(c.noScheduleReason ?? "").trim()) issue("RV-014", "REVIEW_REQUIRED", ["noScheduleReason", "scheduleImpactDays"], "일정 영향이 없는 이유를 입력해주세요.");
    }
  }
  function facts(): Fact[] {
    const conditions: Fact[] = context.explicitCustomerConstraints.filter(v => v.active).map(v => ({ id: v.id, key: featureKind(v.key) ?? normal(v.key), value: v.value, sourceRefs: v.sourceRefs, valid: v.status === "explicit" && v.sourceRefs.some(id => context.sources.find(s => s.id === id)?.text.includes(v.evidence)) }));
    const exclusions = [...context.confirmedExcludedScope, ...strings(obj(context.approvedBaseline?.document).excluded).map(title => ({ id: excludedKey(title), title, sourceRefs: [`scope:${context.approvedBaseline!.id}`] }))];
    return [...conditions, ...exclusions.map(v => ({ id: v.id, key: featureKind(v.title) ?? "exclusion", title: v.title, value: false, sourceRefs: v.sourceRefs, valid: v.sourceRefs.some(id => context.sources.some(s => s.id === id)) }))];
  }
  function proposedReplacement(fact: Fact) {
    if (context.operation !== "SCOPE_COMPARISON" || c.classification === "IN_SCOPE" || !context.changeRequest) return false;
    return replacements().some(n => n.status === "explicit" && strings(n.supersedes).includes(fact.id) && isIncluded(n.value) && strings(n.sourceRefs).includes(`change:${context.changeRequest!.id}`) && context.sources.find(s => s.id === `change:${context.changeRequest!.id}`)?.text.includes(String(n.evidence)));
  }
  function validateConditions() {
    result.evaluatedRules.push("RV-005", "RV-006", "RV-007", "RV-008");
    const all = facts();
    for (const fact of all.filter(f => f.valid)) if (all.some(other => other.valid && other.id !== fact.id && other.key === fact.key && other.value !== fact.value && !other.title && !fact.title)) issue("RV-004", "REVIEW_REQUIRED", ["reviewNotes.constraints"], "확정 조건끼리 충돌합니다. 새 조건의 대체 관계를 확인해주세요.", fact.sourceRefs, { key: fact.key });
    const server = all.filter(f => ["SERVER", "serverimplementation", "server", "backendimplementation"].includes(f.key) && isExcluded(f.value) && !proposedReplacement(f));
    const pages = all.filter(f => ["pagecount", "pages", "page_count"].includes(f.key) && f.value === 1);
    const excluded = all.filter(f => Object.keys(aliases).filter(k => k !== "SERVER").includes(f.key) && isExcluded(f.value) && !proposedReplacement(f));
    const assets = all.filter(f => ["logoprovided", "menuprovided", "logoprovider", "menuprovider", "customerprovidedlogo", "customerprovidedmenu"].includes(f.key) && (f.value === true || ["customer", "client", "provided", "고객"].includes(String(f.value).toLowerCase())));
    const name = Array.isArray(c.features) ? "features" : Array.isArray(c.newRequirements) ? "newRequirements" : Array.isArray(c.requirements) ? "requirements" : Array.isArray(c.items) ? "items" : null;
    if (!name) return;
    const rows = list(c[name]);
    if (context.operation === "SCOPE_COMPARISON" && policy.kind !== "SCOPE" && server.some(f => f.valid) && Number(obj(c.estimatedWork).backend) > 0 && !rows.some(row => ["SERVER_API", "STATIC_TOOLING", "UNKNOWN"].includes(String(obj(row.implementation).serverWork)))) {
      issue("RV-005", String(c.reason ?? "").trim() ? "WARNING" : "REVIEW_REQUIRED", ["estimatedWork.backend", "reason"], "Backend 시간의 실제 작업 종류를 확인해주세요. 역할 시간만으로 서버 구현을 단정하지 않습니다.", server.flatMap(f => f.sourceRefs), { backendHours: obj(c.estimatedWork).backend });
    }
    rows.forEach((row, index) => {
      if (["REMOVE", "KEEP"].includes(String(row.change))) return;
      const stored = context.confirmedRequirements.find(r => r.id === row.requirementId);
      const implementation = row.implementation ?? obj(stored?.provenance).implementation;
      const attrs = implementationSchema.safeParse(implementation);
      const prefix = `${name}.${index}`;
      const relevant = [...server, ...pages, ...excluded, ...assets];
      if (!attrs.success && relevant.length) { issue("RV-005", "REVIEW_REQUIRED", [`${prefix}.implementation`], "중요한 범위 조건을 비교할 구현 속성이 없습니다. 작업 종류와 포함 범위를 보완해주세요.", [...new Set(relevant.flatMap(f => f.sourceRefs))]); return; }
      if (!attrs.success) return;
      const a = attrs.data;
      for (const f of relevant.filter(f => !f.valid)) issue("RV-004", "REVIEW_REQUIRED", [`${prefix}.implementation`], "확정 조건의 출처 또는 상태를 먼저 보완해주세요.", f.sourceRefs, { condition: f.key });
      const text = [row.title, row.description, row.reason].filter(v => typeof v === "string").join("\n");
      if (server.some(f => f.valid)) {
        if (a.serverWork === "SERVER_API") issue("RV-005", "ERROR", [`${prefix}.implementation.serverWork`], "명시적으로 제외된 별도 서버/API 구현 작업입니다.", server.flatMap(f => f.sourceRefs), { work: a.serverWork }, ["작업 종류를 바로잡거나 고객 조건 변경 절차를 진행하세요."]);
        else if (a.serverWork === "UNKNOWN") issue("RV-005", "REVIEW_REQUIRED", [`${prefix}.implementation.serverWork`], "별도 서버 구현 여부를 확인해주세요.", server.flatMap(f => f.sourceRefs));
        else if (obj(row.hours).backend as number > 0 && a.serverWork === "NONE") issue("RV-005", String(row.reason ?? "").trim() ? "WARNING" : "REVIEW_REQUIRED", [`${prefix}.hours.backend`, `${prefix}.reason`], "Backend 시간의 실제 작업 종류를 확인해주세요. 역할 시간만으로 서버 구현을 단정하지 않습니다.", server.flatMap(f => f.sourceRefs), { backendHours: obj(row.hours).backend });
        if (a.serverWork !== "SERVER_API" && suspect(text, /API\s*(?:구현|개발)|서버\s*(?:구현|개발)|implement.*(?:server|API)/i)) issue("RV-005", "WARNING", [`${prefix}.description`, `${prefix}.reason`], "설명의 서버/API 구현 표현이 구조 속성과 다른지 확인해주세요.", server.flatMap(f => f.sourceRefs));
      }
      if (pages.some(f => f.valid)) {
        if (a.pageCount !== null && a.pageCount > 1 || a.separatePage === true) issue("RV-006", "ERROR", [`${prefix}.implementation.pageCount`, `${prefix}.implementation.separatePage`], "같은 1페이지 조건과 별도 페이지 구현 속성이 충돌합니다.", pages.flatMap(f => f.sourceRefs), { pageCount: a.pageCount, separatePage: a.separatePage });
        else if ((a.pageCount === null || a.separatePage === null)) issue("RV-006", "REVIEW_REQUIRED", [`${prefix}.implementation`], "페이지 수와 별도 페이지 여부를 확인해주세요.", pages.flatMap(f => f.sourceRefs));
        if (suspect(text, /메뉴\s*페이지|separate.*page|menu page/i)) issue("RV-006", "WARNING", [`${prefix}.description`], "‘메뉴 페이지’가 별도 페이지인지 내부 섹션인지 설명을 확인해주세요.", pages.flatMap(f => f.sourceRefs));
      }
      for (const f of excluded.filter(f => f.valid)) {
        if (a.featureTypes.includes(f.key as z.infer<typeof implementationSchema>["featureTypes"][number])) issue("RV-007", "ERROR", [`${prefix}.implementation.featureTypes`], `제외된 ${f.title ?? f.key} 유형이 구현 범위에 포함되어 있습니다.`, f.sourceRefs, { featureTypes: a.featureTypes }, ["포함 유형을 바로잡거나 명시적 조건 변경 근거를 보완하세요."]);
        else if (!a.featureTypes.length) issue("RV-007", "REVIEW_REQUIRED", [`${prefix}.implementation.featureTypes`], "포함 기능 유형을 선택해주세요. 중요한 제외 조건을 판별할 수 없습니다.", f.sourceRefs);
        else {
          const pattern = { PAYMENT: /결제|payment/i, SIGNUP: /회원가입|signup|user registration/i, ADMIN: /관리자|admin/i, EXTERNAL_INTEGRATION: /외부.*연동|external.*integration/i }[f.key as "PAYMENT" | "SIGNUP" | "ADMIN" | "EXTERNAL_INTEGRATION"];
          if (pattern && suspect(text, pattern)) issue("RV-007", "WARNING", [`${prefix}.description`, `${prefix}.implementation.featureTypes`], "설명의 제외 기능 표현과 선택한 포함 유형이 다른지 확인해주세요.", f.sourceRefs, { condition: f.title ?? f.key, featureTypes: a.featureTypes });
        }
      }
      for (const f of assets.filter(f => f.valid)) {
        const asset = f.key.includes("logo") ? "LOGO" : "MENU";
        if (a.assets.some(w => w.asset === asset && w.work === "CREATE")) issue("RV-008", "ERROR", [`${prefix}.implementation.assets`], `고객 제공 ${asset === "LOGO" ? "로고" : "메뉴 자료"}를 신규 제작으로 산정할 수 없습니다.`, f.sourceRefs, { asset }, ["자료 적용·보정 작업과 신규 제작을 구분하세요."]);
        else if (suspect(text, asset === "LOGO" ? /로고.*(?:제작|디자인)|(?:create|design).*logo/i : /메뉴.*(?:제작|디자인)|(?:create|design).*menu/i)) issue("RV-008", "WARNING", [`${prefix}.description`, `${prefix}.implementation.assets`], "자료 제작 표현이 실제 신규 제작인지 제공 자료 적용·보정인지 확인해주세요.", f.sourceRefs, { asset });
      }
    });
  }
  function validateAmounts() {
    result.evaluatedRules.push("RV-009");
    if (policy.amounts) {
      if (!moneySchema.safeParse(policy.amounts.calculated).success || !moneySchema.safeParse(policy.amounts.final).success) issue("RV-001", "ERROR", ["additionalCost"], "계산 금액과 최종 금액이 올바른 원화 정수여야 합니다.");
      if (policy.amounts.final !== policy.amounts.calculated && !policy.amounts.adjustmentReason.trim()) issue("RV-009", "ERROR", ["additionalCost", "adjustmentReason"], "최종 금액 조정에는 사유가 필요합니다.", [], policy.amounts);
    }
    if (context.operation === "SCOPE_COMPARISON" && policy.kind !== "SCOPE" && c.calculatedAmount != null) {
      const expected = calculateAmount(hoursSchema.parse(c.estimatedWork), ratesSchema.parse(context.changeRequest?.rates));
      if (c.calculatedAmount !== expected) issue("RV-009", "ERROR", ["calculatedAmount"], "AI 계산 금액이 회사 단가와 추가 작업량의 서버 계산값과 다릅니다.", [], { claimed: c.calculatedAmount, expected });
    }
    if (context.operation === "SCOPE_COMPARISON" && policy.kind !== "SCOPE" && c.additionalCost != null) {
      const expected = policy.amounts?.final ?? calculateAmount(hoursSchema.parse(c.estimatedWork), ratesSchema.parse(context.changeRequest?.rates));
      if (c.additionalCost !== expected) issue("RV-009", "ERROR", ["additionalCost"], "제시된 추가 금액이 서버 계산·조정 금액과 다릅니다.", [], { claimed: c.additionalCost, expected });
    }
    if (context.operation === "ESTIMATE" && policy.kind !== "SCOPE") list(c.items).forEach((row, i) => {
      const rates = context.confirmedEstimate?.rates ?? context.rateCard;
      if (!rates) { issue("RV-009", "REVIEW_REQUIRED", [`items.${i}.hours`], "회사 단가 기준이 필요합니다."); return; }
      const expected = calculateAmount(hoursSchema.parse(row.hours), ratesSchema.parse(rates));
      if (row.calculatedAmount != null && row.calculatedAmount !== expected) issue("RV-009", "ERROR", [`items.${i}.calculatedAmount`], "작업량 × 저장 단가의 계산값과 다릅니다.", [], { expected, claimed: row.calculatedAmount });
    });
  }
  function validateScope() {
    if (context.operation !== "SCOPE_SUMMARY" && policy.kind !== "SCOPE") return;
    result.evaluatedRules.push("RV-010", "RV-011");
    const expected = policy.expectedScope ?? (context.confirmedEstimate ? { total: context.confirmedEstimate.total, durationDays: context.confirmedEstimate.durationDays, items: context.confirmedEstimate.items } : undefined);
    if (policy.expectedDocumentFingerprint && fingerprint(candidate) !== policy.expectedDocumentFingerprint) issue("RV-010", "ERROR", [], "발급된 승인 스냅샷이 변경되었습니다. 링크를 회수하고 다시 검토해주세요.");
    const metrics = policy.kind === "SCOPE" ? { ...obj(c.estimate), durationDays: c.durationDays } : obj(c.metrics);
    if (!expected) issue("RV-010", "REVIEW_REQUIRED", ["metrics"], "확정 견적·기간 기준을 먼저 저장해주세요.");
    else if (policy.kind === "SCOPE" || c.metrics != null) {
      if (metrics.total !== expected.total || expected.durationDays !== null && metrics.durationDays !== expected.durationDays) issue("RV-010", "ERROR", [policy.kind === "SCOPE" ? "estimate.total" : "metrics.total", policy.kind === "SCOPE" ? "durationDays" : "metrics.durationDays"], "Scope 금액·기간이 확정 스냅샷과 다릅니다.", context.confirmedEstimate ? [context.confirmedEstimate.sourceRef] : [], { expectedTotal: expected.total, expectedDays: expected.durationDays, actualTotal: metrics.total, actualDays: metrics.durationDays });
      if (expected.items && fingerprint(list(metrics.items).map(i => ({ requirementId: i.requirementId, hours: i.hours })).sort((a, b) => String(a.requirementId).localeCompare(String(b.requirementId)))) !== fingerprint(expected.items.map(obj).map(i => ({ requirementId: i.requirementId, hours: i.hours })).sort((a, b) => String(a.requirementId).localeCompare(String(b.requirementId))))) issue("RV-010", "ERROR", [policy.kind === "SCOPE" ? "estimate.items" : "metrics.items"], "Scope 작업량 표가 확정된 역할별 시간과 다릅니다.");
      if (policy.expectedScope && "deadline" in policy.expectedScope && (c.deadline ?? null) !== policy.expectedScope.deadline) issue("RV-010", "ERROR", ["deadline"], "확정 완료일과 다릅니다. 없는 날짜를 새로 만들 수 없습니다.");
    }
    const excluded = strings(c.excluded);
    const exclusionReview = policy.exclusionReview;
    if (policy.kind === "SCOPE" && exclusionReview) {
      const active = publicExclusions(exclusionReview);
      for (const item of exclusionReview.items.filter(i => i.state === "pending")) issue("RV-011", "REVIEW_REQUIRED", ["exclusions"], `고객 명시 제외 조건과 제안 후보를 확인해주세요: ${item.title}`, item.sourceRefs, { title: item.title });
      if (fingerprint(excluded) !== fingerprint(active.map(i => i.title)) || fingerprint(c.exclusions ?? null) !== fingerprint(active)) issue("RV-011", "ERROR", ["excluded", "exclusions"], "검토한 항목별 제외 목록과 문서의 제외 범위가 다릅니다.");
    }
    for (const fact of facts().filter(f => f.title && !proposedReplacement(f))) if (!excluded.some(title => sameExclusion(title, fact.title!))) issue("RV-011", "ERROR", ["excluded"], `필수 명시 제외 ‘${fact.title}’가 Scope에서 빠졌습니다.`, fact.sourceRefs, { excludedTitle: fact.title }, ["일반적인 추가 기능 제외 문구 대신 해당 항목을 개별적으로 유지하세요."]);
    if (policy.kind === "SCOPE") {
      const estimate = obj(c.estimate); let subtotal = 0; let paid = 0;
      if (policy.expectedScope?.requirements && fingerprint(c.requirements) !== fingerprint(policy.expectedScope.requirements)) issue("RV-010", "ERROR", ["requirements"], "요구사항 스냅샷이 확정 범위와 다릅니다. 요구사항 검토 절차에서 변경해주세요.");
      const savedRates = policy.expectedScope?.rates ?? context.confirmedEstimate?.rates;
      if (savedRates && fingerprint(estimate.rates) !== fingerprint(savedRates)) issue("RV-010", "ERROR", ["estimate.rates"], "Scope 단가가 저장된 회사 단가 스냅샷과 다릅니다.");
      list(estimate.items).forEach((row, i) => {
        const savedItem = (policy.expectedScope?.items ?? []).map(obj).find(v => v.requirementId === row.requirementId);
        if (savedItem && savedRates) {
          const itemRates = savedItem.rates ?? savedRates;
          const savedAmount = savedItem.amount ?? calculateAmount(hoursSchema.parse(savedItem.hours), ratesSchema.parse(itemRates));
          if (fingerprint(row.rates ?? estimate.rates) !== fingerprint(itemRates) || row.amount !== savedAmount) issue("RV-010", "ERROR", [`estimate.items.${i}`], "Scope 항목의 단가·금액이 확정 견적과 다릅니다.");
        }
        const calculated = calculateAmount(hoursSchema.parse(row.hours), ratesSchema.parse(row.rates ?? estimate.rates)); subtotal += calculated; paid += Number(row.amount);
        if (row.calculatedAmount != null && row.calculatedAmount !== calculated || row.amount !== calculated && !String(row.adjustmentReason ?? "").trim()) issue("RV-009", "ERROR", [`estimate.items.${i}.amount`], "Scope 항목의 계산 금액 또는 조정 근거가 다릅니다.", [], { calculated, amount: row.amount });
      });
      if (estimate.subtotal !== subtotal || estimate.total !== paid && !String(estimate.adjustmentReason ?? "").trim()) issue("RV-009", "ERROR", ["estimate.subtotal", "estimate.total", "estimate.adjustmentReason"], "Scope 합계·최종 금액의 계산 또는 조정 근거를 확인해주세요.", [], { subtotal, paid });
    }
  }
  function validateExplanations() {
    result.evaluatedRules.push("RV-012", "RV-013");
    for (const [index, ref] of list(c.numericReferences).entries()) {
      const current = at(candidate, String(ref.fieldPath));
      if (typeof current !== "number" || ref.value !== current) issue("RV-012", "ERROR", [`numericReferences.${index}`, String(ref.fieldPath)], "설명에 연결된 숫자가 현재 필드와 다릅니다.", [], { text: ref.text, reference: ref.value, current });
    }
    const inspect = (row: Obj, prefix: string, previous: Obj) => {
      const hours = obj(row.hours ?? row.estimatedWork);
      const oldHours = obj(previous.hours ?? previous.estimatedWork);
      const text = String(row.reason ?? "");
      const hourKey = row.hours ? "hours" : "estimatedWork";
      if (Object.keys(oldHours).length && fingerprint(hours) !== fingerprint(oldHours) && text === String(previous.reason ?? "")) issue("RV-013", "WARNING", [prefix ? `${prefix}.${hourKey}` : hourKey, prefix ? `${prefix}.reason` : "reason"], "작업량을 바꾼 뒤 이전 산정 설명이 그대로입니다. 설명을 확인하거나 수정해주세요.", [], { hours, reason: text });
      for (const role of roles) {
        const pattern = new RegExp(`${role}\\s*(?:[:：=]|은|는)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:h\\b|시간|hours?\\b)`, "ig");
        for (const match of text.matchAll(pattern)) if (typeof hours[role] === "number" && Number(match[1]) !== hours[role]) issue("RV-012", "WARNING", [prefix ? `${prefix}.${hourKey}.${role}` : `${hourKey}.${role}`, prefix ? `${prefix}.reason` : "reason"], "자유 문장에 남은 역할별 시간이 표와 다른지 확인해주세요.", [], { sentence: match[0], current: hours[role] });
      }
      if ((row.scheduleImpactDays !== previous.scheduleImpactDays || row.calculatedAmount !== previous.calculatedAmount || row.additionalCost !== previous.additionalCost) && Object.keys(previous).length && text === previous.reason) issue("RV-013", "WARNING", ["scheduleImpactDays", "calculatedAmount", "additionalCost", "reason"], "금액·일수를 바꾼 뒤 이전 설명이 그대로입니다. 관련 설명을 재검토해주세요.", [], { days: row.scheduleImpactDays, amount: row.calculatedAmount, final: row.additionalCost, reason: text });
    };
    if (context.operation === "SCOPE_COMPARISON" && policy.kind !== "SCOPE") inspect(c, "", obj(policy.previousCandidate));
    if (Array.isArray(c.items)) list(c.items).forEach((row, i) => inspect(row, `items.${i}`, list(obj(policy.previousCandidate).items).find(v => v.requirementId === row.requirementId) ?? {}));
    if (context.operation === "SCOPE_SUMMARY" || policy.kind === "SCOPE") {
      const expected = policy.expectedScope ?? context.confirmedEstimate;
      const text = [c.description, ...strings(c.assumptions), ...strings(c.deliverables)].join("\n");
      const previous = obj(policy.previousCandidate);
      if (Object.keys(previous).length && c.description === previous.description && (c.durationDays !== previous.durationDays || obj(c.estimate).total !== obj(previous.estimate).total || fingerprint(c.metrics ?? {}) !== fingerprint(previous.metrics ?? {}))) issue("RV-013", "WARNING", ["description", "durationDays", "estimate.total", "metrics"], "Scope 수치를 바꾼 뒤 이전 설명이 그대로입니다. 설명을 재검토해주세요.");
      for (const [pattern, value, label] of [[/(?:총|최종)\s*(?:금액|견적|비용)[^\d\n]{0,15}([\d,]+)\s*원/g, expected?.total, "금액"], [/(?:개발|작업|예상)\s*기간[^\d\n]{0,15}(\d+)\s*일/g, expected?.durationDays, "기간"]] as const) for (const match of text.matchAll(pattern)) if (value == null || Number(match[1].replaceAll(",", "")) !== value) issue("RV-012", "WARNING", ["description", "assumptions", "deliverables"], `자유 설명의 ${label} 표현을 확정 값과 대조해주세요.`, [], { sentence: match[0], expected: value });
    }
  }
  function validateProposedDocument() {
    const baseline = obj(context.approvedBaseline!.document);
    // Old/partial imported baselines require evidence completion, never fabricated snapshots.
    if (!scopeDocumentSchema.safeParse(baseline).success) { issue("RV-004", "REVIEW_REQUIRED", ["classification"], "승인 기준 문서의 견적·요구사항 스냅샷이 불완전합니다."); return; }
    const paid = policy.amounts?.final ?? calculateAmount(hoursSchema.parse(c.estimatedWork), ratesSchema.parse(context.changeRequest!.rates));
    const next = proposedChangeDocument(context, comparisonSchema.parse(c), paid, policy.amounts?.adjustmentReason ?? "");
    const retired = new Set(replacements().filter(n => n.status === "explicit" && isIncluded(n.value) && strings(n.sourceRefs).includes(`change:${context.changeRequest!.id}`) && context.sources.find(s => s.id === `change:${context.changeRequest!.id}`)?.text.includes(String(n.evidence))).flatMap(n => strings(n.supersedes)));
    const known = list(next.requirements).map(r => ({ id: String(r.id), title: String(r.title), status: "CONFIRMED" as const }));
    const nextContext = { ...context, operation: "SCOPE_SUMMARY" as const, existingRequirements: known, approvedBaseline: { ...context.approvedBaseline!, document: { ...baseline, excluded: strings(baseline.excluded).filter(title => !retired.has(excludedKey(title))) } }, explicitCustomerConstraints: context.explicitCustomerConstraints.map(f => ({ ...f, active: f.active && !retired.has(f.id) })), confirmedExcludedScope: context.confirmedExcludedScope.filter(f => !retired.has(f.id)) };
    const exclusionReview = carryExclusions(Array.isArray(baseline.exclusions) ? context.scopeExclusions ?? null : null, strings(c.removedExclusions), context.changeRequest!.id, String(c.reason), "proposed-change");
    const validation = validateAIResult(nextContext, next, { kind: "SCOPE", ...(exclusionReview ? { exclusionReview } : {}), expectedScope: { total: Number(obj(baseline.estimate).total) + paid, durationDays: Number(baseline.durationDays) + Number(c.scheduleImpactDays), items: list(obj(next.estimate).items), deadline: next.deadline as string | null }, acknowledgements: policy.acknowledgements });
    result.issues.push(...validation.issues);
  }
}

export function proposedChangeDocument(context: ProjectAIContext, review: z.infer<typeof comparisonSchema>, amount: number, adjustmentReason: string): Obj {
  const base = structuredClone(context.approvedBaseline!.document) as Obj;
  const estimate = obj(base.estimate); const calculated = calculateAmount(review.estimatedWork, ratesSchema.parse(context.changeRequest!.rates));
  return { ...base, description: review.scopeDescription ?? `${String(base.description ?? "")}\n\n변경 요청: ${context.changeRequest!.request}`.trim(), requirements: [...list(base.requirements), ...review.newRequirements.map((r, i) => ({ ...r, id: `proposed-${context.changeRequest!.id}-${i}` }))], estimate: { ...estimate, items: [...list(estimate.items), { requirementId: `CR-${context.changeRequest!.id}`, title: "변경 요청", hours: review.estimatedWork, rates: context.changeRequest!.rates, calculatedAmount: calculated, amount, adjustmentReason, complexity: "MEDIUM", reason: review.reason }], subtotal: Number(estimate.subtotal) + calculated, total: Number(estimate.total) + amount }, excluded: strings(base.excluded).filter(title => !review.removedExclusions.includes(title)), ...(Array.isArray(base.exclusions) ? { exclusions: list(base.exclusions).filter(i => !review.removedExclusions.includes(String(i.title))) } : {}), durationDays: Number(base.durationDays) + review.scheduleImpactDays, deadline: addDays(typeof base.deadline === "string" ? base.deadline : null, review.scheduleImpactDays) };
}
