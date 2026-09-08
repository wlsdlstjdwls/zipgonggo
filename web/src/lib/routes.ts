// 앱 내부 경로 빌더. 경로 형식은 docs/url-structure.md — 타입 세그먼트는 영어, 식별자는 한글(인코딩).
import { noticeFiltersToParams } from "./notice-filters";
import type { NoticeFilters } from "@/types/notice";

export const ROUTES = {
  home: "/",
  notice: "/notice",
  api: "/api",
  apiNotices: "/api/notices",
} as const;

/** /notice/{slug}. slug에 한글·콜론이 들어가므로 항상 인코딩한다. */
export function noticePath(slug: string): string {
  return `${ROUTES.notice}/${encodeURIComponent(slug)}`;
}

/** 단지 세그먼트. "{단지명}-{단지코드}" — 코드는 공고 안에서만 유일하므로 공고 경로 아래에 둔다. */
export function complexSegment(c: { name: string; complex_code: string | null; id: number }): string {
  return `${c.name}-${c.complex_code ?? c.id}`;
}

/** /notice/{공고}/{단지명}-{단지코드}. docs/url-structure.md 호실 상세 자리 — 지금은 단지가 최소 단위. */
export function noticeComplexPath(noticeSlug: string, c: { name: string; complex_code: string | null; id: number }): string {
  return `${noticePath(noticeSlug)}/${encodeURIComponent(complexSegment(c))}`;
}

/** 단지 세그먼트를 이름과 코드로 되돌린다. 코드는 맨 뒤 하이픈 뒤. */
export function parseComplexSegment(seg: string): { name: string; code: string } | null {
  const i = seg.lastIndexOf("-");
  if (i <= 0 || i === seg.length - 1) return null;
  return { name: seg.slice(0, i), code: seg.slice(i + 1) };
}

/** 홈 목록 경로. 필터가 없으면 "/" 그대로. */
export function homePath(f: NoticeFilters = {}): string {
  const q = noticeFiltersToParams(f).toString();
  return q ? `${ROUTES.home}?${q}` : ROUTES.home;
}

/** 다음 페이지 API 경로. */
export function apiNoticesPath(params: string, cursor: string): string {
  const u = new URLSearchParams(params);
  u.set("cursor", cursor);
  return `${ROUTES.apiNotices}?${u.toString()}`;
}
