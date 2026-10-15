"use client";
import type { AIContextSnapshot, ContextIssue, Resolution } from "@/lib/ai-context";
import type { Dispatch, SetStateAction } from "react";
import type { z } from "zod";
import type { reviewNotesSchema } from "@/lib/ai-context";
export function AIConditionProposals({ notes, context }: { notes?: z.infer<typeof reviewNotesSchema>; context?: AIContextSnapshot }) {
  if (!notes || (!notes.constraints.length && !notes.excludedScope.length)) return null;
  return <details className="ai-context"><summary>AI가 추출한 조건·제외 제안 · 고객 승인 전</summary><div className="detail-body"><p className="text-xs">원문 근거 추출이며 고객이 승인한 요구사항이 아닙니다. 조건을 대체하는 경우 사유를 남겨주세요.</p>{notes.constraints.map(c => <div key={c.id}><p>{c.key}: {String(c.value)} · {c.status === "pending" ? "확인 필요" : "명시된 문장 근거"}</p><p className="prose">{c.evidence}</p>{c.supersedes.length > 0 && <p>대체할 이전 조건: {c.supersedes.map(id => context?.explicitCustomerConstraints.find(v => v.id === id)?.key ?? "기존 제외 조건").join(", ")}</p>}<AIEvidence sourceRefs={c.sourceRefs} context={context} /></div>)}{notes.excludedScope.map(c => <div key={c.title}><p>제외 제안: {c.title} · {c.status === "pending" ? "확인 필요" : "명시된 문장 근거"}</p><p className="prose">{c.evidence}</p><AIEvidence sourceRefs={c.sourceRefs} context={context} /></div>)}</div></details>;
}
export function AIContextBasis({ context, baselineVersion }: { context?: AIContextSnapshot; baselineVersion?: string }) {
  if (!context) return null;
  return <details className="ai-context"><summary>적용 기준 · 저장 답변 {context.savedAnswers.length}개{baselineVersion || context.approvedBaseline ? ` · 기준 Scope v${baselineVersion ?? context.approvedBaseline?.version}` : ""}</summary><div className="detail-body"><p className="text-xs">저장된 원문·답변과 담당자 확정 범위를 사용합니다. AI 추정은 고객 승인 사실과 구분합니다.</p>{context.explicitCustomerConstraints.filter(c => c.active).map(c => <p key={c.id}>{c.key}: {String(c.value)} · {c.status === "pending" ? "확인 필요" : "원문·답변 근거"}</p>)}<div className="form-grid mt-4"><div><h3>포함 범위</h3><ul>{context.confirmedIncludedScope.map((r, i) => <li key={i}>{r.title}</li>)}</ul></div><div><h3>확인된 제외 범위</h3><ul>{context.confirmedExcludedScope.map((r, i) => <li key={i}>{r.title}</li>)}</ul></div></div>{context.ownerDecisions?.map((d, i) => <p className="prose" key={i}>담당자 확인: {d.description} · {d.reason}</p>)}</div></details>;
}
export function AIEvidence({ sourceRefs = [], context }: { sourceRefs?: string[]; context?: AIContextSnapshot }) {
  if (!sourceRefs.length || !context) return null;
  return <details className="ai-evidence"><summary>근거 보기</summary><div className="detail-body">{sourceRefs.map(id => { const source = context.sources.find(s => s.id === id); return source ? <div key={id}><strong>{source.label}</strong><p className="prose">{source.text}</p></div> : <p key={id}>연결된 요구사항을 확인할 수 없습니다.</p>; })}</div></details>;
}
export function AIReviewIssues({ issues, context, resolutions, setResolutions, required = true }: { required?: boolean; issues: ContextIssue[]; context?: AIContextSnapshot; resolutions: Resolution[]; setResolutions: Dispatch<SetStateAction<Resolution[]>> }) {
  return <><input type="hidden" name="resolutions" value={JSON.stringify(resolutions)} />{issues.length > 0 && <section className="review-issues"><h3>확인 필요 · 기본 범위·합계와 별도</h3>{issues.map(issue => {
    const decision = resolutions.find(d => d.id === issue.id);
    const update = (reason: string, sourceRefs = decision?.sourceRefs ?? issue.sourceRefs) => setResolutions(rows => [...rows.filter(d => d.id !== issue.id), { id: issue.id, reason, sourceRefs }]);
    return <div key={issue.id} className="stack"><p>{issue.important ? "필수 확인" : "참고"} · {issue.description}</p><AIEvidence sourceRefs={issue.sourceRefs} context={context} /><label>담당자 확인·조건 해소 사유<textarea required={required && issue.important} value={decision?.reason ?? ""} onChange={e => update(e.target.value)} rows={2} placeholder="고객 답변이나 합의 근거와 판단 사유를 남겨주세요." /></label><label>확인 근거<select required={required && issue.important} value={decision?.sourceRefs[0] ?? issue.sourceRefs[0] ?? ""} onChange={e => update(decision?.reason ?? "", e.target.value ? [e.target.value] : [])}><option value="">근거 선택</option>{context?.sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label></div>;
  })}</section>}</>;
}
