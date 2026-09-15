import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getProject } from "@/lib/queries";
import { PageHeading } from "@/components/ui";
import { ProjectTabs } from "@/components/navigation";
// Layouts persist across navigation; show live status in each page's documents and project list.
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) { const {projectId} = await params; const { project, client } = await getProject(projectId); return <><Link className="detail-meta" href="/projects"><ChevronLeft size={14} />프로젝트 목록</Link><PageHeading eyebrow={client.company || client.name} title={project.name} description="요청을 정리하고, 범위에 합의하고, 변경을 기록하세요." /><ProjectTabs projectId={projectId} />{children}</>; }
