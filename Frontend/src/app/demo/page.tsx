import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, CircleDollarSign, FileCheck2, FileText, GitPullRequest, LayoutDashboard, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Badge, Card, Logo, PageHeading } from "@/components/ui";

export const metadata: Metadata = {
  title: "읽기 전용 데모",
  description: "로그인 없이 ScopeFlow의 핵심 흐름을 확인하는 읽기 전용 데모입니다.",
};

const requirements = [
  { title: "고객 문의를 프로젝트로 등록", description: "이메일과 메신저에 흩어진 요청을 하나의 프로젝트로 모읍니다.", priority: "HIGH" },
  { title: "요구사항과 제외 범위 정리", description: "무엇을 만들고 무엇을 만들지 않는지 고객과 같은 문서에서 확인합니다.", priority: "HIGH" },
  { title: "고객 승인 후 변경 요청 관리", description: "최초 합의 이후 추가 요청의 범위와 비용 영향을 비교합니다.", priority: "MEDIUM" },
];

export default function DemoPage() {
  return <div className="app-shell">
    <aside className="sidebar">
      <Logo />
      <div className="workspace-box"><div className="workspace-icon">S</div><div><strong>ScopeFlow Demo</strong><small>READ-ONLY WORKSPACE</small></div></div>
      <div className="nav-label">DEMO MENU</div>
      <nav className="main-nav" aria-label="데모 메뉴">
        <a href="#overview" className="active"><LayoutDashboard size={18} />대시보드<span className="nav-dot" /></a>
        <a href="#projects"><FileText size={18} />프로젝트</a>
        <a href="#requirements"><Check size={18} />요구사항</a>
        <a href="#scope"><FileCheck2 size={18} />Scope 문서</a>
        <a href="#changes"><GitPullRequest size={18} />변경 요청</a>
      </nav>
      <div className="sidebar-bottom"><div className="credit-box"><div className="row"><span>AI Credit</span><strong>42 / 100</strong></div><div className="progress"><span style={{ width: "42%" }} /></div><small>데모 데이터</small></div></div>
    </aside>

    <main>
      <div className="topbar"><div className="breadcrumb"><span>ScopeFlow Demo</span><ArrowRight size={13} /><strong>읽기 전용 미리보기</strong></div><div className="topbar-right"><span><ShieldCheck size={14} /> 로그인·저장 없이 확인</span><Link href="/login" className="button small secondary">실제 로그인</Link></div></div>
      <div className="content">
        <div id="overview"><PageHeading eyebrow="READ-ONLY DEMO" title="프로젝트의 범위를 한눈에" description="고객 요청부터 요구사항, Scope 승인, 변경 관리까지 ScopeFlow의 핵심 흐름을 로그인 없이 확인해보세요."><Link href="#projects" className="button">데모 둘러보기 <ArrowRight size={15} /></Link></PageHeading></div>
        <div className="notice"><ShieldCheck size={17} /><span>이 페이지는 예시 데이터만 사용합니다. 실제 계정·운영 DB와 연결되지 않으며 모든 입력과 버튼은 읽기 전용입니다.</span></div>

        <div className="stats" aria-label="데모 요약">
          {[{ label: "진행 중인 프로젝트", value: "02", note: "합의한 범위 안에서 진행 중", icon: FileText }, { label: "Scope 승인 대기", value: "01", note: "고객의 확인을 기다리고 있어요", icon: FileCheck2 }, { label: "검토할 변경 요청", value: "01", note: "작은 변경도 놓치지 않도록", icon: GitPullRequest }, { label: "이번 달 AI Credit", value: "42", unit: "/ 100", note: "데모 사용량", icon: Sparkles }].map(item => <div className="stat" key={item.label}><div className="row"><span>{item.label}</span><span className="stat-icon"><item.icon size={15} /></span></div><strong className="stat-value">{item.value}<span className="unit">{item.unit}</span></strong><small>{item.note}</small></div>)}
        </div>

        <div className="dashboard-grid" id="projects">
          <div className="stack">
            <Card title="최근 프로젝트" hint="문의부터 최종 승인까지, 진행 상황을 확인하세요."><div className="table-wrap"><table><thead><tr><th>프로젝트</th><th>고객</th><th>상태</th><th>예상 견적</th></tr></thead><tbody>
              <tr><td><div className="project-cell"><div className="project-icon"><FileText size={16} /></div><div><strong>브랜드 웹사이트 리뉴얼</strong><small>고객 요청 → Scope 승인</small></div></div></td><td>모노 스튜디오</td><td><Badge value="ACTIVE" /></td><td>₩8,400,000</td></tr>
              <tr><td><div className="project-cell"><div className="project-icon"><FileText size={16} /></div><div><strong>예약 관리 모바일 앱</strong><small>요구사항을 정리하고 있어요</small></div></div></td><td>플로우랩</td><td><Badge value="WAITING_SCOPE_APPROVAL" /></td><td>₩12,600,000</td></tr>
            </tbody></table></div><div className="card-footer"><span>데모 프로젝트 2개</span><span>명확한 범위, 건강한 프로젝트</span></div></Card>
            <Card title="요구사항" hint="AI가 정리한 내용을 담당자가 검토하고 확정합니다." className="demo-section" action={<a href="#requirements">전체 보기 <ArrowRight size={13} /></a>}><div className="activity" id="requirements">{requirements.map((item, index) => <div className="activity-item" key={item.title}><div className="activity-dot"><Check size={13} /></div><div style={{ flex: 1 }}><strong>{index + 1}. {item.title}</strong><p>{item.description}</p></div><Badge value={item.priority} /></div>)}</div></Card>
          </div>
          <div className="stack">
            <Card title="프로젝트 흐름" hint="한 곳에서 합의하고 기록합니다."><div className="flow-card" style={{ border: 0, borderRadius: 0 }}><Sparkles size={20} className="green-text" /><h3>모호한 요청을 명확한 약속으로</h3><p>고객의 요청을 구조화하고, Scope와 견적을 합의한 뒤 변경 영향까지 추적합니다.</p><div className="flow-steps"><span><FileText size={16} /></span><i /><span><Check size={16} /></span><i /><span><GitPullRequest size={16} /></span></div><span className="muted text-xs">요청 → 요구사항 → Scope → 변경 관리</span></div></Card>
            <Card title="고객·견적 요약"><div className="card-body"><div className="info-grid"><div><small>고객</small><strong>모노 스튜디오</strong></div><div><small>담당 Workspace</small><strong>ScopeFlow Demo</strong></div><div><small>예상 작업 기간</small><strong>42일</strong></div><div><small>예상 견적</small><strong>₩8,400,000</strong></div></div></div><div className="estimate-total"><div><p>현재 Scope 기준</p><strong>₩8,400,000</strong></div><CircleDollarSign className="green-text" size={23} /></div></Card>
          </div>
        </div>

        <div id="scope" className="stack" style={{ marginTop: 24 }}><Card title="Scope 문서" hint="고객과 합의한 범위, 제외 범위, 가정을 한 문서로 관리합니다."><div className="scope-paper"><div className="row"><div><div className="eyebrow">SCOPE V1 · MONO STUDIO</div><h2>브랜드 웹사이트 리뉴얼</h2></div><Badge value="WAITING_APPROVAL" /></div><div className="doc-section"><h3>포함 범위</h3><ul><li>반응형 브랜드 소개 페이지 5개</li><li>CMS 기반 공지사항·작품 관리</li><li>문의 접수 및 이메일 알림</li></ul></div><div className="doc-section"><h3>제외 범위</h3><ul><li>다국어 번역 콘텐츠 작성</li><li>외부 CRM 데이터 이관</li></ul></div><div className="doc-section"><h3>고객 확인이 필요한 내용</h3><p className="prose">최종 브랜드 가이드와 페이지별 콘텐츠를 착수 전에 전달해주세요. 범위 밖 요청은 변경 요청으로 별도 검토합니다.</p></div></div></Card></div>

        <div id="changes" className="stack" style={{ marginTop: 24 }}><Card title="변경 요청" hint="최초 Scope 이후 추가된 요청의 영향과 비용을 비교합니다."><div className="card-body"><div className="row"><div><div className="eyebrow">CHANGE REQUEST #01</div><h2>다국어 페이지를 추가하고 싶어요</h2></div><Badge value="WAITING_CLIENT_APPROVAL" /></div><p className="prose" style={{ marginTop: 18 }}>영문 페이지 5개 추가 요청입니다. 기존 Scope에는 포함되지 않아 작업 시간과 일정 영향을 별도로 검토합니다.</p><div className="info-grid" style={{ marginTop: 22 }}><div><small>범위 판정</small><div><Badge value="OUT_OF_SCOPE" /></div></div><div><small>추가 견적</small><strong>₩1,800,000</strong></div><div><small>일정 영향</small><strong>+7일</strong></div><div><small>고객 승인</small><strong>대기 중</strong></div></div></div></Card></div>

        <div className="flow-card" style={{ marginTop: 24 }}><Users size={19} className="green-text" /><h3>이 데모에서 확인할 수 있는 것</h3><p>고객 요청을 프로젝트로 정리하고, 요구사항·견적·Scope를 거쳐 변경 요청까지 연결하는 전체 제품 방향을 확인할 수 있습니다.</p><Link href="/login?signup=1" className="inline-link">실제 Workspace 시작하기 <ArrowRight size={13} /></Link></div>
        <p className="footer-note">ScopeFlow Demo · 읽기 전용 예시 데이터 · 실제 데이터와 연결되지 않습니다.</p>
      </div>
    </main>
  </div>;
}
