"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { UsageResponse } from "@/lib/ai-usage";
type CreditSnapshot = Pick<UsageResponse, "asOf" | "workspace" | "user" | "availableCredits" | "previews">;
type CreditContextValue = { data: CreditSnapshot | null; loading: boolean; error: string; refresh: () => Promise<void>; workspaceId: string; canRun: boolean };
const CreditContext = createContext<CreditContextValue | null>(null);
export function CreditProvider({ initial, workspaceId, canRun, children }: { initial: CreditSnapshot | null; workspaceId: string; canRun: boolean; children: ReactNode }) {
  const [fetched, setFetched] = useState<CreditSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current; setLoading(true); setError("");
    try {
      const response = await fetch("/api/ai", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Credit 정보를 확인하지 못했습니다.");
      if (request === sequence.current) setFetched(data);
    } catch (failure) { if (request === sequence.current) setError(failure instanceof Error ? failure.message : "Credit 정보를 확인하지 못했습니다."); }
    finally { if (request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    window.addEventListener("scopeflow-credit-refresh", focus);
    return () => { window.removeEventListener("focus", focus); window.removeEventListener("scopeflow-credit-refresh", focus); };
  }, [refresh]);
  const data = fetched && (!initial || fetched.asOf >= initial.asOf) ? fetched : initial;
  return <CreditContext.Provider value={{ data, loading, error, refresh, workspaceId, canRun }}>{children}</CreditContext.Provider>;
}
export function useCredit() { const value = useContext(CreditContext); if (!value) throw new Error("CreditProvider is required"); return value; }
export function CreditBalance() {
  const credit = useCredit();
  if (credit.loading) return <p role="status">Credit 정보를 확인하고 있습니다.</p>;
  if (credit.error || !credit.data) return <><p role="alert">Credit 정보를 확인하지 못했습니다.</p><button className="text-button" type="button" onClick={() => void credit.refresh()}>다시 확인</button></>;
  return <><div className="row"><strong>잔여 AI Credit</strong><span>{credit.data.availableCredits} Credit</span></div><div className="progress"><span style={{ width: Math.min(100, credit.data.workspace.used / Math.max(1, credit.data.workspace.limit) * 100) + "%" }} /></div><small>팀 사용 {credit.data.workspace.used} / {credit.data.workspace.limit} · 처리 중 예약 {credit.data.workspace.reserved}</small></>;
}
