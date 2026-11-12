import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getProject } from "@/lib/queries";
import { PageHeading } from "@/components/ui";
import { ProjectTabs } from "@/components/navigation";
// Layouts persist across navigation; show live status in each page's documents and project list.
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) { const {projectId} = await params; const { project } = await getProject(projectId); return <div className="project-page"><div className="project-breadcrumb"><Link href="/projects">프로젝트</Link><ChevronRight size={14} aria-hidden="true" /><span>{project.name}</span></div><PageHeading title={project.name} description="고객과 합의할 범위를 명확하게 정리하세요." /><ProjectTabs projectId={projectId} />{children}</div>; }
