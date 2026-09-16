// 공고 상세와 같은 골격. 전에는 [slug]/loading.tsx를 물려받았는데, 그 경계가 단지 페이지의
// 404 코드를 삼켜서 (detail) 그룹으로 옮겼다 — 그래서 여기 제 몫으로 한 장 둔다((detail)/layout.tsx 머리글).
import { SkeletonDetail } from "@/components/skeleton";

export default function ComplexLoading() {
  return <SkeletonDetail />;
}
