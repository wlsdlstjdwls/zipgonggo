// 필터 칩·셀렉트의 수량. 필터가 바뀔 때마다 클라이언트(ListStateProvider)가 다시 받는다 —
// 지역을 바꾸면 유형 수량도 그 지역 기준으로 바뀌어야 한다(사용자 지적 2026-09-09).
import { NextResponse } from "next/server";
import { API_CACHE_CONTROL } from "@/lib/constants";
import { parseNoticeFilters } from "@/lib/notice-filters";
import { listFacets } from "@/lib/queries";

// route handler는 레이아웃 상속과 별개로 명시해 둔다 — DB(us-east-1)와 리전을 맞춘다.
export const preferredRegion = "iad1";

export async function GET(req: Request) {
  const u = new URL(req.url);
  // 정렬은 수량을 바꾸지 않는다 — 캐시 키가 갈라지지 않게 여기서 떨군다
  const { sort: _drop, ...f } = parseNoticeFilters((k) => u.searchParams.get(k));
  const facets = await listFacets(f);
  return NextResponse.json(facets, { headers: { "Cache-Control": API_CACHE_CONTROL } });
}
