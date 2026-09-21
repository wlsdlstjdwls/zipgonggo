// 목록 필터 ⇄ 쿼리스트링. page.tsx(searchParams)·api/notices(URLSearchParams)·NoticeFeed가 같은 규칙을 쓴다.
import { isSector, type NoticeFilters, type NoticeSort } from "@/types/notice";

const DEFAULT_SORT: NoticeSort = "posted";

function sortOf(v: string | undefined): NoticeSort {
  return v === "deadline" || v === "rent" ? v : DEFAULT_SORT;
}

/** 금액 한 칸. 양의 정수만 받는다 — 음수·소수·글자는 필터가 없는 것으로 친다 */
function money(v: string | undefined): number | undefined {
  if (!v || !/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 ? n : undefined;
}

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
    agency: firstParam(get("agency")),
    sido: firstParam(get("sido")),
    // 시도 없이 온 시군구는 버린다 — 「강서구」는 서울과 부산에 둘 다 있어 홀로는 뜻이 안 선다
    sigungu: firstParam(get("sido")) ? firstParam(get("sigungu")) : undefined,
    type: firstParam(get("type")),
    sort: sortOf(firstParam(get("sort"))),
    closing: firstParam(get("closing")) === "7d" ? "7d" : undefined,
    closed: firstParam(get("closed")) === "1" || undefined,
    maxDeposit: money(firstParam(get("dep"))),
    maxRent: money(firstParam(get("rent"))),
  };
}

/** 필터 → 쿼리. 기본 정렬(posted)은 URL에 적지 않는다. */
export function noticeFiltersToParams(f: NoticeFilters): URLSearchParams {
  const u = new URLSearchParams();
  if (f.sector) u.set("sector", f.sector);
  if (f.agency) u.set("agency", f.agency);
  if (f.sido) u.set("sido", f.sido);
  if (f.sido && f.sigungu) u.set("sigungu", f.sigungu);
  if (f.type) u.set("type", f.type);
  if (f.sort && f.sort !== DEFAULT_SORT) u.set("sort", f.sort);
  if (f.closing) u.set("closing", f.closing);
  if (f.closed) u.set("closed", "1");
  if (f.maxDeposit) u.set("dep", String(f.maxDeposit));
  if (f.maxRent) u.set("rent", String(f.maxRent));
  return u;
}

export function hasFilter(f: NoticeFilters): boolean {
  return Boolean(f.sector || f.agency || f.sido || f.sigungu || f.type || f.closing || f.closed || f.maxDeposit || f.maxRent || (f.sort && f.sort !== DEFAULT_SORT));
}

/** /api/notices 용 쿼리. */
export function feedParams(f: NoticeFilters): string {
  return noticeFiltersToParams(f).toString();
}
