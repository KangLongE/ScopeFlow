import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { eq, and, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { Context } from "../src/lib/security";
import { addDays, calculateAmount, comparisonSchema, defaultRates, zeroHours } from "../src/lib/model";

process.env.DATABASE_URL = "";
process.env.PGLITE_PATH = "memory://";
// Ephemeral test credentials exist only in this process and its isolated memory database.
const testPassword = randomBytes(24).toString("base64url");
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("hex");
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.AI_PROVIDER = "openai";
process.env.AI_API_KEY = randomBytes(32).toString("hex");
process.env.AI_FAST_MODEL = "gpt-4.1-mini";
process.env.AI_STANDARD_MODEL = "gpt-4.1-mini";
process.env.AI_REASONING_MODEL = "gpt-4.1";
process.env.AI_MODEL_PRICES = '{"gpt-4.1-mini":[0.4,0.1,1.6]}';
const { db, closeDatabase } = await import("../src/lib/db/index");
const s = await import("../src/lib/db/schema");
const { auth } = await import("../src/lib/auth");
const { contextFor, projectFor, limitRequest, hashToken } = await import("../src/lib/security");
const { executeCommand } = await import("../src/lib/commands");
const { executeChange } = await import("../src/lib/changes");
const { executePortal, portalData, tokenFor } = await import("../src/lib/client-portal");
const { executeAI } = await import("../src/lib/ai/commands");
const { generate } = await import("../src/lib/ai/service");
const { aiBaseUrl, configuredProvider } = await import("../src/lib/ai/provider");
const { modelFor } = await import("../src/lib/ai/prompts");
const { POST } = await import("../src/app/api/commands/route");

const feature = { title: "이메일 로그인", category: "인증", description: "이메일과 비밀번호로 로그인하고 세션을 유지한다. 소셜 로그인은 제외한다.", type: "FEATURE" as const, priority: "HIGH" as const };
const extra = { title: "상품 리뷰", category: "리뷰", description: "구매자가 상품에 리뷰를 작성하고 조회한다.", type: "FEATURE" as const, priority: "MEDIUM" as const };
let ctx: Context, other: Context, projectId: string;
let providerCalls = 0;
let providerFailure: "none" | "schema" | "http" | "timeout" = "none";
const providerServer = createServer(async (req,res) => {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString()); providerCalls++;
  assert.equal(body.response_format.type, "json_schema"); assert.equal(body.response_format.json_schema.strict,true);
  assert.ok(body.max_completion_tokens<=12000);
  if (providerFailure === "http") { res.writeHead(503).end(); return; }
  if (providerFailure === "timeout") { setTimeout(()=>res.writeHead(504).end(),1500); return; }
  const task = body.response_format.json_schema.name.replace("scopeflow_", "");
  const input = JSON.parse(body.messages[1].content);
  let result: unknown;
  if (task === "initial") result = { projectType:"쇼핑몰",summary:"회원 기능을 제공하는 쇼핑몰",features:[{...feature,confidence:0.95}],budget:{amount:5000000,currency:"KRW"},desiredDeadline:null,missingInformation:[{key:"social",question:"소셜 로그인이 필요한가요?",reason:"인증 범위 확인"}] };
  if (task === "questions") result = { questions:[{key:"design",question:"디자인을 제공하시나요?",reason:"납품 범위 확인"}] };
  if (task === "requirements") result = { requirements:[feature] };
  if (task === "estimate") result = { items:input.requirements.map((r:{id:string})=>({requirementId:r.id,hours:{frontend:4,backend:5,design:0,qa:2},complexity:"MEDIUM",reason:"인증 및 검증 처리"})) };
  if (task === "summary") result = {description:"이메일 로그인을 제공하는 쇼핑몰 구축",excluded:["소셜 로그인"],assumptions:["디자인 제공"],integrations:[],deliverables:["소스 코드"]};
  if (task === "compare") result = {classification:"OUT_OF_SCOPE",confidence:0.95,reason:"승인된 Scope에 리뷰 기능이 없습니다.",newRequirements:[extra],affectedExistingRequirements:[],removedExclusions:["리뷰 기능"],estimatedWork:{frontend:6,backend:6,design:0,qa:2},scheduleImpactDays:2};
  res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(providerFailure === "schema" ? {bad:"output"} : result)}}],usage:{prompt_tokens:1000,completion_tokens:200,prompt_tokens_details:{cached_tokens:100}}}));
});

