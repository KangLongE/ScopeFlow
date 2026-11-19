import Link from "next/link";
import { backendApi } from "@/lib/api";
import { Card, Logo, PageHeading } from "@/components/ui";
import { labels } from "@/lib/model";
import { operations } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
export const metadata = { title: "서비스 이용 안내 · 정책 초안" };
export default async function ServicePolicy() {
  const policy = await backendApi<{ credits: Record<string, number> }>("/api/v1/service-policy").catch(() => null);
  return <main className="public-wrap stack"><div className="row"><Logo /><Link className="inline-link" href="/login">로그인</Link></div>
    <PageHeading title="서비스 이용 안내" description="현재 제공 기능과 AI 사용 기준 · 유료 이용 조건 검토용 초안" />
    <div className="notice"><span>유료 요금제와 결제·자동 갱신 기능은 아직 제공하지 않습니다. 아래 유료 조건은 검토용 초안이며, 확정된 유료 계약이나 결제 약관이 아닙니다.</span></div>
    <Card title="현재 제공 기능"><div className="card-body"><p className="prose">고객·프로젝트 등록, 고객 질문과 답변, 요구사항 검토, 역할별 견적, Scope 작성과 고객 승인, 변경 요청 비교 및 승인 이력을 제공합니다. AI 결과는 담당자가 검토하는 초안이며, 고객 승인이나 확정 문서를 자동으로 대체하지 않습니다.</p></div></Card>
    <Card title="AI 사용량과 실패 시 차감"><div className="card-body"><p className="prose">Workspace와 사용자별 월 한도를 함께 적용합니다. 매월 1일 UTC에 사용 기간이 바뀌며, 실제 실행 전 화면의 필요 Credit·잔여량을 확인할 수 있습니다. 이 관리 한도는 유료 상품의 구매량이나 가격을 뜻하지 않습니다.</p>
      {policy ? <div className="table-wrap mt-5"><table><thead><tr><th>작업</th><th>Credit</th></tr></thead><tbody>{Object.entries(operations).map(([task, action]) => <tr key={action}><td>{labels[task]}</td><td>{policy.credits[action] ?? "실행 전 안내 확인"}</td></tr>)}</tbody></table></div> : <p className="form-error mt-5">현재 작업별 사용량 정책을 조회하지 못했습니다. 로그인 후 실행 전 안내를 확인해주세요.</p>}
      <ul className="policy-list"><li>성공해 검토 초안이 저장된 실행은 1회 차감합니다. 담당자가 아직 확정하지 않았다는 이유로 실패가 되지는 않습니다.</li><li>제공자 오류, 토큰 한도, 응답 형식 오류 등 확정된 실행 실패는 0 Credit이며 예약을 해제합니다.</li><li>실행 중에는 필요한 Credit을 예약합니다. 연결이 끊겨 결과를 모르는 경우 기존 실행 상태를 먼저 확인하며, 자동 재실행이나 임의 환급을 하지 않습니다.</li><li>동일 입력의 유효한 캐시 재사용은 추가 차감하지 않습니다. 사용자가 새로 실행한 작업은 별도 실행으로 안내합니다.</li></ul>
    </div></Card>
    <Card title="해지·환불 조건 초안"><div className="card-body"><p className="prose">현재 결제와 유료 구독이 없어 이 사이트에서 청구되거나 자동 갱신되는 금액은 없습니다. 유료 서비스 개시 전 다음 항목을 확정하고 별도로 고지합니다.</p><ul className="policy-list"><li>요금, 부가세 포함 여부, 결제 주기, 제공 기능, 월 Credit과 이월·소멸 기준</li><li>해지 신청 경로, 다음 자동 갱신 중단 시점, 남은 이용 기간과 데이터 내보내기·삭제 일정</li><li>중복 결제·서비스 미제공, 미사용 기간·Credit, 일부 사용한 상품의 환불 산식과 처리 기한</li><li>서비스 장애와 과오금의 확인·보상 절차, 적용 법령에 따른 청약철회·환급 권리</li></ul><p className="text-sm">구체적인 기간·공제율·환불 금액은 아직 확정하지 않았습니다. 이 초안으로 이용자의 법정 권리를 제한하지 않습니다.</p></div></Card>
    <Card title="고객 데이터와 문의"><div className="card-body"><p className="prose">Workspace별 권한으로 고객 데이터를 구분합니다. 소유자는 설정에서 회사 데이터를 JSON으로 내보낼 수 있습니다. JSON 내보내기는 운영 DB 전체 백업을 대체하지 않으며, 백업 보관 기간과 실제 운영 복구 체계는 별도로 확인해야 합니다.</p><p className="mt-5">운영자: 강태현</p><p>문의: <a className="inline-link" href="mailto:scopeflowservice@gmail.com">scopeflowservice@gmail.com</a></p><p className="text-xs mt-5">정책 초안 기준일: 2026-11-17 · 사업자등록 정보, 개인정보 보유·삭제 기간과 처리방침은 유료 서비스 개시 전 추가 확정이 필요합니다.</p></div></Card>
  </main>;
}
