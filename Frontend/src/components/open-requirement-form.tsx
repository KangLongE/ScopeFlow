"use client";
import { Plus } from "lucide-react";
import { focusRuleField } from "./rule-validation";

export function OpenRequirementForm() {
  return <button type="button" className="inline-link" onClick={() => focusRuleField(document.getElementById("manual-requirements"), ["title"])}><Plus size={16} aria-hidden="true" />직접 추가</button>;
}
