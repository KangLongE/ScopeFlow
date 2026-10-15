import { Layers3, ChevronRight, CircleCheck } from "lucide-react";
import { currentContext, usageResponse } from "@/lib/queries";
import { CreditProvider, CreditBalance } from "@/components/credit";
import { Navigation } from "@/components/navigation";
import { Logo } from "@/components/ui";
import { SuccessFeedback } from "@/components/success-feedback";
import { SignOut } from "@/components/form";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await currentContext(); const usage = await usageResponse(ctx.workspaceId).catch(() => null);
  return <CreditProvider key={ctx.workspaceId} initial={usage && { asOf: usage.asOf, availableCredits: usage.availableCredits, workspace: usage.workspace, user: usage.user, previews: usage.previews }} workspaceId={ctx.workspaceId} canRun={ctx.role === "OWNER"}><div className="app-shell"><aside className="sidebar"><Logo /><Link href="/settings" className="workspace-box"><div className="workspace-icon">{ctx.workspace.name.slice(0,1)}</div><div><strong>{ctx.workspace.name}</strong><small>TEAM WORKSPACE</small></div></Link><div className="nav-label">WORKSPACE</div><Navigation /><div className="sidebar-bottom"><div className="credit-box"><CreditBalance /><Link className="inline-link" href="/usage">사용량 확인</Link></div><div className="user-box"><div className="avatar">{ctx.user.name.slice(0,1)}</div><div><strong>{ctx.user.name}</strong><SignOut /></div></div></div></aside><div className="app-main"><header className="topbar"><div className="breadcrumb"><Layers3 size={15} /><span>Workspace</span><ChevronRight size={12} /><span>{ctx.workspace.name}</span></div><div className="topbar-right"><span><CircleCheck size={13} />함께 명확하게, ScopeFlow</span><div className="avatar">{ctx.user.name.slice(0,1)}</div></div></header><main className="content"><SuccessFeedback />{children}</main></div></div></CreditProvider>;
}
