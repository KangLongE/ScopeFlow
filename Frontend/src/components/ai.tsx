import { Sparkles } from "lucide-react";
import { MutationForm } from "./form";
import { Card } from "./ui";
import { initialSchema, questionsSchema, requirementsSchema, workSchema, labels } from "@/lib/model";
import { aiConfigured } from "@/lib/ai/provider";
import type { AIAction } from "@/lib/ai/prompts";
import type { aiDrafts } from "@/lib/db/schema";
export function AIButton({ projectId, task, force = false }: { projectId: string; task: Exclude<AIAction,"compare">; force?: boolean }) { return <MutationForm action="ai.run" className="compact ai" payload={{projectId,task,force}} submit={force ? "다시 생성 (Credit 사용)" : `✧ AI ${labels[task]}`} disabled={!aiConfigured()} />; }
export function DraftPanel({ draft }: { draft: typeof aiDrafts.$inferSelect | undefined }) {
  if (!draft || draft.appliedAt || draft.action === "summary") return null;
  let items: { title: string; description: string }[] = [];
  if (draft.action === "initial") { const a = initialSchema.parse(draft.result); items = [{title:a.projectType,description:a.summary}, ...a.features.map(f=>({title:`${f.title} · 신뢰도 ${Math.round(f.confidence*100)}%`,description:f.description})), ...a.missingInformation.map(q=>({title:q.question,description:q.reason}))]; }
  if (draft.action === "questions") items = questionsSchema.parse(draft.result).questions.map(q=>({title:q.question,description:q.reason}));
  if (draft.action === "requirements") items = requirementsSchema.parse(draft.result).requirements.map(r=>({title:r.title,description:r.description}));
  if (draft.action === "estimate") items = workSchema.parse(draft.result).items.map((i,n)=>({title:`항목 ${n+1} · 총 ${Object.values(i.hours).reduce((sum,h)=>sum+h,0)}시간`,description:i.reason}));
  return <Card title="AI 분석 초안" hint="아래 내용을 확인한 뒤 반영하세요. 기존 항목을 임의로 삭제하지 않습니다." action={<Sparkles size={17} className="green-text" />}><div className="card-body"><div className="detail-list">{items.map((item,i)=><div key={i} className="activity-item"><div><strong>{item.title}</strong><p>{item.description}</p></div></div>)}</div><div className="actions-row"><MutationForm action="ai.apply" payload={{projectId:draft.projectId,task:draft.action}} submit={draft.action === "initial" ? "추가 질문 반영" : draft.action === "estimate" ? "견적 초안 반영" : "검토한 초안 반영"} /><AIButton projectId={draft.projectId} task={draft.action as Exclude<AIAction,"compare">} force /></div></div></Card>;
}
