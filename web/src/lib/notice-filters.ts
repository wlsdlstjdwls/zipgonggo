// 목록 필터 ⇄ 쿼리스트링. page.tsx(searchParams)·api/notices(URLSearchParams)·NoticeFeed가 같은 규칙을 쓴다.
import { isSector, type NoticeFilters, type NoticeSort } from "@/types/notice";

const DEFAULT_SORT: NoticeSort = "posted";

/** 값 1개 꺼내기. 배열이면 첫 값, 공백은 없음으로. */
export function firstParam(v: string | string[] | null | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

/** 쿼리 → 필터. 모르는 sector·sort 값은 버린다. */
export function parseNoticeFilters(get: (key: string) => string | string[] | null | undefined): Required<Pick<NoticeFilters, "sort">> & NoticeFilters {
  const sector = firstParam(get("sector"));
  return {
    sector: isSector(sector) ? sector : undefined,
    sido: firstParam(get("sido")),
    type: firstParam(get("type")),
    sort: firstParam(get("sort")) === "deadline" ? "deadline" : DEFAULT_SORT,
    closing: firstParam(get("closing")) === "7d" ? "7d" : undefined,
    closed: firstParam(get("closed")) === "1" || undefined,
  };
}

/** 필터 → 쿼리. 기본 정렬(posted)은 URL에 적지 않는다. */
export function noticeFiltersToParams(f: NoticeFilters): URLSearchParams {
  const u = new URLSearchParams();
  if (f.sector) u.set("sector", f.sector);
  if (f.sido) u.set("sido", f.sido);
  if (f.type) u.set("type", f.type);
  if (f.sort && f.sort !== DEFAULT_SORT) u.set("sort", f.sort);
  if (f.closing) u.set("closing", f.closing);
  if (f.closed) u.set("closed", "1");
  return u;
}

export function hasFilter(f: NoticeFilters): boolean {
  return Boolean(f.sector || f.sido || f.type || f.closing || f.closed || (f.sort && f.sort !== DEFAULT_SORT));
}

/** /api/notices 용 쿼리. */
export function feedParams(f: NoticeFilters): string {
  return noticeFiltersToParams(f).toString();
}