async function createUser(email: string, name: string) {
  const response = await auth.api.signUpEmail({body:{email,name,password:testPassword},asResponse:true});
  assert.equal(response.status,200,await response.clone().text());
  return (await response.json()).user as {id:string};
}
async function createProject(context:Context,name:string) {
  await executeCommand(context,{action:"client.save",name:"가상 고객",email:`${crypto.randomUUID()}@example.com`,company:"테스트 고객"});
  const [client]=await db.select().from(s.clients).where(eq(s.clients.workspaceId,context.workspaceId));
  const result=await executeCommand(context,{action:"project.create",name,clientId:client.id,content:"이메일 로그인 쇼핑몰 개발",budget:5000000,deadline:"2026-11-30"});
  return result.redirect!.split("/").pop()!;
}
before(async()=>{
  for (const migration of readMigrationFiles({migrationsFolder:"drizzle"})) for (const statement of migration.sql) await db.execute(sql.raw(statement));
  await new Promise<void>(resolve=>providerServer.listen(0,"127.0.0.1",resolve));
  const address=providerServer.address(); assert.ok(address && typeof address!=="string"); process.env.AI_BASE_URL=`http://127.0.0.1:${address.port}/v1`;
  const user=await createUser("owner@example.com","테스트 소유자");
  await executeCommand({userId:user.id,workspaceId:"",role:"OWNER"},{action:"workspace.create",name:"테스트 Workspace"}); ctx=await contextFor(user.id);
  const otherUser=await createUser("other@example.com","다른 소유자");
  await executeCommand({userId:otherUser.id,workspaceId:"",role:"OWNER"},{action:"workspace.create",name:"다른 Workspace"}); other=await contextFor(otherUser.id);
  projectId=await createProject(ctx,"전체 흐름 검증");
});
after(async()=>{ providerServer.closeAllConnections(); await new Promise<void>(resolve=>providerServer.close(()=>resolve())); await closeDatabase(); });

