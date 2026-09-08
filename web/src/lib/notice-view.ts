// 상세 화면(공고·단지) 전용 표시 계산. 두 page.tsx가 공유한다 — 레이아웃 JSX와 분리해 여기 한 곳만 본다.
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

/** 단지 헤드라인 금액의 최소~최대 범위. notice_complex.min_*는 이미 이 단지 안 최소값이고,
    최대는 공급현황(supply)의 같은 항목 중 가장 큰 값이다 — 범위가 없으면(전부 같으면) null */
export function complexPriceRange(c: NoticeComplex, supply: NoticeSupply[]): number | null {
  const min = c.min_rent ?? c.min_deposit;
  if (min == null) return null;
  const field = c.min_rent != null ? "rent" : "deposit";
  const values = supply.map((s) => s[field]).filter((v): v is number => v != null);
  const max = values.length ? Math.max(...values) : null;
  return max != null && max > min ? max : null;
}

/** 단지 상세 「보증금과 임대료」 — 이 단지의 공급현황이 있으면 공급대상 × 공급유형별로 쪼갠다.
    공고 단위 priceRows와 달리 계약금/중도금/잔금 개념이 없어 그룹은 항상 "base"(평범한 한 줄)다. */
export function complexPriceRows(supply: NoticeSupply[]): PriceRow[] {
  return supply
    .filter((s) => s.deposit != null || s.rent != null)
    .map((s) => ({
      id: String(s.id),
      group: "base",
      label: classLabel(s),
      note: typeLabel(s),
      deposit: wonKo(s.deposit),
      rent: s.rent != null ? wonKo(s.rent) : "—",
      exact: [s.deposit, s.rent],
    }));
}
