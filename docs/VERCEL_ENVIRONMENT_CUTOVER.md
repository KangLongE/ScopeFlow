# Vercel 환경 분리 적용안 · 2026-11-17

## 최초 점검 결과

로그인한 Chrome에서 두 대시보드와 General의 Project ID를 확인했다. 사용자 제공 ID와 일치한다. 같은 프로젝트의 MCP 조회는 404여서 브라우저와 MCP의 접근 결과가 다르다. MCP 공통 장애의 원인까지 확정한 것은 아니다.

| 대상 | 확인한 상태 |
| --- | --- |
| Frontend `scope-flow` | Neon 자동 관리 변수 18개가 모든 환경에 연결됨. DB URL·비밀번호는 Config 유형. 별도 Groq 키도 Production에 남아 있음 |
| Backend `scope-flow-backend` | 변수 8개가 Production·Preview를 함께 대상으로 지정. DB·인증 Secret·Groq 키도 같은 항목을 공유. 유형은 Secret |
| Backend 빌드 | Root Directory는 Backend. 빌드 명령에 마이그레이션 단계가 포함됨 |
| 운영 버전 | Frontend 대시보드에서 main `8481df2` Ready 확인 |

비밀값을 열거나 복사하지 않고 이름·범위·유형만 확인했다. Secret 편집에서 키 입력은 변경 불가이며 저장된 값은 다시 읽을 수 없다. 기존 DB Secret의 이름만 바꾸어 마이그레이션용으로 보존하는 방식은 사용할 수 없다.

## 1단계: 환경별 접근 분리

Production의 현재 DB 접속값·인증 Secret·AI 키는 보존한다. 사용 중인 DB 사용자 교체나 인증 Secret 회전, 운영 재배포는 이 단계에 포함하지 않는다.

1. Frontend의 Neon **Remove Project Connection**으로 자동 DB 변수 주입을 해제한다. DB·Neon 프로젝트 삭제는 하지 않는다. [Neon 공식 문서](https://github.com/neondatabase/website/blob/main/content/docs/guides/vercel-managed-integration.md)의 프로젝트 연결 해제 절차를 따르며 Frontend 빌드가 DB에 의존하지 않는지도 확인한다.
2. Frontend에서 사용하지 않는 `GROQ_API_KEY`·`AI_PROVIDER`·`AI_FAST_MODEL`·`AI_STANDARD_MODEL`·`BETTER_AUTH_SECRET`를 제거한다. 현재 소스와 HEAD에서 이 값들을 인증·AI 실행에 사용하지 않음을 확인했다. 업무 인증·AI는 Backend가 담당한다.
3. Backend의 `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`, `GROQ_API_KEY`를 Production에만 유지한다. 기존 비밀값을 교체하지 않고 Preview 범위를 해제한다.
4. Preview에는 준비된 `scopeflow_preview` 접속값과 별도 인증 Secret을 Secret 유형으로 설정한다. 운영 DB 행은 복사하지 않는다.
5. Backend `DATABASE_ENVIRONMENT`, Frontend `BACKEND_ENVIRONMENT`를 Development·Preview·Production에 각각 같은 환경명으로 설정한다. 로컬 개발 DB 비밀번호를 Vercel에 복사하지 않는다.
6. Preview 전용 Groq 키와 정확한 Frontend·Backend URL을 별도로 준비한다. 이 값이 준비되기 전 Preview 배포는 기동 또는 요청에서 차단될 수 있다. 정상 사용 가능한 Preview가 완성됐다고 표시하지 않는다.

모델 이름은 비밀값이 아니므로 Backend에서 공유할 수 있다. 실제 AI 요청은 추가하지 않는다. 이미 허용된 실제 호출 2회 한도는 소진됐다.

## 2단계: 운영 앱 계정 최소 권한 적용

1. 새 코드의 `MIGRATION_DATABASE_URL` 지원을 먼저 준비한다. 미지정 시 기존 `DATABASE_URL`로 동작해 현재 빌드를 유지한다.
2. 마이그레이션 접속값은 Vercel Backend의 **Production Secret**에 직접 입력하거나 연결 도구로 안전하게 전달한다. 소유자 비밀번호를 로컬 파일·명령행·로그에 저장하지 않는다. 필요한 Secret 값의 입력은 운영자가 Neon의 보호된 접속 화면을 이용할 수 있다.
3. 런타임 `DATABASE_URL`을 준비된 `scopeflow_production_app`으로 변경한다. 마이그레이션과 런타임은 같은 DB·스키마여야 하며 pooled/direct 차이만 허용한다.
4. 코드와 설정을 함께 반영한 배포에서 마이그레이션·인증·회사별 데이터 접근·내보내기를 검증한다. DB 계정만 먼저 바꾸어 이전 코드의 배포 마이그레이션을 깨뜨리지 않는다.

## 현재 적용 상태

사용자의 명시적 1단계 승인 후 Chrome에서 아래 설정을 저장하고 페이지를 다시 불러와 적용 범위를 검증했다.

- Frontend의 Neon 프로젝트 연결 해제 완료. 자동 DB 변수 18개가 제거됐고 Neon 관리 API에서 운영 `neondb`와 `scopeflow_preview`가 유지됨을 확인했다.
- Frontend의 미사용 변수 5개 제거 완료. 남은 항목은 기존 Production `BACKEND_URL`과 환경별 `BACKEND_ENVIRONMENT` 3개로 총 4개다.
- Backend의 기존 DB·인증 Secret·서비스 URL·Groq 키는 Production에만 유지했다. 기존 비밀값을 입력하거나 교체하지 않았다.
- Preview 전용 DB 연결·인증 Secret을 별도의 Preview Secret으로 저장했다.
- Backend `DATABASE_ENVIRONMENT`, Frontend `BACKEND_ENVIRONMENT`는 세 환경 각각 해당 환경명으로 저장했다.
- 사용자가 직접 입력한 별도 Preview Groq 키를 Secret·Preview 범위로 저장했다. 새로고침 후 Production·Preview의 별도 Secret 항목을 확인했다. 키 값은 로그·문서·로컬 파일에 기록하지 않았고 실제 AI 호출은 하지 않았다.
- Preview Frontend·Backend URL은 아직 지정하지 않았다. 운영 Origin을 Preview에 재사용하지 않았다.

운영 Frontend 인증 경로와 Backend health는 HTTP 200으로 응답했다. 운영 재배포·코드 커밋·푸시·비밀번호 회전·실제 AI 호출은 수행하지 않았다. **환경 변수 변경은 새 배포에 반영되며, 기존 배포의 환경 스냅샷은 재배포·정리 전까지 남는다.** 따라서 이 기록을 운영 보안 준비 전체 완료 또는 정상 사용 가능한 Preview 완성으로 해석하지 않는다.

앞선 Save는 자동 승인 검토로 보류됐지만 사용자가 Preview 준비 중 차단 가능성을 포함해 적용을 허용한 뒤 진행했다. Preview DB와 운영 DB의 컴퓨트·6시간 PITR은 여전히 같은 main 브랜치를 공유한다. 세 환경 AI 키의 값 대조와 운영 앱 제한 계정 전환은 별도 검증·적용이 남았다.
