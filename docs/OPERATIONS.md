# ScopeFlow 운영 환경과 고객 데이터 보호

이 문서는 구현한 보호 장치와 운영자가 실제 서비스에서 적용해야 할 설정을 구분한다. 비밀값, 고객 원문, DB 접속 문자열은 문서에 기입하지 않는다.

## 배포 전 필수 설정

**이 변경을 배포하기 전에 Vercel 환경별 태그와 실제 연결 대상을 설정해야 한다. 태그가 없거나 맞지 않으면 서버와 마이그레이션은 중단된다.** 태그 자체가 DB의 소속을 증명하지는 않으므로 아래 분리 검사도 수행한다.

| 대상 | Development | Preview | Production |
| --- | --- | --- | --- |
| Backend `DATABASE_ENVIRONMENT` | `development` | `preview` | `production` |
| Frontend `BACKEND_ENVIRONMENT` | `development` | `preview` | `production` |
| Backend DB | 별도 로컬 개발 DB | 별도 비운영 DB | 고객 데이터 전용 DB |
| DB 접속 계정·비밀번호 | 개발 전용 | Preview 전용 | 운영 전용 |
| `BETTER_AUTH_SECRET` | 개발 전용 난수 | Preview 전용 난수 | 운영 전용 난수 |
| `GROQ_API_KEY` | 개발 전용 키 | Preview 전용 키 | 운영 전용 키 |
| `FRONTEND_URL` | 로컬 Frontend | 정확한 Preview Frontend Origin | 운영 Frontend Origin |
| `BETTER_AUTH_URL` | 로컬 Backend | Preview Backend | 운영 Backend |
| Frontend `BACKEND_URL` | 로컬 Backend | Preview Backend | 운영 Backend |

Vercel에서는 `VERCEL_ENV`를 배포 환경의 기준으로 사용한다. 로컬은 `SCOPEFLOW_ENV=development`를 사용하며, `next build/start`의 `NODE_ENV=production`과 구분한다. Preview에 매번 다른 URL을 쓰는 경우 해당 Frontend·Backend의 정확한 URL과 환경을 연결한다. 편의를 위해 `*.vercel.app` 전체를 CORS나 공유 쿠키 도메인으로 허용하지 않는다.

비밀값은 Backend에만 둔다. Vercel의 Preview·Production에는 Secret 유형으로 저장하고 환경을 각각 지정한다. Development의 저장 방식은 Vercel의 지원 범위에 맞추되 운영 값을 복사하지 않는다. Frontend에는 DB 비밀번호, 인증 Secret, AI 키를 저장하지 않는다. Frontend 설정 로드는 알려진 Backend 비밀값이나 비밀값 성격의 `NEXT_PUBLIC_` 변수가 있으면 빌드를 거절한다.

Neon에서는 운영과 비운영 프로젝트 또는 브랜치 분리를 우선하며 DB 사용자·비밀번호도 별도로 발급한다. 운영 데이터를 복제한 브랜치를 그대로 개발에 사용하지 않는다. 비운영 DB는 빈 스키마에 마이그레이션을 적용하거나 비식별화한 데이터를 사용한다. 운영 앱 계정은 업무 테이블에 필요한 권한만 부여하고, 스키마 마이그레이션 계정은 분리해 관리한다. 아래 현재 구성은 Vercel 관리 조직의 제약으로 동일 브랜치의 별도 DB와 권한을 사용하는 절충안이다.

### 2026-11-19 실제 DB 구성

| 환경·용도 | DB | 계정 | 확인한 권한·상태 |
| --- | --- | --- | --- |
| Development | 로컬 전용 개발 DB | 개발 전용 계정 | 원격 운영 DB와 분리, 비관리자 |
| Preview | `scopeflow_preview` | `scopeflow_preview_migrator` | Preview DB 소유, 운영 테이블 읽기·쓰기 및 관리자 역할 없음. 마이그레이션 6개, 업무 테이블 26개, 운영 데이터 복사 없이 구성 |
| Production 앱 | `neondb` | `scopeflow_production_app` | 운영 업무 테이블 DML, 마이그레이션 기록 읽기 전용. 스키마 생성·역할 관리·Preview 테이블 접근 차단 |
| Production 백업 | `neondb` | `scopeflow_production_backup` | 운영 public 읽기 전용. 데이터 삭제·Preview 테이블 읽기 거절을 확인 |

