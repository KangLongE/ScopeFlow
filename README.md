# ScopeFlow

고객 문의부터 요구사항, 견적, Scope 승인, 변경 요청까지 관리하는 한국어 B2B SaaS입니다.

## 구조

- `Frontend/`: Next.js UI. DB와 비밀키에 직접 접근하지 않고 Backend API만 호출합니다.
- `Backend/`: Next.js API, Better Auth, Prisma, PostgreSQL/Neon, Groq 연동의 단일 소유자입니다.

## 로컬 실행

Node.js 22.9 이상을 사용합니다.

1. `Backend/.env.example`을 참고해 `Backend/.env.local`을 설정합니다. 실제 비밀값은 커밋하지 않습니다.
2. DB 마이그레이션을 적용하고 Backend를 실행합니다.

```powershell
Set-Location Backend
npm ci
npm run db:deploy
npm run dev
```

3. 별도 터미널에서 Frontend를 실행합니다.

```powershell
Set-Location Frontend
npm ci
npm run dev
```

Frontend는 기본적으로 `http://127.0.0.1:3001`의 Backend를 사용합니다. 다른 주소가 필요하면 `Frontend/.env.local`의 서버 전용 `BACKEND_URL`만 변경합니다. 브라우저에서는 [http://127.0.0.1:3000](http://127.0.0.1:3000)을 엽니다.

## 환경 변수

DB, 인증, Groq 관련 값은 모두 Backend에만 둡니다.

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`
- `AI_PROVIDER=groq`, `GROQ_API_KEY`
- `AI_FAST_MODEL=openai/gpt-oss-20b`
- `AI_STANDARD_MODEL=openai/gpt-oss-120b`
- `AI_REASONING_MODEL` (선택, 기본값은 Standard 모델)

Frontend에는 `BACKEND_URL` 외의 비밀값이 필요하지 않습니다. 비밀값에 `NEXT_PUBLIC_` 접두사를 사용하지 마세요.

## 검증

각 폴더에서 다음 명령을 실행합니다.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Backend 통합 테스트는 별도의 빈 DB를 `TEST_DATABASE_URL`로 제공할 때만 실행됩니다. 운영 배포에서는 `db:migrate` 대신 `db:deploy`를 사용합니다.

## 공개 저장소 보안

계정 정보, API 키, 공유 토큰, DB 덤프를 커밋하지 마세요. `.env*`, 로컬 데이터, 빌드 결과, 로그, 인증서와 백업은 Git에서 제외됩니다. 이미 공개된 비밀값은 문서에서 지우는 것만으로 안전해지지 않으므로 공급자에서 폐기하고 재발급해야 합니다.
