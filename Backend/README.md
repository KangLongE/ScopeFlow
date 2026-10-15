# ScopeFlow Backend

Next.js Route Handler, Prisma, Better Auth, Neon PostgreSQL, Groq으로 구성한 독립 API 서버입니다. 모든 업무 API는 `/api/v1` 아래에 있고, 인증 API는 `/api/auth/*`, 상태 확인은 `/api/health`입니다.

## 로컬 실행

```powershell
Copy-Item .env.example .env.local
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

`DATABASE_URL`은 Neon development 브랜치를 사용하세요. 실제 비밀값은 `.env.local`이나 배포 환경변수에만 두고 저장소에는 커밋하지 않습니다. Seed 계정은 `SEED_EMAIL`, `SEED_PASSWORD`로 직접 지정해야 합니다.

인증 후 업무 API 요청에는 `credentials: "include"`와 로그인 사용자가 소속된 `X-Workspace-Id` 헤더가 필요합니다. 허용 Origin은 `FRONTEND_URL` 하나로 제한됩니다.

## 검증 및 배포

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run db:deploy
```

통합 테스트는 별도의 빈 DB를 `TEST_DATABASE_URL`로 제공할 때 실행됩니다. Production에서는 `db:migrate`가 아니라 `db:deploy`만 사용하세요.

AI 문맥 파이프라인에는 `0003_ai_context`, 결과 규칙 검증에는 `0004_ai_rule_validation` migration이 필요합니다. 운영 DB에는 대상 환경을 확인한 뒤 `npm run db:deploy`를 적용하세요. 이번 작업에서는 격리된 로컬 테스트 DB에만 적용했습니다.

구현·검증 결과는 [AI 문맥 파이프라인 검증 기록](../docs/AI_CONTEXT_PIPELINE_2026-10-07.md)과 [AI 결과 규칙 검증 기록](../docs/AI_RULE_VALIDATOR_2026-10-07.md)을 참고하세요. Context가 저장된 기존 초안은 최신 규칙으로 재검증하며, 프롬프트 버전만 바뀐 경우 유료 AI 재호출은 필요하지 않습니다. Context가 없는 이전 초안이나 실제 고객 근거가 달라진 초안은 재분석이 필요합니다. 승인된 문서는 일괄 수정하지 않습니다.

`ai.review`, `ai.apply`, `change.saveDraft`, `change.review`, `estimate.review`, `scope.review` 및 일반 견적/Scope 수정 요청은 `candidateRevision`을 전송해야 합니다. 최초 값은 0이며 저장 응답의 새 리비전을 이후 요청에 사용하세요. 리비전 충돌은 409, 최종 검증 실패는 422와 `error.validation`을 반환합니다. 오류가 있는 검토 후보도 저장할 수 있지만, 통과 전에는 확정값·고객 승인에 반영하지 않습니다.

## 주요 API

변경 승인 금액·기간 요약에는 `0005_change_approval_impact` migration이 추가로 필요합니다. 고객 조회의 `change.impact`와 발급 당시 스냅샷을 사용하며, 변경 승인/의견 요청에는 조회한 `target: { approvalSnapshotId, changeRequestId, revision }`을 함께 보내야 합니다. [구현 및 회귀 기록](../docs/CHANGE_APPROVAL_IMPACT_2026-10-13.md)을 참고하세요.

Credit·오류·비용 표시에는 `0006_credit_errors_ux` migration이 필요합니다. `GET /api/v1/ai/usage?operation=INITIAL_ANALYSIS&projectId=<projectId>&regenerate=false`로 실제 비용·캐시·잔여·정책 리비전을 조회하고, 공개 유료 실행 요청에 `executionKey`(UUID)와 `policyRevision`을 전송하세요. 응답이 유실되면 새 키로 호출하지 않고 같은 경로의 `executionKey` 쿼리로 기존 상태를 조회합니다. 정책 변경/무료 캐시 만료는 새 비용을 확인한 뒤 재실행해야 합니다. [구현·정책·UX-01~24 검증 기록](../docs/CREDIT_ERRORS_UX_2026-10-14.md)을 참고하세요.

실행 상태와 Credit 처리 상태는 별개입니다. 성공 기록만 월 사용량에 반영하고 pending은 예약하며, 확정 실패는 예약을 해제합니다. 상태가 불명인 오래된 pending은 자동 환불/재실행하지 않습니다. API 추정 비용은 실행 당시 근거를 사용하며, 단가 미설정·사용량 누락·근거 없는 과거 0은 무료로 표시하지 않습니다. 이번 migration은 격리 테스트 DB에만 적용했으며, 일반 로컬/배포 DB 적용 및 배포는 별도로 필요합니다.

- Workspace, Client, Project, Requirement, Rate Card CRUD
- 최초 요청 분석, 질문/요구사항/견적 생성 및 AI 사용량
- Scope 생성·수정·승인 요청
- 고객 해시 토큰 조회·답변·Scope 승인·수정 요청
- Change Request 분석·내부 검토·고객 승인·새 Scope 버전 생성

## 항목별 Scope 제외 검토

내부 프로젝트 응답의 `aiContext.scopeExclusions`와 `sources`를 읽고, Scope 생성/수정 요청의 `exclusions: { revision, contextFingerprint, items }`로 검토 목록을 저장합니다. Scope 수정의 기존 `candidateRevision`도 필요합니다. 원문·답변·항목 리비전이 달라지면 409이며, 출처/origin 조작·명시 조건의 단순 삭제는 422입니다. pending은 초안 저장만 가능하고 고객 승인 전에는 검토가 필요합니다.

기존 Scope JSON의 `validationReview.exclusionReview`에 내부 상태/근거를, document의 `exclusions`에는 최종 제목/설명만 저장합니다. `excluded` 문자열은 같은 목록의 호환 projection입니다. 새 migration은 없으며 승인된 문서를 일괄 수정하지 않습니다. [제외 조건 구현·EXC-01~20 검증 기록](../docs/SCOPE_EXCLUSIONS_2026-10-15.md)을 참고하세요.
