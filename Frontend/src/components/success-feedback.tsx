"use client";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
const subscribe = (listener: () => void) => { window.addEventListener("scopeflow-feedback", listener); return () => window.removeEventListener("scopeflow-feedback", listener); };
export function SuccessFeedback() {
  const pathname = usePathname();
  const raw = useSyncExternalStore(subscribe, () => sessionStorage.getItem("scopeflow-feedback") ?? "", () => "");
  useEffect(() => {
    if (!raw) return;
    const timer = setTimeout(() => { sessionStorage.removeItem("scopeflow-feedback"); window.dispatchEvent(new Event("scopeflow-feedback")); }, 8000);
    return () => clearTimeout(timer);
  }, [raw]);
  const value = raw ? JSON.parse(raw) as { path: string; message: string } : null;
  return value?.path === pathname ? <div className="form-success mb-5 row" role="status"><span>{value.message}</span><button type="button" className="text-button" onClick={() => { sessionStorage.removeItem("scopeflow-feedback"); window.dispatchEvent(new Event("scopeflow-feedback")); }} aria-label="알림 닫기">닫기</button></div> : null;
}
