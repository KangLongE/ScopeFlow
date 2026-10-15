import { ShieldCheck } from "lucide-react";
import { portalData } from "@/lib/client-portal";
import { BackendError } from "@/lib/api";
import { ScopeDocument } from "@/components/scope-document";
import { Badge, Card, Field, Logo, PageHeading, Textarea } from "@/components/ui";
import { MutationForm } from "@/components/form";
import { ChangeImpactSummary } from "@/components/change-impact";
import { ClientDecisionForm } from "@/components/client-decision";
import { dateLabel } from "@/lib/model";
export const dynamic = "force-dynamic";
export default async function ClientPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; let d;
  try { d = await portalData(token); }
  catch (error) {
    if (!(error instanceof BackendError)) throw error;
    return <main className="public-wrap"><Logo /><div className="empty"><ShieldCheck className="mx-auto mb-5 muted" size={32} /><h1>공유 링크를 확인해주세요</h1><p role="alert">{error.message}</p>{error.status >= 500 && <a className="button secondary" href={`/client/${encodeURIComponent(token)}`}>다시 확인</a>}</div></main>;
  }
  const status = d.scope?.status || d.change?.status;
  const canDecide = !d.receipt && (status === "WAITING_APPROVAL" || status === "WAITING_CLIENT_APPROVAL");
  return <main className="public-wrap">
    <header className="public-header"><Logo /><span><ShieldCheck size={13} className="inline mr-1" />고객 전용 확인 페이지</span></header>
    <PageHeading eyebrow={`${d.workspaceName} → CLIENT REVIEW`} title={d.project.name} description={d.purpose === "QUESTIONS" ? "아래 질문에 답해주시면 프로젝트의 범위를 더 명확하게 정리할 수 있습니다." : "프로젝트 범위와 견적을 확인하고 의견을 전달해주세요."} />
    {d.receipt && <div className="notice" role="status"><ShieldCheck size={18} /><div><h2>{d.receipt.decision === "APPROVE" ? "승인이 완료되었습니다" : "검토 의견이 전달되었습니다"}</h2><p>{d.change?.impact.resultScope ? `Scope v${d.change.impact.resultScope.version}` : d.scope ? `Scope v${d.scope.version}` : ""} · {dateLabel(d.receipt.createdAt)} · {d.receipt.name}</p><p>이 요청은 처리되어 다시 승인할 수 없습니다.</p></div></div>}
    {d.scope && <ScopeDocument document={d.scope.document} version={d.scope.version} status={d.scope.status} approvedAt={d.scope.approvedAt} approvedBy={d.scope.approvedBy} />}
    {d.change && <Card title={`변경 요청 #${d.change.number}`} hint={`기준 Scope v${d.change.baseVersion}`} action={<Badge value={d.change.status} />}><div className="card-body">
      <ChangeImpactSummary impact={d.change.impact} number={d.change.number} />
      <p className="prose mt-6">{d.change.request}</p>
      <div className="doc-section mt-6"><h3>추가되는 기능</h3>{d.change.review?.newRequirements.map((r, i) => <div key={i} className="activity-item"><div><strong>{r.title}</strong><p>{r.description}</p></div></div>)}</div>
      <div className="mt-6"><small>판정</small><div><Badge value={d.change.review?.classification || "UNCERTAIN"} /></div></div>
      {d.change.approvedAt && <p className="green-text text-xs mt-5">✓ {d.change.approvedBy}님 승인 · {dateLabel(d.change.approvedAt)}</p>}
    </div></Card>}
    {d.change?.review && <Card title="변경 근거 및 제외 범위 조정"><div className="card-body"><p className="prose">{d.change.review.reason}</p>{!!d.change.review.removedExclusions?.length && <><h3 className="mt-5">승인 시 제외 범위에서 해제</h3><ul className="doc-list">{d.change.review.removedExclusions.map(item => <li key={item}>{item}</li>)}</ul></>}</div></Card>}
    {d.purpose === "QUESTIONS" && d.questions.map((q, i) => <Card key={q.id} title={`${i + 1}. ${q.question}`} hint={q.reason}><div className="card-body"><MutationForm endpoint="/api/client" action="client.answer" payload={{ token, questionId: q.id }} submit="답변 전달"><Field label="답변자 이름" name="name" value={q.author || d.questions.find(question => question.author)?.author} required /><Textarea name="content" label="답변" value={q.answer || ""} required /></MutationForm></div></Card>)}
    {canDecide && <Card title="검토 의견 전달" hint="승인 후 이 버전의 범위와 금액은 보존되며, 추가 변경은 별도로 합의합니다."><div className="decision"><ClientDecisionForm key={d.change ? `${d.change.impact.approvalSnapshotId}:${d.change.impact.revision}` : token} token={token} impact={d.change?.impact} change={!!d.change} /></div></Card>}
    {status === "APPROVED" && <div className="notice mt-6"><ShieldCheck size={18} /><span>승인이 완료되었습니다. 변경 사항은 담당자와 별도로 협의해주세요.</span></div>}
    <p className="footer-note">{d.workspaceName} · 공유 링크 만료 {dateLabel(d.expiresAt)}<br />Powered by ScopeFlow</p>
  </main>;
}
