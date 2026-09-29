import Link from "next/link";
import { ArrowUpRight, Folder } from "lucide-react";
import { Badge, Empty } from "./ui";
import { dateLabel, won } from "@/lib/model";
import type { ProjectSummary } from "@/lib/queries";
import { estimateTotal, scopeVersion } from "@/lib/workflow";
export function ProjectTable({ projects, filtered = false }: { projects: ProjectSummary[]; filtered?: boolean }) {
  if (!projects.length) return <Empty title={filtered ? "조건에 맞는 프로젝트가 없습니다" : "첫 프로젝트를 시작해보세요"} description={filtered ? "검색어나 필터를 변경해 다시 찾아보세요." : "고객의 요청을 입력하면 요구사항부터 승인까지 차근차근 정리할 수 있어요."} href={filtered ? "/projects" : "/projects/new"} cta={filtered ? "필터 초기화" : "새 프로젝트"} />;
  return <div className="table-wrap"><table><thead><tr><th>프로젝트 / 고객</th><th>상태</th><th>현재 Scope</th><th>견적</th><th>최근 수정</th><th><span className="sr-only">프로젝트 열기</span></th></tr></thead><tbody>{projects.map(p => <tr key={p.id}><td><Link href={`/projects/${p.id}`} className="project-cell"><span className="project-icon"><Folder size={17} /></span><span><strong>{p.name}</strong><small>{p.clientName}</small></span></Link></td><td><Badge value={p.status} /></td><td>{p.scopes[0] ? scopeVersion(p.scopes[0]) : "미정"}</td><td className="nowrap">{estimateTotal(p) == null ? "미정" : won(estimateTotal(p)!)}</td><td className="muted nowrap">{dateLabel(p.updatedAt)}</td><td><Link href={`/projects/${p.id}`} aria-label={`${p.name} 열기`} className="muted"><ArrowUpRight size={15} /></Link></td></tr>)}</tbody></table></div>;
}
