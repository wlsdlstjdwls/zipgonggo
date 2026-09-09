// 상세 화면(공고·단지) 전용 표시 계산. 두 page.tsx가 공유한다 — 레이아웃 JSX와 분리해 여기 한 곳만 본다.
import { convertRange, CONVERT_LIMIT_SHARE, CONVERT_RATE_DOWN, CONVERT_RATE_UP } from "./calc";
import { wonKo } from "./format";
import type { Notice, NoticeComplex, NoticeSupply } from "@/types/notice";

/** 공급유형 표기 — "39㎡", 주거약자용이면 "39㎡ 주거약자용" */
export function typeLabel(s: NoticeSupply): string {
  return `${s.supply_type.replace(/[A-Za-z]$/, "")}㎡${s.accessible ? " 주거약자용" : ""}`;
}

/** 공급대상 표기 — 청년은 소득 조건까지 */
export function classLabel(s: NoticeSupply): string {
  return s.income_option ? `${s.tenant_class} ${s.income_option}` : s.tenant_class;
}

export function m2(v: number | null): string {
  return v == null ? "—" : `${v}㎡`;
}

/** 공용면적 = 주거공용 + 기타공용. 표에는 따로 있지만 읽는 쪽은 합으로 본다 */
export function commonArea(s: NoticeSupply): number | null {
  if (s.area_common == null && s.area_etc == null) return null;
  return Math.round(((s.area_common ?? 0) + (s.area_etc ?? 0)) * 100) / 100;
}

/** 단지 한 곳의 면적 표기. 하나뿐이면 값 하나, 범위면 "24~38㎡" */
export function areaText(c: NoticeComplex): string | null {
  if (c.area_min == null && c.area_max == null) return null;
  const lo = c.area_min ?? c.area_max;
  const hi = c.area_max ?? c.area_min;
  if (lo == null || hi == null) return null;
  return lo === hi ? `${lo}㎡` : `${lo}~${hi}㎡`;
}

// 보증금·임대료 표 — 열린 공고 데이터에서만 계산한다(하드코딩 금지, design/README.md).
// 납부 구성은 DB 값(계약금·중도금·잔금)이 있으면 그대로, 없고 전세형(월임대료 없음)이면 10%/90% 가정치로 보여 준다.
// 마이홈 API는 미기재를 0으로 주는 경우가 있어(실측 2026-09-08) 납부 구성은 0을 미기재로 본다.
// exact: 원 단위 원본. 화면은 "1억 960만 원"으로 읽히게 쓰고, 정확한 값은 마우스를 올리면 나온다
// group으로 화면이 기본/납부 구성/최대를 시각적으로 묶는다 — "납부 구성 계약금" 같은 긴 라벨을 매 줄 반복하지 않는다
export type PriceRowGroup = "base" | "pay" | "max";
export type PriceRow = { id: string; group: PriceRowGroup; label: string; note?: string; deposit: string; rent: string; exact: [number | null, number | null] };

function pos(v: number | null): number | null {
  return v != null && v > 0 ? v : null;
}

export function priceRows(n: Notice): PriceRow[] {
  const rows: PriceRow[] = [{ id: "base", group: "base", label: "기본", note: "공고 최소값", deposit: wonKo(n.min_deposit), rent: wonKo(n.min_rent), exact: [n.min_deposit, n.min_rent] }];
  const down = pos(n.min_down_payment), interim = pos(n.min_interim), balance = pos(n.min_balance);
  if (down != null || interim != null || balance != null) {
    if (down != null) rows.push({ id: "down", group: "pay", label: "계약금", deposit: wonKo(down), rent: "—", exact: [down, null] });
    if (interim != null) rows.push({ id: "interim", group: "pay", label: "중도금", deposit: wonKo(interim), rent: "—", exact: [interim, null] });
    if (balance != null) rows.push({ id: "balance", group: "pay", label: "잔금", deposit: wonKo(balance), rent: "—", exact: [balance, null] });
  } else if (n.min_rent == null && n.min_deposit != null) {
    rows.push({ id: "down-est", group: "pay", label: "계약금", note: "10% 가정", deposit: wonKo(Math.round(n.min_deposit * 0.1)), rent: "—", exact: [Math.round(n.min_deposit * 0.1), null] });
    rows.push({ id: "balance-est", group: "pay", label: "잔금", note: "90% 가정", deposit: wonKo(Math.round(n.min_deposit * 0.9)), rent: "—", exact: [Math.round(n.min_deposit * 0.9), null] });
  }
  if ((n.max_deposit != null && n.max_deposit !== n.min_deposit) || (n.max_rent != null && n.max_rent !== n.min_rent)) {
    rows.push({ id: "max", group: "max", label: "최대", note: "공고 최대값", deposit: wonKo(n.max_deposit ?? n.min_deposit), rent: wonKo(n.max_rent ?? n.min_rent), exact: [n.max_deposit ?? n.min_deposit, n.max_rent ?? n.min_rent] });
  }
  return rows;
}

