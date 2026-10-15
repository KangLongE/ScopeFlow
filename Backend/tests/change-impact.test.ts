import assert from "node:assert/strict";
import test from "node:test";
import { buildChangeApprovalImpact, publicChangeReview } from "@/lib/change-approval-impact";

const baseline = () => ({ id: "base", majorVersion: 1, minorVersion: 0, document: { estimate: { subtotal: 790000, total: 800000 }, durationDays: 8, deadline: null } });
const change = () => ({ id: "change", baseScopeId: "base", revision: 2, request: "FAQ 추가", review: { scheduleImpactDays: 1, additionalCost: 999999 }, amount: 140000, adjustmentReason: "담당자 확정" });
const impact = (options: Partial<Parameters<typeof buildChangeApprovalImpact>[0]> = {}) => buildChangeApprovalImpact({ change: change(), baseline: baseline(), phase: "waiting", datePolicy: "CALENDAR_DAYS_UTC", ...options });
test("IMP-01~04 final adjusted baseline and owner delta, no invented date", () => {
  const i = impact(); assert.deepEqual(i.amount, { before: 800000, delta: 140000, after: 940000 }); assert.deepEqual(i.duration, { beforeDays: 8, deltaDays: 1, afterDays: 9, unit: "일" });
  assert.deepEqual(i.completionDate, { before: null, after: null, status: "undetermined" }); assert.equal(i.canApprove, true);
  assert.equal(impact({ change: { ...change(), amount: 160000 } }).amount.after, 960000);
});
test("IMP-05~08 zero is explicit, missing/invalid values do not turn into zero", () => {
  const zero = impact({ change: { ...change(), amount: 0, review: { scheduleImpactDays: 0 } } }); assert.deepEqual(zero.amount, { before: 800000, delta: 0, after: 800000 }); assert.equal(zero.duration.afterDays, 8); assert.equal(zero.canApprove, true);
  for (const amount of [null, undefined, "140000", -1, NaN, 0.5]) { const invalid = impact({ change: { ...change(), amount } }); assert.equal(invalid.amount.delta, null); assert.equal(invalid.amount.after, null); assert.equal(invalid.canApprove, false); }
  const unknown = impact({ baseline: { ...baseline(), document: { ...baseline().document, durationDays: null } } }); assert.equal(unknown.duration.beforeDays, null); assert.equal(unknown.duration.afterDays, null); assert.equal(unknown.duration.deltaDays, 1); assert.equal(unknown.canApprove, true, "existing validators still enforce their schedule requirements separately");
  for (const scheduleImpactDays of [undefined, null, "1", -1]) assert.equal(impact({ change: { ...change(), review: { scheduleImpactDays } } }).canApprove, false);
  assert.equal(impact({ expectedAfter: { amount: 999000 } }).canApprove, false);
});
test("IMP-09~10 existing calendar-day UTC policy and date-only boundary", () => {
  for (const [before, after] of [["2028-02-28", "2028-02-29"], ["2026-12-31", "2027-01-01"]]) {
    const b = { ...baseline(), document: { ...baseline().document, deadline: before } }; assert.deepEqual(impact({ baseline: b }).completionDate, { before, after, status: "known" });
    assert.deepEqual(impact({ baseline: b, datePolicy: undefined }).completionDate, { before, after: null, status: "review_required" });
  }
  assert.equal(impact({ baseline: { ...baseline(), document: { ...baseline().document, deadline: "2026-02-30" } } }).completionDate.status, "review_required");
});
test("IMP-11/20~21 exact historical baseline; unsupported policies stay blocked", () => {
  const next = { ...baseline(), minorVersion: 1, document: { ...baseline().document, estimate: { total: 940000 }, durationDays: 9 } };
  assert.equal(impact({ baseline: next, change: { ...change(), amount: 60000 } }).amount.after, 1000000);
  assert.equal(impact({ baseline: null }).amount.before, null); assert.equal(impact({ baseline: null }).canApprove, false);
  assert.equal(impact({ baseline: { ...baseline(), document: { ...baseline().document, estimate: { total: 800000, currency: "USD" } } } }).canApprove, false);
  assert.equal(impact({ change: { ...change(), amount: -50000 } }).canApprove, false, "this product has no reduction policy");
});
test("public review contains no rates, AI evidence, source IDs or internal validation", () => {
  const r = publicChangeReview({ classification: "OUT_OF_SCOPE", confidence: 0.9, reason: "추가 범위", newRequirements: [{ category: "FAQ", title: "FAQ", description: "질문 섹션", type: "FEATURE", priority: "MEDIUM", sourceRefs: ["private-source"] }], estimatedWork: { frontend: 2, backend: 0, design: 0, qa: 1 }, scheduleImpactDays: 1, affectedExistingRequirements: [], removedExclusions: [], validation: { secret: "internal" } });
  assert.ok(r); assert.equal(JSON.stringify(r).includes("private-source"), false); assert.equal("validation" in r, false); assert.equal("estimatedWork" in r, false);
});
