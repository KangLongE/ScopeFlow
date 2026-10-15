import assert from "node:assert/strict";
import test from "node:test";
import { scopeExclusionRows } from "../src/lib/scope-exclusions";
test("EXC-16/19: same public exclusion list and original legacy text", () => {
  assert.deepEqual(scopeExclusionRows({ excluded: ["legacy"], exclusions: [{ title: "관리자 개발 제외", description: "이번 계약 범위" }] }), [{ title: "관리자 개발 제외", description: "이번 계약 범위" }]);
  assert.deepEqual(scopeExclusionRows({ excluded: ["외부 서비스 이용료 / 추가 기능"] }), [{ title: "외부 서비스 이용료 / 추가 기능", description: null }]);
  assert.deepEqual(scopeExclusionRows({ excluded: ["legacy"], exclusions: [] }), []);
});
