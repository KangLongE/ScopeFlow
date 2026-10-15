"use client";
import { useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { controlMessage, type FieldError } from "@/lib/form-validation";
type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type ErrorItem = FieldError & { control?: Control; id: string };
const controls = (form: HTMLFormElement) => Array.from(form.elements).filter((el): el is Control => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement);
function focus(control?: Control) {
  for (let parent = control?.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
  control?.focus();
}
function labelFor(control: Control) {
  const label = control.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
  label?.querySelectorAll("input,textarea,select,.field-error").forEach(node => node.remove());
  return control.getAttribute("aria-label") ?? label?.textContent?.trim() ?? "해당 항목";
}
export function useFormErrors() {
  const id = useId();
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  function clearControl(item: ErrorItem) {
    item.control?.removeAttribute("aria-invalid");
    const remaining = item.control?.getAttribute("aria-describedby")?.split(" ").filter(v => v !== item.id).join(" ");
    if (remaining) item.control?.setAttribute("aria-describedby", remaining); else item.control?.removeAttribute("aria-describedby");
  }
  function show(form: HTMLFormElement, fields: FieldError[]) {
    errors.forEach(clearControl);
    const elements = controls(form);
    const next = fields.map((field, index) => {
      const control = elements.find((el, i) => (el.name || el.dataset.fieldPath || "@" + i) === field.fieldPath);
      const item = { ...field, control, id: id + "-error-" + index };
      if (control && !control.getAttribute("aria-label")) control.setAttribute("aria-label", labelFor(control));
      control?.setAttribute("aria-invalid", "true");
      const described = control?.getAttribute("aria-describedby");
      control?.setAttribute("aria-describedby", [described, item.id].filter(Boolean).join(" "));
      return item;
    });
    setErrors(next); focus(next.find(item => item.control)?.control);
  }
  function validate(form: HTMLFormElement, action: string) {
    const fields: FieldError[] = [];
    controls(form).forEach((control, index) => {
      if (!control.willValidate) return;
      const input = control instanceof HTMLInputElement ? control : null;
      let required = control.required;
      if (action === "client.decide" && control.name === "message" && (form.elements.namedItem("decision") as HTMLSelectElement | null)?.value !== "APPROVE") required = true;
      if (control.name === "adjustmentReason") {
        const adjusted = form.elements.namedItem("overrideTotal") as HTMLInputElement | null;
        if (adjusted?.value.trim()) required = true;
      }
      const label = action === "project.create" && control.name === "name" ? "프로젝트 이름" : action === "client.decide" && control.name === "message" ? "수정 요청 사유" : labelFor(control);
      let message = controlMessage(label, control.value, { required, type: input?.type, checked: input?.checked, min: input?.min, max: input?.max, minLength: "minLength" in control ? control.minLength : undefined, maxLength: "maxLength" in control ? control.maxLength : undefined, badInput: control.validity.badInput, typeMismatch: control.validity.typeMismatch, stepMismatch: control.validity.stepMismatch, patternMismatch: control.validity.patternMismatch });
      if (action === "project.create" && control.name === "name" && !control.value.trim()) message = "프로젝트 이름을 입력해주세요.";
      if (action === "client.decide" && control.name === "message" && required && !control.value.trim()) message = "수정 요청 사유를 입력해주세요.";
      if (message) fields.push({ fieldPath: control.name || control.dataset.fieldPath || "@" + index, message });
    });
    show(form, fields); return !fields.length;
  }
  function changed(event: FormEvent<HTMLFormElement>) {
    const control = event.target;
    errors.filter(item => item.control === control).forEach(clearControl);
    setErrors(current => current.filter(item => item.control !== control));
  }
  const feedback = errors.map(item => item.control?.isConnected && item.control.closest("label") ? createPortal(<span className="field-error" id={item.id} role="alert">{item.message}</span>, item.control.closest("label")!, item.id) : <p key={item.id} id={item.id} className="form-error" role="alert">{item.message}</p>);
  return { validate, show, changed, feedback };
}
