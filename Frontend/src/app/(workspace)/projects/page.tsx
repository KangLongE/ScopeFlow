import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { currentContext, listProjects } from "@/lib/queries";
import { Card, PageHeading } from "@/components/ui";
import { ProjectTable } from "@/components/projects";
import { labels } from "@/lib/model";
export default async function Projects({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ctx = await currentContext(); const params = await searchParams;
  const rows = await listProjects(ctx.workspaceId);
  const filtered = rows.filter(p => (!params.q || `${p.name} ${p.clientName}`.toLowerCase().includes(params.q.toLowerCase())) && (!params.status || p.status === params.status));
  return <><PageHeading eyebrow="PROJECTS" title="프로젝트" description="고객의 첫 요청부터, 마지막 변경 승인까지."><Link className="button" href="/projects/new"><Plus size={16} />새 프로젝트</Link></PageHeading><form className="search-form"><input name="q" aria-label="프로젝트 검색" defaultValue={params.q} placeholder="프로젝트 또는 고객 검색" /><select name="status" aria-label="상태 필터" defaultValue={params.status || ""}><option value="">전체 상태</option>{["DRAFT","REQUIREMENT_GATHERING","WAITING_SCOPE_APPROVAL","ACTIVE","WAITING_CHANGE_APPROVAL","COMPLETED","CANCELLED"].map(v => <option key={v} value={v}>{labels[v]}</option>)}</select><button className="button secondary" type="submit"><Search size={14} />검색</button></form><Card title={`프로젝트 ${filtered.length}`}><ProjectTable projects={filtered} /></Card></>;
}
