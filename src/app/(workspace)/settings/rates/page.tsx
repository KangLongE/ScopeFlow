import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateCards } from "@/lib/db/schema";
import { currentContext } from "@/lib/queries";
import { Card, Field, PageHeading } from "@/components/ui";
import { MutationForm } from "@/components/form";
import { defaultRates, roles, roleLabels } from "@/lib/model";
export default async function Rates() { const ctx=await currentContext(); const [card]=await db.select().from(rateCards).where(eq(rateCards.workspaceId,ctx.workspaceId)); return <><PageHeading eyebrow="RATE CARD" title="작업 단가" description="AI는 작업 시간을 추정하고, 견적은 우리 팀의 단가로 계산합니다." /><div className="tabs"><Link href="/settings">Workspace</Link><Link className="active" href="/settings/rates">작업 단가</Link><Link href="/settings/ai">AI 및 Credit</Link></div><Card title="시간당 작업 단가" hint="기준 통화: KRW"><div className="card-body"><MutationForm action="rates.save" disabled={ctx.role!=="OWNER"} submit="단가표 저장"><div className="form-grid">{roles.map(role=><Field key={role} label={`${roleLabels[role]} · KRW / hour`} name={`rates.${role}`} type="number" min={0} max={1e12} value={(card?.rates||defaultRates)[role]} required />)}</div><p className="text-xs">새 견적과 변경 요청에 적용됩니다. 기존 견적 초안은 항목을 저장하면 현재 단가표가 반영됩니다. 이미 공유·승인된 Scope의 견적에는 영향을 주지 않습니다.</p></MutationForm></div></Card></>; }
