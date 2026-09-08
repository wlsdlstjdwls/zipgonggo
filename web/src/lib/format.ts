// 표시용 포맷. 계산은 전부 KST 날짜 기준.
import { DDAY_SOON_DAYS, DDAY_URGENT_DAYS } from "./constants";
import type { NoticeListItem } from "@/types/notice";

const KO = "ko-KR";

export function todayKST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
}

function toUTCDate(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 오늘로부터 며칠 남았나. 음수면 지남. */
export function daysUntil(ymd: string | null): number | null {
  if (!ymd) return null;
  return Math.round((toUTCDate(ymd) - toUTCDate(todayKST())) / 86_400_000);
}

/** 11400000 → "1,140만". 단위 없는 수치. 행 금액·지도 핀·KPI처럼 숫자만 크게 쓰는 자리에. */
export function wonShort(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "0원";
  if (n < 10_000) return `${n.toLocaleString(KO)}원`;
  const eok = Math.floor(n / 100_000_000);
  const man = Math.round((n % 100_000_000) / 10_000);
  const parts: string[] = [];
  if (eok) parts.push(`${eok}억`);
  if (man) parts.push(`${man.toLocaleString(KO)}만`);
  return parts.join(" ");
}

/** 11400000 → "1,140만 원". 만 단위 미만은 원 그대로. */
export function won(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const s = wonShort(n);
  return s.endsWith("원") ? s : `${s} 원`;
}

/** 행·핀·상세 헤드라인 금액. 월임대료가 있으면 "월 24만"(보조 라벨 보증금), 전세형이면 보증금. */
export type Money = { main: string; label: string; sub: string | null };
export function moneyOf(n: Pick<NoticeListItem, "min_rent" | "min_deposit">): Money | null {
  if (n.min_rent != null) return { main: `월 ${wonShort(n.min_rent)}`, label: "월임대료", sub: n.min_deposit != null ? `보증금 ${wonShort(n.min_deposit)}` : null };
  if (n.min_deposit != null) return { main: wonShort(n.min_deposit), label: "보증금", sub: null };
  return null;
}

/** D-day 칩(56×52). num은 큰 글자, unit은 밑 라벨. tone은 색. */
export type DdayChip = { num: string; unit: string; tone: "hot" | "warn" | "soft" | "acc"; days: number | null };
export function ddayChip(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at" | "status">): DdayChip {
  const toEnd = daysUntil(n.apply_end_at);
  const toStart = daysUntil(n.apply_start_at);
  if (toEnd === null) {
    if (n.status === "접수중") return { num: "모집", unit: "진행 중", tone: "acc", days: null };
    if (n.status === "정정공고중") return { num: "정정", unit: "공고 중", tone: "warn", days: null };
    if (n.status === "접수마감") return { num: "마감", unit: "종료", tone: "soft", days: null };
    return { num: "—", unit: "일정 미정", tone: "soft", days: null };
  }
  if (toEnd < 0) return { num: "마감", unit: "종료", tone: "soft", days: toEnd };
  if (toStart !== null && toStart > 0) return { num: `D-${toStart}`, unit: "접수 시작", tone: "acc", days: toStart };
  if (toEnd === 0) return { num: "오늘", unit: "마감", tone: "hot", days: 0 };
  return { num: `D-${toEnd}`, unit: "마감", tone: toEnd <= DDAY_URGENT_DAYS ? "hot" : toEnd <= DDAY_SOON_DAYS ? "warn" : "soft", days: toEnd };
}

/** 2026-09-07 → 09.07 (행 접수기간처럼 연도가 뻔한 자리) */
export function dateMD(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  return ymd.slice(5).replace("-", ".");
}

/** 정확한 원 단위. 툴팁·표에 쓴다. */
export function wonExact(n: number | null | undefined): string {
  return num(n, "원");
}

/** 2026-09-07 → 2026.09.07 (일) */
export function dateK(ymd: string | null | undefined, withWeekday = false): string {
  if (!ymd) return "—";
  const base = ymd.replaceAll("-", ".");
  if (!withWeekday) return base;
  const w = ["일", "월", "화", "수", "목", "금", "토"][new Date(toUTCDate(ymd)).getUTCDay()];
  return `${base} (${w})`;
}

/** 1234 → "1,234" (+단위). null은 "—". */
export function num(n: number | null | undefined, unit = ""): string {
  if (n === null || n === undefined) return "—";
  return `${n.toLocaleString(KO)}${unit}`;
}

/** 건수 표기 "1,234건". 0도 표시한다. */
export function count(n: number, unit = "건"): string {
  return `${n.toLocaleString(KO)}${unit}`;
}
