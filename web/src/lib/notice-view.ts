// 상세 화면(공고·단지) 전용 표시 계산. 두 page.tsx가 공유한다 — 레이아웃 JSX와 분리해 여기 한 곳만 본다.
import { convertRange } from "./calc";
import { hoText, wonKo } from "./format";
import type { DepositOption, Notice, NoticeComplex, NoticeSupply, NoticeUnit } from "@/types/notice";

/** 공급유형 표기 — "39㎡", 주거약자용이면 "39㎡ 주거약자용" */
export function typeLabel(s: NoticeSupply): string {
  // SH는 「39」「29S」처럼 면적 반올림이 유형이다. 민간임대(youth_attach)는 「26A-1」 「D1」 같은 사업자 타입 코드라
  // 면적을 따로 앞세운다 — 코드만으로는 몇 평인지 모른다
  // 「36A」처럼 SH 꼴이어도 숫자가 전용면적(26.21)과 다르면 사업자 코드다 — 「36㎡」로 내면 면적 칸과 어긋난다
  const num = parseFloat(s.supply_type);
  const codeLike = !/^\d+(\.\d+)?[A-Za-z]?$/.test(s.supply_type)
    || (s.area_exclusive != null && Number.isFinite(num) && Math.round(num) !== Math.round(s.area_exclusive));
  if (codeLike) {
    return `${s.area_exclusive != null ? `${s.area_exclusive}㎡ ` : ""}${s.supply_type}형`;
  }
  return `${s.supply_type.replace(/[A-Za-z]$/, "")}㎡${s.accessible ? " 주거약자용" : ""}`;
}

/** 공급대상 표기 — 청년은 소득 조건까지. 민간임대는 income_option에 특별공급/일반공급이 든다.
 *  「전체」는 공고문 표에 계층이 안 적혀 파서가 비워 둔 자리다 — 모든 계층이 대상이라는 뜻이 아니므로 적지 않는다 */
export function classLabel(s: NoticeSupply): string {
  const cls = s.tenant_class === "전체" ? "" : s.tenant_class;
  return [cls, s.income_option].filter(Boolean).join(" ");
}

/** 입주시작 원문("’27.4", "2027.4", "27.4.")을 사람 말로. 「(예정)」 열이라 확정 표기가 아니면 예정으로 읽는다.
 *  못 알아보는 표기는 원문 그대로 — 없는 날짜를 지어내지 않는다(사용자 요청 2026-09-09: 확정인지 예정인지 밝힐 것) */
