import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getProject } from "@/lib/queries";
import { PageHeading } from "@/components/ui";
import { ProjectTabs } from "@/components/navigation";
// Layouts persist across navigation; show live status in each page's documents and project list.
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) { const {projectId} = await params; const { project, client } = await getProject(projectId); return <div className="project-page"><div className="project-breadcrumb"><Link href="/projects">프로젝트</Link><ChevronRight size={14} aria-hidden="true" /><span>{client.company || client.name}</span></div><PageHeading title={project.name} description="고객 요청을 정리하고, 함께 제공할 범위를 명확하게 합의하세요." /><ProjectTabs projectId={projectId} />{children}</div>; }
