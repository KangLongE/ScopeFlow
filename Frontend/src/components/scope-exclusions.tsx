"use client";
import { useState } from "react";
import { exclusionOrigin, exclusionState, type ExclusionItem, type ExclusionReview } from "@/lib/scope-exclusions";
type Source = { id: string; label: string; kind: string };
export function ScopeExclusionsEditor({ review, sources }: { review: ExclusionReview; sources: Source[] }) {
  const [items, setItems] = useState(review.items);
  const update = (id: string, fields: Partial<ExclusionItem>) => setItems(current => current.map(i => i.id === id ? { ...i, ...fields } : i));
  const pending = items.filter(i => i.state === "pending").length;
  return <section className="scope-exclusions" aria-label="항목별 제외 범위 검토">
    <h3>이번 범위에 포함하지 않는 작업</h3>
    <p className="text-xs">원문·저장 답변의 조건과 담당자·템플릿·AI 제안을 구분합니다. 담당자 확인은 고객 승인과 별개입니다. 검토·저장에는 추가 Credit이 들지 않습니다.</p>
    <input type="hidden" name="exclusions" value={JSON.stringify({ ...review, items })} />
    <input type="hidden" name="excluded" value={items.filter(i => i.state === "active").map(i => i.title).join("\n")} />
    {pending > 0 && <p role="status">고객 명시 제외 조건과 확인 필요 후보 {pending}개를 검토해주세요. 초안 저장은 가능하지만 미확인 목록으로 승인 요청할 수 없습니다.</p>}
    {!items.length && <p>명시된 제외 조건 없음 · 필요한 담당자 조건만 직접 추가할 수 있습니다.</p>}
    {items.map((entry, index) => <fieldset className="exclusion-item" key={entry.id}>
      <legend>{index + 1}. {exclusionOrigin[entry.origin]}</legend>
      <span className="text-xs">{exclusionState[entry.state]}{entry.explicit ? " · 고객 명시 근거" : " · 확정 고객 조건으로 간주하지 않음"}</span>
      {!review.items.some(i => i.id === entry.id) && !entry.reviewedAt && !entry.evidence.length && ["staff", "template"].includes(entry.origin) && <label>직접 추가 조건의 출처<select value={entry.origin} onChange={e => update(entry.id, { origin: e.target.value as ExclusionItem["origin"] })}><option value="staff">담당자 추가</option><option value="template">공통 템플릿</option></select></label>}
      <label>제외 항목 제목<input required maxLength={160} value={entry.title} data-field-path={`exclusions.items.${index}`} onChange={e => update(entry.id, { title: e.target.value })} /></label>
      <label>설명<textarea maxLength={5000} value={entry.description ?? ""} onChange={e => update(entry.id, { description: e.target.value || null })} rows={2} /></label>
      <label>검토 상태<select value={entry.state} onChange={e => update(entry.id, { state: e.target.value as ExclusionItem["state"] })}>{Object.entries(exclusionState).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <details><summary>원문·답변 근거와 수정 기록</summary><div className="detail-body">
        {entry.evidence.length ? entry.evidence.map((evidence, i) => <blockquote key={i}><strong>{sources.find(s => s.id === evidence.sourceRef)?.label ?? "연결된 근거 확인 필요"}</strong><p className="prose">{evidence.quote}</p><small>근거 버전: {evidence.revision}</small></blockquote>) : <p>고객 발언으로 확인된 출처 없음. 과거 자유 문구는 당시 문구 그대로 보존합니다.</p>}
        {entry.reviewedAt && <p>담당자 검토 시각: {new Date(entry.reviewedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>}
        <p className="text-xs">제외 조건 해제는 후속 고객 요청·저장 답변이 필요합니다. 고객 명시 조건은 삭제하거나 수수료 제외로 바꿔 우회할 수 없습니다.</p>
      </div></details>
      <label>확인·수정·해제 사유<textarea rows={2} maxLength={5000} value={entry.resolutionReason ?? ""} onChange={e => update(entry.id, { resolutionReason: e.target.value || null })} /></label>
      {entry.state === "superseded" && <label>후속 조건 변경의 고객 근거<select multiple value={entry.resolutionSourceRefs} onChange={e => update(entry.id, { resolutionSourceRefs: [...e.target.selectedOptions].map(o => o.value) })}>{sources.filter(s => ["REQUEST", "ANSWER"].includes(s.kind)).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
      {entry.state === "dismissed" && <label>중복인 경우 유지할 항목<select value={entry.duplicateOf ?? ""} onChange={e => update(entry.id, { duplicateOf: e.target.value || null })}><option value="">잘못된 제안 · 중복 아님</option>{items.filter(i => i.id !== entry.id && i.state === "active").map(i => <option value={i.id} key={i.id}>{i.title}</option>)}</select></label>}
    </fieldset>)}
    <div className="actions-row"><button type="button" className="button secondary" disabled={!pending} onClick={() => setItems(current => current.map(i => i.state === "pending" ? { ...i, state: "active" } : i))}>현재 목록 검토·확인</button><button type="button" className="button secondary" onClick={() => setItems(current => [...current, { id: crypto.randomUUID(), title: "", description: null, origin: "staff", sourceRefs: [], evidence: [], explicit: false, state: "active", resolutionReason: null, resolutionSourceRefs: [], duplicateOf: null, reviewedBy: null, reviewedAt: null }])}>담당자 조건 직접 추가</button></div>
    <p className="text-xs">현재 목록의 리비전 {review.revision}에 대해서만 확인합니다. 출처·원문은 수정하지 않으며, 중복 정리 시 모든 근거를 보존합니다.</p>
  </section>;
}
export function ScopeExclusionsHistory({ review }: { review: ExclusionReview }) {
  return <details><summary>이 버전의 제외 조건 근거·검토 기록 · 내부 전용</summary><div className="detail-body">{review.items.map(item => <div className="exclusion-item" key={item.id}><h3>{item.title}</h3><p>{exclusionOrigin[item.origin]} · {item.state === "active" ? "이 버전의 확인된 제외" : exclusionState[item.state]}</p>{item.description && <p>{item.description}</p>}{item.evidence.map((e, i) => <blockquote key={i}><p className="prose">{e.quote}</p><small>당시 근거 버전: {e.revision}</small></blockquote>)}{item.resolutionReason && <p>검토 사유: {item.resolutionReason}</p>}{item.resolutionEvidence?.map((e, i) => <blockquote key={i}><p className="prose">{e.quote}</p><small>조건 변경 근거 버전: {e.revision}</small></blockquote>)}{item.reviewedAt && <small>검토 시각: {new Date(item.reviewedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small>}</div>)}</div></details>;
}
