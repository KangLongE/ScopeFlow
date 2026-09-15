# ScopeFlow 구현 계획

빈 저장소에서 Next.js App Router, TypeScript, Tailwind CSS, Better Auth, Drizzle ORM, PostgreSQL로 구현한다.
로컬 실행은 디스크에 저장되는 PGlite(PostgreSQL WASM), 운영은 DATABASE_URL의 PostgreSQL을 사용한다.

1. 인증, Workspace 및 멤버, 고객·프로젝트 CRUD, DB migration.
2. 최초 문의, 구조화된 AI 분석, 질문 편집·답변, 확정 요구사항.
3. 단가표, 작업 시간·최종 금액 수정, 견적 스냅샷, Scope 버전.
4. 만료·폐기 가능한 해시 토큰, 고객 답변·승인·수정 요청.
5. AI 범위 비교, 내부 검토, 변경 견적·승인, 원자적 버전 생성.
6. 월별 Workspace·사용자 Credit, DB 기반 제한·캐싱, 사용량과 감사 기록, Dashboard.

승인된 Scope의 내용과 견적은 독립된 JSON 스냅샷으로 보관하며 DB 트리거로 변경을 금지한다.
승인과 변경 반영은 프로젝트 행 잠금 및 트랜잭션으로 처리한다. 공유 링크는 특정 문서에 귀속한다.
AI 결과는 Zod로 검증하고 승인된 데이터와 구분한다. 비용과 날짜는 서버에서 계산한다.
AI 키 미설정 시 임의의 AI 결과를 만들지 않으며 수동 입력을 제공한다.

## 구현 현황

Phase 1~6의 코드와 로컬 DB 마이그레이션을 구현했다. 고객 승인과 변경 승인·버전 보존은 실제 UI에서 검증했다. 실제 AI 공급자 연결과 운영 DB·외부 배포는 환경 설정이 필요하다. 전체 검사 결과와 제한 사항은 [검증 기록](VERIFICATION.md)에 남겼다.
