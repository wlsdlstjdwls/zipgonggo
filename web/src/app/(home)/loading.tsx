// 홈 스트리밍 폴백. DB를 기다리는 동안 이 골격이 먼저 뜬다.
import { Box, SkeletonRows } from "@/components/skeleton";

export default function HomeLoading() {
  return (
    <div>
      <div className="fbar" aria-hidden="true">
        <Box w={78} h={38} r={11} /><Box w={104} h={38} r={11} /><Box w={104} h={38} r={11} /><Box w={118} h={38} r={11} />
        <Box w={196} h={30} r={999} style={{ marginLeft: "auto" }} />
      </div>
      <div className="list-top" aria-hidden="true"><Box w={180} h={18} r={5} /><Box w={44} h={13} r={4} /></div>
      <SkeletonRows count={5} />
    </div>
  );
}
