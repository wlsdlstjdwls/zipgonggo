// 표시용 포맷. 계산은 전부 KST 날짜 기준.
import { DDAY_SOON_DAYS, DDAY_URGENT_DAYS } from "./constants";
import type { NoticeListItem } from "@/types/notice";

const KO = "ko-KR";

/** 접수 날짜를 공고문에서 못 읽었을 때 쓰는 한 마디. 목록·공고 상세·단지 상세가 같은 말을 한다
 *  (사용자 요청 2026-09-09: 기관 목록의 「모집중」을 날짜 자리에 대신 쓰지 말 것) */
export const NO_DATE = "원문 확인";

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
// soon = 아직 안 열린 접수(D-N 시작)에만 쓴다. 오늘 시작한 건 지금 넣을 수 있으니 접수 중과 같은 acc다(사용자 지적 2026-09-09)
export type DdayChip = {
  num: string;
  unit: string;
  tone: "hot" | "warn" | "soft" | "acc" | "soon";
  days: number | null;
  /** 지금 움직여야 하는 상태(오늘 접수 시작·모집 중·오늘 마감·마감·D-4 이내). 색을 꽉 채워 강조한다(사용자 요청 2026-09-09) */
  solid?: boolean;
};
/** 당첨자 발표일이 지났으면 접수는 이미 끝난 것이다.
 * 마이홈 API의 endDe는 「예비입주자 명부 유효기간」이 들어오는 공고가 있어(LH 예비입주자 정례모집: 접수
 * 2025-09-29~10-01인데 endDe 2029-10-01) 마감일만 보면 4년 뒤까지 접수 중으로 보인다. 발표일이 지났다는
 * 사실이 그보다 확실하다 — SH도 같은 규칙으로 status를 매긴다(사용자 지적 2026-09-15). */
export function announced(n: Pick<NoticeListItem, "announce_at">): boolean {
  const toAnnounce = daysUntil(n.announce_at);
  return toAnnounce !== null && toAnnounce < 0;
}

/** 마감인가 — 상태·마감일·발표일 셋 중 하나라도 지났으면 마감. queries.ts의 CLOSED와 같은 규칙이다. */
export function isClosed(n: Pick<NoticeListItem, "apply_end_at" | "announce_at" | "status">): boolean {
  if (n.status === "접수마감") return true;
  const toEnd = daysUntil(n.apply_end_at);
  return (toEnd !== null && toEnd < 0) || announced(n);
}

/** 공고가 지금 어느 국면에 있나. ddayChip과 **같은 규칙**으로 가른다 —
 *  칩이 「오늘 마감」이라 말하는 행이 「접수 중」 덩이에 들어가면 둘 중 하나가 거짓말이 된다.
 *  관심 공고(/my)가 이 값으로 목록을 덩이로 나눈다(사용자 요청 2026-09-22). */
export type NoticePhase = "today" | "open" | "upcoming" | "closed";

export const PHASE_ORDER: readonly NoticePhase[] = ["today", "open", "upcoming", "closed"];
export const PHASE_LABEL: Record<NoticePhase, string> = {
  today: "오늘 마감",
  open: "접수 중",
  upcoming: "접수 예정",
  closed: "마감",
};

export function noticePhase(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at" | "announce_at" | "status">): NoticePhase {
  if (isClosed(n)) return "closed";
  const toEnd = daysUntil(n.apply_end_at);
  const toStart = daysUntil(n.apply_start_at);
  // 아직 안 열린 접수가 먼저다 — 마감일이 있어도 넣을 수 없는 날은 「접수 중」이 아니다
  if (toStart !== null && toStart > 0) return "upcoming";
  if (toEnd === 0) return "today";
  if (toEnd !== null) return "open";
  // 접수 마감일을 못 읽은 공고. 기관이 말하는 상태만 남는다
  return n.status === "접수중" ? "open" : "upcoming";
}

