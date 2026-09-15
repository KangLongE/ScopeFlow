import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: { default: "ScopeFlow — 프로젝트의 범위를 명확하게", template: "%s · ScopeFlow" }, description: "고객 문의부터 요구사항, 견적, Scope 승인과 변경 관리까지 하나의 흐름으로.", robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="ko"><body>{children}</body></html>; }
