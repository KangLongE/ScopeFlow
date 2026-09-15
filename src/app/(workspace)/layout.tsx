import { Layers3, ChevronRight, CircleCheck } from "lucide-react";
import { currentContext, monthlyUsage } from "@/lib/queries";
import { Navigation } from "@/components/navigation";
import { Logo } from "@/components/ui";
import { SignOut } from "@/components/form";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await currentContext(); const usage = await monthlyUsage(ctx.workspaceId); const credits = usage.reduce((sum, u) => sum + u.creditsUsed, 0);
  return <div className="app-shell"><aside className="sidebar"><Logo /><Link href="/settings" className="workspace-box"><div className="workspace-icon">{ctx.workspace.name.slice(0,1)}</div><div><strong>{ctx.workspace.name}</strong><small>TEAM WORKSPACE</small></div></Link><div className="nav-label">WORKSPACE</div><Navigation /><div className="sidebar-bottom"><Link href="/usage" className="credit-box block"><div className="row"><strong>AI Credit</strong><span>{credits} <span className="muted">/ {ctx.workspace.creditLimit}</span></span></div><div className="progress"><span style={{ width: `${Math.min(100, credits / Math.max(1, ctx.workspace.creditLimit) * 100)}%` }} /></div><small>명확한 요구사항을 만드는 작은 도움</small></Link><div className="user-box"><div className="avatar">{ctx.user.name.slice(0,1)}</div><div><strong>{ctx.user.name}</strong><SignOut /></div></div></div></aside><div className="app-main"><header className="topbar"><div className="breadcrumb"><Layers3 size={15} /><span>Workspace</span><ChevronRight size={12} /><span>{ctx.workspace.name}</span></div><div className="topbar-right"><span><CircleCheck size={13} />함께 명확하게, ScopeFlow</span><div className="avatar">{ctx.user.name.slice(0,1)}</div></div></header><main className="content">{children}</main></div></div>;
}
