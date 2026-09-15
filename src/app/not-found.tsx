import Link from "next/link";
export default function NotFound() { return <main className="empty"><h1>페이지를 찾을 수 없습니다</h1><p>주소가 올바르지 않거나 접근 권한이 없습니다.</p><Link className="button" href="/dashboard">대시보드로 이동</Link></main>; }
