import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EstimateTotals } from "../src/components/estimate-totals";
import { won, type ScopeDocument } from "../src/lib/model";

function estimate(total: number, adjustmentReason: string | null = "고객과 합의한 금액") {
  return { items: [660000, 275000].map((amount, i) => ({ requirementId: `r${i}`, title: `기능 ${i}`, hours: { frontend: 0, backend: 0, design: 0, qa: 0 }, complexity: "LOW", reason: "승인 작업량", amount })), total, adjustmentReason };
}
const render = (value: ReturnType<typeof estimate>) => renderToStaticMarkup(createElement(EstimateTotals, { estimate: value, finalLabel: "승인 최종 금액" }));

test("approved estimate reconciles saved line amounts and final price without rewriting its snapshot", () => {
  const saved = estimate(800000);
  const original = structuredClone(saved);
  const html = render(saved);
  assert.match(html, /항목 합계/);
  assert.ok(html.includes(won(935000)));
  assert.ok(html.includes(`−${won(135000)}`));
  assert.match(html, /승인 최종 금액/);
  assert.ok(html.includes(won(800000)));
  assert.match(html, /고객과 합의한 금액/);
  assert.deepEqual(saved, original);
});

test("adjustment sign supports additions and a zero final price", () => {
  assert.ok(render(estimate(1000000)).includes(`+${won(65000)}`));
  const free = render(estimate(0));
  assert.ok(free.includes(`−${won(935000)}`));
  assert.ok(free.includes(`<dd>${won(0)}</dd>`));
});

test("legacy adjustments without a reason remain explicit instead of inventing agreement", () => {
  assert.match(render(estimate(800000, null)), /조정 사유가 기록되어 있지 않습니다/);
  assert.match(render(estimate(800000, "  ")), /조정 사유가 기록되어 있지 않습니다/);
  const unadjusted = render(estimate(935000, ""));
  assert.ok(unadjusted.includes(`<dd>${won(0)}</dd>`));
  assert.doesNotMatch(unadjusted, /조정 사유가 기록되어 있지 않습니다/);
});

test("line totals use the saved price rather than current rates or a stale subtotal", () => {
  const saved = { ...estimate(800000), adjustmentReason: "<고객 합의>", subtotal: 1, rates: { frontend: 999, backend: 0, design: 0, qa: 0 } } satisfies ScopeDocument["estimate"];
  const html = render(saved);
  assert.ok(html.includes(won(935000)));
  assert.match(html, /&lt;고객 합의&gt;/);
});
