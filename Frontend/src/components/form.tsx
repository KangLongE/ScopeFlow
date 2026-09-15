"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, LoaderCircle } from "lucide-react";
import type { ActionResult } from "@/lib/model";

export function MutationForm({ action, payload = {}, endpoint = "/api/commands", children, submit = "저장", className = "", confirm, disabled = false }: { action: string; payload?: Record<string, unknown>; endpoint?: string; children?: ReactNode; submit?: string; className?: string; confirm?: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult>({});
  const [copied, setCopied] = useState(false);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const form = event.currentTarget;
    const data: Record<string, unknown> = { ...payload, action };
    for (const [name, raw] of new FormData(form)) {
      const control = form.elements.namedItem(name);
      const value = control instanceof HTMLInputElement && control.type === "number" ? (raw === "" ? "" : Number(raw)) : raw;
      const [group, field] = name.split(".");
      if (field) { const record = data[group] && typeof data[group] === "object" ? { ...data[group] as Record<string, unknown> } : {}; record[field] = value; data[group] = record; }
      else data[name] = value;
    }
    setPending(true); setResult({});
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result: ActionResult = await response.json();
      if (!response.ok && !result.error) result.error = "처리 중 문제가 발생했습니다.";
      setResult(result);
      if (!result.error) { if (result.redirect) router.push(result.redirect); router.refresh(); }
    } catch { setResult({ error: "서버에 연결할 수 없습니다. 연결 상태를 확인해주세요." }); }
    finally { setPending(false); }
  }
  return <form onSubmit={send} className={`mutation-form ${className}`}>
    <fieldset disabled={pending || disabled}>{children}<button className="button" type="submit" disabled={pending || disabled}>{pending && <LoaderCircle className="spin" size={16} />}{pending ? "처리 중…" : submit}</button></fieldset>
    {result.error && <p className="form-error" role="alert">{result.error}</p>}
    {result.message && <p className="form-success" role="status">{result.message}</p>}
    {result.link && <div className="share-result"><a href={result.link} target="_blank" rel="noreferrer">고객 승인 페이지 열기 ↗</a><button className="button secondary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}${result.link}`); setCopied(true); } catch { setResult(r => ({ ...r, error: "주소를 직접 선택해 복사해주세요." })); } }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "복사됨" : "링크 복사"}</button><input aria-label="고객 공유 링크" readOnly value={typeof location === "undefined" ? result.link : `${location.origin}${result.link}`} onFocus={e => e.target.select()} /></div>}
  </form>;
}

export function AuthForm({ signup = false }: { signup?: boolean }) {
  const [error, setError] = useState(""); const [pending, setPending] = useState(false); const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); setPending(true); setError("");
    try {
      const response = await fetch(`/api/auth/${signup ? "sign-up" : "sign-in"}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!response.ok) { setError(signup ? "가입 정보를 확인해주세요. 이미 가입된 이메일이거나 요청이 제한되었습니다." : "이메일과 비밀번호를 확인해주세요. 잠시 후 다시 시도할 수 있습니다."); return; }
      router.push(signup ? "/onboarding" : "/dashboard"); router.refresh();
    } catch { setError("서버 연결을 확인해주세요."); } finally { setPending(false); }
  }
  return <form onSubmit={submit} className="auth-form"><fieldset disabled={pending}>
    {signup && <label>이름<input name="name" required maxLength={100} autoComplete="name" placeholder="홍길동" /></label>}
    <label>이메일<input name="email" type="email" required autoComplete="email" placeholder="you@company.com" /></label>
    <label>비밀번호<input name="password" type="password" minLength={signup ? 10 : 1} maxLength={128} required autoComplete={signup ? "new-password" : "current-password"} placeholder={signup ? "10자 이상 입력해주세요" : "비밀번호를 입력해주세요"} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}<button className="button" type="submit">{pending ? "처리 중…" : signup ? "계정 만들기" : "로그인"}</button>
  </fieldset></form>;
}

export function SignOut() { const router = useRouter(); return <button className="text-button" onClick={async () => { const r = await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); if (r.ok) { router.push("/login"); router.refresh(); } }}>로그아웃</button>; }
