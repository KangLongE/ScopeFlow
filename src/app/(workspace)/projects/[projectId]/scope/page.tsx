import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiDrafts } from "@/lib/db/schema";
import { projectData } from "@/lib/queries";
import { Card, Field, Textarea, Empty } from "@/components/ui";
import { MutationForm } from "@/components/form";
import { AIButton } from "@/components/ai";
import { ScopeDocument } from "@/components/scope-document";
import { dateLabel, summarySchema } from "@/lib/model";
export default async function Scope({params,searchParams}: {params:Promise<{projectId:string}>;searchParams:Promise<{version?:string}>}) {
  const {projectId} = await params; const d = await projectData(projectId); const {version} = await searchParams; const scope = d.scopes.find(s=>s.id===version) || d.scopes[0];
  const [draft] = await db.select().from(aiDrafts).where(and(eq(aiDrafts.projectId,projectId),eq(aiDrafts.action,"summary"))); const aiSummary = draft && draft.revision===d.project.revision ? summarySchema.parse(draft.result) : null;
  const editable = !d.scopes.some(s=>["APPROVED","WAITING_APPROVAL"].includes(s.status)); const content = aiSummary || scope?.document;
  return <div className="stack">{d.scopes.length > 0 && <div className="row"><div className="actions-row" style={{margin:0}}>{d.scopes.map(s=><Link className={`button small ${s.id===scope?.id ? "" : "secondary"}`} href={`?version=${s.id}`} key={s.id}>{s.status==="APPROVED" ? `v1.${s.version-1}` : `v0.${s.version} 초안`}</Link>)}</div><span className="text-xs muted">승인된 버전은 원본 그대로 보관됩니다.</span></div>}
  {scope && <ScopeDocument document={scope.document} version={scope.version} status={scope.status} approvedAt={scope.approvedAt} approvedBy={scope.approvedBy} />}
  {editable && <Card title={scope ? "Scope 초안 수정" : "Scope 초안 만들기"} hint="요구사항과 최신 견적을 문서에 반영합니다." action={<AIButton projectId={projectId} task="summary" />}><div className="card-body"><MutationForm key={`${scope?.id}-${draft?.id}`} action={scope ? "scope.edit" : "scope.create"} payload={{projectId,...(scope ? {scopeId:scope.id} : {})}} submit={scope ? "초안 저장 · 최신 견적 반영" : "Scope 초안 생성"}><Textarea label="프로젝트 설명" name="description" value={content?.description || d.initial?.content} required /><div className="form-grid"><Textarea label="제외 범위 (한 줄에 하나씩)" name="excluded" value={content?.excluded.join("\n") || "명시되지 않은 추가 기능\n외부 서비스 이용료"} /><Textarea label="가정 및 협의 사항 (한 줄에 하나씩)" name="assumptions" value={content?.assumptions.join("\n") || "고객이 콘텐츠와 브랜드 자료를 제공합니다.\n세금 및 외부 서비스 비용은 별도 협의합니다."} /><Textarea label="외부 연동 (한 줄에 하나씩)" name="integrations" value={content?.integrations.join("\n")} /><Textarea label="납품 범위 (한 줄에 하나씩)" name="deliverables" value={content?.deliverables.join("\n") || "서비스 소스 코드\n운영 환경 배포\n기본 운영 가이드"} required /><Field label="예상 개발 기간 (일)" name="durationDays" type="number" value={scope?.document.durationDays || 30} min={1} max={3650} required /></div></MutationForm></div></Card>}
  {scope && ["DRAFT","WAITING_APPROVAL"].includes(scope.status) && <Card title="고객 승인 요청" hint="공유 링크는 이 버전의 문서와 견적에 연결되며, 14일 후 만료됩니다."><div className="card-body"><MutationForm action="share.create" payload={{projectId,purpose:"SCOPE",targetId:scope.id}} submit="Scope 승인 링크 발급" />{scope.status==="WAITING_APPROVAL" && <div className="actions-row"><MutationForm className="compact" action="scope.withdraw" payload={{projectId,scopeId:scope.id}} submit="승인 요청 회수 · 초안 수정" /></div>}</div></Card>}
  {scope?.status==="APPROVED" && <div className="notice"><span>이 버전은 고객이 승인했습니다. 새로운 범위는 변경 요청을 통해 합의하세요.</span><Link href={`/projects/${projectId}/changes`}>변경 요청 관리 →</Link></div>}
  {d.tokens.length > 0 && <Card title="공유 링크 관리"><div className="table-wrap"><table><thead><tr><th>용도</th><th>만료일</th><th>상태</th><th>관리</th></tr></thead><tbody>{d.tokens.map(t=><tr key={t.id}><td>{t.purpose==="QUESTIONS" ? "질문 답변" : t.purpose==="SCOPE" ? "Scope 승인" : "변경 승인"}</td><td>{dateLabel(t.expiresAt)}</td><td>{t.revokedAt ? "회수됨" : t.expiresAt < new Date() ? "만료됨" : "사용 가능"}</td><td>{!t.revokedAt && <MutationForm className="compact" action="share.revoke" payload={{projectId,tokenId:t.id}} submit="링크 폐기" />}</td></tr>)}</tbody></table></div></Card>}
  {!scope && !editable && <Empty title="아직 Scope가 없습니다" description="요구사항과 견적을 먼저 정리해주세요." />}</div>;
}
