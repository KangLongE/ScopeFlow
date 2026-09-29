import Link from "next/link";
import { notFound } from "next/navigation";
import { currentContext, listClients, listProjects } from "@/lib/queries";
import { Card, PageHeading } from "@/components/ui";
import { ProjectTable } from "@/components/projects";
export default async function ClientDetail({ params }: { params: Promise<{ clientId: string }> }) {
  const ctx = await currentContext(); const { clientId } = await params;
  const [clients, projects] = await Promise.all([listClients(ctx.workspaceId), listProjects(ctx.workspaceId)]);
  const client = clients.find(c => c.id === clientId); if (!client) notFound();
  const rows = projects.filter(p => p.clientId === clientId);
  return <><PageHeading eyebrow="CLIENT" title={client.company || client.name} description={`진행 중 프로젝트 ${rows.filter(p => ["ACTIVE", "WAITING_CHANGE_APPROVAL"].includes(p.status)).length}개`}><Link className="button" href={`/projects/new?client=${clientId}`}>이 고객의 새 프로젝트</Link></PageHeading><div className="stack"><Card title="고객 정보"><dl className="card-body info-grid"><div><dt>담당자</dt><dd>{client.name}</dd></div><div><dt>이메일</dt><dd>{client.email}</dd></div><div><dt>연락처</dt><dd>{client.phone || "미등록"}</dd></div><div><dt>메모</dt><dd>{client.notes || "없음"}</dd></div></dl></Card><Card title={`연결 프로젝트 ${rows.length}`}><ProjectTable projects={rows} /></Card><Link href="/clients" className="inline-link">고객 목록 · 정보 수정</Link></div></>;
}
