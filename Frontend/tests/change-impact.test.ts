import assert from "node:assert/strict";
import test from "node:test";
import { impactAmountDelta, impactDays, impactDayDelta, impactMoney, impactSentence, type ChangeApprovalImpact } from "../src/lib/change-approval-impact";
test("IMP-05/07/18/21 amount and duration labels distinguish zero, unknown and signs", () => {
  assert.equal(impactMoney(null), "확인 필요"); assert.equal(impactMoney(800000), "800,000원");
  assert.equal(impactAmountDelta(140000), "+140,000원"); assert.match(impactAmountDelta(0), /금액 변화 없음/); assert.equal(impactAmountDelta(-50000), "-50,000원");
  assert.equal(impactDays(null, "일"), "미정"); assert.equal(impactDayDelta(null, "일"), "기간 영향 확인 필요"); assert.match(impactDayDelta(0, "일"), /\+0일.*기간 변화 없음/);
  const i = { phase: "waiting", currency: "KRW", amount: { after: 940000 }, duration: { afterDays: 9, unit: "일" } } as ChangeApprovalImpact;
  assert.match(impactSentence(i), /승인하면.*940,000원.*9일/); assert.match(impactSentence({ ...i, phase: "approved" }), /^승인된 프로젝트/);
  assert.match(impactSentence({ ...i, canApprove: false }), /발급 당시.*재검토/);
});
