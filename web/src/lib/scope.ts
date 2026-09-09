"use client";

// 스코프(부문+시도)와 필터(유형·마감·정렬)를 세션 동안 기억한다.
// docs/url-structure.md 6차 설계. localStorage는 클라이언트 전용 — "/"의 서버 렌더(ISR)엔 절대 반영하지 않는다.
// 크롤러·공유 링크 수신자는 항상 전국 목록을 받고, 저장값은 마운트 뒤 클라이언트에서만 쓰인다(ScopeSync).
import { DEFAULT_SCOPE_SIDO, SCOPE_STORAGE_KEY } from "./constants";
import { areaPath, homePath } from "./routes";
import { isSector, type NoticeClosing, type NoticeFilters, type NoticeSort } from "@/types/notice";

/** 기억 대상 = 목록 상태 전체(스코프 + 필터). URL에 실리는 값과 1:1이다. */
export type Scope = NoticeFilters;

export { DEFAULT_SCOPE_SIDO };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** localStorage에서 마지막 목록 상태를 읽는다. 서버(SSR)에선 항상 빈 값. */
export function readScope(): Scope {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      sector: isSector(p.sector) ? p.sector : undefined,
      sido: str(p.sido),
      type: str(p.type),
      closing: p.closing === "7d" ? ("7d" as NoticeClosing) : undefined,
      sort: p.sort === "deadline" ? ("deadline" as NoticeSort) : undefined,
    };
  } catch {
    return {};
  }
}

/** URL이 목록 상태를 말할 때마다 호출된다(ScopeSync). 저장 자체는 화면을 바꾸지 않는다. */
export function writeScope(s: Scope): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 프라이빗 모드 등 저장 실패는 화면 동작에 영향 없음 — 무시
  }
}

/** 목록 상태 → 경로. sido가 있으면 /area/{시도}, 없으면 "/". 나머지는 쿼리로. */
export function scopePath(s: Scope): string {
  return s.sido ? areaPath(s.sido, s) : homePath(s);
}
