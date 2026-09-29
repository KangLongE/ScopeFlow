import { MutationForm } from "./form";
import { labels } from "@/lib/model";
type AITask = "initial" | "questions" | "requirements" | "estimate";
export function AIButton({ projectId, task, force = false, primary = false }: { projectId: string; task: AITask; force?: boolean; primary?: boolean }) { return <MutationForm action="ai.run" variant={primary ? "primary" : "secondary"} className="compact ai" payload={{projectId,task,force}} submit={force ? "다시 생성 (Credit 사용)" : `✧ AI ${labels[task]}`} />; }
