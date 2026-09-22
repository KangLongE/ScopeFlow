import Link from "next/link";
import { ArrowUpRight, Folder } from "lucide-react";
import { Badge, Empty } from "./ui";
import { dateLabel } from "@/lib/model";
export function ProjectTable({ projects }: { projects: { id: string; name: string; clientName: string; status: string; deadline: string | null; updatedAt: Date | string }[] }) {
  if (!projects.length) return <Empty title="첫 프로젝트를 시작해보세요" description="고객의 요청을 입력하면 요구사항부터 승인까지 차근차근 정리할 수 있어요." href="/projects/new" cta="새 프로젝트" />;
  return <div className="table-wrap"><table><thead><tr><th>프로젝트</th><th>상태</th><th>목표 완료일</th><th><span className="sr-only">프로젝트 열기</span></th></tr></thead><tbody>{projects.map(p => <tr key={p.id}><td><Link href={`/projects/${p.id}`} className="project-cell"><span className="project-icon"><Folder size={17} /></span><span><strong>{p.name}</strong><small>{p.clientName}</small></span></Link></td><td><Badge value={p.status} /></td><td className="muted">{dateLabel(p.deadline)}</td><td><Link href={`/projects/${p.id}`} aria-label={`${p.name} 열기`} className="muted"><ArrowUpRight size={15} /></Link></td></tr>)}</tbody></table></div>;
}