/** 단지 상세 「보증금과 임대료」 — 이 단지의 공급현황이 있으면 공급대상 × 공급유형별로 쪼갠다.
    공고 단위 priceRows와 달리 계약금/중도금/잔금 개념이 없어 낱줄은 항상 "base"다.
    줄이 둘 이상이고 값이 갈리면 맨 밑에 최소/최대 두 줄을 덧댄다(사용자 요청 2026-09-09) —
    상호전환 계산기에 넣을 범위를 표에서 바로 읽으라고. 공급현황이 아예 없으면 단지 요약값(min_*)으로 대신한다. */
export function complexPriceRows(supply: NoticeSupply[], c?: NoticeComplex): PriceRow[] {
  const priced = supply.filter((s) => s.deposit != null || s.rent != null);
  const rows: PriceRow[] = priced.map((s) => ({
    id: String(s.id),
    group: "base",
    label: classLabel(s),
    note: typeLabel(s),
    deposit: wonKo(s.deposit),
    rent: s.rent != null ? wonKo(s.rent) : "—",
    exact: [s.deposit, s.rent],
  }));

  if (rows.length === 0) {
    // 첨부 표를 못 읽은 공고 — 목록·지도가 쓰는 단지 요약 최소값이라도 낸다
    if (!c || (c.min_deposit == null && c.min_rent == null)) return rows;
    return [{
      id: "complex-min",
      group: "base",
      label: "최소",
      note: "단지 요약값",
      deposit: wonKo(c.min_deposit),
      rent: c.min_rent != null ? wonKo(c.min_rent) : "—",
      exact: [c.min_deposit, c.min_rent],
    }];
  }
  if (rows.length < 2) return rows;

  const span = (pick: (s: NoticeSupply) => number | null): [number | null, number | null] => {
    const v = priced.map(pick).filter((x): x is number => x != null);
    return v.length ? [Math.min(...v), Math.max(...v)] : [null, null];
  };
  const [dLo, dHi] = span((s) => s.deposit);
  const [rLo, rHi] = span((s) => s.rent);
  if (dLo === dHi && rLo === rHi) return rows;   // 전부 같은 값이면 덧댈 게 없다

  rows.push(
    { id: "range-min", group: "max", label: "최소", note: "이 단지", deposit: wonKo(dLo), rent: rLo != null ? wonKo(rLo) : "—", exact: [dLo, rLo] },
    { id: "range-max", group: "max", label: "최대", note: "이 단지", deposit: wonKo(dHi), rent: rHi != null ? wonKo(rHi) : "—", exact: [dHi, rHi] },
  );
  return rows;
}

// 단지 상세 「보증금과 임대료」 — 공급대상 × 공급유형마다 전세전환 / 기본 / 월세전환 세 줄.
// 사용자 요청 2026-09-09: "신혼부부 전세전환·기본·월세전환 / 청년 전세전환·기본·월세전환처럼 유형별로,
// 최소 최대 몇 퍼센트까지 가능한지" — 계약 때 실제로 고를 수 있는 폭을 표에서 바로 읽게 한다.
// 계산은 lib/calc.ts(SH 별표1 역산 6.0% / 2.5%, 한도 50%)를 쓴다. 하드코딩 금액은 없다.
export type PriceScenarioKind = "max" | "base" | "min";
export type PriceScenario = {
  kind: PriceScenarioKind;
  label: string;
  deposit: string;
  rent: string;
  exact: [number | null, number | null];
  /** 기준 보증금 대비 비율(%). 기본 줄은 null */
  pct: number | null;
};
export type PriceGroup = { id: string; label: string; note: string; units: number | null; rows: PriceScenario[] };

/** 전환 한도 안내 문구에 쓰는 값 — 화면이 상수를 다시 적지 않게 여기서 한 번만 만든다 */
export const CONVERT_HINT = {
  share: Math.round(CONVERT_LIMIT_SHARE * 100),
  up: CONVERT_RATE_UP,
  down: CONVERT_RATE_DOWN,
};

/** 전환 표를 그릴 수 있는 줄만 — 보증금과 월임대료가 둘 다 있어야 성립한다(장기전세는 월임대료가 없다) */
export function complexPriceGroups(supply: NoticeSupply[]): PriceGroup[] {
  return supply
    .filter((s) => s.deposit != null && s.deposit > 0 && s.rent != null && s.rent > 0)
    .map((s) => {
      const base = s.deposit as number;
      const r = convertRange(base, s.rent as number);
      const scenario = (kind: PriceScenarioKind, label: string, c: { deposit: number; rent: number }): PriceScenario => ({
        kind,
        label,
        deposit: wonKo(c.deposit),
        rent: wonKo(c.rent),
        exact: [c.deposit, c.rent],
        pct: kind === "base" ? null : Math.round((c.deposit / base) * 100),
      });
      return {
        id: String(s.id),
        label: classLabel(s),
        note: typeLabel(s),
        units: s.units_total,
        rows: [
          scenario("max", "전세전환", r.max),
          scenario("base", "기본", r.base),
          scenario("min", "월세전환", r.min),
        ],
      };
    });
}
