// 약관 페이지도 이동 즉시 뼈대를 보여 준다 — RSC 페이로드를 받는 동안 화면이 비면
// "링크가 안 먹는다"로 읽힌다(사용자 지적 2026-09-09).
import { SkeletonLegal } from "@/components/skeleton";

export default function TermsLoading() {
  return <SkeletonLegal />;
}
