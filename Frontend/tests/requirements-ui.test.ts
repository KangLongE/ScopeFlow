import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerRequestContext, RequirementRow } from "../src/components/requirements";
import type { AIContextSnapshot } from "../src/lib/ai-context";
import type { ProjectDetail } from "../src/lib/queries";

test("customer context separates verified facts from pending, inactive and invented AI evidence", () => {
  const condition = { id: "page", key: "pageCount", value: 1, evidence: "같은 1페이지", sourceRefs: ["request:one"], status: "explicit" as const, supersedes: [], active: true };
  const context: AIContextSnapshot = { inputFingerprint: "test", savedAnswers: [], confirmedIncludedScope: [], unresolvedItems: [], approvedBaseline: null, confirmedEstimate: null, sources: [{ id: "request:one", text: "같은 1페이지. 미확정 추가 기능. 이전 조건.", label: "고객 원문", kind: "INITIAL_REQUEST", revision: "1" }], explicitCustomerConstraints: [condition, { ...condition, id: "pending", status: "pending", evidence: "미확정 추가 기능" }, { ...condition, id: "inactive", active: false, evidence: "이전 조건" }, { ...condition, id: "invented", evidence: "출처에 없는 문장" }, { ...condition, id: "unknown", sourceRefs: ["foreign"], evidence: "잘못된 출처" }, { ...condition, id: "empty", evidence: "" }], confirmedExcludedScope: [{ title: "결제 제외", sourceRefs: ["request:one"] }, { title: "결제 제외", sourceRefs: ["request:one"] }] };
  const markup = renderToStaticMarkup(createElement(CustomerRequestContext, { content: "저장된 고객 요청", context, budget: 0 }));
  assert.match(markup, /페이지 수 1개/); assert.match(markup, /등록 예산/); assert.match(markup, /0원/);
  assert.doesNotMatch(markup, /미확정 추가 기능|이전 조건|출처에 없는 문장|잘못된 출처/);
  assert.equal((markup.match(/결제 제외/g) ?? []).length, 1);
  const notProvided = { ...context, explicitCustomerConstraints: [{ ...condition, key: "logoProvided", value: false, evidence: "고객 제공 아님" }], sources: [{ ...context.sources[0], text: "고객 제공 아님" }] };
  const negative = renderToStaticMarkup(createElement(CustomerRequestContext, { content: "저장된 요청", context: notProvided, budget: null }));
  assert.match(negative, /고객 제공 아님/); assert.doesNotMatch(negative, /로고는 고객 제공/);
});

test("requirement rows keep descriptions visible and pending or excluded states distinct from confirmed", () => {
  const requirement = { id: "r", category: "소개", title: "<임의 코드>", description: "고객 원문에 맞춘 완료 기준", type: "FEATURE", priority: "HIGH", source: "OWNER_MANUAL", status: "CONFIRMED", createdAt: "2026-11-12" } as ProjectDetail["requirements"][number];
  for (const [status, label] of [["CONFIRMED", "확정"], ["PENDING", "확인 필요"], ["EXCLUDED", "제외"]]) {
    const markup = renderToStaticMarkup(createElement(RequirementRow, { requirement: { ...requirement, status } }, createElement("p", null, "기존 편집 내용")));
    assert.ok(markup.indexOf("고객 원문에 맞춘 완료 기준") < markup.indexOf("</summary>"));
    assert.match(markup, new RegExp(`<span class="requirement-status">${label}</span>`));
    assert.match(markup, /&lt;임의 코드&gt;/); assert.match(markup, /기존 편집 내용/); assert.match(markup, /상세·근거 보기/);
  }
});
