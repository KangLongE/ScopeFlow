import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { aiFailureGuidance, manualReviewLink } from "../src/lib/ai-failure";
import { AIFailureNotice } from "../src/components/ai-failure";
import type { Execution } from "../src/lib/ai-usage";

test("AI failure guidance separates settings failures from explicit retryable failures", () => {
  for (const code of ["AI_PROVIDER_BAD_REQUEST", "AI_PROVIDER_AUTH_ERROR", "AI_PROVIDER_MODEL_UNAVAILABLE", "AI_CONTEXT_TOO_LARGE"]) assert.equal(aiFailureGuidance(code).canRetry, false);
  assert.equal(aiFailureGuidance("AI_PROVIDER_ERROR", "제공자 오류 (400)").canRetry, false);
  for (const code of ["AI_INVALID_RESPONSE", "AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_UNAVAILABLE"]) assert.equal(aiFailureGuidance(code).canRetry, true);
  assert.equal(manualReviewLink("p", "initial").href, "/projects/p/requirements#manual-requirements");
  assert.equal(manualReviewLink("p", "estimate").target, "manual-estimate");
  assert.equal(manualReviewLink("p", "summary").target, "scope-editor");
  assert.equal(manualReviewLink("p", "compare", "c").target, "manual-change-c");
});

test("AI failure notice displays actual charges, safe manual continuation and explicit new-run cost", () => {
  const execution: Execution = { runId: "run", executionKey: "key", state: "FAILED", creditsUsed: 0, creditState: "NOT_CHARGED", error: "요청 형식 확인 필요", errorCode: "AI_PROVIDER_BAD_REQUEST", validationStatus: null, contextStatus: "FRESH" };
  let calls = 0; const onRetry = () => { calls++; };
  const markup = renderToStaticMarkup(createElement(AIFailureNotice, { execution, manualHref: "/projects/p/requirements#manual-requirements", onRetry, retryCost: 2 }));
  assert.match(markup, /실제 차감량 0 Credit/); assert.match(markup, /미차감/); assert.match(markup, /수동 검토 계속하기/); assert.doesNotMatch(markup, /새 실행으로 재시도/);
  const retry = renderToStaticMarkup(createElement(AIFailureNotice, { execution: { ...execution, errorCode: "AI_INVALID_RESPONSE" }, manualHref: "#manual", onRetry, retryCost: 2 }));
  assert.match(retry, /새 실행으로 재시도 · 2 Credit 예상/);
  const unknown = renderToStaticMarkup(createElement(AIFailureNotice, { execution: { ...execution, creditsUsed: null, creditState: "UNKNOWN", errorCode: "AI_INVALID_RESPONSE" }, manualHref: "#manual", onRetry }));
  assert.match(unknown, /실제 차감량 확인 필요/); assert.match(unknown, /disabled=""/); assert.doesNotMatch(unknown, /실제 차감량 0/);
  assert.equal(calls, 0, "rendering an error never retries AI");
});