Neon `scopeflow-db / main`은 PostgreSQL 18이고 관리 API에서 복구 보존 기간 21,600초(6시간)를 확인했다. 새 빈 프로젝트 생성은 Vercel 관리 조직 정책으로 거절됐고, 관리 도구의 브랜치 생성에는 스키마만 복제하는 옵션이 없어 고객 데이터를 복사하는 브랜치는 만들지 않았다. 대신 동일 `main`에 빈 `scopeflow_preview` DB를 만들었다. **DB와 자격 증명은 분리되지만 컴퓨트와 PITR은 공유한다. main을 과거 시점으로 복구하면 Preview도 영향을 받는다.** 별도 복구·리소스 경계가 필요하면 Vercel 관리 화면에서 별도 프로젝트 또는 빈 브랜치를 준비해야 한다.

Preview 앱과 마이그레이션은 현재 Preview 전용 DB 소유 계정을 사용한다. 별도 런타임 계정 발급은 관리 도구 권한 제한으로 보류됐다. Production의 앱은 별도로 발급한 제한 계정을 사용하고 소유자 계정은 관리자 작업용으로 관리한다.

Preview 전용 인증 Secret·DB 연결·AI 키는 Vercel Backend에 Preview Secret으로 저장했다. 서비스 URL은 `codex/preview`에 지정했고, 두 Preview 프로젝트 사이 요청은 Vercel의 단기 OIDC 신원으로 인증한다. 운영 런타임은 pooled 연결, 관리자 마이그레이션과 백업은 direct 연결을 사용한다. DB 전용 도구는 DB·환경·TLS를 검증하고, 앱 실행은 서비스 URL·인증 설정도 검증한다.

## 분리 검사

Production의 Vercel 빌드는 제한 계정으로 `prisma migrate status`를 실행한다. 새 운영 마이그레이션은 관리자 실행 환경에서 배포 전에 적용한다. Preview 빌드는 전용 DB에 `prisma migrate deploy`를 실행한다. [배포·마이그레이션 절차](VERCEL_ENVIRONMENT_CUTOVER.md)

비밀 저장소에서 환경별 설정을 별개의 Git 무시 파일로 준비한다. 아래 인수는 파일 경로이며 비밀값을 명령행에 직접 넣지 않는다. 파일 값은 다른 변수 참조 없이 완전히 해석된 값이어야 한다.

```powershell
Set-Location Backend
npm run ops:check-environments -- .env.development.audit .env.preview.audit .env.production.audit
```

검사는 환경 태그·TLS, 서로 다른 DB 대상과 DB 자격 증명, 인증 Secret, AI 키를 확인한다. Neon의 pooled/direct 주소 차이로 같은 DB를 다른 DB로 오인하지 않도록 처리한다. 결과와 오류에는 비밀값을 출력하지 않는다. 검사는 실제 권한·유출 여부·백업 활성화를 증명하지 않는다.

코드의 런타임 검사와 Prisma 설정은 잘못된 환경 태그 및 비보호 원격 연결을 차단한다. 세 환경의 실제 값 대조와 Frontend의 실제 연결 대상 검증은 외부 설정 접근 후 수행해야 한다.

## 비밀값 보호와 교체

- `.env*` 전체와 `.env.example`, `.vercel`, 인증 자료, 덤프와 백업은 Git에서 제외한다.
- `node scripts/check-secrets.mjs`는 작업 트리, `--staged`는 실제 Git 인덱스의 내용을 검사한다. 비밀값을 지운 작업 트리로 이미 스테이징한 비밀값 검사를 우회할 수 없다.
- 로컬 훅: `git config core.hooksPath .githooks`. 다른 OS에서 설치할 때 `chmod +x .githooks/pre-commit`을 확인한다. GitHub Actions에도 같은 검사가 있다. 원격 필수 체크 설정은 저장소 관리자가 적용해야 한다.
- 훅을 우회하거나 Git 이력·공급자 로그에서 이미 유출된 값은 이 검사로 복구되지 않는다. 유출 가능성이 있는 DB 비밀번호·AI 키는 공급자에서 교체하고, 새 값을 해당 환경에만 저장한 뒤 연결을 검증한다.
- 인증 Secret을 운영 중 교체할 때는 Better Auth의 현재 버전과 암호화 키 회전 절차를 확인한다. 단순 덮어쓰기는 세션이나 암호화 자료에 영향을 줄 수 있다. 이 작업에서 운영 Secret을 임의로 교체하지 않는다.
- 공유 승인 토큰은 앱의 구조화 로그에서 가린다. Vercel 등 플랫폼의 URL 접근 로그와 팀 접근 권한·보관 정책은 별도로 관리한다. 고객 원문이나 전체 제공자 응답을 로그에 추가하지 않는다.

