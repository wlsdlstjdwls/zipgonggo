import { notFound, permanentRedirect } from "next/navigation";
import { AREA_MIN_COUNT } from "@/lib/constants";
import { listFilterOptions } from "@/lib/queries";
import { ROUTES } from "@/lib/routes";

// 시도 착지의 404·308 판정. page가 아니라 layout에서 하는 이유는 notice/[slug]/(detail)/layout.tsx 머리글 참고.
// (sido) 그룹 안에 있는 이유도 같다 — loading.tsx를 [region] 바로 밑에 두면 그 경계가 형제인
// [type](/area/{시군구}/{유형})까지 덮는다. **판정을 [region]/layout.tsx로 올리지 말 것**:
// 같은 자리에 한 단 아래에서는 시군구가 오므로 시도 목록으로 판정하면 지역×유형이 통째로 404가 된다.
export default async function AreaGuardLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ region: string }> },
) {
  const { region } = await params;
  const sido = decodeURIComponent(region);
  // unstable_cache + react cache라 page가 같은 값을 또 불러도 질의가 늘지 않는다
  const options = await listFilterOptions(undefined);
  const match = options.sido.find((o) => o.value === sido);
  if (!match) notFound();
  // 얇은 페이지는 발행하지 않는다(CLAUDE.md 4) — URL은 살려 두고 홈으로 넘긴다
  if (match.count < AREA_MIN_COUNT) permanentRedirect(ROUTES.home);
  return children;
}
