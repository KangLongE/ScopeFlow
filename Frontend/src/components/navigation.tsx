"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Users, GitPullRequest, Sparkles, Settings2, Menu, X } from "lucide-react";
const items = [ { href: "/dashboard", label: "대시보드", icon: LayoutDashboard }, { href: "/projects", label: "프로젝트", icon: FolderKanban }, { href: "/clients", label: "고객", icon: Users }, { href: "/requests", label: "변경 요청", icon: GitPullRequest }, { href: "/usage", label: "AI 사용량", icon: Sparkles }, { href: "/settings", label: "설정", icon: Settings2 } ];
export function Navigation() {
  const path = usePathname();
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={toggle} type="button" className="mobile-menu-toggle" aria-expanded={expanded} aria-controls="workspace-main-nav" onClick={() => setExpanded(value => !value)}>{expanded ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}메뉴 {expanded ? "닫기" : "열기"}</button>
    <nav id="workspace-main-nav" className={`main-nav${expanded ? " is-open" : ""}`} aria-label="메인 메뉴" onKeyDown={event => { if (event.key === "Escape" && expanded) { event.preventDefault(); setExpanded(false); toggle.current?.focus(); } }}>
      {items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setExpanded(false)} className={path.startsWith(href) ? "active" : ""} aria-current={path.startsWith(href) ? "page" : undefined}><Icon size={18} aria-hidden="true" />{label}{path.startsWith(href) && <span className="nav-dot" />}</Link>)}
    </nav>
  </>;
}
export function ProjectTabs({ projectId }: { projectId: string }) { const path = usePathname(); return <nav className="tabs" aria-label="프로젝트 메뉴">{[["", "개요"], ["/requirements", "요구사항"], ["/estimate", "견적"], ["/scope", "Scope 문서"], ["/changes", "변경 요청"]].map(([suffix, label]) => { const href = `/projects/${projectId}${suffix}`; return <Link className={path === href ? "active" : ""} aria-current={path === href ? "page" : undefined} key={href} href={href}>{label}</Link>; })}</nav>; }
