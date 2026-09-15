import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { projects, clients } from "@/lib/db/schema";
import { currentContext } from "@/lib/queries";
import { Card, PageHeading } from "@/components/ui";
import { ProjectTable } from "@/components/projects";
import { labels } from "@/lib/model";
export default async function Projects({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ctx = await currentContext(); const params = await searchParams;
  const rows = await db.select({ id: projects.id, name: projects.name, clientName: clients.company, status: projects.status, deadline: projects.deadline, updatedAt: projects.updatedAt }).from(projects).innerJoin(clients, eq(projects.clientId, clients.id)).where(eq(projects.workspaceId, ctx.workspaceId)).orderBy(desc(projects.updatedAt));
  const filtered = rows.filter(p => (!params.q || `${p.name} ${p.clientName}`.toLowerCase().includes(params.q.toLowerCase())) && (!params.status || p.status === params.status));
  return <><PageHeading eyebrow="PROJECTS" title="프로젝트" description="고객의 첫 요청부터, 마지막 변경 승인까지."><Link className="button" href="/projects/new"><Plus size={16} />새 프로젝트</Link></PageHeading><form className="search-form"><input name="q" aria-label="프로젝트 검색" defaultValue={params.q} placeholder="프로젝트 또는 고객 검색" /><select name="status" aria-label="상태 필터" defaultValue={params.status || ""}><option value="">전체 상태</option>{["DRAFT","REQUIREMENT_GATHERING","WAITING_SCOPE_APPROVAL","ACTIVE","WAITING_CHANGE_APPROVAL","COMPLETED","CANCELLED"].map(v => <option key={v} value={v}>{labels[v]}</option>)}</select><button className="button secondary" type="submit"><Search size={14} />검색</button></form><Card title={`프로젝트 ${filtered.length}`}><ProjectTable projects={filtered} /></Card></>;
}
