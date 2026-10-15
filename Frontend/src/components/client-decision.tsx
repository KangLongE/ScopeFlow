"use client";
import { useState } from "react";
import { MutationForm } from "./form";
import { Field, Textarea } from "./ui";
import { impactSentence, type ChangeApprovalImpact } from "@/lib/change-approval-impact";

export function ClientDecisionForm({ token, impact, change = false }: { token: string; impact?: ChangeApprovalImpact | null; change?: boolean }) {
  const [decision, setDecision] = useState("APPROVE");
  const canApprove = !change || impact?.canApprove === true;
  const target = impact ? { approvalSnapshotId: impact.approvalSnapshotId, changeRequestId: impact.changeRequestId, revision: impact.revision } : undefined;
  return <MutationForm endpoint="/api/client" action="client.decide" variant="primary" payload={{ token, target }} submitDisabled={decision === "APPROVE" && !canApprove} submit="검토 의견 전달">
    {impact && <p className="impact-sentence">{impactSentence(impact)}</p>}
    {change && !canApprove && <p className="form-error" role="alert">{impact?.approvalBlockReason ?? "승인 요약 확인 전에는 승인할 수 없습니다."}</p>}
    <div className="form-grid"><Field label="확인자 이름" name="name" required /><label>검토 결과<select name="decision" value={decision} onChange={e => setDecision(e.target.value)}><option value="APPROVE" disabled={!canApprove}>승인</option><option value="REVISE">수정 요청</option>{change && <option value="REJECT">거절</option>}</select></label></div>
    <Textarea label="의견 (수정 요청·거절 시 필수)" name="message" rows={3} />
    <label className="check-label"><input type="checkbox" name="consent" required />표시된 범위·일정·견적을 확인했으며 선택한 의견을 전달합니다.</label>
  </MutationForm>;
}
