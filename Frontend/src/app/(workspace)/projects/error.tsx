"use client";
import { PageError } from "@/components/page-error";
export default function ErrorPage({ retry }: { retry: () => void }) { return <PageError title="프로젝트" retry={retry} />; }
