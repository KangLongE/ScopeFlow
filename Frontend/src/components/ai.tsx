import { MutationForm } from "./form";
import { labels } from "@/lib/model";
type AITask = "initial" | "questions" | "requirements" | "estimate";
export function AIButton({ projectId, task, force = false }: { projectId: string; task: AITask; force?: boolean }) { return <MutationForm action="ai.run" className="compact ai" payload={{projectId,task,force}} submit={force ? "다시 생성 (Credit 사용)" : `✧ AI ${labels[task]}`} />; }
