"use client";
import type { AIContextSnapshot, ContextIssue, Resolution } from "@/lib/ai-context";
import type { Dispatch, SetStateAction } from "react";
import type { z } from "zod";
import type { reviewNotesSchema } from "@/lib/ai-context";
import { approvedExclusionSource } from "@/lib/ai-recovery";
type ReviewNotes = z.infer<typeof reviewNotesSchema>;
function AIQuoteFields({ entry, path, context, onChange }: { entry: { title?: string; evidence: string; sourceRefs: string[] }; path: string; context?: AIContextSnapshot; onChange?: (fields: { evidence: string; sourceRefs: string[] }) => void }) {
  if (!onChange) return <><p className="prose">{entry.evidence}</p><AIEvidence sourceRefs={entry.sourceRefs} context={context} /></>;
  const source = entry.title ? approvedExclusionSource(entry.title, context) : undefined;
  return <div className="stack">
    <label data-field-path={`${path}.evidence`}>근거 인용문 · 출처 원문 그대로<textarea value={entry.evidence} onChange={e => onChange({ evidence: e.target.value, sourceRefs: entry.sourceRefs })} rows={2} required /></label>
    <label data-field-path={`${path}.sourceRefs`}>인용 출처<select multiple value={entry.sourceRefs} onChange={e => onChange({ evidence: entry.evidence, sourceRefs: [...e.target.selectedOptions].map(o => o.value) })} required>
      {entry.sourceRefs.filter(id => !context?.sources.some(s => s.id === id)).map(id => <option key={id} value={id}>확인할 수 없는 출처 · {id}</option>)}
      {context?.sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select></label>
    {source && <button type="button" className="button secondary small" disabled={entry.evidence === source.text && entry.sourceRefs.length === 1 && entry.sourceRefs[0] === source.id} onClick={() => onChange({ evidence: source.text, sourceRefs: [source.id] })}>승인 문서의 제외 원문 연결</button>}
    <AIEvidence sourceRefs={entry.sourceRefs} context={context} />
  </div>;
}
export function AIConditionProposals({ notes, context, onChange }: { notes?: ReviewNotes; context?: AIContextSnapshot; onChange?: (notes: ReviewNotes) => void }) {
  if (!notes || (!notes.constraints.length && !notes.excludedScope.length)) return null;
  return <details className="ai-context"><summary>AI가 추출한 조건·제외 제안 · 고객 승인 전</summary><div className="detail-body"><p className="text-xs">원문 근거 추출이며 고객이 승인한 요구사항이 아닙니다. 조건을 대체하는 경우 사유를 남겨주세요.</p>
    {onChange && <p className="text-xs">인용·출처 수정 후 ‘검토 저장 · 서버 재검증’을 실행하세요. AI 재호출·Credit 차감은 없습니다.</p>}
    {notes.constraints.map((c, i) => <div key={`${c.id}:${i}`}><p>{c.key}: {String(c.value)} · {c.status === "pending" ? "확인 필요" : "명시된 문장 근거"}</p><AIQuoteFields entry={c} path={`reviewNotes.constraints.${i}`} context={context} onChange={onChange ? fields => onChange({ ...notes, constraints: notes.constraints.map((row, n) => n === i ? { ...row, ...fields } : row) }) : undefined} />{c.supersedes.length > 0 && <p>대체할 이전 조건: {c.supersedes.map(id => context?.explicitCustomerConstraints.find(v => v.id === id)?.key ?? "기존 제외 조건").join(", ")}</p>}</div>)}
    {notes.excludedScope.map((c, i) => <div key={`${c.title}:${i}`}><p>제외 제안: {c.title} · {c.status === "pending" ? "확인 필요" : "명시된 문장 근거"}</p><AIQuoteFields entry={c} path={`reviewNotes.excludedScope.${i}`} context={context} onChange={onChange ? fields => onChange({ ...notes, excludedScope: notes.excludedScope.map((row, n) => n === i ? { ...row, ...fields } : row) }) : undefined} /></div>)}
  </div></details>;
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
