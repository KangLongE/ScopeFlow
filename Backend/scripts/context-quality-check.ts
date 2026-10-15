// Explicitly invoked release check: real configured Groq calls, disposable local database only.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { prompts } from "@/lib/ai/prompts";
import { aiWorkflowService as ai } from "@/lib/services/ai-workflow.service";
import { projectService as projects, questionService as questions } from "@/lib/services/core.service";
import { buildProjectAIContext, reviewIssues } from "@/lib/services/ai-context.service";
import { changeRequestService as changes, scopeService as scopes, clientAccessService as client } from "@/lib/services/workflow.service";
import { comparisonSchema, initialAnalysisSchema, questionsResultSchema, requirementsResultSchema, estimateResultSchema, scopeAIResultSchema } from "@/lib/model";

const url = new URL(getEnv().DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/scopeflow_ux_20260928", "Only the disposable local database is allowed");
const prior = process.argv.includes("--resume") ? JSON.parse(readFileSync("test-results/context-quality.json", "utf8")) : null;
if (prior) assert.equal(prior.promptVersion, prompts.REQUIREMENTS.version, "Run a fresh quality check after a prompt version change");
const previousRun = prior?.projectId ? await prisma.aIUsage.findFirstOrThrow({ where: { projectId: prior.projectId }, orderBy: { createdAt: "desc" } }) : prior?.repetitions?.at(-1)?.runId ? await prisma.aIUsage.findUniqueOrThrow({ where: { id: prior.repetitions.at(-1).runId } }) : null;
const user = previousRun ? await prisma.user.findUniqueOrThrow({ where: { id: previousRun.userId } }) : await prisma.user.create({ data: { id: crypto.randomUUID(), name: "Model quality check", email: `${crypto.randomUUID()}@example.invalid` } });
const workspace = previousRun ? await prisma.workspace.findUniqueOrThrow({ where: { id: previousRun.workspaceId } }) : await prisma.workspace.create({ data: { name: "Real Groq regression", creditLimit: 10000, userCreditLimit: 10000, members: { create: { userId: user.id, role: "OWNER" } }, rateCard: { create: { rates: { frontend: 50000, backend: 60000, design: 45000, qa: 40000 } } } } });
const ctx = { workspaceId: workspace.id, userId: user.id, role: "OWNER" as const };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let response = await realFetch(input, { ...init, signal: AbortSignal.timeout(getEnv().AI_TIMEOUT_MS) });
  for (let attempt = 0; response.status === 429 && attempt < 3; attempt++) {
    const detail = await response.clone().json().catch(() => null) as { error?: { message?: string } } | null;
    const seconds = Number(response.headers.get("retry-after")) || Number(detail?.error?.message?.match(/try again in ([\d.]+)s/)?.[1]) || 30;
    const wait = Math.min(60, Math.max(1, Math.ceil(seconds) + 1));
    console.log(`Groq TPM pause: ${wait}s; retry ${attempt + 1}/3`);
    await new Promise(resolve => setTimeout(resolve, wait * 1000)); response = await realFetch(input, { ...init, signal: AbortSignal.timeout(getEnv().AI_TIMEOUT_MS) });
  }
  if (!response.ok && String(input).startsWith("https://api.groq.com/")) {
    const detail = await response.clone().json().catch(() => null) as { error?: { message?: string; code?: string; failed_generation?: string } } | null;
    console.error("Groq diagnosis:", detail?.error?.code, detail?.error?.message?.replaceAll(getEnv().GROQ_API_KEY, "[redacted]").slice(0, 1500));
    if (detail?.error?.failed_generation) console.error("Fixture output diagnosis:", JSON.stringify({ length: detail.error.failed_generation.length, start: detail.error.failed_generation.slice(0, 160), end: detail.error.failed_generation.slice(-160) }));
  }
  if (response.ok && String(input).startsWith("https://api.groq.com/")) {
    const wire = JSON.parse(String(init?.body)); const context = JSON.parse(wire.messages[1].content);
    const payload = await response.clone().json(); const value = JSON.parse(payload.choices[0].message.content);
    for (const item of [...(value.reviewNotes?.constraints ?? []), ...(value.reviewNotes?.excludedScope ?? [])]) if (!item.sourceRefs.some((id: string) => context.sources.find((s: { id: string }) => s.id === id)?.text.includes(item.evidence))) console.log("Quote check:", JSON.stringify({ key: item.key ?? item.title, evidence: item.evidence, source: item.sourceRefs.map((id: string) => context.sources.find((s: { id: string }) => s.id === id)?.text) }));
  }
  return response;
};
const previousProject = previousRun ? await prisma.project.findUniqueOrThrow({ where: { id: previousRun.projectId! } }) : null;
const customer = previousProject ? await prisma.client.findUniqueOrThrow({ where: { id: previousProject.clientId } }) : await prisma.client.create({ data: { workspaceId: workspace.id, name: "QA Cafe", email: "cafe@example.invalid" } });
const request = "작은 카페 웹사이트가 필요합니다. 카페 소개, 메뉴, 주소와 영업시간을 보여주세요. 결제·회원가입·관리자·외부 연동은 제외합니다. 로고와 메뉴 자료는 고객이 제공합니다.";
const answer = "소개와 메뉴는 같은 1페이지 내부 섹션으로 만듭니다. Vercel 정적 배포이며 별도 서버 구현과 외부 연동은 제외합니다. 로고와 메뉴 자료는 고객이 제공합니다.";
const project = previousProject ?? await projects.create(ctx, { name: "QA Cafe Context", clientId: customer.id }, request);
const question = previousProject ? await prisma.clarificationQuestion.findFirstOrThrow({ where: { projectId: project.id } }) : await prisma.clarificationQuestion.create({ data: { projectId: project.id, question: "페이지 구성, 배포 방식, 서버 및 자료 제공 범위는?", reason: "기본 범위 합의", important: true } });
if (!previousProject) await questions.answer(ctx, project.id, question.id, answer, "QA customer");
const report: Record<string, unknown> = prior ? { ...prior, failures: [], priorAttemptFailures: [...(prior.priorAttemptFailures ?? []), ...prior.failures] } : { provider: getEnv().AI_PROVIDER, model: getEnv().AI_STANDARD_MODEL, promptVersion: prompts.REQUIREMENTS.version, repetitions: [], stages: [], failures: [] };
report.maxOutputTokens = getEnv().AI_MAX_OUTPUT_TOKENS;
report.projectId = project.id;
report.promptVersions = Object.fromEntries(Object.entries(prompts).map(([action, p]) => [action, p.version]));
const stages = report.stages as string[];
const reset = () => prisma.requestLimit.deleteMany({ where: { key: `${workspace.id}:${user.id}:ai` } });
const review = (selected: Awaited<ReturnType<typeof ai.generateRequirements>>) => ({ reason: "QA 담당자가 고객 원문·저장 답변을 확인함. 미합의 추가 기능은 포함하지 않음.", runId: selected.runId, resolutions: reviewIssues(selected.context, selected.result).filter(i => i.important).map(i => ({ id: i.id, reason: "QA 고객의 명시된 제한을 기준으로 검토하며 추가 범위는 합의하지 않음", sourceRefs: i.sourceRefs.length ? i.sourceRefs : [selected.context.sources[0].id] })) });
try {
  await reset();
  if (!stages.includes("INITIAL_ANALYSIS")) {
  const initial = await ai.analyzeRequest(ctx, project.id, request, true); initialAnalysisSchema.parse(initial.result);
  await ai.apply(ctx, project.id, "initial", initial.revision, initial.result, review(initial)); stages.push("INITIAL_ANALYSIS"); console.log("PASS INITIAL_ANALYSIS");
  }
  if (!stages.includes("QUESTIONS")) {
  const qDraft = await ai.generateQuestions(ctx, project.id, true); const qResult = questionsResultSchema.parse(qDraft.result);
  assert.ok(!qResult.questions.some(q => /(?:몇|어떤).*페이지|로고.*(?:제공|제작)|서버.*(?:포함|필요)|배포.*방식/.test(q.question) && !/충돌|변경|수정/.test(q.reason)), "must not repeat already answered conditions");
  stages.push("QUESTIONS"); console.log(`PASS QUESTIONS (${qResult.questions.length} new questions, not applied)`);
  }
  const draft = previousProject ? (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).aiDrafts as unknown as { requirements?: Awaited<ReturnType<typeof ai.generateRequirements>>; estimate?: Awaited<ReturnType<typeof ai.generateRequirements>> } : null;
  let selected!: Awaited<ReturnType<typeof ai.generateRequirements>>;
  if (draft?.requirements) selected = draft.requirements;
  if (!stages.includes("REQUIREMENTS")) {
  const fingerprints: string[] = prior ? prior.repetitions.filter((r: { stage: string }) => r.stage === "REQUIREMENTS").map((r: { fingerprint: string }) => r.fingerprint) : [];
  for (let i = fingerprints.length + 1; i <= 3; i++) {
    await reset(); selected = await ai.generateRequirements(ctx, project.id, true); fingerprints.push(selected.inputFingerprint);
    const parsed = requirementsResultSchema.parse(selected.result);
    const text = parsed.requirements.map(r => r.title + " " + r.description).join("\n");
    assert.ok(/1\s*페이지|한\s*페이지|단일\s*페이지|같은\s*페이지|섹션|(?:single|same)[ -]page|section/i.test(text), "same-page menu must be explicit");
    assert.ok(!parsed.requirements.some(r => /결제|회원가입|관리자|외부\s*연동|백엔드\s*API|서버\s*구현|payment|sign[ -]?up|admin|external integration|backend API|server implementation/i.test(r.title)), "excluded features must not be basic requirements");
    assert.ok(!/(?:별도|독립).*메뉴.*페이지|(?:신규|새로운)\s*로고\s*(?:제작|디자인)|(?:separate|independent).*menu.*page|new logo (?:creation|design)/i.test(text), "no extra menu page or new logo creation");
    if (parsed.requirements.some(r => !/[가-힣]/.test(r.title + r.description))) {
      const warnings = (report.languageWarnings ??= []) as unknown[];
      warnings.push({ stage: "REQUIREMENTS", runId: selected.runId, message: "영문 요구사항 출력: 담당자 검토 필요" });
    }
    (report.repetitions as unknown[]).push({ stage: "REQUIREMENTS", repetition: i, runId: selected.runId, fingerprint: selected.inputFingerprint, titles: parsed.requirements.map(r => r.title) });
    console.log(`PASS REQUIREMENTS ${i}/3`);
  }
  assert.equal(new Set(fingerprints).size, 1, "all three requirement calls use identical input");
  await ai.apply(ctx, project.id, "requirements", selected.revision, selected.result, review(selected)); stages.push("REQUIREMENTS");
  }
  const fingerprints: string[] = prior ? prior.repetitions.filter((r: { stage: string }) => r.stage === "ESTIMATE").map((r: { fingerprint: string }) => r.fingerprint) : [];
  if (draft?.estimate) selected = draft.estimate;
  if (!stages.includes("ESTIMATE")) {
  for (let i = fingerprints.length + 1; i <= 3; i++) {
    await reset(); selected = await ai.estimate(ctx, project.id, true); fingerprints.push(selected.inputFingerprint);
    const parsed = estimateResultSchema.parse(selected.result);
    assert.ok(parsed.items.every(item => item.hours.backend === 0), "explicit server exclusion must not generate Backend implementation hours");
    (report.repetitions as unknown[]).push({ stage: "ESTIMATE", repetition: i, runId: selected.runId, fingerprint: selected.inputFingerprint, hours: parsed.items.map(item => item.hours) });
    console.log(`PASS ESTIMATE ${i}/3`);
  }
  assert.equal(new Set(fingerprints).size, 1);
  await ai.apply(ctx, project.id, "estimate", selected.revision, selected.result, review(selected)); stages.push("ESTIMATE");
  }
  const confirmed = await buildProjectAIContext(ctx, project.id, "SCOPE_SUMMARY");
  if (!await prisma.scope.count({ where: { projectId: project.id } })) await scopes.create(ctx, project.id, { document: { durationDays: 8 } });
  if (!stages.includes("SCOPE_SUMMARY")) {
  await reset(); const summary = await ai.summarize(ctx, project.id, true); const summaryResult = scopeAIResultSchema.parse(summary.result);
  const exclusionIndexes = [/결제|payment/i, /회원가입|sign[ -]?up|user registration/i, /관리자|admin/i, /외부\s*연동|external integration/i].map(pattern => {
    const index = summaryResult.excluded.findIndex(e => pattern.test(e));
    assert.ok(index >= 0, `individual scope exclusion: ${pattern}`); return index;
  });
  assert.equal(new Set(exclusionIndexes).size, 4, "four exclusions must remain individual entries");
  await ai.apply(ctx, project.id, "summary", summary.revision, summary.result, review(summary)); stages.push("SCOPE_SUMMARY");
  }
  let scope = await prisma.scope.findFirstOrThrow({ where: { projectId: project.id } });
  assert.equal((scope.document as { estimate: { total: number } }).estimate.total, confirmed.confirmedEstimate?.total);
  assert.equal((scope.document as { durationDays: number }).durationDays, 8); console.log("PASS SCOPE_SUMMARY (individual exclusions and saved numbers)");
  if (scope.status !== "APPROVED") {
    const link = await scopes.requestApproval(ctx, project.id, scope.id); await client.decide(link.token, "APPROVE", "QA customer", "");
    scope = await prisma.scope.findUniqueOrThrow({ where: { id: scope.id } });
  }
  const original = structuredClone((await prisma.scope.findUniqueOrThrow({ where: { id: scope.id } })).document);
  if (!stages.includes("SCOPE_COMPARISON")) {
  const faq = await changes.create(ctx, project.id, "기존 같은 1페이지 안에 FAQ 섹션을 추가해주세요.");
  await reset(); const compared = await ai.compareChange(ctx, project.id, faq.id, true); const comparison = comparisonSchema.parse(compared.analysis);
  assert.ok(["OUT_OF_SCOPE", "PARTIALLY_IN_SCOPE"].includes(comparison.classification)); assert.equal(comparison.estimatedWork.backend, 0);
  assert.deepEqual((await prisma.scope.findUniqueOrThrow({ where: { id: scope.id } })).document, original); stages.push("SCOPE_COMPARISON"); console.log("PASS SCOPE_COMPARISON (FAQ and exact unchanged baseline)");
  }
  const server = await changes.create(ctx, project.id, "수정 요청: 이번 변경에서는 별도 서버와 관리자도 포함해주세요.");
  await reset(); const changed = await ai.compareChange(ctx, project.id, server.id, true); const serverReview = comparisonSchema.parse(changed.analysis);
  assert.ok(["OUT_OF_SCOPE", "PARTIALLY_IN_SCOPE", "UNCERTAIN"].includes(serverReview.classification)); assert.ok(/서버|관리자/.test(JSON.stringify(serverReview))); stages.push("POST_APPROVAL_CONDITION_CHANGE"); console.log("PASS explicit post-approval server/admin change");
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL"; (report.failures as unknown[]).push({ message: error instanceof Error ? error.message : String(error) });
  console.error("Quality check failed:", error instanceof Error ? error.message : String(error)); process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  mkdirSync("test-results", { recursive: true }); writeFileSync("test-results/context-quality.json", JSON.stringify(report, null, 2)); await prisma.$disconnect();
}