test("money and calendar math reject invalid values and preserve month boundaries",()=>{
  assert.equal(calculateAmount({frontend:4,backend:5,design:0,qa:2},defaultRates),580000);
  assert.equal(addDays("2026-11-30",2),"2026-12-02"); assert.equal(addDays("2028-02-28",1),"2028-02-29");
  assert.throws(()=>addDays("2026-02-30",1)); assert.throws(()=>calculateAmount({...zeroHours,qa:-1},defaultRates));
});
test("Groq routing uses the configured endpoint and GPT-OSS defaults",()=>{
  const previous = { provider:process.env.AI_PROVIDER, baseUrl:process.env.AI_BASE_URL, fast:process.env.AI_FAST_MODEL, standard:process.env.AI_STANDARD_MODEL, reasoning:process.env.AI_REASONING_MODEL };
  try {
    process.env.AI_PROVIDER = "groq"; delete process.env.AI_BASE_URL; delete process.env.AI_FAST_MODEL; delete process.env.AI_STANDARD_MODEL; delete process.env.AI_REASONING_MODEL;
    assert.equal(configuredProvider(),"groq"); assert.equal(aiBaseUrl(),"https://api.groq.com/openai/v1");
    assert.equal(modelFor("summary"),"openai/gpt-oss-20b"); assert.equal(modelFor("initial"),"openai/gpt-oss-120b"); assert.equal(modelFor("compare",true),"openai/gpt-oss-120b");
  } finally {
    process.env.AI_PROVIDER = previous.provider; process.env.AI_BASE_URL = previous.baseUrl; process.env.AI_FAST_MODEL = previous.fast; process.env.AI_STANDARD_MODEL = previous.standard; process.env.AI_REASONING_MODEL = previous.reasoning;
  }
});
test("authentication, origin protection, tenancy, and MEMBER authorization",async()=>{
  const unauth=await POST(new NextRequest("http://localhost:3000/api/commands",{method:"POST",headers:{origin:"http://localhost:3000","Content-Type":"application/json"},body:JSON.stringify({action:"client.save"})})); assert.equal(unauth.status,401);
  const crossOrigin=await POST(new NextRequest("http://localhost:3000/api/commands",{method:"POST",headers:{origin:"https://attacker.invalid"},body:"{}"})); assert.equal(crossOrigin.status,403);
  await assert.rejects(projectFor(other,projectId),/프로젝트를 찾을/);
  await assert.rejects(contextFor(ctx.userId,other.workspaceId),/Workspace/);
  await assert.rejects(executeCommand({...ctx,role:"MEMBER"},{action:"rates.save",rates:defaultRates}),/소유자/);
  const [foreignClient]=await db.select().from(s.clients).where(eq(s.clients.workspaceId,ctx.workspaceId));
  await assert.rejects(executeCommand(other,{action:"project.create",name:"잘못된 고객",clientId:foreignClient.id,content:"새 프로젝트",budget:null,deadline:""}),/Workspace의 고객/);
  const signIn=await auth.api.signInEmail({body:{email:"owner@example.com",password:testPassword},asResponse:true}); assert.equal(signIn.status,200);
  const cookie=signIn.headers.getSetCookie().map(c=>c.split(";")[0]).join("; "); const session=await auth.api.getSession({headers:new Headers({cookie})}); assert.equal(session?.user.id,ctx.userId);
});
test("complete AI-assisted workflow, client approval, and immutable change versioning",async()=>{
  await executeAI(ctx,{action:"ai.run",projectId,task:"initial"});
  await executeAI(ctx,{action:"ai.apply",projectId,task:"initial"});
  const [question]=await db.select().from(s.questions).where(eq(s.questions.projectId,projectId)); assert.ok(question);
  const questionShare=await executeCommand(ctx,{action:"share.create",projectId,purpose:"QUESTIONS"}); const questionToken=questionShare.link!.split("/").pop()!;
  await executePortal({action:"client.answer",token:questionToken,questionId:question.id,name:"고객 담당자",content:"소셜 로그인은 필요하지 않습니다."});
  await executeAI(ctx,{action:"ai.run",projectId,task:"requirements"});
  await executeAI(ctx,{action:"ai.apply",projectId,task:"requirements"});
  const [requirement]=await db.select().from(s.requirements).where(eq(s.requirements.projectId,projectId)); assert.equal(requirement.title,feature.title);
  await executeAI(ctx,{action:"ai.run",projectId,task:"estimate"});
  await executeAI(ctx,{action:"ai.apply",projectId,task:"estimate"});
  const scopeInput={action:"scope.create",projectId,description:"쇼핑몰 로그인 개발",excluded:"소셜 로그인\n리뷰 기능",assumptions:"디자인 제공",integrations:"",deliverables:"소스 코드",durationDays:30};
  await assert.rejects(executeCommand(ctx,scopeInput),/검토/);
  await executeCommand(ctx,{action:"estimate.item",projectId,requirementId:requirement.id,hours:{frontend:4,backend:5,design:0,qa:2},reason:"개발 담당자 검토 완료"});
  await executeAI(ctx,{action:"ai.run",projectId,task:"summary"});
  await executeCommand(ctx,scopeInput);
  const [scope]=await db.select().from(s.scopes).where(eq(s.scopes.projectId,projectId)); assert.equal(scope.document.estimate.total,580000);
  await executeCommand(ctx,{action:"requirement.save",projectId,requirementId:requirement.id,...feature,description:"이메일 로그인 및 세션 만료 처리. 소셜 로그인 제외."});
  await assert.rejects(executeCommand(ctx,{action:"share.create",projectId,purpose:"SCOPE",targetId:scope.id}),/바뀌었/);
  await executeCommand(ctx,{...scopeInput,action:"scope.edit",scopeId:scope.id});
  const share=await executeCommand(ctx,{action:"share.create",projectId,purpose:"SCOPE",targetId:scope.id}); const token=share.link!.split("/").pop()!;
  const [tokenRow]=await db.select().from(s.accessTokens).where(eq(s.accessTokens.scopeId,scope.id)); assert.equal(tokenRow.tokenHash,hashToken(token)); assert.notEqual(tokenRow.tokenHash,token);
  await assert.rejects(executeCommand(ctx,{action:"requirement.delete",projectId,requirementId:requirement.id}),/수정할 수 없/);
  const portal=await portalData(token); assert.equal(portal.scope?.document.estimate.total,580000); assert.equal("notes" in portal.project,false);
  await Promise.all([executePortal({action:"client.decide",token,name:"고객 담당자",decision:"APPROVE",consent:"on"}),executePortal({action:"client.decide",token,name:"고객 담당자",decision:"APPROVE",consent:"on"})]);
  const [base]=await db.select().from(s.scopes).where(eq(s.scopes.id,scope.id)); assert.equal(base.status,"APPROVED"); const original=JSON.stringify(base);
  await assert.rejects(db.update(s.scopes).set({document:{...base.document,description:"tamper"}}).where(eq(s.scopes.id,scope.id)));
  await assert.rejects(db.delete(s.scopes).where(eq(s.scopes.id,scope.id)));
  await executeChange(ctx,{action:"change.create",projectId,request:"상품 리뷰를 추가해주세요."});
  const [change]=await db.select().from(s.changes).where(eq(s.changes.projectId,projectId));
  await executeChange(ctx,{action:"change.analyze",projectId,changeId:change.id});
  await assert.rejects(executeCommand(ctx,{action:"share.create",projectId,purpose:"CHANGE",targetId:change.id}),/검토/);
  const [analyzed]=await db.select().from(s.changes).where(eq(s.changes.id,change.id)); const analysis=comparisonSchema.parse(analyzed.analysis);
  await assert.rejects(executeChange(ctx,{...analysis,action:"change.review",projectId,changeId:change.id,request:change.request,removedExclusions:["존재하지 않는 제외 항목"]}),/제외 항목/);
  await assert.rejects(executeChange(ctx,{...analysis,action:"change.review",projectId,changeId:change.id,request:change.request,classification:"IN_SCOPE"}),/제외 범위/);
  await executeChange(ctx,{...analysis,action:"change.review",projectId,changeId:change.id,request:change.request,classification:"UNCERTAIN"});
  await assert.rejects(executeCommand(ctx,{action:"share.create",projectId,purpose:"CHANGE",targetId:change.id}),/검토/);
  await executeChange(ctx,{...analysis,action:"change.review",projectId,changeId:change.id,request:change.request});
  const changeShare=await executeCommand(ctx,{action:"share.create",projectId,purpose:"CHANGE",targetId:change.id}); const changeToken=changeShare.link!.split("/").pop()!;
  assert.equal((await portalData(changeToken)).change?.amount,740000);
  assert.equal((await portalData(changeToken)).change?.newDeadline,"2026-12-02");
  await Promise.all([executePortal({action:"client.decide",token:changeToken,name:"고객 담당자",decision:"APPROVE",consent:"on"}),executePortal({action:"client.decide",token:changeToken,name:"고객 담당자",decision:"APPROVE",consent:"on"})]);
  const versions=await db.select().from(s.scopes).where(eq(s.scopes.projectId,projectId)).orderBy(s.scopes.version); assert.equal(versions.length,2); assert.equal(JSON.stringify(versions[0]),original); assert.equal(versions[1].document.estimate.total,1320000); assert.equal(versions[1].document.requirements.length,2); assert.equal(versions[1].document.deadline,"2026-12-02");
  assert.deepEqual(versions[0].document.excluded,["소셜 로그인","리뷰 기능"]); assert.deepEqual(versions[1].document.excluded,["소셜 로그인"]);
  const logs=await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.projectId,projectId),eq(s.auditLogs.event,"CHANGE_APPROVED"))); assert.equal(logs.length,1);
  const usage=await db.select().from(s.aiUsage).where(eq(s.aiUsage.projectId,projectId)); assert.equal(usage.length,5); assert.equal(usage.reduce((sum,u)=>sum+u.creditsUsed,0),11); assert.ok(usage.every(u=>u.status==="SUCCESS"&&u.inputTokens===1000&&u.estimatedCost>0));
});
test("cache, force-regeneration, output validation, retry, timeout and quotas",async()=>{
  const pid=await createProject(other,"AI 제한 검증"); const input={content:"캐시 검증용 로그인 프로젝트"};
  const before=providerCalls;
  await generate(other,pid,"initial",input); const cached=await generate(other,pid,"initial",input); assert.equal(cached.cached,true); assert.equal(providerCalls,before+1);
  await generate(other,pid,"initial",input,{force:true}); assert.equal(providerCalls,before+2);
  providerFailure="schema";
  await assert.rejects(generate(other,pid,"initial",{content:"invalid"}),/AI 분석/);
  let usage=await db.select().from(s.aiUsage).where(eq(s.aiUsage.projectId,pid)); const failed=usage.find(u=>u.status==="FAILED")!; assert.equal(failed.creditsUsed,0); assert.equal(failed.inputTokens,1000); assert.ok(failed.estimatedCost>0);
  providerFailure="http"; const beforeRetry=providerCalls;
  await assert.rejects(generate(other,pid,"initial",{content:"retry"}),/AI 분석/); assert.equal(providerCalls,beforeRetry+2);
  providerFailure="timeout"; process.env.AI_TIMEOUT_MS="1000";
  await assert.rejects(generate(other,pid,"initial",{content:"timeout"}),/AI 분석/); process.env.AI_TIMEOUT_MS="45000"; providerFailure="none";
  await db.update(s.workspaces).set({creditLimit:5}).where(eq(s.workspaces.id,other.workspaceId));
  await assert.rejects(generate(other,pid,"initial",{content:"over quota"}),/Workspace의 이번 달/);
  await db.update(s.workspaces).set({creditLimit:500,userCreditLimit:4}).where(eq(s.workspaces.id,other.workspaceId));
  await assert.rejects(generate(other,pid,"initial",{content:"over user quota"}),/사용자의 이번 달/);
  usage=await db.select().from(s.aiUsage).where(eq(s.aiUsage.projectId,pid)); assert.equal(usage.reduce((sum,u)=>sum+u.creditsUsed,0),4);
});
test("token expiry/revocation and server request limits",async()=>{
  const pid=await createProject(ctx,"토큰 검증");
  const share=await executeCommand(ctx,{action:"share.create",projectId:pid,purpose:"QUESTIONS"}); const token=share.link!.split("/").pop()!; const row=await tokenFor(token);
  await executeCommand(ctx,{action:"share.revoke",projectId:pid,tokenId:row.id}); await assert.rejects(tokenFor(token),/만료/);
  const expired=await executeCommand(ctx,{action:"share.create",projectId:pid,purpose:"QUESTIONS"}); const raw=expired.link!.split("/").pop()!;
  await db.update(s.accessTokens).set({expiresAt:new Date(0)}).where(eq(s.accessTokens.tokenHash,hashToken(raw))); await assert.rejects(tokenFor(raw),/만료/);
  await limitRequest("test-limit",1); await assert.rejects(limitRequest("test-limit",1),/요청이 너무/);
});

