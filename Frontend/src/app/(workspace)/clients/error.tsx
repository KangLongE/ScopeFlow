"use client";
import { PageError } from "@/components/page-error";
export default function ErrorPage({ retry }: { retry: () => void }) { return <PageError title="고객" retry={retry} />; }
