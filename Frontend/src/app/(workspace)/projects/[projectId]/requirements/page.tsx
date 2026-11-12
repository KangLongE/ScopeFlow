import Link from "next/link";
import { ArrowRight, CircleCheck, Circle, FileText, Plus } from "lucide-react";
import { ProjectState } from "@/components/next-step";
import { projectData } from "@/lib/queries";
import { AiNotice, Card, Textarea, Field } from "@/components/ui";
import { AIButton } from "@/components/ai";
import { AIContextBasis } from "@/components/ai-context";
import { AIReview } from "@/components/ai-review";
import { MutationForm } from "@/components/form";
import { RequirementContext, RequirementFields } from "@/components/requirements";
import { RequirementEditor } from "@/components/requirement-editor";
import { RequirementStatus, RequirementsWorkbench } from "@/components/requirements-workbench";
import { OpenRequirementForm } from "@/components/open-requirement-form";
import { labels } from "@/lib/model";

export default async function Requirements({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const d = await projectData(projectId);
  const locked = ["COMPLETED", "CANCELLED"].includes(d.project.status) || d.scopes.some(s => ["APPROVED", "WAITING_APPROVAL"].includes(s.status));
  const owner = d.ctx.role === "OWNER";
  const drafts = d.project.aiDrafts ?? {};
  const reviewing = Object.entries(drafts).some(([task, draft]) => ["initial", "questions", "requirements"].includes(task) && draft.status === "READY");
  const unanswered = d.questions.filter(q => q.question.important !== false && !q.answer).length;
  const confirmed = d.requirements.filter(r => r.status === "CONFIRMED").length;
  const pending = d.requirements.filter(r => r.status === "PENDING").length;
  const ready = confirmed > 0 && !pending && !unanswered;
  const task = !d.initial?.analysis ? "initial" : !d.questions.length && d.initial.analysis.missingInformation.length ? "questions" : "requirements";

  return <div className="stack requirements-workspace">
    <div className={`requirements-toolbar${ready && !locked && !reviewing ? " is-ready" : ""}`}>
      {(!ready || locked || reviewing) && <div><ProjectState project={d.project} /><p>{locked ? "합의한 요구사항은 보호됩니다. 추가 범위는 변경 요청에서 관리하세요." : reviewing ? "AI 검토 초안을 확인하고 요구사항에 반영해주세요." : unanswered ? `고객 답변 ${unanswered}건을 확인하면 요구사항을 정리할 수 있습니다.` : "고객 요청을 확인하고 제공할 범위를 정리하세요."}</p></div>}
      <div className="heading-actions">
        {locked ? <Link className="button secondary" href={`/projects/${projectId}/scope`}>현재 Scope 보기 <ArrowRight size={16} /></Link> : !reviewing && (ready ? <Link className="button" href={`/projects/${projectId}/estimate`}><FileText size={18} aria-hidden="true" />견적 만들기 <ArrowRight size={16} /></Link> : unanswered ? owner && <MutationForm action="share.create" variant="primary" payload={{ projectId, purpose: "QUESTIONS" }} submit="고객에게 질문 전달" /> : owner && <AIButton projectId={projectId} task={task} primary />)}
      </div>
    </div>

    <div className="requirements-summary" aria-label="요구사항 검토 현황"><strong><CircleCheck size={20} aria-hidden="true" />{confirmed}개 확정</strong><span className="summary-separator" /><span><Circle size={20} aria-hidden="true" />확인 필요 {pending}개</span>{unanswered > 0 && <Link href="#questions" className="question-pending">답변 대기 {unanswered}개</Link>}</div>

    {!locked && owner && (["initial", "questions", "requirements"] as const).map(task => drafts[task] && <AIReview key={task + drafts[task].createdAt} projectId={projectId} task={task} draft={drafts[task]} revision={d.project.revision} replaces={task === "requirements" ? d.requirements.length > 0 : task === "questions" && unanswered > 0} />)}

    <RequirementsWorkbench action={!locked && <OpenRequirementForm />} items={d.requirements.map(r => ({ id: r.id, title: r.title, description: r.description, status: r.status, detail: <>
      <div className="requirement-detail-heading"><h2>{r.title}</h2><RequirementStatus status={r.status} detail /></div>
      {locked ? <div className="requirement-readonly"><h3>완료 기준</h3><p className="prose">{r.description}</p><div className="detail-meta"><span>카테고리 · {r.category}</span><span>우선순위 · {r.priority === "HIGH" ? "높음" : r.priority === "LOW" ? "낮음" : "보통"}</span></div></div> : <RequirementEditor projectId={projectId} requirement={r} />}
      <RequirementContext context={d.project.aiContext} sourceRefs={r.provenance?.sourceRefs} budget={d.project.budget} />
      {!locked && <details className="requirement-extra-actions"><summary>추가 설정 · 제목·유형 편집 및 삭제</summary><div className="stack">
        <MutationForm action="requirement.save" payload={{ projectId, requirementId: r.id, category: r.category, description: r.description, priority: r.priority, status: r.status }} submit="추가 속성 저장"><Field label="요구사항 이름" name="title" value={r.title} required /><label>유형<select name="type" defaultValue={r.type}>{["FEATURE", "NON_FUNCTIONAL", "DESIGN", "INFRA", "EXTERNAL_INTEGRATION"].map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label><Textarea label="고객 조건 수정 사유" name="decisionReason" rows={2} /></MutationForm>
        <MutationForm className="compact" variant="danger" action="requirement.delete" payload={{ projectId, requirementId: r.id }} submit="요구사항 삭제" confirm="이 요구사항과 연결된 견적 초안 항목을 삭제할까요?" />
      </div></details>}
    </> }))} />
    {!locked && <Card id="manual-requirements" title="요구사항 직접 추가"><details><summary><span>직접 입력하기</span><Plus size={17} aria-hidden="true" /></summary><div className="card-body"><MutationForm action="requirement.save" payload={{ projectId }} submit="요구사항 추가"><RequirementFields /></MutationForm></div></details></Card>}
    <div className="requirements-support">
      <div className="stack">
        <section className="card questions-card" id="questions">
          <details open={unanswered > 0}><summary><span>고객에게 확인할 질문 <span className="count-label">{d.questions.length}/8</span></span><span className={unanswered ? "question-pending" : "muted"}>{unanswered ? `답변 대기 ${unanswered}개` : "질문 관리"}</span></summary><div className="card-body">
            <p className="text-sm mb-4">저장된 답변만 AI 검토에 반영됩니다. 꼭 필요한 질문만 전달하세요.</p>
            {d.questions.map(({ question: q, answer }, i) => <details key={q.id} open={!answer}><summary>{i + 1}. {q.question}</summary><div className="detail-body"><p className="text-sm mb-4">{q.reason}</p>
              {!locked ? <>
                <MutationForm action="answer.save" payload={{ projectId, questionId: q.id }} submit="답변 저장"><Textarea label="고객 답변" name="content" value={answer?.content} required rows={3} /></MutationForm>
                <details><summary>질문 편집</summary><MutationForm action="question.save" payload={{ projectId, questionId: q.id }} confirm={answer ? "질문을 바꾸면 기존 답변은 삭제됩니다. 계속할까요?" : undefined}><Textarea label="질문" name="question" value={q.question} required rows={2} /><Textarea label="질문 이유" name="reason" value={q.reason} rows={2} /><label>범위·비용 영향<select name="important" defaultValue={String(q.important !== false)}><option value="true">중요 · 반영 전 확인</option><option value="false">참고 · 미답변이어도 진행</option></select></label></MutationForm><MutationForm className="compact" variant="danger" action="question.delete" payload={{ projectId, questionId: q.id }} submit="질문 삭제" confirm="질문과 답변을 삭제할까요?" /></details>
              </> : <p className="prose">{answer?.content || "답변 없음"}</p>}
            </div></details>)}
            {!locked && <><details><summary>질문 직접 추가</summary><MutationForm action="question.save" payload={{ projectId }} submit="질문 추가" disabled={d.questions.length >= 8}><Textarea label="질문" name="question" required rows={2} /><Textarea label="질문 이유" name="reason" rows={2} /><label>범위·비용 영향<select name="important" defaultValue="true"><option value="true">중요 · 반영 전 확인</option><option value="false">참고 · 미답변이어도 진행</option></select></label></MutationForm></details>{owner && d.questions.length > 0 && !unanswered && <AIButton projectId={projectId} task="requirements" />}</>}
          </div></details>
        </section>
        <section className="card analysis-tools"><details><summary>분석 요약·적용 기준</summary><div className="card-body"><ProjectState project={d.project} />
          {d.initial?.analysis && <><h3>{d.initial.analysis.projectType}</h3><p className="prose">{d.initial.analysis.summary}</p><details><summary>분석에서 추출한 기능 후보</summary><ul>{d.initial.analysis.features.map((feature, i) => <li key={i}>{feature.title}</li>)}</ul></details>{d.initial.analysis.missingInformation.length > 0 && <details><summary>확인이 필요한 내용</summary><ul>{d.initial.analysis.missingInformation.map((q, i) => <li key={i}>{q.question}</li>)}</ul></details>}</>}
          <AIContextBasis context={d.project.aiContext} /><AiNotice configured />
          {!locked && owner && <><h3>AI로 다시 정리하기</h3><div className="actions-row"><AIButton projectId={projectId} task="initial" /><AIButton projectId={projectId} task="questions" blockReason={!d.initial?.analysis ? "먼저 요청 분석 초안을 검토·반영해주세요." : undefined} /><AIButton projectId={projectId} task="requirements" /></div></>}
        </div></details></section>
      </div>
      <Card title="고객 요청 원문">
          <details className="request-editor"><summary><span><FileText size={15} aria-hidden="true" /> 원문 전체 보기{!locked && owner ? "·수정" : ""}</span></summary><div className="detail-body">
            {!locked && owner ? <MutationForm action="initial.save" payload={{ projectId }} submit="원문 저장"><Textarea label="고객이 전달한 원문" name="content" value={d.initial?.content} required rows={6} /></MutationForm> : <p className="prose">{d.initial?.content}</p>}
          </div></details>
      </Card>
    </div>
  </div>;
}
