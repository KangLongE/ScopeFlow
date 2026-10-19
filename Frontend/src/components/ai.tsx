"use client";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { labels, type ActionResult } from "@/lib/model";
import { operations, creditStateLabel, type AITask, type Execution, type CreditPreview } from "@/lib/ai-usage";
import { useCredit } from "./credit";
import { AIFailureNotice } from "./ai-failure";
import { manualReviewLink } from "@/lib/ai-failure";
export function AIButton({ projectId, task, changeId, force = false, primary = false, edited = false, blockReason }: { projectId: string; task: AITask; changeId?: string; force?: boolean; primary?: boolean; edited?: boolean; blockReason?: string }) {
  const credit = useCredit();
  const { refresh, workspaceId } = credit;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [execution, setExecution] = useState<Execution | null>(null);
  const sending = useRef(false);
  const alive = useRef(true);
  const key = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey = ["scopeflow-ai-execution", workspaceId, projectId, task, changeId ?? ""].join(":");
  const snapshotId = credit.data?.asOf;
  const canRun = credit.canRun;
  const previewId = [projectId, task, changeId ?? "", force, snapshotId].join(":");
  const [prepared, setPrepared] = useState<{ id: string; preview?: CreditPreview; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!snapshotId || !canRun) return;
    const query = new URLSearchParams({ operation: operations[task], projectId, regenerate: String(force), ...(changeId ? { changeId } : {}) });
    void (async () => {
      try { const response = await fetch("/api/ai?" + query.toString(), { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Credit 정보를 확인하지 못했습니다."); if (!cancelled) setPrepared({ id: previewId, preview: data.preview }); }
      catch (failure) { if (!cancelled) setPrepared({ id: previewId, error: failure instanceof Error ? failure.message : "Credit 정보를 확인하지 못했습니다." }); }
    })();
    return () => { cancelled = true; };
  }, [previewId, snapshotId, canRun, projectId, task, force, changeId]);
  const preview = prepared?.id === previewId ? prepared.preview : undefined;
  const previewError = prepared?.id === previewId ? prepared.error : undefined;
  const check = useCallback(async function read(executionKey: string) {
    if (!alive.current) return;
    setPending(true); setUncertain(true);
    try {
      const response = await fetch("/api/ai?executionKey=" + encodeURIComponent(executionKey), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "실행 상태를 확인하지 못했습니다.");
      if (!alive.current) return;
      const state = data.execution as Execution;
      setExecution(state); setError("");
      await refresh();
      if (!alive.current) return;
      if (state.state === "RUNNING") { timer.current = setTimeout(() => void read(executionKey), 2500); return; }
      if (state.state === "UNKNOWN") { setPending(false); setError("실행 결과와 사용 상태를 확정하지 못했습니다. 같은 실행을 조회하거나 담당자에게 확인해주세요. 새 호출은 자동 실행하지 않습니다."); return; }
      setUncertain(false); setPending(false); sending.current = false;
      sessionStorage.removeItem(storageKey); key.current = null;
      if (state.state === "COMPLETED") { sessionStorage.setItem("scopeflow-ai-review", projectId + ":" + task); router.refresh(); }
    } catch (failure) {
      if (!alive.current) return;
      setPending(false); setError(failure instanceof Error ? failure.message : "실행 상태를 확인하지 못했습니다.");
    }
  }, [refresh, storageKey, projectId, task, router]);
  useEffect(() => {
    alive.current = true;
    const saved = sessionStorage.getItem(storageKey);
    if (saved) { key.current = saved; void check(saved); }
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); };
  }, [check, storageKey]);
  async function run(resend = false) {
    if (pending || !resend && (sending.current || uncertain)) return;
    const existing = sessionStorage.getItem(storageKey);
    if (existing && !resend) { key.current = existing; void check(existing); return; }
    if (blockReason || !credit.canRun || credit.loading || credit.error || !preview?.canExecute || preview.creditCost === null) return;
    const visibleDraft = document.querySelector<HTMLElement>('[data-ai-task="' + task + '"]' + (changeId ? '[data-ai-change-id="' + changeId + '"]' : ''));
    const hasEdits = edited || visibleDraft?.dataset.aiEdited === "true";
    if (hasEdits && !window.confirm("재실행하면 현재 검토 초안이 새 결과로 바뀝니다. 저장하지 않은 편집 내용이 사라질 수 있습니다. 새로 실행할까요?")) return;
    sending.current = true; setPending(true); setError(""); setExecution(null);
    const executionKey = existing ?? crypto.randomUUID(); key.current = executionKey; sessionStorage.setItem(storageKey, executionKey);
    try {
      const response = await fetch("/api/commands", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: task === "compare" ? "change.analyze" : "ai.run", projectId, ...(task === "compare" ? { changeId } : { task }), force, executionKey, policyRevision: preview.policyRevision }) });
      const data = await response.json() as ActionResult;
      if (!alive.current) return;
      if (data.execution) { await check(executionKey); return; }
      if (data.uncertain || !response.ok && response.status >= 500) { await check(executionKey); return; }
      setError(data.error ?? "실행 상태를 확인하지 못했습니다.");
      sessionStorage.removeItem(storageKey); key.current = null; sending.current = false; setPending(false);
      await refresh();
    } catch { if (alive.current) await check(executionKey); }
  }
  const block = blockReason ?? (!credit.canRun ? "AI 실행은 Workspace 소유자만 할 수 있습니다." : credit.loading || !preview && !previewError && !!credit.data ? "Credit 정보를 확인하고 있습니다." : credit.error || previewError || !preview ? previewError ?? "Credit 정보를 확인하지 못했습니다." : preview.blockReason);
  const manual = manualReviewLink(projectId, task, changeId);
  function continueManually(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById(manual.target);
    if (!target) return;
    event.preventDefault();
    let parent: HTMLElement | null = target; while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    target.querySelectorAll("details").forEach(details => { details.open = true; });
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    (target.querySelector<HTMLElement>("input:not([type=hidden]),textarea,select,button") ?? target).focus({ preventScroll: true });
  }
  return <div className="ai-execution" aria-busy={pending}>
    <button type="button" className={"button " + (primary ? "primary" : "secondary")} disabled={!!block || !preview?.canExecute || pending || uncertain} onClick={() => void run()}>{pending && <LoaderCircle size={16} className="spin" />}{pending ? "AI " + labels[task] + " 중…" : (force ? "✧ AI 다시 " + labels[task] : "✧ AI " + labels[task])}{preview?.creditCost !== null && preview?.creditCost !== undefined && " · " + preview.creditCost + " Credit"}</button>
    {!block && preview && <p className="text-xs">잔여 {preview.availableCredits} Credit → 실행 후 예상 {preview.expectedRemaining} Credit<br />다른 실행이 없을 때의 예상값입니다. 캐시 재사용은 실제 차감 0 Credit입니다.</p>}
    {block && <p className="text-xs" role={credit.error ? "alert" : "status"}>{block}</p>}
    {(credit.error || previewError || !credit.data) && !credit.loading && <button type="button" className="text-button" onClick={() => void refresh()}>Credit 다시 확인</button>}
    <p className="text-xs">현재 검토 초안이 있는 작업은 실행하면 새 결과로 바뀝니다. 저장하지 않은 답변은 AI 입력에 포함되지 않습니다.</p>
    {uncertain && <p role="status">실행 상태를 확인하고 있습니다. 자동으로 새 유료 요청을 보내지 않습니다.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {error && !execution && <a href={manual.href} className="text-button" onClick={continueManually}>수동 검토 계속하기 · 실제 차감량은 실행 기록에서 확인해주세요</a>}
    {uncertain && !pending && <div className="actions-row"><button type="button" className="button secondary" onClick={() => key.current && void check(key.current)}>같은 실행 상태 다시 확인</button><button type="button" className="button secondary" disabled={!!block || !preview?.canExecute} onClick={() => void run(true)}>동일 요청 다시 전송</button></div>}
    {execution?.state === "FAILED" && <AIFailureNotice execution={execution} manualHref={manual.href} onManual={continueManually} onRetry={() => void run()} retryCost={preview?.creditCost} retryDisabled={pending || uncertain || !!block || !preview?.canExecute} />}
    {execution && execution.state !== "FAILED" && <p className="form-success" role="status">{execution.state === "COMPLETED" ? "AI 실행 완료 · 초안의 검증 상태는 별도로 확인해주세요." : execution.state === "UNKNOWN" ? "실행 상태 확인 불가" : execution.state === "RESULT_READY" ? "AI 실행은 완료됐으나 검토 초안 반영은 확인이 필요합니다. 기존 편집과 실행 결과는 보존했습니다." : "AI 실행 중"} · {creditStateLabel(execution.creditState)}{execution.creditsUsed !== null && " · 실제 사용 " + execution.creditsUsed + " Credit"}</p>}
  </div>;
}
