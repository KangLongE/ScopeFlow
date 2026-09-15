import { currentUser } from "@/lib/queries";
import { MutationForm } from "@/components/form";
import { Field, Logo } from "@/components/ui";
export default async function Onboarding() { await currentUser(); return <main className="onboarding"><Logo /><div className="card card-body"><div className="eyebrow">LET’S GET STARTED</div><h1>우리 팀의 Workspace</h1><p>고객과 프로젝트, 단가표를 함께 관리할 공간의 이름을 정해주세요.</p><MutationForm action="workspace.create" submit="Workspace 만들기"><Field label="Workspace 이름" name="name" required placeholder="예: 스튜디오 그로브" /></MutationForm></div></main>; }
