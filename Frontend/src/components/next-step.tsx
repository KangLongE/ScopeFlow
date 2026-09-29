import Link from "next/link";
import { projectStep, scopeVersion } from "@/lib/workflow";
import type { ProjectDetail } from "@/lib/queries";
import { Badge } from "./ui";

export function ProjectState({ project }: { project: ProjectDetail }) {
  const scope = project.scopes.find(s => s.status === "APPROVED") ?? project.scopes[0];
  return <div className="detail-meta"><Badge value={project.status} /><strong>현재 Scope {scope ? scopeVersion(scope) : "미생성"}</strong>{scope?.status === "DRAFT" && <span>초안</span>}</div>;
}

export function NextStep({ project }: { project: ProjectDetail }) {
  const next = projectStep(project);
  const scope = project.scopes.find(s => s.status === "APPROVED") ?? project.scopes[0];
  return <section className="next-step"><div><small>현재 단계{scope ? ` · Scope ${scopeVersion(scope)}` : ""}</small><h2>{next.title}</h2><p>{next.description}</p></div><Link className="button" href={next.href}>{next.action} →</Link></section>;
}
