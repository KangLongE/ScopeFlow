"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Users, GitPullRequest, Sparkles, Settings2 } from "lucide-react";
const items = [ { href: "/dashboard", label: "대시보드", icon: LayoutDashboard }, { href: "/projects", label: "프로젝트", icon: FolderKanban }, { href: "/clients", label: "고객", icon: Users }, { href: "/requests", label: "변경 요청", icon: GitPullRequest }, { href: "/usage", label: "AI 사용량", icon: Sparkles }, { href: "/settings", label: "설정", icon: Settings2 } ];
export function Navigation() { const path = usePathname(); return <nav className="main-nav" aria-label="메인 메뉴">{items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={path.startsWith(href) ? "active" : ""} aria-current={path.startsWith(href) ? "page" : undefined}><Icon size={18} />{label}{path.startsWith(href) && <span className="nav-dot" />}</Link>)}</nav>; }
export function ProjectTabs({ projectId }: { projectId: string }) { const path = usePathname(); return <nav className="tabs" aria-label="프로젝트 메뉴">{[["", "개요"], ["/requirements", "요구사항"], ["/scope", "Scope 문서"], ["/estimate", "견적"], ["/changes", "변경 요청"]].map(([suffix, label]) => { const href = `/projects/${projectId}${suffix}`; return <Link className={path === href ? "active" : ""} key={href} href={href}>{label}</Link>; })}</nav>; }
