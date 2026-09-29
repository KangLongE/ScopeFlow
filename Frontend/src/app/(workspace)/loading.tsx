export default function Loading() {
  return <div className="stack skeleton" role="status" aria-label="화면을 불러오는 중"><span className="sr-only">프로젝트 정보를 불러오고 있습니다.</span><div className="skeleton-line title" /><div className="stats">{[1,2,3,4].map(i => <div className="card card-body" key={i}><div className="skeleton-line" /><div className="skeleton-line title" /></div>)}</div><div className="card card-body">{[1,2,3,4].map(i => <div className="skeleton-line" key={i} />)}</div></div>;
}
