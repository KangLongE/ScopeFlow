"use client";
import { useState, type ReactNode } from "react";
import { CircleCheck, CircleHelp, CircleMinus } from "lucide-react";

export function RequirementStatus({ status, detail = false }: { status: string; detail?: boolean }) {
  const Icon = status === "CONFIRMED" ? CircleCheck : status === "PENDING" ? CircleHelp : CircleMinus;
  return <span className={`requirement-state ${status.toLowerCase()}`}><Icon size={16} aria-hidden="true" />{status === "PENDING" ? "확인 필요" : status === "CONFIRMED" ? detail ? "확정된 요구사항" : "확정" : status === "EXCLUDED" ? "제외" : status}</span>;
}

export function RequirementsWorkbench({ items, action }: { items: { id: string; title: string; description: string; status: string; detail: ReactNode }[]; action?: ReactNode }) {
  const [selection, setSelection] = useState(items[0]?.id);
  const selected = items.some(item => item.id === selection) ? selection : items[0]?.id;
  return <div className="requirements-workbench">
    <section className="workbench-list" id="requirements-list" aria-label="요구사항 목록">
      <div className="workbench-list-heading"><h2>요구사항 목록 ({items.length})</h2>{action}</div>
      <div className="requirement-options">{items.map(item => <button type="button" id={`requirement-option-${item.id}`} key={item.id} aria-pressed={selected === item.id} aria-controls={`requirement-detail-${item.id}`} className={`requirement-option${selected === item.id ? " selected" : ""}`} onClick={() => {
        setSelection(item.id);
        if (window.matchMedia("(max-width:900px)").matches) requestAnimationFrame(() => {
          const panel = document.getElementById(`requirement-detail-${item.id}`);
          panel?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion:reduce)").matches ? "instant" : "smooth", block: "start" });
          panel?.focus({ preventScroll: true });
        });
      }}><span className="requirement-option-copy"><strong>{item.title}</strong><span>{item.description}</span></span><RequirementStatus status={item.status} /></button>)}</div>
      {!items.length && <p className="workbench-empty">고객 요청을 바탕으로 요구사항을 직접 추가하거나 AI 검토 초안을 반영하세요.</p>}
    </section>
    <div className="workbench-details">
      <a href="#requirements-list" className="mobile-list-link">요구사항 목록으로 돌아가기</a>
      {/* Keep each editor mounted so switching requirements preserves unsaved input. */}
      {items.map(item => <section key={item.id} id={`requirement-detail-${item.id}`} role="region" tabIndex={-1} aria-labelledby={`requirement-option-${item.id}`} hidden={selected !== item.id} className="requirement-detail">{item.detail}</section>)}
      {!items.length && <div className="workbench-empty"><h2>검토할 요구사항이 없습니다</h2><p>요구사항을 추가하면 완료 기준과 고객 근거를 함께 확인할 수 있습니다.</p></div>}
    </div>
  </div>;
}
