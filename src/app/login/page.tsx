import Link from "next/link";
import { ArrowRight, FileText, Check, GitPullRequest } from "lucide-react";
import { AuthForm } from "@/components/form";
import { Logo } from "@/components/ui";
export default async function Login({ searchParams }: { searchParams: Promise<{ signup?: string }> }) {
  const signup = (await searchParams).signup === "1";
  return <div className="auth-layout"><section className="auth-story"><Logo /><main><div className="eyebrow">LESS AMBIGUITY. BETTER PROJECTS.</div><h1>프로젝트의 시작부터<br /><em>범위는 명확하게.</em></h1><p>흩어진 고객의 요청을 정리하고, 합의한 범위를 지켜보세요. 더 좋은 프로젝트는 명확한 약속에서 시작됩니다.</p><div className="flow-steps"><span><FileText size={17} /></span><i /><span><Check size={17} /></span><i /><span><GitPullRequest size={17} /></span><ArrowRight size={18} /></div></main><footer>REQUIREMENTS → SCOPE → APPROVAL → DELIVERY</footer></section><section className="auth-content"><div className="eyebrow">YOUR PROJECT, IN SCOPE</div><h2>{signup ? "좋은 프로젝트의 시작" : "다시 만나 반가워요"}</h2><p>{signup ? "ScopeFlow와 함께 일의 범위를 명확하게 정리하세요." : "Workspace에 로그인하고 프로젝트를 이어가세요."}</p><AuthForm key={String(signup)} signup={signup} /><div className="auth-link">{signup ? "이미 계정이 있으신가요?" : "아직 계정이 없으신가요?"}<Link href={signup ? "/login" : "/login?signup=1"}>{signup ? "로그인" : "무료로 시작하기"}</Link></div></section></div>;
}