export function moveInLabel(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, "");
  const m = t.match(/^[’'´`]?(\d{2,4})[.\-\/](\d{1,2})/);
  if (!m) return raw;
  const y = Number(m[1]);
  const year = y < 100 ? 2000 + y : y;
  return `${year}년 ${Number(m[2])}월 예정`;
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
    계약금·잔금은 notice_supply의 실제 값(down_payment·balance, 원문 표에서 그대로 옮긴 값)이 있으면
    그 줄 바로 밑에 덧붙이고, 없고 전세형(월임대료 없음)이면 공고 단위 priceRows와 같은 10%/90% 가정치로 보여 준다.
    줄이 셋 이상이고 값이 갈리면 맨 밑에 최소/최대 두 줄을 덧댄다(사용자 요청 2026-09-09) —
    상호전환 계산기에 넣을 범위를 표에서 바로 읽으라고. 유형이 둘뿐이면 최소/최대가 위 두 줄과 완전히
    같은 값을 반복해 "같은 유형이 오르내린다"는 착시를 만들어(사용자 지적 2026-09-10) 그때는 덧대지 않는다.
    공급현황이 아예 없으면 단지 요약값(min_*)으로 대신한다. */
export function complexPriceRows(supply: NoticeSupply[], c?: NoticeComplex): PriceRow[] {
  const priced = supply.filter((s) => s.deposit != null || s.rent != null);
  const rows: PriceRow[] = [];
  for (const s of priced) {
    rows.push({
      id: String(s.id),
      group: "base",
      label: classLabel(s),
      note: typeLabel(s),
      deposit: wonKo(s.deposit),
      rent: s.rent != null ? wonKo(s.rent) : "—",
      exact: [s.deposit, s.rent],
    });
    const down = pos(s.down_payment), balance = pos(s.balance);
    if (down != null) rows.push({ id: `${s.id}-down`, group: "pay", label: "계약금", deposit: wonKo(down), rent: "—", exact: [down, null] });
    if (balance != null) rows.push({ id: `${s.id}-balance`, group: "pay", label: "잔금", deposit: wonKo(balance), rent: "—", exact: [balance, null] });
    if (down == null && balance == null && s.rent == null && s.deposit != null) {
      rows.push({ id: `${s.id}-down-est`, group: "pay", label: "계약금", note: "10% 가정", deposit: wonKo(Math.round(s.deposit * 0.1)), rent: "—", exact: [Math.round(s.deposit * 0.1), null] });
      rows.push({ id: `${s.id}-balance-est`, group: "pay", label: "잔금", note: "90% 가정", deposit: wonKo(Math.round(s.deposit * 0.9)), rent: "—", exact: [Math.round(s.deposit * 0.9), null] });
    }
  }

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
  if (priced.length < 3) return rows;

  const span = (pick: (s: NoticeSupply) => number | null): [number | null, number | null] => {
    const v = priced.map(pick).filter((x): x is number => x != null);
    return v.length ? [Math.min(...v), Math.max(...v)] : [null, null];
  };
  const [dLo, dHi] = span((s) => s.deposit);
  const [rLo, rHi] = span((s) => s.rent);
  if (dLo === dHi && rLo === rHi) return rows;   // 전부 같은 값이면 덧댈 게 없다

  rows.push(
    { id: "range-min", group: "max", label: "최소", note: "전체 유형 중", deposit: wonKo(dLo), rent: rLo != null ? wonKo(rLo) : "—", exact: [dLo, rLo] },
    { id: "range-max", group: "max", label: "최대", note: "전체 유형 중", deposit: wonKo(dHi), rent: rHi != null ? wonKo(rHi) : "—", exact: [dHi, rHi] },
  );
  return rows;
}

/** 공급현황 표가 없고 호실 목록만 있는 공고(매입임대 별첨)의 「보증금과 임대료」.
 *  호실마다 금액이 달라 단지 단위로는 범위가 답이다 — 낱 호실의 기준·전세전환·월세전환은 아래 동호수별 표가 말한다.
 *  전환 폭을 여기서 또 요약하지 않는 이유: 호실 하나만 잘못 읽혀도 최소·최대가 통째로 어긋난다. */
export function unitPriceRows(units: NoticeUnit[]): PriceRow[] {
  if (units.length === 0) return [];
  const span = (pick: (u: NoticeUnit) => number | null): [number | null, number | null] => {
    const v = units.map(pick).filter((x): x is number => x != null);
    return v.length ? [Math.min(...v), Math.max(...v)] : [null, null];
  };
  const row = (id: string, label: string, note: string | undefined, d: number | null, r: number | null): PriceRow => ({
    id, group: "base", label, note, deposit: wonKo(d), rent: r != null ? wonKo(r) : "—", exact: [d, r],
  });
  const [dLo, dHi] = span((u) => u.deposit);
  const [rLo, rHi] = span((u) => u.rent);
  if (dLo == null && rLo == null) return [];
  // 「최소」는 값이 실제로 갈릴 때만 — 한 호실짜리 집에 「기준 최소 1호 중」은 거짓 신호다(사용자 지적 2026-10-08)
  if (dLo === dHi && rLo === rHi) {
    return [units.length === 1 ? row("u-one", "이 집", undefined, dLo, rLo) : row("u-all", "모든 호실", `${units.length}호`, dLo, rLo)];
  }
  return [row("u-min", "최소", `${units.length}호 중`, dLo, rLo), row("u-max", "최대", `${units.length}호 중`, dHi, rHi)];
}

// ── 상호전환 슬라이더 (사용자 결정 2026-09-22) ─────────────────────────────────
// 최대/기본/최소 세 줄짜리 표(ConvertTable)를 걷어내고, 그 폭을 손잡이 하나로 끌게 바꿨다.
// "보기가 힘들다 — 바 같은 걸로 왼쪽 오른쪽 움직이면 최대 보증금(최소 임대료), 왼쪽일수록 최소 보증금(최대 임대료)".
//
// 값의 출처가 둘이고, 그 둘을 섞지 않는 것이 이 함수의 전부다:
//   1) 별첨 호실 목록(unit)은 전환 금액을 **공고문이 직접 적어 놨다**(deposit_jeonse·deposit_wolse).
//      이때는 규칙으로 계산하지 않는다 — 계산하면 공고문과 다른 숫자가 나온다.
//      실측(해가온 0203호): 공고문 세 점에서 역산한 이율이 연 6.7%라 calc.ts 기본값 6.0%와 다르다.
//   2) 공급현황 표(notice_supply)에는 기준 금액뿐이라 calc.ts 규칙(6.0% / 2.5%, 한도 50%)으로 양 끝을 만든다.

/** 상호전환 슬라이더 한 칸. 양 끝은 「보증금 최대」(전세전환)와 「보증금 최소」(월세전환)다 */
export type ConvertGroup = {
  id: string;
  /** 탭·셀렉트에 걸리는 이름. 칸이 하나뿐이면 안 보인다 */
  label: string;
  /** 이름 옆 보조 글자(면적·호수) */
  note: string;
  /** [보증금, 월임대료] 원 단위 */
  base: [number, number];
  /** 보증금 최대 쪽 끝 */
  max: [number, number];
  /** 보증금 최소 쪽 끝 */
  min: [number, number];
  /** 양 끝이 어디서 왔나. notice면 공고문이 적어 둔 금액, rule이면 calc.ts 규칙으로 계산한 값 */
  source: "notice" | "rule";
};

/** 별첨 호실 목록에서 — 금액이 같은 호실은 한 칸으로 묶는다(층만 다른 같은 값이 흔하다) */
function unitConvertGroups(units: NoticeUnit[]): ConvertGroup[] {
  const m = new Map<string, { u: NoticeUnit; n: number }>();
  for (const u of units) {
    if (u.deposit == null || u.rent == null) continue;
    if (u.deposit_jeonse == null || u.rent_jeonse == null) continue;
    if (u.deposit_wolse == null || u.rent_wolse == null) continue;
    const key = `${u.deposit}|${u.rent}|${u.deposit_jeonse}|${u.rent_jeonse}|${u.deposit_wolse}|${u.rent_wolse}`;
    const hit = m.get(key);
    if (hit) hit.n += 1;
    else m.set(key, { u, n: 1 });
  }
  return [...m.values()].map(({ u, n }) => ({
    id: `u${u.id}`,
    label: n > 1 ? `${hoText(u.room)} 외 ${n - 1}호` : hoText(u.room),
    note: u.area_m2 != null ? `${u.area_m2}㎡` : "",
    base: [u.deposit as number, u.rent as number],
    max: [u.deposit_jeonse as number, u.rent_jeonse as number],
    min: [u.deposit_wolse as number, u.rent_wolse as number],
    source: "notice" as const,
  }));
}

/**
 * 슬라이더에 걸 칸들. 별첨 호실 목록이 있으면 그쪽이 먼저다 — 공고문이 적어 둔 실제 금액이라서.
 * 둘 다 없거나 월임대료가 없으면(장기전세) 빈 배열이고, 화면은 기존 금액 표로 떨어진다.
 */
export function convertGroups(supply: NoticeSupply[], units: NoticeUnit[]): ConvertGroup[] {
  const fromUnits = unitConvertGroups(units);
  if (fromUnits.length) return fromUnits;
  return supply
    .filter((s) => s.deposit != null && s.deposit > 0 && s.rent != null && s.rent > 0)
    .map((s) => {
      const r = convertRange(s.deposit as number, s.rent as number);
      return {
        id: String(s.id),
        label: classLabel(s),
        note: typeLabel(s),
        base: [r.base.deposit, r.base.rent] as [number, number],
        max: [r.max.deposit, r.max.rent] as [number, number],
        min: [r.min.deposit, r.min.rent] as [number, number],
        source: "rule" as const,
      };
    });
}


/** 민간임대 보증금 비율 슬라이더(components/option-slider.tsx)의 칸 묶음 — 공급현황 한 줄이 한 칸 */
export type OptionGroup = { id: string; label: string; note: string; opts: DepositOption[] };

/** 비율 오름차순, 고정액은 맨 뒤 — optionLabels와 같은 순서 */
const byRatio = (a: DepositOption, b: DepositOption) =>
  (a.ratio ?? 1e9) - (b.ratio ?? 1e9) || a.label.localeCompare(b.label, "ko");

/** 금액이 있는 줄마다 한 칸. 공고가 그 주택형에 비율 하나만 적었거나(골드타워 36㎡는 55%뿐) 옵션 없이 기준값만 준 줄도
 *  빼지 않는다 — 빼면 그 줄 값이 사라져 예전엔 통째로 표 두 벌로 떨어졌다(2026-10-08 전수 점검, 31단지).
 *  옵션이 하나면 슬라이더가 막대를 숨기고 값만 낸다 */
export function optionGroups(supply: NoticeSupply[], hasClass: boolean): OptionGroup[] {
  return supply
    .filter((s) => s.deposit != null || (s.deposit_options ?? []).some((o) => o.deposit != null))
    .map((s) => {
      const opts = (s.deposit_options ?? []).filter((o) => o.deposit != null).sort(byRatio);
      return {
        id: String(s.id),
        label: hasClass ? classLabel(s) || typeLabel(s) : typeLabel(s),
        note: hasClass && classLabel(s) ? typeLabel(s) : "",
        opts: opts.length ? opts : [{ label: "기준", ratio: null, deposit: s.deposit, rent: s.rent }],
      };
    });
}
