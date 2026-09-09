// 앱 내부 경로 빌더. 경로 형식은 docs/url-structure.md — 타입 세그먼트는 영어, 식별자는 한글(인코딩).
import { noticeFiltersToParams } from "./notice-filters";
import type { NoticeFilters } from "@/types/notice";

export const ROUTES = {
  home: "/",
  notice: "/notice",
  area: "/area",
  api: "/api",
  apiNotices: "/api/notices",
  apiFacets: "/api/facets",
  terms: "/terms",
  privacy: "/privacy",
} as const;

/** /notice/{slug}. slug에 한글·콜론이 들어가므로 항상 인코딩한다. */
export function noticePath(slug: string): string {
  return `${ROUTES.notice}/${encodeURIComponent(slug)}`;
}

/**
 * 단지 세그먼트. 코드가 있으면 "{단지명}-{단지코드}", 없으면 단지명 그대로.
 * DB의 id는 절대 쓰지 않는다 — 파이프라인이 단지 목록을 통째로 다시 넣으면 id가 바뀌어 URL이 죽는다(CLAUDE.md 6).
 */
export function complexSegment(c: { name: string; complex_code: string | null }): string {
  return c.complex_code ? `${c.name}-${c.complex_code}` : c.name;
}

/** /notice/{공고}/{단지명}-{단지코드}. docs/url-structure.md 호실 상세 자리 — 지금은 단지가 최소 단위. */
export function noticeComplexPath(noticeSlug: string, c: { name: string; complex_code: string | null }): string {
  return `${noticePath(noticeSlug)}/${encodeURIComponent(complexSegment(c))}`;
}

/** 홈 목록 경로. 필터가 없으면 "/" 그대로. */
export function homePath(f: NoticeFilters = {}): string {
  const q = noticeFiltersToParams(f).toString();
  return q ? `${ROUTES.home}?${q}` : ROUTES.home;
}

/**
 * /area/{시도} 스코프 착지 경로. 시도는 경로에 있으므로 f.sido는 무시하고 나머지만 쿼리로 붙인다.
 * docs/url-structure.md 6차 설계 — 스코프(부문+시도)는 경로/쿼리, 필터(유형·마감·정렬)는 쿼리만.
 */
export function areaPath(sido: string, f: NoticeFilters = {}): string {
  const { sido: _drop, ...rest } = f;
  const q = noticeFiltersToParams(rest).toString();
  const base = `${ROUTES.area}/${encodeURIComponent(sido)}`;
  return q ? `${base}?${q}` : base;
}

/** 다음 페이지 API 경로. */
export function apiNoticesPath(params: string, cursor: string): string {
  const u = new URLSearchParams(params);
  u.set("cursor", cursor);
  return `${ROUTES.apiNotices}?${u.toString()}`;
}
