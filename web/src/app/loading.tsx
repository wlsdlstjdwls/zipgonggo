// 홈 스트리밍 폴백. searchParams 때문에 / 는 동적 렌더라 DB를 기다리는 동안 이 골격이 먼저 뜬다.
import { SkeletonGrid } from "@/components/skeleton";

export default function HomeLoading() {
  return (
    <>
      <div className="hero sk-hero">
        <h1>임대주택 모집공고 지도</h1>
        <p>LH·SH·지방공사 공고를 한곳에. 최신 공고순, 보증금·월임대료는 공고에 적힌 최소값입니다.</p>
        <div className="stat">
          {["전체", "서울 SH", "민간임대"].map((k) => (
            <div key={k}><span>{k}</span><span className="sk" style={{ width: 48, height: 24, borderRadius: 6, marginTop: 4 }} /></div>
          ))}
        </div>
      </div>
      <nav className="tabs" aria-hidden="true">
        <a className="on">전체</a><a>공공임대</a><a>민간임대</a>
      </nav>
      <div className="filters" aria-hidden="true">
        <span className="sk static" style={{ width: 150, height: 40, borderRadius: 14 }} />
        <span className="sk static" style={{ width: 150, height: 40, borderRadius: 14 }} />
        <span className="sk static" style={{ width: 64, height: 40, borderRadius: 14 }} />
      </div>
      <p className="result-count"><span className="sk" style={{ width: 60, height: 14, borderRadius: 4 }} /></p>
      <SkeletonGrid count={6} />
    </>
  );
}
