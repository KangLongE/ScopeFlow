import assert from "node:assert/strict";
import test from "node:test";
import { costLabel, usd, creditStateLabel } from "../src/lib/ai-usage";
import { controlMessage } from "../src/lib/form-validation";
import { activityText, type Activity } from "../src/lib/activity";
test("UX-11/12/22 localized control messages retain real constraints", () => {
  assert.match(controlMessage("프로젝트 이름", "  ", { required: true })!, /입력해주세요/);
  assert.equal(controlMessage("동의", "on", { required: true, type: "checkbox", checked: false }), "내용을 확인하고 동의해주세요.");
  assert.match(controlMessage("작업량", "-1", { type: "number", min: "0", max: "2000" })!, /0 이상/);
  assert.equal(controlMessage("작업량", "0", { type: "number", required: true, min: "0" }), null);
  assert.equal(controlMessage("예산", "", { type: "number", badInput: true }), "예산에 올바른 숫자를 입력해주세요.");
  assert.equal(controlMessage("예산", "", { type: "number" }), null);
  assert.equal(controlMessage("이메일", "invalid", { type: "email", typeMismatch: true }), "올바른 이메일 주소를 입력해주세요.");
  assert.match(controlMessage("비밀번호", "short", { minLength: 10 })!, /10자 이상/);
});
test("UX-14~16 cost states do not claim free usage", () => {
  assert.equal(costLabel({ status: "estimated", estimatedUsd: 0 }), "$0.00000 · 추정");
  assert.equal(costLabel({ status: "unconfigured", estimatedUsd: null }), "단가 미설정 · 추정 불가");
  assert.equal(costLabel({ status: "unknown", estimatedUsd: null }), "계산 근거 확인 불가");
  assert.equal(usd(0.0000001), "< $0.00001");
  assert.equal(creditStateLabel("RESERVED"), "처리 중 · Credit 예약");
});
test("UX-17/18 normalized activity uses exact historical targets, not arbitrary payload", () => {
  const log: Activity = { id: "internal", event: "CHANGE_REQUEST_APPROVED", createdAt: "2026-10-14", display: { project: { id: "internal", name: "카페 소개 사이트" }, actorName: null, scopeVersion: "1.1", changeNumber: 1, requirementName: null, requirementCount: null, task: null, href: "/projects/internal/changes" } };
  assert.equal(activityText(log), "‘카페 소개 사이트’ 변경 요청 #1 승인 · Scope v1.1 생성");
  assert.equal(activityText({ ...log, event: "UNKNOWN_LEGACY" }), "‘카페 소개 사이트’ 활동 기록 · 상세 정보 확인 불가");
  assert.equal(activityText({ id: "internal-uuid", event: "UNKNOWN", createdAt: "2026-10-14" }), "활동 기록 · 상세 정보 확인 불가");
});
