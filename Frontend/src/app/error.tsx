"use client";
export default function ErrorPage({ retry }: { retry: () => void }) { return <div className="empty"><h1>페이지를 불러오지 못했습니다</h1><p>잠시 후 다시 시도해주세요. 문제가 계속되면 서버 연결 상태를 확인해주세요.</p><button className="button" onClick={retry}>다시 시도</button></div>; }
