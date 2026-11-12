import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RequirementContext } from "../src/components/requirements";
import { RequirementsWorkbench, RequirementStatus } from "../src/components/requirements-workbench";
import type { AIContextSnapshot } from "../src/lib/ai-context";

test("customer context separates verified facts from pending, inactive and invented AI evidence", () => {
  const condition = { id: "page", key: "pageCount", value: 1, evidence: "같은 1페이지", sourceRefs: ["request:one"], status: "explicit" as const, supersedes: [], active: true };
  const context: AIContextSnapshot = { inputFingerprint: "test", savedAnswers: [], confirmedIncludedScope: [], unresolvedItems: [], approvedBaseline: null, confirmedEstimate: null, sources: [{ id: "request:one", text: "같은 1페이지. 미확정 추가 기능. 이전 조건.", label: "고객 원문", kind: "INITIAL_REQUEST", revision: "1" }], explicitCustomerConstraints: [condition, { ...condition, id: "pending", status: "pending", evidence: "미확정 추가 기능" }, { ...condition, id: "inactive", active: false, evidence: "이전 조건" }, { ...condition, id: "invented", evidence: "출처에 없는 문장" }, { ...condition, id: "unknown", sourceRefs: ["foreign"], evidence: "잘못된 출처" }, { ...condition, id: "empty", evidence: "" }], confirmedExcludedScope: [{ title: "결제 제외", sourceRefs: ["request:one"] }, { title: "결제 제외", sourceRefs: ["request:one"] }] };
  const markup = renderToStaticMarkup(createElement(RequirementContext, { context, budget: 0 }));
  assert.match(markup, /페이지 수 1개/); assert.match(markup, /등록 예산/); assert.match(markup, /0원/);
  assert.doesNotMatch(markup, /미확정 추가 기능|이전 조건|출처에 없는 문장|잘못된 출처/);
  assert.equal((markup.match(/결제 제외/g) ?? []).length, 1);
  const notProvided = { ...context, explicitCustomerConstraints: [{ ...condition, key: "logoProvided", value: false, evidence: "고객 제공 아님" }], sources: [{ ...context.sources[0], text: "고객 제공 아님" }] };
  const negative = renderToStaticMarkup(createElement(RequirementContext, { context: notProvided, budget: null }));
  assert.match(negative, /고객 제공 아님/); assert.doesNotMatch(negative, /로고는 고객 제공/);
});

test("requirement selection keeps every editor mounted and pending states separate from processing", () => {
  const items = ["a", "b"].map(id => ({ id, title: `<임의 코드 ${id}>`, description: "고객 원문에 맞춘 완료 기준", status: "CONFIRMED", detail: createElement("input", { name: id, defaultValue: "저장 전 입력" }) }));
  const markup = renderToStaticMarkup(createElement(RequirementsWorkbench, { items }));
  assert.match(markup, /&lt;임의 코드 a&gt;/); assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /id="requirement-detail-b"[^>]*hidden=""/);
  assert.match(markup, /name="a"/); assert.match(markup, /name="b"/);
  assert.match(markup, /고객 원문에 맞춘 완료 기준/);
  for (const [status, label] of [["CONFIRMED", "확정"], ["PENDING", "확인 필요"], ["EXCLUDED", "제외"]]) {
    const statusMarkup = renderToStaticMarkup(createElement(RequirementStatus, { status }));
    assert.match(statusMarkup, new RegExp(label)); assert.doesNotMatch(statusMarkup, /처리 중/);
  }
});

test("a missing linked source never becomes a fabricated customer quotation", () => {
  const markup = renderToStaticMarkup(createElement(RequirementContext, { sourceRefs: ["foreign:source"], budget: null }));
  assert.match(markup, /연결된 출처를 확인할 수 없습니다/);
  assert.doesNotMatch(markup, /<blockquote>/);
});
