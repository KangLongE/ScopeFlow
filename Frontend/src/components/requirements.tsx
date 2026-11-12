import { Field, Textarea } from "./ui";
import { labels, type RequirementInput } from "@/lib/model";
import { ChevronDown, Coins, FileText, Image as ImageIcon, Info } from "lucide-react";
import type { AIContextSnapshot } from "@/lib/ai-context";

export function RequirementContext({ context, sourceRefs = [], budget }: { context?: AIContextSnapshot; sourceRefs?: string[]; budget: number | null }) {
  const verified = context?.explicitCustomerConstraints.filter(c => c.active && c.status === "explicit" && c.evidence.trim() && c.sourceRefs.some(id => context.sources.find(s => s.id === id)?.text.includes(c.evidence))) ?? [];
  const provided = ["logoProvided", "menuProvided"].every(key => verified.some(c => c.key === key && c.value === true));
  const conditions = [...new Set(verified.map(c => {
    if (c.key === "pageCount" && typeof c.value === "number") return `페이지 수 ${c.value}개`;
    if (c.value === true && ["logoProvided", "menuProvided"].includes(c.key)) return provided ? "로고·메뉴 자료는 고객 제공" : c.key === "logoProvided" ? "로고는 고객 제공" : "메뉴 자료는 고객 제공";
    return c.evidence;
  }))];
  const excluded = [...new Set(context?.confirmedExcludedScope.map(c => c.title) ?? [])];
  const sources = sourceRefs.map(id => context?.sources.find(source => source.id === id)).filter(source => source !== undefined);
  const customerSource = sources.some(source => ["REQUEST", "INITIAL_REQUEST", "ANSWER", "CHANGE_REQUEST"].includes(source.kind));
  return <div className="requirement-context">
    <section className="linked-evidence"><h3>{customerSource || !sources.length ? "연결된 고객 근거" : "연결된 근거"}</h3>
      {sources.length ? <blockquote><p>{sources[0].text}</p><details className="source-quote-details"><summary><cite>{sources[0].label} · 원문 전체 보기</cite><ChevronDown size={14} aria-hidden="true" /></summary><div>{sources.map(source => <div key={source.id}><strong>{source.label}</strong><p className="prose">{source.text}</p></div>)}</div></details></blockquote> : <p className="muted">아직 고객 근거가 연결되지 않았습니다. 아래 원문·분석 도구에서 고객 요청을 확인하세요.</p>}
      {sourceRefs.some(id => !sources.some(source => source.id === id)) && <p className="form-error">연결된 출처를 확인할 수 없습니다.</p>}
    </section>
    <section className="shared-conditions"><h3>함께 확인할 조건</h3><ul>{conditions.map(text => <li key={text}>{text.includes("제공") ? <ImageIcon size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}<span>{text}</span></li>)}{budget !== null && <li><Coins size={18} aria-hidden="true" /><span>등록 예산 {budget.toLocaleString("ko-KR")}원</span></li>}</ul>{!conditions.length && budget === null && <p className="muted">확인된 고객 조건이 아직 없습니다.</p>}</section>
    <footer className="requirement-context-footer"><p><strong>제외:</strong> {excluded.length ? excluded.join(" · ") : "확인된 항목 없음"}</p><span><Info size={15} aria-hidden="true" />AI 초안은 담당자 검토 후 반영됩니다.</span></footer>
  </div>;
}
export function RequirementFields({ value }: { value?: RequirementInput & { status?: string } }) { return <><div className="form-grid"><Field label="기능 / 요구사항 이름" name="title" value={value?.title} required /><Field label="분류" name="category" value={value?.category} placeholder="예: 인증, 결제, 디자인" required /><label>유형<select name="type" defaultValue={value?.type || "FEATURE"}>{["FEATURE","NON_FUNCTIONAL","DESIGN","INFRA","EXTERNAL_INTEGRATION"].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label><label>우선순위<select name="priority" defaultValue={value?.priority || "MEDIUM"}>{["HIGH","MEDIUM","LOW"].map(v=><option key={v} value={v}>{labels[v]}</option>)}</select></label><label>범위 상태<select name="status" defaultValue={value?.status || "CONFIRMED"}><option value="CONFIRMED">확정</option><option value="PENDING">확인 필요</option><option value="EXCLUDED">제외</option></select></label></div><Textarea label="상세 설명과 완료 기준" name="description" value={value?.description} required placeholder="어떤 동작이 필요하고, 어디까지 제공하는지 명확하게 적어주세요." /></>; }