export function ddayChip(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at" | "announce_at" | "status">): DdayChip {
  const toEnd = daysUntil(n.apply_end_at);
  const toStart = daysUntil(n.apply_start_at);
  if (announced(n)) return { num: "마감", unit: "종료", tone: "soft", days: toEnd, solid: true };
  if (toEnd === null) {
    if (n.status === "접수중") return { num: "모집", unit: "진행 중", tone: "acc", days: null, solid: true };
    if (n.status === "정정공고중") return { num: "정정", unit: "공고 중", tone: "warn", days: null, solid: true };
    if (n.status === "접수마감") return { num: "마감", unit: "종료", tone: "soft", days: null, solid: true };
    return { num: "원문", unit: "확인", tone: "soft", days: null };
  }
  if (toEnd < 0) return { num: "마감", unit: "종료", tone: "soft", days: toEnd, solid: true };
  if (toStart !== null && toStart > 0) return { num: `D-${toStart}`, unit: "접수 시작", tone: "soon", days: toStart };
  if (toEnd === 0) return { num: "오늘", unit: "마감", tone: "hot", days: 0, solid: true };
  // 오늘 접수가 열린 날은 마감 D-day보다 이 사실이 먼저다(사용자 요청 2026-09-09).
  // 단 색은 접수 중과 같은 acc — 오늘 시작도 지금 신청되는 건 매한가지다
  if (toStart === 0) return { num: "오늘", unit: "접수 시작", tone: "acc", days: toEnd, solid: true };
  // 마감이 코앞이면 숫자 칩이라도 같이 강조한다
  if (toEnd <= DDAY_URGENT_DAYS) return { num: `D-${toEnd}`, unit: "마감", tone: "hot", days: toEnd, solid: true };
  return { num: `D-${toEnd}`, unit: "마감", tone: toEnd <= DDAY_SOON_DAYS ? "warn" : "soft", days: toEnd };
}

/** 2026-09-07 → 09.07 (행 접수기간처럼 연도가 뻔한 자리) */
export function dateMD(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  return ymd.slice(5).replace("-", ".");
}

/** 정확한 원 단위. 툴팁·검증용. 표에는 wonKo를 쓴다. */
export function wonExact(n: number | null | undefined): string {
  return num(n, "원");
}

/**
 * 억·만·원 단위를 붙여 읽기 쉽게. **한 원도 버리지 않는다** — wonShort는 만 단위로 반올림하지만 이건 정확하다.
 * 109600000 → "1억 960만 원" · 24414000 → "2,441만 4,000원" · 312200 → "31만 2,200원"
 * 표처럼 금액을 나란히 놓는 자리에 쓴다(사용자 요청 2026-09-08: 109600000원보다 1억 960만 원이 읽힌다).
 */