test("client revision, IN_SCOPE zero cost, stale competing changes and rejection",async()=>{
  const make = async (request:string) => {
    const created = await executeChange(ctx,{action:"change.create",projectId,request});
    return created.redirect!.split("#")[1];
  };
  const review = {action:"change.review",projectId,request:"기존 이메일 로그인의 화면을 확인해주세요.",classification:"IN_SCOPE",confidence:1,reason:"승인된 이메일 로그인 기능의 동작 확인이며 추가 개발이 없습니다.",newRequirements:[],affectedExistingRequirements:[],removedExclusions:[],estimatedWork:zeroHours,scheduleImpactDays:0};
  const first=await make(review.request), second=await make(review.request);
  await executeChange(ctx,{...review,changeId:first}); await executeChange(ctx,{...review,changeId:second});
  const share = async (targetId:string) => (await executeCommand(ctx,{action:"share.create",projectId,purpose:"CHANGE",targetId})).link!.split("/").pop()!;
  let token=await share(first);
  await assert.rejects(share(second),/다른 변경 요청/);
  await executePortal({action:"client.decide",token,name:"검토 고객",decision:"REVISE",message:"확인 범위를 더 명확하게 설명해주세요.",consent:"on"});
  await assert.rejects(tokenFor(token),/만료/); await assert.rejects(share(first),/내부 검토/);
  await executeChange(ctx,{...review,changeId:first}); token=await share(first);
  const before=await db.select().from(s.scopes).where(eq(s.scopes.projectId,projectId)).orderBy(s.scopes.version);
  await executePortal({action:"client.decide",token,name:"검토 고객",decision:"APPROVE",consent:"on"});
  const after=await db.select().from(s.scopes).where(eq(s.scopes.projectId,projectId)).orderBy(s.scopes.version);
  assert.equal(after.length,before.length+1); assert.equal(after.at(-1)!.document.estimate.total,before.at(-1)!.document.estimate.total); assert.equal(after.at(-1)!.document.deadline,before.at(-1)!.document.deadline);
  await assert.rejects(share(second),/기준 Scope/);
  const third=await make(review.request); await executeChange(ctx,{...review,changeId:third}); token=await share(third);
  await executePortal({action:"client.decide",token,name:"검토 고객",decision:"REJECT",message:"진행하지 않겠습니다.",consent:"on"});
  assert.equal((await db.select().from(s.scopes).where(eq(s.scopes.projectId,projectId))).length,after.length);
  assert.equal((await db.select().from(s.changes).where(eq(s.changes.id,third)))[0].status,"REJECTED");
});

test("concurrent AI reservations cannot overspend the monthly credit limit",async()=>{
  const user=await createUser("concurrency@example.com","동시성 검증");
  await executeCommand({userId:user.id,workspaceId:"",role:"OWNER"},{action:"workspace.create",name:"동시 요청 검증"});
  const context=await contextFor(user.id), pid=await createProject(context,"월 한도 경쟁");
  await db.update(s.workspaces).set({creditLimit:2,userCreditLimit:2}).where(eq(s.workspaces.id,context.workspaceId));
  const before=providerCalls;
  const results=await Promise.allSettled([generate(context,pid,"initial",{content:"첫 번째 요청"}),generate(context,pid,"initial",{content:"두 번째 요청"})]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1); assert.equal(providerCalls,before+1);
  const usage=await db.select().from(s.aiUsage).where(eq(s.aiUsage.projectId,pid)); assert.equal(usage.reduce((sum,u)=>sum+u.creditsUsed,0),2);
});
