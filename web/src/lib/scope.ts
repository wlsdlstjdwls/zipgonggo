"use client";

// 스코프(부문+시도) — 목록의 상위 범위. 필터(유형·마감·정렬)와 분리해 세션 동안 기억한다.
// docs/url-structure.md 6차 설계. localStorage는 클라이언트 전용 — "/"의 서버 렌더(ISR)엔 절대 반영하지 않는다.
// 크롤러·공유 링크 수신자는 항상 전국 목록을 봐야 하고, 저장된 값은 사용자가 스코프 바를 직접 조작할 때만 쓰인다.
import { DEFAULT_SCOPE_SIDO, SCOPE_STORAGE_KEY } from "./constants";
import { areaPath, homePath } from "./routes";
import { isSector, type NoticeFilters, type Sector } from "@/types/notice";

export type Scope = { sector?: Sector; sido?: string };

export { DEFAULT_SCOPE_SIDO };

/** localStorage에서 마지막 스코프를 읽는다. 서버(SSR)에선 항상 빈 스코프. */
export function readScope(): Scope {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { sector?: unknown; sido?: unknown };
    return {
      sector: isSector(parsed.sector) ? parsed.sector : undefined,
      sido: typeof parsed.sido === "string" && parsed.sido ? parsed.sido : undefined,
    };
  } catch {
    return {};
  }
}

/** 사용자가 스코프를 바꿀 때만 호출 — 페이지 진입만으로는 쓰지 않는다(강제 이동 방지). */
export function writeScope(s: Scope): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 프라이빗 모드 등 저장 실패는 화면 동작에 영향 없음 — 무시
  }
}

/** "전국"으로 되돌릴 때. */
export function clearScope(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SCOPE_STORAGE_KEY);
  } catch {
    // 무시
  }
}

/** 스코프 → 경로. sido가 있으면 /area/{시도}, 없으면 "/". 유형·마감·정렬은 그대로 얹는다. */
export function scopePath(s: Scope, rest: Omit<NoticeFilters, "sector" | "sido"> = {}): string {
  const f: NoticeFilters = { ...rest, sector: s.sector };
  return s.sido ? areaPath(s.sido, f) : homePath(f);
}