export function wonKo(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "0원";
  const neg = n < 0;
  let rest = Math.abs(Math.round(n));
  const eok = Math.floor(rest / 100_000_000);
  rest -= eok * 100_000_000;
  const man = Math.floor(rest / 10_000);
  const one = rest - man * 10_000;
  const parts: string[] = [];
  if (eok) parts.push(`${eok.toLocaleString(KO)}억`);
  if (man) parts.push(`${man.toLocaleString(KO)}만`);
  // 마지막 토막에만 "원"을 붙인다. 만 단위로 딱 떨어지면 "… 만 원"(단위 명사라 띄어 쓴다)
  if (one) parts.push(`${one.toLocaleString(KO)}원`);
  else parts[parts.length - 1] += " 원";
  return (neg ? "-" : "") + parts.join(" ");
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

/** 별첨의 호는 "0302"처럼 층+호를 붙인 네 자리다 — 사람이 읽는 "302호"로 편다 */
export function hoText(room: string): string {
  const t = room.replace(/^0+/, "");
  return /^\d+$/.test(t) ? `${t}호` : room;
}

/**
 * 접수 상태 — 상세 헤드라인과 목록 행이 같은 문장을 쓴다(사용자 요청 2026-09-09: 접수 시작을 위에서 강조).
 * label은 크게 쓰는 한 마디, note는 그 밑 날짜 줄, live는 목록 행에 붙는 짧은 표식(없으면 null).
 */
export type ApplyPhase = {
  kind: "before" | "today-open" | "open" | "today-close" | "closed" | "none";
  label: string;
  note: string | null;
  live: string | null;
  tone: "hot" | "warn" | "acc" | "soft" | "soon";
};
export function applyPhase(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at" | "announce_at">): ApplyPhase {
  const toStart = daysUntil(n.apply_start_at);
  const toEnd = daysUntil(n.apply_end_at);
  const span = n.apply_start_at || n.apply_end_at ? `${dateK(n.apply_start_at, true)} ~ ${dateK(n.apply_end_at, true)}` : null;
  const endNote = n.apply_end_at ? `${dateK(n.apply_end_at, true)} 마감` : null;

  // 발표가 끝난 공고는 마감일이 뭐라고 적혀 있든 접수가 끝났다(위 announced 주석)
  if (announced(n)) return { kind: "closed", label: "접수 마감", note: `${dateK(n.announce_at, true)} 발표 완료`, live: null, tone: "soft" };

  // 오늘 시작은 이미 접수 중이라 acc. 같은 날 마감까지면 마감이 더 급하니 hot
  if (toStart === 0 && toEnd === 0) return { kind: "today-close", label: "오늘 접수 시작, 오늘 마감", note: span, live: "오늘 마감", tone: "hot" };
  if (toStart === 0) return { kind: "today-open", label: "오늘 접수 시작", note: span, live: "접수 중", tone: "acc" };
  if (toStart !== null && toStart > 0) return { kind: "before", label: `${toStart}일 뒤 접수 시작`, note: span, live: `D-${toStart} 시작`, tone: "soon" };
  if (toEnd === 0) return { kind: "today-close", label: "오늘 접수 마감", note: span, live: "오늘 마감", tone: "hot" };
  if (toEnd !== null && toEnd > 0) {
    return { kind: "open", label: `접수 중, ${toEnd}일 남음`, note: endNote, live: "접수 중", tone: toEnd <= DDAY_URGENT_DAYS ? "hot" : toEnd <= DDAY_SOON_DAYS ? "warn" : "acc" };
  }
  if (toEnd !== null && toEnd < 0) return { kind: "closed", label: "접수 마감", note: endNote, live: null, tone: "soft" };
  return { kind: "none", label: NO_DATE, note: "접수 기간이 공고문에 없어 기관 원문에서 확인해야 합니다", live: null, tone: "soft" };
}

/** 우측 카드용 — 접수 시작과 무관하게 항상 "마감"을 센다(사용자 요청 2026-09-09: 마감 D-day를 없애지 말 것). */
export function deadlineChip(n: Pick<NoticeListItem, "apply_start_at" | "apply_end_at" | "announce_at" | "status">): DdayChip {
  const toEnd = daysUntil(n.apply_end_at);
  if (announced(n)) return { num: "마감", unit: "종료", tone: "soft", days: toEnd };
  if (toEnd === null) return ddayChip(n);
  if (toEnd < 0) return { num: "마감", unit: "종료", tone: "soft", days: toEnd };
  if (toEnd === 0) return { num: "오늘", unit: "마감", tone: "hot", days: 0 };
  return { num: `D-${toEnd}`, unit: "마감까지", tone: toEnd <= DDAY_URGENT_DAYS ? "hot" : toEnd <= DDAY_SOON_DAYS ? "warn" : "acc", days: toEnd };
}

/** 예산 칩·목록 요약에 쓰는 짧은 금액. 만 단위 아래를 버린다 — 「5,000만」·「1억」·「30만」.
 *  wonKo는 한 원도 안 버려 칩에 넣으면 「1,558만 5,000원 이하」처럼 길어진다. 눈금 값에만 쓴다 */
export function wonStep(n: number): string {
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n - eok * 100_000_000) / 10_000);
  if (eok && man) return `${eok}억 ${man.toLocaleString(KO)}만`;
  if (eok) return `${eok}억`;
  return `${man.toLocaleString(KO)}만`;
}
