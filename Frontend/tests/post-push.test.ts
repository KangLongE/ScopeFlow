import assert from "node:assert/strict";
import test from "node:test";
import { initialSchema, workSchema } from "../src/lib/model";
import { initialEditorSchema, linkEstimateRequirement, approvedExclusionSource } from "../src/lib/ai-recovery";
import type { AIContextSnapshot } from "../src/lib/ai-context";
import { reviewSnapshotKey, type ValidationResult } from "../src/lib/rule-validation";

test("exclusion quote action selects the exact approved title and version, never a similar or foreign source", () => {
  const title = "관리자 페이지 개발 제외";
  const source = { id: "scope-excluded:one:admin", text: title, revision: "1.0", kind: "APPROVED_SCOPE", label: title };
  const context = { approvedBaseline: { id: "one", version: "1.0" }, sources: [{ ...source, id: "scope-excluded:one:external", text: "외부 서비스 연동 개발 제외" }, source] } as AIContextSnapshot;
  assert.deepEqual(approvedExclusionSource(title, context), source);
  assert.equal(approvedExclusionSource("관리자 페이지", context), undefined);
  assert.equal(approvedExclusionSource(title), undefined);
  for (const changed of [{ ...source, revision: "0.9" }, { ...source, kind: "SCOPE_DRAFT" }, { ...source, id: "scope-excluded:older:admin" }]) assert.equal(approvedExclusionSource(title, { ...context, sources: [changed] }), undefined);
  assert.equal(approvedExclusionSource(title, { ...context, sources: [source, { ...source, id: "scope-excluded:one:duplicate" }] }), undefined);
});

test("N-01 invalid empty analysis is editable without relaxing the apply contract", () => {
  const candidate = { projectType: "카페", summary: "소개 사이트", features: [], budget: { amount: null, currency: "KRW" }, desiredDeadline: null, missingInformation: [] };
  assert.equal(initialEditorSchema.safeParse(candidate).success, true);
  assert.equal(initialSchema.safeParse(candidate).success, false);
});
test("N-02 requirement selection preserves hours and other evidence, replacing only the linked source", () => {
  const item = workSchema.shape.items.element.parse({ requirementId: "requirement:old", hours: { frontend: 8, backend: 0, design: 4, qa: 2 }, complexity: "LOW", reason: "제공 자료 적용", sourceRefs: ["request:original", "requirement:old"] });
  const next = linkEstimateRequirement(item, "new-uuid");
  assert.equal(next.requirementId, "new-uuid"); assert.deepEqual(next.hours, item.hours);
  assert.deepEqual(next.sourceRefs, ["request:original", "requirement:new-uuid"]); assert.equal(item.requirementId, "requirement:old");
});
test("N-05 latest stored validation replaces the old panel even for the same entity", () => {
  const validation: ValidationResult = { status: "blocked", ruleSetVersion: "1.2.0", contextFingerprint: "one", candidateRevision: 1, issues: [] };
  const old = reviewSnapshotKey("scope", { candidateRevision: 1, validation });
  assert.notEqual(old, reviewSnapshotKey("scope", { candidateRevision: 2, validation: { ...validation, status: "passed", candidateRevision: 2 } }));
  assert.notEqual(old, reviewSnapshotKey("scope", { candidateRevision: 1, validation: { ...validation, contextFingerprint: "new-answer" } }));
});
