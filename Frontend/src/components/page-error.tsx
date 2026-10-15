"use client";
export function PageError({ title, retry }: { title: string; retry: () => void }) { return <div className="empty" role="alert"><h2>{title} 정보를 불러오지 못했습니다.</h2><p>빈 결과가 아니라 조회 오류입니다. 잠시 후 다시 확인해주세요.</p><button className="button secondary" type="button" onClick={retry}>다시 확인</button></div>; }
