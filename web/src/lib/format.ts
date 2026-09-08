// 표시용 포맷. 계산은 전부 KST 날짜 기준.

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

export type DdayBadge = { label: string; tone: "urgent" | "soon" | "open" | "upcoming" | "closed" | "none" };

/** 접수 일정 → 배지. 마감 3일 이내 urgent, 7일 이내 soon. */
export function ddayBadge(start: string | null, end: string | null): DdayBadge {
  const toEnd = daysUntil(end);
  const toStart = daysUntil(start);
  if (toEnd === null) return { label: "일정 미정", tone: "none" };
  if (toEnd < 0) return { label: "마감", tone: "closed" };
  if (toStart !== null && toStart > 0) return { label: `접수 D-${toStart}`, tone: "upcoming" };
  if (toEnd === 0) return { label: "오늘 마감", tone: "urgent" };
  if (toEnd <= 3) return { label: `D-${toEnd}`, tone: "urgent" };
  if (toEnd <= 7) return { label: `D-${toEnd}`, tone: "soon" };
  return { label: `D-${toEnd}`, tone: "open" };
}

/** 11400000 → "1,140만 원". 만 단위 미만은 원 그대로. */
export function won(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "0원";
  if (n < 10_000) return `${n.toLocaleString("ko-KR")}원`;
  const eok = Math.floor(n / 100_000_000);
  const man = Math.round((n % 100_000_000) / 10_000);
  const parts: string[] = [];
  if (eok) parts.push(`${eok}억`);
  if (man) parts.push(`${man.toLocaleString("ko-KR")}만`);
  return parts.join(" ") + " 원";
}

/** 정확한 원 단위. 툴팁·표에 쓴다. */
export function wonExact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 2026-09-07 → 2026.09.07 (일) */
export function dateK(ymd: string | null | undefined, withWeekday = false): string {
  if (!ymd) return "—";
  const base = ymd.replaceAll("-", ".");
  if (!withWeekday) return base;
  const w = ["일", "월", "화", "수", "목", "금", "토"][new Date(toUTCDate(ymd)).getUTCDay()];
  return `${base} (${w})`;
}

export function num(n: number | null | undefined, unit = ""): string {
  if (n === null || n === undefined) return "—";
  return `${n.toLocaleString("ko-KR")}${unit}`;
}
