// 헤더 검색칸이 타이핑 중에 받아 가는 미리보기. /search 지면은 이 라우트를 거치지 않고 직접 조회한다.
//
// 캐시는 CDN 층에서 받는다 — 같은 말을 여러 사람이 치면 URL이 같아 한 장으로 끝난다.
// unstable_cache(데이터 캐시)로 감싸지 않는 이유는 queries.ts의 검색 절 머리글에 적어 뒀다.
import { NextResponse } from "next/server";
import { SEARCH_CACHE_CONTROL } from "@/lib/constants";
import { listAreaTypePairs, listFilterOptions, listTypeHubs, searchComplexes, searchNotices } from "@/lib/queries";
import { matchShortcuts, SEARCH_PREVIEW_LIMIT, searchTerm } from "@/lib/search";
import type { SearchResult } from "@/types/notice";

// route handler는 레이아웃 상속과 별개로 명시해 둔다 — DB(us-east-1)와 리전을 맞춘다.
export const preferredRegion = "iad1";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const term = searchTerm(raw);
  const empty: SearchResult = { q: raw, shortcuts: [], notices: [], complexes: [] };
  if (!term) return NextResponse.json(empty, { headers: { "Cache-Control": SEARCH_CACHE_CONTROL } });

  const [notices, complexes, options, pairs, hubs] = await Promise.all([
    searchNotices(term, SEARCH_PREVIEW_LIMIT),
    searchComplexes(term, SEARCH_PREVIEW_LIMIT),
    listFilterOptions(undefined),
    listAreaTypePairs(),
    listTypeHubs(),
  ]);
  const body: SearchResult = {
    q: raw,
    shortcuts: matchShortcuts(raw, { sido: options.sido, pairs, hubs }, SEARCH_PREVIEW_LIMIT),
    notices,
    complexes,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": SEARCH_CACHE_CONTROL } });
}
