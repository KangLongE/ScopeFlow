"use client";
import { useState } from "react";
import { CircleCheck, Flag, Tag } from "lucide-react";
import { labels } from "@/lib/model";
import type { ProjectDetail } from "@/lib/queries";
import { MutationForm } from "./form";
import { Textarea } from "./ui";

export function RequirementEditor({ projectId, requirement: r }: { projectId: string; requirement: ProjectDetail["requirements"][number] }) {
  const [needsReason, setNeedsReason] = useState(false);
  return <div onChangeCapture={event => {
    const form = (event.target as HTMLElement).closest("form");
    if (!form) return;
    const data = new FormData(form);
    setNeedsReason(["title", "description", "status"].some(key => data.get(key) !== r[key as "title" | "description" | "status"]));
  }}>
    <MutationForm action="requirement.save" payload={{ projectId, requirementId: r.id }} submit="수정 저장" className="requirement-editor" onResult={result => { if (!result.error) setNeedsReason(false); }}>
      <input type="hidden" name="title" value={r.title} /><input type="hidden" name="type" value={r.type} />
      <div className="completion-field"><Textarea label="완료 기준" name="description" value={r.description} required rows={2} /></div>
      <div className="requirement-attributes">
        <label>카테고리<span className="attribute-control"><Tag size={17} aria-hidden="true" /><input key={r.category} name="category" defaultValue={r.category} required maxLength={160} /></span></label>
        <label>우선순위<span className="attribute-control"><Flag size={17} aria-hidden="true" /><select key={r.priority} name="priority" defaultValue={r.priority}>{["HIGH", "MEDIUM", "LOW"].map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></span></label>
        <label>범위 상태<span className="attribute-control"><CircleCheck size={17} aria-hidden="true" /><select key={r.status} name="status" defaultValue={r.status}><option value="CONFIRMED">확정</option><option value="PENDING">확인 필요</option><option value="EXCLUDED">제외</option></select></span></label>
      </div>
      <div className="requirement-reason" hidden={!needsReason}><Textarea label="고객 조건 수정 사유" name="decisionReason" required={needsReason} rows={2} placeholder="제목·완료 기준·범위 상태를 변경한 근거를 남겨주세요." /></div>
    </MutationForm>
  </div>;
}
