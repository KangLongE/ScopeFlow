import assert from "node:assert/strict";
import test from "node:test";
import { matchesReviewedCandidate, canFinalize } from "../src/lib/rule-validation";
import type { ValidationResult } from "../src/lib/rule-validation";
test("VAL-21 a delayed passed response cannot validate a newer edit", () => {
  assert.equal(matchesReviewedCandidate("passed candidate", "new error candidate", 2, 1), false);
  assert.equal(matchesReviewedCandidate("same", "same", 1, 1), false);
  assert.equal(matchesReviewedCandidate("same", "same", 2, 1), true);
  for (const status of ["blocked", "review_required"]) assert.equal(canFinalize({ status } as ValidationResult), false);
  assert.equal(canFinalize({ status: "passed_with_warnings" } as ValidationResult), true);
});
