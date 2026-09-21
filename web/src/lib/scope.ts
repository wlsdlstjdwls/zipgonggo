"use client";

// 목록 상태(부문·시도·유형·마감·정렬)를 브라우저에 기억한다. 저장이 곧 URL을 대신한다(2026-09-09).
// localStorage는 클라이언트 전용 — 서버 렌더(ISR)엔 절대 반영하지 않는다. 크롤러·공유 링크 수신자는 항상
// 전국 목록을 받고, 저장값은 마운트 뒤 ListStateProvider가 읽어 적용한다.
import { SCOPE_STORAGE_KEY } from "./constants";
import { isSector, type NoticeClosing, type NoticeFilters, type NoticeSort } from "@/types/notice";

/** 기억 대상 = 목록 상태 전체(부문·시도·유형·마감·정렬). */
export type Scope = NoticeFilters;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 저장된 예산. 양의 정수만 — 손으로 고친 localStorage가 쿼리를 깨지 못하게 */
function money(v: unknown): number | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined;
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
      // 시도 없이 남은 시군구는 버린다 — 옛 저장값이 그럴 수 있다
      sigungu: str(p.sido) ? str(p.sigungu) : undefined,
      type: str(p.type),
      closing: p.closing === "7d" ? ("7d" as NoticeClosing) : undefined,
      sort: p.sort === "deadline" || p.sort === "rent" ? (p.sort as NoticeSort) : undefined,
      closed: p.closed === true || undefined,
      maxDeposit: money(p.maxDeposit),
      maxRent: money(p.maxRent),
    };
  } catch {
    return {};
  }
}

/** 상태가 바뀔 때마다 ListStateProvider가 호출한다. */
export function writeScope(s: Scope): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 프라이빗 모드 등 저장 실패는 화면 동작에 영향 없음 — 무시
  }
}
