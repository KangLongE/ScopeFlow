"use client";
import { useState } from "react";
import { Field } from "./ui";
export function ClientPicker({ clients, selected }: { clients: { id: string; name: string; company: string }[]; selected?: string }) {
  const [create, setCreate] = useState(!clients.length);
  return <div className="wide stack">{clients.length > 0 ? <div className="actions-row"><button type="button" className="button secondary" onClick={() => setCreate(!create)}>{create ? "기존 고객 선택" : "새 고객 바로 등록"}</button></div> : <p className="text-xs">프로젝트와 함께 새 고객을 등록합니다.</p>}
    {create ? <div className="form-grid"><Field label="고객 담당자 이름" name="newClient.name" required /><Field label="고객 이메일" name="newClient.email" type="email" required /><Field label="회사명 (선택)" name="newClient.company" /></div> : <label>고객<select name="clientId" required defaultValue={selected ?? ""}><option value="">고객 선택</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company || c.name} · {c.name}</option>)}</select></label>}
  </div>;
}
