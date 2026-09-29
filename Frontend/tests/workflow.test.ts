import assert from "node:assert/strict";
import test from "node:test";
import { estimateTotal, projectStep, scopeVersion } from "../src/lib/workflow";
import type { ProjectDetail } from "../src/lib/queries";

test("next action follows persisted requirements, estimate, approval and change states", () => {
  const project = { id: "test", status: "REQUIREMENT_GATHERING", revision: 0, aiDrafts: {}, questions: [], requirements: [], estimate: null, scopes: [] } as unknown as ProjectDetail;
  assert.equal(projectStep(project).href, "/projects/test/requirements");
  project.questions = [{ id: "q", question: "질문", reason: "", position: 0, answer: null }];
  assert.equal(projectStep(project).title, "고객 답변 대기");
  project.questions = [];
  project.requirements = [{ id: "r", category: "기능", title: "로그인", description: "", type: "FEATURE", priority: "HIGH", source: "OWNER_MANUAL", status: "CONFIRMED", createdAt: "" }];
  assert.equal(projectStep(project).href, "/projects/test/estimate");
  project.estimate = { id: "e", rates: { frontend: 50000, backend: 60000, design: 0, qa: 0 }, overrideTotal: null, adjustmentReason: "", items: [{ id: "i", requirementId: "r", hours: { frontend: 2, backend: 1, design: 0, qa: 0 }, reason: "", complexity: "LOW", reviewed: true }] };
  assert.equal(estimateTotal(project), 160000);
  assert.equal(projectStep(project).href, "/projects/test/scope");
  project.status = "WAITING_SCOPE_APPROVAL";
  assert.equal(projectStep(project).title, "Scope 승인 대기");
  project.status = "WAITING_CHANGE_APPROVAL";
  assert.equal(projectStep(project).href, "/projects/test/changes");
  project.status = "ACTIVE";
  project.changeRequests = [{ id: "change", status: "WAITING_INTERNAL_REVIEW" }] as ProjectDetail["changeRequests"];
  assert.equal(projectStep(project).href, "/projects/test/changes#change");
  assert.equal(scopeVersion({ majorVersion: 1, minorVersion: 0 }), "v1.0");
  assert.equal(scopeVersion({ majorVersion: 1, minorVersion: 1 }), "v1.1");
});
