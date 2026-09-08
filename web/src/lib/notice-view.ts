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
export type PriceRow = { kind: string; deposit: string; rent: string; exact: [number | null, number | null] };

function pos(v: number | null): number | null {
  return v != null && v > 0 ? v : null;
}

export function priceRows(n: Notice): PriceRow[] {
  const rows: PriceRow[] = [{ kind: "기본 (공고 최소값)", deposit: wonKo(n.min_deposit), rent: wonKo(n.min_rent), exact: [n.min_deposit, n.min_rent] }];
  const down = pos(n.min_down_payment), interim = pos(n.min_interim), balance = pos(n.min_balance);
  if (down != null || interim != null || balance != null) {
    if (down != null) rows.push({ kind: "납부 구성 계약금", deposit: wonKo(down), rent: "—", exact: [down, null] });
    if (interim != null) rows.push({ kind: "납부 구성 중도금", deposit: wonKo(interim), rent: "—", exact: [interim, null] });
    if (balance != null) rows.push({ kind: "납부 구성 잔금", deposit: wonKo(balance), rent: "—", exact: [balance, null] });
  } else if (n.min_rent == null && n.min_deposit != null) {
    rows.push({ kind: "납부 구성 계약금 (10% 가정)", deposit: wonKo(Math.round(n.min_deposit * 0.1)), rent: "—", exact: [Math.round(n.min_deposit * 0.1), null] });
    rows.push({ kind: "납부 구성 잔금 (90% 가정)", deposit: wonKo(Math.round(n.min_deposit * 0.9)), rent: "—", exact: [Math.round(n.min_deposit * 0.9), null] });
  }
  if ((n.max_deposit != null && n.max_deposit !== n.min_deposit) || (n.max_rent != null && n.max_rent !== n.min_rent)) {
    rows.push({ kind: "최대 (공고 최대값)", deposit: wonKo(n.max_deposit ?? n.min_deposit), rent: wonKo(n.max_rent ?? n.min_rent), exact: [n.max_deposit ?? n.min_deposit, n.max_rent ?? n.min_rent] });
  }
  return rows;
}
