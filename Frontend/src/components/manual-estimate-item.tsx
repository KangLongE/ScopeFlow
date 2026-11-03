"use client";
import { useState } from "react";
import { implementationSchema, hoursSchema, roles, roleLabels, zeroHours, type Hours } from "@/lib/model";
import { Field, Textarea } from "./ui";
import { MutationForm } from "./form";
import { ImplementationFields } from "./implementation-fields";

export function ManualEstimateItem({ projectId, requirement, item, candidateItem, candidateRevision, disabled }: { projectId: string; requirement: { id: string; description: string; provenance?: { implementation?: unknown } | null }; item?: { hours: Hours; reason: string; implementation?: unknown }; candidateItem?: unknown; candidateRevision: number; disabled: boolean }) {
  const prior = candidateItem && typeof candidateItem === "object" ? candidateItem as { hours?: unknown; reason?: unknown; implementation?: unknown } : undefined;
  const source = [prior, item].find(i => i?.implementation != null);
  const parsed = implementationSchema.safeParse(source ? source.implementation : requirement.provenance?.implementation);
  const [implementation, setImplementation] = useState(parsed.success ? parsed.data : null);
  const hours = hoursSchema.safeParse(prior?.hours);
  return <MutationForm action="estimate.item" payload={{ projectId, requirementId: requirement.id, candidateRevision }} submit="검토 완료 · 저장" disabled={disabled}>
    <input type="hidden" name="implementation" value={JSON.stringify(implementation)} />
    <ImplementationFields value={implementation} onChange={setImplementation} />
    <div className="hours-grid">{roles.map(role => <Field key={role} label={`${roleLabels[role]} (시간)`} name={`hours.${role}`} type="number" min={0} max={2000} step={0.01} value={hours.success ? hours.data[role] : item?.hours[role] ?? zeroHours[role]} required />)}</div>
    <Textarea label="산정 근거" name="reason" value={typeof prior?.reason === "string" ? prior.reason : item?.reason || requirement.description} required rows={2} />
  </MutationForm>;
}
