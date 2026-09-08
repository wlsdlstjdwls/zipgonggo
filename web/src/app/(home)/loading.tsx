// 홈 스트리밍 폴백. searchParams 때문에 / 는 동적 렌더라 DB를 기다리는 동안 이 골격이 먼저 뜬다.
import { KpiStripSkeleton } from "@/components/kpi-strip";
import { Box, SkeletonRows } from "@/components/skeleton";

export default function HomeLoading() {
  return (
    <div>
      <div className="list-hero" aria-hidden="true"><Box w={220} h={11} r={4} /><Box w={360} h={38} r={8} style={{ marginTop: 12 }} /><Box w={420} h={14} r={4} style={{ marginTop: 12 }} /></div>
      <KpiStripSkeleton box={<Box w={72} h={32} r={8} />} />
      <div className="fbar" aria-hidden="true">
        <Box w={78} h={38} r={11} /><Box w={104} h={38} r={11} /><Box w={104} h={38} r={11} /><Box w={118} h={38} r={11} />
        <Box w={196} h={30} r={999} style={{ marginLeft: "auto" }} />
      </div>
      <SkeletonRows count={5} />
    </div>
  );
}
