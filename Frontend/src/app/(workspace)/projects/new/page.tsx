import { currentContext, listClients } from "@/lib/queries";
import { Card, Field, PageHeading, Textarea } from "@/components/ui";
import { ClientPicker } from "@/components/client-picker";
import { MutationForm } from "@/components/form";
export default async function NewProject({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const ctx = await currentContext(); const rows = await listClients(ctx.workspaceId); const { client } = await searchParams;
  return <><PageHeading eyebrow="NEW PROJECT" title="새 프로젝트" description="아직 정리되지 않은 요청도 괜찮아요. 고객의 이야기를 그대로 담아주세요." /><Card title="프로젝트 기본 정보">{<div className="card-body"><MutationForm action="project.create" variant="primary" disabled={ctx.role !== "OWNER"} submit="프로젝트 시작하기"><div className="form-grid"><Field label="프로젝트 이름" name="name" required placeholder="예: 브랜드 온라인 스토어 구축" /><ClientPicker clients={rows} selected={client} /><Field label="예산 (선택 · KRW)" name="budget" type="number" min={0} max={1e12} placeholder="5000000" /><Field label="희망 완료일 (선택)" name="deadline" type="date" /><div className="wide"><Textarea label="고객 원문 요청" name="content" required rows={7} placeholder="고객용 쇼핑몰을 만들고 싶습니다. 회원가입, 로그인, 상품 소개, 결제, 관리자 페이지가 필요합니다…" /></div><div className="wide"><Field label="참고 URL (선택)" name="referenceUrl" type="url" placeholder="https://" /></div><div className="wide"><Textarea label="참고 메모 (선택)" name="notes" rows={3} /></div></div></MutationForm></div>}</Card></>;
}
