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

## 주요 API

- Workspace, Client, Project, Requirement, Rate Card CRUD
- 최초 요청 분석, 질문/요구사항/견적 생성 및 AI 사용량
- Scope 생성·수정·승인 요청
- 고객 해시 토큰 조회·답변·Scope 승인·수정 요청
- Change Request 분석·내부 검토·고객 승인·새 Scope 버전 생성
