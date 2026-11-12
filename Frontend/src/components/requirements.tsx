import { Field, Textarea } from "./ui";
import { labels, type RequirementInput } from "@/lib/model";
import { Check, ChevronDown, CircleHelp, Minus } from "lucide-react";
import type { ReactNode } from "react";
import type { ProjectDetail } from "@/lib/queries";
import type { AIContextSnapshot } from "@/lib/ai-context";
import { AIEvidence } from "./ai-context";

export function RequirementRow({ requirement: r, context, children }: { requirement: ProjectDetail["requirements"][number]; context?: AIContextSnapshot; children?: ReactNode }) {
  const Icon = r.status === "CONFIRMED" ? Check : r.status === "PENDING" ? CircleHelp : Minus;
  return <details className={`requirement-row ${r.status.toLowerCase()}`}>
    <summary><span className="requirement-status-icon"><Icon size={18} aria-hidden="true" /></span><span className="requirement-copy"><strong>{r.title}</strong><span>{r.description}</span></span><span className="requirement-row-meta"><span className="requirement-status">{r.status === "PENDING" ? "확인 필요" : labels[r.status] || r.status}</span><span className="requirement-disclosure">상세·근거 보기 <ChevronDown size={15} aria-hidden="true" /></span></span></summary>
    <div className="detail-body"><div className="detail-meta"><span>{r.category}</span><span>{labels[r.type]}</span><span>{labels[r.priority]}</span><span>{labels[r.source]}</span></div><AIEvidence sourceRefs={r.provenance?.sourceRefs} context={context} />{children}</div>
  </details>;
}

export function CustomerRequestContext({ content, context, budget, children }: { content?: string; context?: AIContextSnapshot; budget: number | null; children?: ReactNode }) {
  const verified = context?.explicitCustomerConstraints.filter(c => c.active && c.status === "explicit" && c.evidence.trim() && c.sourceRefs.some(id => context.sources.find(s => s.id === id)?.text.includes(c.evidence))) ?? [];
  const provided = ["logoProvided", "menuProvided"].every(key => verified.some(c => c.key === key && c.value === true));
  const conditions = [...new Set(verified.map(c => {
    if (c.key === "pageCount" && typeof c.value === "number") return `페이지 수 ${c.value}개`;
    if (c.value === true && ["logoProvided", "menuProvided"].includes(c.key)) return provided ? "로고·메뉴 자료는 고객 제공" : c.key === "logoProvided" ? "로고는 고객 제공" : "메뉴 자료는 고객 제공";
    return c.evidence;
  }))];
  const excluded = [...new Set(context?.confirmedExcludedScope.map(c => c.title) ?? [])];
  return <section className="card customer-context" aria-label="고객 원문과 확인된 범위">
    <div className="context-section"><h2>고객 요청 원문 <span className="fact-label">원문</span></h2><div className="customer-request-preview"><p className="customer-request-text">{content || "고객이 전달한 요청을 등록해주세요."}</p></div>{children}</div>
    <div className="context-section"><h2>확인된 조건 <span className="fact-label">근거 확인</span></h2>{conditions.length ? <ul className="context-facts">{conditions.map(text => <li key={text}>{text}</li>)}</ul> : <p className="context-empty">확인된 고객 조건이 아직 없습니다.</p>}{budget !== null && <p className="registered-budget">등록 예산 <strong>{budget.toLocaleString("ko-KR")}원</strong></p>}</div>
    <div className="context-section"><h2>제외 범위 <span className="fact-label">확인된 항목</span></h2>{excluded.length ? <ul className="context-facts">{excluded.map(title => <li key={title}>{title}</li>)}</ul> : <p className="context-empty">확인된 제외 항목이 아직 없습니다.</p>}</div>
  </section>;
}
export function RequirementFields({ value }: { value?: RequirementInput & { status?: string } }) { return <><div className="form-grid"><Field label="기능 / 요구사항 이름" name="title" value={value?.title} required /><Field label="분류" name="category" value={value?.category} placeholder="예: 인증, 결제, 디자인" required /><label>유형<select name="type" defaultValue={value?.type || "FEATURE"}>{["FEATURE","NON_FUNCTIONAL","DESIGN","INFRA","EXTERNAL_INTEGRATION"].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label><label>우선순위<select name="priority" defaultValue={value?.priority || "MEDIUM"}>{["HIGH","MEDIUM","LOW"].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label><label>범위 상태<select name="status" defaultValue={value?.status || "CONFIRMED"}><option value="CONFIRMED">확정</option><option value="PENDING">확인 필요</option><option value="EXCLUDED">제외</option></select></label></div><Textarea label="상세 설명과 완료 기준" name="description" value={value?.description} required placeholder="어떤 동작이 필요하고, 어디까지 제공하는지 명확하게 적어주세요." /></>; }