## 인증·회사별 데이터·내보내기

Better Auth 세션 확인 후 요청한 Workspace의 멤버십을 DB에서 검증한다. 회사 ID 헤더만으로 권한을 인정하지 않는다. 업무 서비스는 Workspace ID를 포함해 프로젝트와 고객을 찾고, 승인 문서는 변경 요청 절차로 보호한다. CORS와 인증의 허용 Origin 계산은 같은 함수를 사용하며, 개발 환경의 localhost 별칭만 추가 허용한다.

소유자는 **설정 → 고객 데이터 관리 → 회사 데이터 내보내기**에서 JSON을 다운로드한다. Backend도 소유자 권한을 다시 검사한다. 파일은 현재 회사의 고객, 프로젝트 원문, 질문·답변, 요구사항, 견적, Scope 이력, 변경 요청과 AI 사용 메타데이터를 포함한다. 로그인 계정·세션·비밀번호, 공유 토큰, AI 원본 진단·캐시는 제외한다. 삭제 표시된 프로젝트는 이력 보존을 위해 포함되며 `deletedAt`으로 구분한다.

내보내기는 일관된 DB 스냅샷에서 읽고 다운로드 응답에 `private, no-store`를 적용한다. 온라인 한도는 프로젝트 1,000개와 파일 4,000,000바이트이며 초과 시 일부만 내려주지 않고 별도 내보내기를 안내한다. 파일에는 고객 개인정보가 있으므로 보관·전달 권한을 제한한다. 이 JSON은 DB 전체 복구용 백업이 아니다.

## 암호화 백업과 복구 훈련

운영에서는 Neon의 복구 기능 활성화·보존 기간·접근 권한을 확인하고, 별도 암호화 백업의 스케줄과 외부 저장 위치를 설정해야 한다. 이 저장소에 코드가 있다는 사실만으로 운영 자동 백업이 켜지지는 않는다. 권장 운영 목표와 실제 계약상 보장은 구분하며, RPO·RTO·보존 기간은 별도 확정한다.

백업 도구는 관리자 PC나 보호된 작업 실행기에서 사용한다. `pg_dump`/`pg_restore`의 PostgreSQL 버전을 DB와 호환되게 설치한다. Windows에서는 실행 파일의 절대 경로를 `PG_DUMP_PATH`, `PG_RESTORE_PATH`에 지정할 수 있다.

`BACKUP_ENCRYPTION_KEY`는 비밀 저장소에서 생성한 무작위 32바이트의 base64 값이다. 아카이브와 별도로 보관하며 분실하면 복구할 수 없다. 운영·비운영 키를 구분한다. `.env` 파일에 저장하더라도 Git 제외와 OS 접근 권한을 확인한다.

```powershell
Set-Location Backend
# 보호된 비밀 저장소에서 BACKUP_ENCRYPTION_KEY를 환경 변수로 주입한 뒤 실행
npm run db:backup
npm run db:backup:verify -- backups/<생성된-파일>.sfbak
```

백업은 AES-256-GCM으로 암호화·인증되며 평문 덤프를 디스크에 쓰지 않는다. 접속 비밀번호는 자식 프로세스 환경으로 전달하며 명령행이나 로그에 출력하지 않는다. 관리형 `neon_auth`를 제외한 앱 DB를 덤프하며 현재 포함되는 업무 스키마는 `public`이다. 자체 Better Auth의 계정·세션과 고객 데이터를 포함하며 플랫폼 역할·설정은 포함하지 않는다. 새 스키마를 추가하면 백업 계정의 읽기 권한도 검토한다. 전체 브랜치 복구는 Neon PITR 절차를 사용한다. 키와 저장소 권한을 보호하며 파일 모드 설정이 Windows ACL 관리를 대체하지는 않는다.

오프라인 도구의 처리 한도는 256 MB다. 그 이상은 플랫폼 복구 또는 별도 스트리밍 백업 운영이 필요하다. 생성 후 검증하고, 보존 기간이 지난 백업의 삭제는 운영자 정책에 따라 수행한다. 이 도구는 백업을 자동 삭제하지 않는다.

```powershell
# RESTORE_DATABASE_URL은 소스와 다른, 비어 있는 로컬 복구 연습 DB를 지정
npm run db:restore:test -- backups/<검증한-파일>.sfbak
```

