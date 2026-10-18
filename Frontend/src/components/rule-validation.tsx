"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/model";
import type { AIContextSnapshot } from "@/lib/ai-context";
import { canFinalize, matchesReviewedCandidate, type ReviewState, type WarningInput } from "@/lib/rule-validation";

export function focusRuleField(root: HTMLElement | null, paths: string[]) {
  if (!root) return;
  const field = [...root.querySelectorAll<HTMLElement>("[data-field-path], [name]")].find(el => paths.some(path => el.dataset.fieldPath === path || el.getAttribute("name") === path || path.startsWith(`${el.dataset.fieldPath}.`)));
  const target = field ?? root.querySelector<HTMLElement>("[data-rule-summary]");
  if (!target) return;
  let ancestor: HTMLElement | null = target; while (ancestor && ancestor !== root) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
  (target.matches("input,textarea,select,button") ? target : target.querySelector<HTMLElement>("input,textarea,select,button") ?? target).focus({ preventScroll: true });
}
export function useRuleReview(candidate: unknown, initial: Partial<ReviewState> | null | undefined, payload: Record<string, unknown>, action: string, onSaved?: () => void) {
  const signature = JSON.stringify(candidate);
  const [saved, setSaved] = useState({ revision: initial?.candidateRevision ?? 0, signature: initial?.validation ? signature : "", validation: initial?.validation, history: initial?.history ?? [], acknowledgements: initial?.acknowledgements ?? [], impact: initial?.impact });
  const [pending, setPending] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const latest = useRef(signature); const inFlight = useRef(false);
  useEffect(() => { latest.current = signature; }, [signature]);
  const dirty = signature !== saved.signature;
  async function save(warnings: WarningInput[] = []) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(""); setMessage("");
    const submitted = signature; const expected = saved.revision;
    try {
      const response = await fetch("/api/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, action, candidateRevision: expected, result: candidate, warnings }) });
      const data: ActionResult = await response.json();
      if (!response.ok || !data.review) {
        setError(data.error ?? "검토 결과를 저장하지 못했습니다.");
        if (data.validation && submitted === latest.current) setSaved(s => ({ ...s, validation: data.validation, signature: submitted }));
        return;
      }
      const state = data.review;
      setSaved(s => state.candidateRevision <= s.revision ? s : { revision: state.candidateRevision, signature: matchesReviewedCandidate(submitted, latest.current, state.candidateRevision, expected) ? submitted : "", validation: state.validation, history: state.history ?? [], acknowledgements: state.acknowledgements ?? [], impact: state.impact });
      if (submitted === latest.current) onSaved?.();
      setMessage(submitted === latest.current ? data.message ?? "재검증 결과를 저장했습니다." : "이전 입력을 저장했습니다. 현재 수정 내용은 다시 검증해주세요.");
    } catch { setError("서버 연결을 확인해주세요. 입력은 그대로 보존됩니다."); }
    finally { inFlight.current = false; setPending(false); }
  }
  function rejected(data: ActionResult) {
    if (data.validation) setSaved(s => ({ ...s, signature, validation: data.validation }));
  }
  function restore(state: ReviewState, value: unknown) { setSaved({ revision: state.candidateRevision, signature: JSON.stringify(value), validation: state.validation, history: state.history ?? [], acknowledgements: state.acknowledgements ?? [], impact: state.impact }); }
  return { ...saved, dirty, pending, error, message, save, rejected, restore, canFinalize: !dirty && !pending && canFinalize(saved.validation) };
}
export function RuleFieldIssues({ review, path }: { review: ReturnType<typeof useRuleReview>; path: string }) { return <>{review.validation?.issues.filter(i => i.fieldPaths.some(p => p === path || p.startsWith(`${path}.`))).map(i => <p key={i.issueId} className={i.severity === "ERROR" ? "form-error" : "text-xs"}>{i.ruleId} · {i.message}</p>)}</>; }
export function RuleValidation({ review, context }: { review: ReturnType<typeof useRuleReview>; context?: AIContextSnapshot }) {
  const [reasons, setReasons] = useState<Record<string, string>>({}); const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const issues = review.validation?.issues ?? [];
  const counts = (severity: string) => issues.filter(i => i.severity === severity).length;
  const label = review.dirty ? "↻ 재검증 필요" : review.validation?.status === "blocked" ? "⚠ 모순 발견" : review.canFinalize ? "✓ 검증 통과" : "ⓘ 확인 필요";
  return <div className="rule-validation" data-rule-summary tabIndex={-1} aria-live="polite"><strong>{label}</strong><p>오류 {counts("ERROR")} · 경고 {counts("WARNING")} · 검토 필요 {counts("REVIEW_REQUIRED")}</p><p className="text-xs">{review.dirty ? "내용이 변경되었습니다. 저장·재검증 후 확정할 수 있습니다." : review.canFinalize ? "구현된 규칙에 따른 일관성 검사입니다. 견적 적정성이나 모든 의미 판단을 보장하지 않습니다." : "오류·판별 불가 항목은 근거를 보완해야 합니다. 경고만 담당자 확인으로 진행할 수 있습니다."}</p>
    {issues.map(issue => <div key={issue.issueId} className={`rule-issue ${issue.severity === "ERROR" ? "form-error" : ""}`}><strong>{issue.ruleId} · {{ ERROR: "오류", WARNING: "경고", REVIEW_REQUIRED: "근거 보완 필요" }[issue.severity]}</strong><p>{issue.message}</p><button type="button" className="text-button" onClick={e => focusRuleField(e.currentTarget.closest("form"), issue.fieldPaths)}>문제 필드로 이동</button><small>{issue.fieldPaths.join(" · ")}</small>{issue.suggestions.map(text => <p className="text-xs" key={text}>{text}</p>)}<details><summary>검증 근거와 충돌값</summary>{issue.sourceRefs.map(id => { const source = context?.sources.find(s => s.id === id); return <div key={id}><strong>{source?.label ?? "현재 확정 기준"}</strong>{source && <p className="prose">{source.text}</p>}</div>; })}<pre>{JSON.stringify(issue.evidence, null, 2)}</pre></details>
      {issue.severity === "WARNING" && <div><label>항목별 확인 사유<textarea aria-label="항목별 확인 사유" value={reasons[issue.issueId] ?? ""} onChange={e => setReasons(r => ({ ...r, [issue.issueId]: e.target.value }))} maxLength={5000} /></label><label className="check-label"><input type="checkbox" disabled={review.dirty || !reasons[issue.issueId]?.trim()} checked={confirmed[issue.issueId] ?? false} onChange={e => setConfirmed(c => ({ ...c, [issue.issueId]: e.target.checked }))} />내용과 근거를 확인했습니다</label>{review.acknowledgements.some(a => a.issueFingerprint === issue.issueFingerprint) && <small>이 경고의 담당자 확인 기록이 있습니다.</small>}</div>}</div>)}
    <button type="button" className="button secondary" disabled={review.pending} onClick={() => review.save(review.dirty ? [] : issues.filter(i => i.severity === "WARNING" && confirmed[i.issueId] && reasons[i.issueId]?.trim()).map(i => ({ issueId: i.issueId, issueFingerprint: i.issueFingerprint, reason: reasons[i.issueId] })))}>{review.pending ? "재검증 중…" : "검토 저장 · 서버 재검증"}</button><p className="text-xs">오류가 있어도 초안을 저장할 수 있습니다. 추가 AI 호출·Credit 사용은 없습니다.</p>{review.error && <p className="form-error" role="alert">{review.error}</p>}{review.message && <p className="form-success" role="status">{review.message}</p>}
    <details><summary>담당자 수정 이력 ({review.history.length})</summary>{review.history.map(h => <details key={h.candidateRevision}><summary>수정본 #{h.candidateRevision} · {h.changedPaths.join(", ") || "확인 기록"}</summary><pre>{JSON.stringify(h.candidate, null, 2)}</pre></details>)}</details>
  </div>;
}
export function RawRuleReview({ initial, original, payload, action, context, onUse }: { initial?: Partial<ReviewState> | null; original: unknown; payload: Record<string, unknown>; action: string; context?: AIContextSnapshot; onUse?: (candidate: unknown, state: ReviewState) => void }) {
  const router = useRouter();
  const [text, setText] = useState(() => JSON.stringify(initial?.candidate ?? original, null, 2));
  let candidate: unknown; let parseError = false; try { candidate = JSON.parse(text); } catch { candidate = text; parseError = true; }
  const review = useRuleReview(candidate, initial, payload, action, () => router.refresh());
  return <form onSubmit={e => e.preventDefault()} className="raw-rule-review" data-ai-task={typeof payload.task === "string" ? payload.task : action === "change.saveDraft" ? "compare" : undefined} data-ai-change-id={typeof payload.changeId === "string" ? payload.changeId : undefined} data-ai-edited={review.dirty || review.revision > 0}><RuleValidation review={review} context={context} /><details><summary>출처·중요 속성 상세 편집</summary><label data-field-path="result">검토 후보 JSON (중요 속성·출처·숫자 연결 포함)<textarea rows={16} spellCheck={false} disabled={review.pending} value={text} onChange={e => setText(e.target.value)} /></label></details>{parseError && <p className="form-error">JSON 형식을 확인해주세요. 정상 결과로 자동 보정하지 않습니다.</p>}{onUse && review.validation && <button type="button" className="button secondary" disabled={!review.canFinalize} onClick={() => onUse(candidate, { candidate, candidateRevision: review.revision, validation: review.validation!, history: review.history, acknowledgements: review.acknowledgements })}>저장한 후보로 일반 검토 열기</button>}<details><summary>원본 · 변경하지 않은 기록</summary><pre>{JSON.stringify(original, null, 2)}</pre></details></form>;
}
