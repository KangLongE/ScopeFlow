import { ProjectState } from "@/components/next-step";
import Link from "next/link";
import { projectData, rateCard } from "@/lib/queries";
import { Card, Empty, Field, Textarea } from "@/components/ui";
import { AIButton } from "@/components/ai";
import { AIReview } from "@/components/ai-review";
import { MutationForm } from "@/components/form";
import { calculateAmount, roles, roleLabels, won, zeroHours } from "@/lib/model";
export default async function Estimate({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params; const d = await projectData(projectId); const card = await rateCard(d.ctx.workspaceId);
  const locked = d.ctx.role !== "OWNER" || ["COMPLETED", "CANCELLED"].includes(d.project.status) || d.scopes.some(s => ["APPROVED", "WAITING_APPROVAL"].includes(s.status));
  const approved = d.scopes.find(s => s.status === "APPROVED");
  if (approved) return <div className="stack"><ProjectState project={d.project} /><div className="next-step"><div><small>승인된 견적 · Scope v{approved.version}</small><h2>{won(approved.document.estimate.total)}</h2><p>승인된 금액은 보존됩니다. 추가 비용은 변경 승인으로 합의하세요.</p></div><Link className="button" href={`/projects/${projectId}/changes#new`}>새 변경 요청</Link></div><Card title="승인 견적"><div className="table-wrap"><table><thead><tr><th>기능 / 변경 요청</th><th>작업 시간</th><th>금액</th></tr></thead><tbody>{approved.document.estimate.items.map((item, i) => <tr key={i}><td>{item.title}<small>{item.reason}</small></td><td>{Object.values(item.hours).reduce((sum, h) => sum + h, 0)}h</td><td>{won(item.amount)}</td></tr>)}</tbody></table></div></Card></div>;
  if (!card) return <Card title="견적 전에 작업 단가를 설정해주세요"><Empty title="우리 팀의 시간당 단가가 필요합니다" description="Frontend · Backend · Design · QA 단가를 저장하면 이 프로젝트로 돌아옵니다." href={`/settings/rates?projectId=${projectId}`} cta="단가 설정하기" /></Card>;
  const rates = d.estimate?.rates ?? card.rates; const requirements = d.requirements.filter(r => r.status === "CONFIRMED");
  const sum = d.items.filter(i => requirements.some(r => r.id === i.requirementId)).reduce((total, i) => total + calculateAmount(i.hours, rates), 0);
  const ready = requirements.length > 0 && !d.requirements.some(r => r.status === "PENDING") && !d.questions.some(q => !q.answer);
  const reviewed = ready && requirements.every(r => d.items.some(i => i.requirementId === r.id && i.reviewed));
  const draft = d.project.aiDrafts?.estimate;
  return <div className="stack"><ProjectState project={d.project} />
    {draft && !locked && <AIReview key={draft.createdAt} projectId={projectId} task="estimate" draft={draft} revision={d.project.revision} requirements={requirements} />}
    {draft?.revision !== d.project.revision && <section className="next-step"><div><small>현재 단계 · 견적</small><h2>{reviewed ? "견적 검토가 완료되었습니다" : ready ? "기능별 예상 작업량을 확인하세요" : "요구사항 확인이 필요합니다"}</h2><p>작업량 × 회사 단가로 계산하며 최종 금액은 OWNER가 조정합니다.</p></div>{reviewed ? <Link className="button" href={`/projects/${projectId}/scope`}>Scope 초안 만들기 →</Link> : ready && !locked ? <AIButton projectId={projectId} task="estimate" primary /> : <Link className="button" href={`/projects/${projectId}/requirements`}>요구사항 확인</Link>}</section>}
    <div className="two-col"><Card title="기능별 예상 작업량" hint="각 항목을 검토·저장해야 고객 승인을 요청할 수 있습니다."><div className="detail-list">{requirements.length ? requirements.map(r => { const item = d.items.find(i => i.requirementId === r.id); return <details key={r.id} open={!item?.reviewed}><summary><div><strong>{r.title}</strong><p className="text-xs">{item?.reviewed ? "검토 완료" : "시간 검토 필요"} · {won(calculateAmount(item?.hours || zeroHours, rates))}</p></div></summary><div className="detail-body"><MutationForm action="estimate.item" payload={{ projectId, requirementId: r.id }} submit="검토 완료 · 저장" disabled={locked || !ready}><div className="hours-grid">{roles.map(role => <Field key={role} label={`${roleLabels[role]} (시간)`} name={`hours.${role}`} type="number" min={0} max={2000} step={0.5} value={item?.hours[role] || 0} required />)}</div><Textarea label="산정 근거" name="reason" value={item?.reason || r.description} required rows={2} /></MutationForm></div></details>; }) : <Empty title="견적을 낼 확정 요구사항이 없습니다" description="요구사항을 먼저 확정해주세요." href={`/projects/${projectId}/requirements`} cta="요구사항 정리" />}</div></Card>
    <Card title="회사 단가 및 견적 요약"><div className="card-body"><dl className="info-grid">{roles.map(role => <div key={role}><dt>{roleLabels[role]} · 시간당</dt><dd>{won(rates[role])}</dd></div>)}</dl><Link className="inline-link" href={`/settings/rates?projectId=${projectId}`}>새 견적에 사용할 단가 설정</Link></div><div className="estimate-total"><div><p>최종 예상 견적 · KRW</p><strong>{won(d.estimate?.overrideTotal ?? sum)}</strong></div></div><div className="card-body"><p className="text-xs mb-5">기능별 합계 {won(sum)} · 기존 견적은 생성 시 단가를 보존합니다.</p>{d.ctx.role === "OWNER" && <MutationForm action="estimate.total" payload={{ projectId }} disabled={locked || !d.estimate}><Field label="최종 금액 조정 (비워두면 자동 합계)" name="overrideTotal" type="number" min={0} max={1e12} value={d.estimate?.overrideTotal} /><Textarea label="금액 조정 이유" name="adjustmentReason" value={d.estimate?.adjustmentReason} rows={3} /></MutationForm>}</div></Card></div>
    {!locked && reviewed && <details><summary>AI로 작업량 다시 추정</summary><AIButton projectId={projectId} task="estimate" force /></details>}
  </div>;
}