복원은 아카이브 인증과 PostgreSQL 아카이브 검증 후에만 실행한다. 원격 대상, 소스와 같은 DB, 기존 테이블이 있는 DB는 거절한다. `--clean`이나 기존 DB 덮어쓰기를 제공하지 않는다. 복구 후 회사별 레코드 수·승인 문서·견적·권한을 확인한다. 사고 복구에서 기존 세션과 공유 링크를 계속 쓸지는 별도 보안 판단이 필요하다.

## 운영 적용과 남은 항목

Vercel의 두 Production 도메인에 `91c242b`가 배포됐다. 운영 Backend에 변경한 제한 계정을 실제 조회에 사용함을 확인했다. Production·Preview의 Groq 키는 별도 Secret으로 지정했고 로컬 Development 키와 운영 키의 중복 여부는 미확인 상태다. 이전 배포는 당시 환경 스냅샷을 보유한다. 직전 Frontend·Backend의 고유 URL은 비로그인 요청을 Vercel 로그인으로 리디렉션했다. 과거 스냅샷 정리와 소유자 자격 증명의 회전은 별도 작업으로 남았다. [실제 적용 기록](VERCEL_ENVIRONMENT_CUTOVER.md)

Neon 관리 API로 **6시간 PITR, 자동 스냅샷 스케줄 없음, 무료 플랜, main 브랜치 보호 미설정**을 확인했다. `Expires: never`는 브랜치 만료 설정으로, 무제한 복구 보존을 뜻하지 않는다. [Neon History window](https://github.com/neondatabase/website/blob/main/content/docs/postgres/backup-restore/history-window.md)와 [브랜치 만료 안내](https://neon.com/blog/expire-neon-branches-automatically)를 구분해 확인한다. [자동 스냅샷 스케줄은 유료 플랜 기능](https://api-docs.neon.tech/reference/setsnapshotschedule)이므로 플랜 업그레이드나 과금 설정을 실행하지 않았다.

로컬 개발용 DB와 전용 비관리자 계정은 분리 생성했으며 기존 원격 데이터는 복사하거나 변경하지 않았다. 로컬의 이전 환경 파일은 Git에서 제외되는 `.data/operations/` 아래 Windows 사용자 계정에 묶인 DPAPI 암호문으로만 보관했다. 이 암호문은 외부 공유용 복구 수단이 아니다.

## 2026-11-19 적용 기록

Windows 작업 스케줄러의 `ScopeFlow - Daily Encrypted Backup`이 매일 오전 9시(KST)에 현재 사용자의 일반 권한으로 실행된다. PC가 켜져 있고 해당 사용자가 로그인해 있어야 한다. 누락된 예약은 실행 가능한 시점에 시도한다. 실행 실패 시 10분 간격으로 두 번 재시도한다.

실행기와 PostgreSQL 18 클라이언트는 Git 체크아웃과 독립된 `%LOCALAPPDATA%\ScopeFlow-Backup`에 있다. 설치 폴더는 현재 사용자 전용 ACL로 보호한다. 읽기 전용 DB 접속값과 아카이브 키는 각각 CurrentUser DPAPI 파일로 보관한다. 작업 결과는 작업 스케줄러 종료 코드와 `last-success.json`의 검증 시각으로 확인한다. 암호문은 `backups` 하위에 쌓이며 보관 기간과 별도 저장소는 미정이다. PC 분실 시 복구할 외부 사본과 키 보관은 여전히 필요하다.

실행기에 포함하는 코드는 `Backend/scripts/backup.ts`를 Node용으로 번들한 `backup.mjs`와 `Backend/scripts/run-local-backup.ps1`이다. 실행기 코드를 갱신할 때에는 독립 설치본도 갱신한 뒤 스케줄러에서 작업을 실행해 새 아카이브와 성공 시각을 확인한다. 전체 아카이브 검증은 복호화한 데이터를 PostgreSQL 도구로 끝까지 읽어 null 장치로 보낸다.

11월 17일 운영 아카이브를 사용자 전용 임시 PostgreSQL 18 클러스터에 복원했다. 6개 마이그레이션, 업무 테이블, 고객 계정·Scope 문서 존재, 외래키 검증 상태와 `pg_amcheck` 검사를 통과했다. 확인 후 임시 서버를 종료하고 데이터 디렉터리를 제거했다. 11월 19일에는 예약 작업도 실제 실행해 새 백업 생성과 전체 검증, 종료 코드 0을 확인했다.

## 공식 참고 자료

- [Vercel 환경 변수와 Secret 유형](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [Neon 브랜치 운영](https://neon.com/docs/introduction/branching)
- [Better Auth 보안·Secret 회전](https://better-auth.com/docs/reference/security)
