// 홈 스트리밍 폴백. searchParams 때문에 / 는 동적 렌더라 DB를 기다리는 동안 이 골격이 먼저 뜬다.
import { Hero } from "@/components/hero";
import { Box, SkeletonGrid } from "@/components/skeleton";
import { HERO_STAT_LABELS } from "@/lib/constants";

export default function HomeLoading() {
  return (
    <>
      <Hero skeleton stats={HERO_STAT_LABELS.map((k) => <Box key={k} w={48} h={24} r={6} style={{ marginTop: 4 }} />)} />
      <nav className="tabs" aria-hidden="true">
        <a className="on">전체</a><a>공공임대</a><a>민간임대</a>
      </nav>
      <div className="filters" aria-hidden="true">
        <Box w={150} h={40} r={14} shimmer={false} />
        <Box w={150} h={40} r={14} shimmer={false} />
        <Box w={64} h={40} r={14} shimmer={false} />
      </div>
      <p className="result-count"><Box w={60} h={14} r={4} /></p>
      <SkeletonGrid />
    </>
  );
}
