// 청년안심주택 민간임대(공공지원민간임대) 「내 조건」 판정 — 순수 함수.
//
// 공공 공고와 달리 공고문에서 자격 묶음(notice_eligibility)을 읽지 않는다. 사업자마다 조판이 제각각이라 파서가 붙지 않고,
// 자격 자체는 단지가 달라도 같은 제도 고정 규칙이기 때문이다. 근거는 최초모집공고의 「4 신청자격 및 당첨자 선정 방법」 절
// (홍대입구역 맹그로브창천 2026.9.8. 공고 10~13쪽, 구산역 구산주택 2026.9.10. 공고 2~3쪽에서 같은 문장을 확인했다):
//
// - 공통      모집공고일 기준 19~39세 | 미혼(신혼부부 계층은 혼인 7년 이내) | 무주택(신청자 본인) |
//             자동차(이륜차 포함) 무소유이거나 자동차가액 한도 이하
// - 특별공급  공통 + 해당 세대 월평균소득 120% 이하 + 자산 한도(청년은 본인, 신혼부부는 세대).
//             「소득순위 → 지역순위 → 추첨」 — 소득순위는 100 | 110 | 120%가 1 | 2 | 3순위,
//             지역순위는 단지 소재 자치구 1순위, 그 외 서울 2순위, 그 외 지역 3순위(대학과 직장 소재지도 인정)
// - 일반공급  공통만. 공고문 문장 그대로 「소득·지역요건 없으며 경쟁 시 무작위 전산 추첨」. 물량은 대개 8할이 여기다
//
// 해마다 바뀌는 금액(자산·자동차 한도)은 코드에 박지 않고 시드(supply_type, 청년안심주택(민간))에서 가져온다.
// 소득 기준액도 income_standard의 최신 연도 표를 그대로 쓴다 — 마감된 옛 공고에 지금 기준을 대는 셈이라 화면이 그 말을 한다.
import { wonKo } from "@/lib/format";
import type { IncomeStandard, SupplyType } from "@/types/eligibility";
import type { DepositOption, NoticeSupply } from "@/types/notice";

/** 시드에서 민간임대 자격 줄을 고르는 열쇠. supply_type.category 값 그대로 */
export const MINGAN_CATEGORY = "청년안심주택(민간)";

/** 특별공급 소득순위 — 1순위 100%, 2순위 110%, 3순위 120% */
export const MINGAN_INCOME_PCTS = [100, 110, 120] as const;

export type MinganClass = "청년" | "신혼부부";
export const MINGAN_CLASSES: readonly MinganClass[] = ["청년", "신혼부부"];

export type MinganProfile = {
  cls: MinganClass;
  age: number;
  /** 가구원 수(태아 포함). 단독 세대주면 1 */
  household: number;
  /** 해당 세대 월평균소득(원). 단독 세대주는 본인 소득 */
  incomeWon: number;
  assetMan: number;
  carMan: number;
  homeless: boolean;
  /** 거주지 자치구(서울) 또는 "기타". 대학과 직장 소재지로도 인정된다 */
  gu: string;
};

export type MinganReason = { label: string; ok: boolean | null; text: string };

export type MinganTrack = {
  key: "특별공급" | "일반공급";
  /** 이 갈래에 넣을 수 있나 */
  ok: boolean;
  /** 특별공급 소득순위(1~3). 일반공급은 순위가 없다 */
  rank: number | null;
  label: string;
  reasons: MinganReason[];
  incomeLimit: { pct: number; won: number | null } | null;
};

export type MinganVerdict = {
  /** 두 갈래에 함께 걸리는 요건 */
  common: MinganReason[];
  tracks: MinganTrack[];
  /** 특별공급 동일소득 경쟁에서만 쓰는 지역순위. 단지 자치구를 모르면 null */
  region: { rank: number; text: string } | null;
};

/** 한도 금액(만 원). null이면 그 기준을 안 본다 */
export type MinganLimits = { assetMan: number | null; carMan: number | null };

// 시드가 비었을 때 쓰는 값. 2026년 공고문의 숫자다 — 시드가 있으면 언제나 시드가 이긴다
const FALLBACK_LIMITS: Record<MinganClass, MinganLimits> = {
  청년: { assetMan: 25_100, carMan: 4_542 },
  신혼부부: { assetMan: 34_500, carMan: 4_542 },
};

const MAN = 10_000;
const HOUSEHOLD_MAX = 7;

function won(n: number): string {
  return `${Math.round(n / MAN).toLocaleString("ko-KR")}만 원`;
}

/** 만 원 단위 값을 억·만 한글 표기로. 「25,100만 원」은 한눈에 안 읽힌다 — 「2억 5,100만 원」 */
function man(n: number): string {
  return wonKo(n * MAN);
}

/** 시드에서 이 계층의 특별공급 줄. 청년은 required_class에 「청년」, 신혼부부는 「신혼」이 든다 */
export function minganType(types: SupplyType[], cls: MinganClass): SupplyType | null {
  const want = cls === "청년" ? /청년/ : /신혼/;
  return types.find((t) => t.category === MINGAN_CATEGORY && t.required_class.some((c) => want.test(c))) ?? null;
}

export function minganLimits(types: SupplyType[], cls: MinganClass): MinganLimits {
  const t = minganType(types, cls);
  if (!t) return FALLBACK_LIMITS[cls];
  return {
    assetMan: t.asset_limit_man ?? FALLBACK_LIMITS[cls].assetMan,
    // 일반공급까지 걸리는 기준이라 계층 줄에 없으면 다른 줄에서라도 찾는다
    carMan: t.car_limit_man ?? types.find((x) => x.category === MINGAN_CATEGORY && x.car_limit_man != null)?.car_limit_man ?? FALLBACK_LIMITS[cls].carMan,
  };
}

/** 가구원수 × % → 월소득 상한(원). 표에 없는 가구원수는 마지막 줄로 갈음한다 */
export function minganIncomeLimit(income: IncomeStandard[], household: number, pct: number): number | null {
  const h = Math.min(Math.max(household, 1), HOUSEHOLD_MAX);
  return income.find((r) => r.household === h && r.pct === pct)?.monthly_won ?? null;
}

export function isSeoulGu(gu: string): boolean {
  return gu !== "" && gu !== "기타";
}

/**
 * 판정. 공통 요건을 먼저 보고 특별공급과 일반공급 두 갈래를 따로 매긴다 —
 * 특별공급에서 떨어져도 일반공급은 열려 있다는 게 이 제도에서 제일 자주 오해받는 자리다.
 */
export function fitMingan(
  types: SupplyType[],
  income: IncomeStandard[],
  p: MinganProfile,
  complexGu?: string | null,
): MinganVerdict {
  const lim = minganLimits(types, p.cls);
  const common: MinganReason[] = [];

  const ageOk = p.age >= 19 && p.age <= 39;
  common.push({ label: "나이", ok: ageOk, text: `모집공고일 기준 19~39세, 입력 ${p.age}세` });

  common.push(
    p.cls === "청년"
      ? { label: "혼인", ok: null, text: "미혼이어야 합니다 (혼인관계증명서를 냅니다)" }
      : { label: "혼인", ok: null, text: "혼인 7년 이내이거나 예비신혼부부여야 합니다. 부부 중 한 명이 대표로 한 건만 신청합니다" },
  );

  common.push({ label: "무주택", ok: p.homeless, text: "신청자 본인이 무주택자여야 합니다 (특별공급은 입주예정 세대원 전부)" });

  const carOk = lim.carMan == null ? null : p.carMan <= lim.carMan;
  if (lim.carMan != null) {
    common.push({ label: "자동차", ok: carOk, text: `자동차를 안 가졌거나 자동차가액 ${man(lim.carMan)} 이하, 입력 ${man(p.carMan)}` });
  }

  // ok가 null인 줄(혼인)은 사용자가 스스로 확인할 몫이라 탈락시키지 않는다
  const commonOk = ageOk && p.homeless && carOk !== false;

  // ── 특별공급 — 소득순위와 자산
  const special: MinganTrack = { key: "특별공급", ok: false, rank: null, label: "미달", reasons: [], incomeLimit: null };
  let hitPct: number | null = null;
  let lastLimit: number | null = null;
  for (const [i, pct] of MINGAN_INCOME_PCTS.entries()) {
    const l = minganIncomeLimit(income, p.household, pct);
    lastLimit = l ?? lastLimit;
    if (l == null) continue;
    if (p.incomeWon <= l) {
      hitPct = pct;
      special.rank = i + 1;
      special.incomeLimit = { pct, won: l };
      break;
    }
  }
  if (hitPct != null) {
    special.reasons.push({
      label: "소득",
      ok: true,
      text: `${special.rank}순위 ${hitPct}% 이하 (${p.household}인 가구 월 ${won(special.incomeLimit!.won!)}), 입력 월 ${won(p.incomeWon)}`,
    });
  } else {
    special.reasons.push({
      label: "소득",
      ok: false,
      text: `3순위 120% 이하${lastLimit != null ? ` (${p.household}인 가구 월 ${won(lastLimit)})` : ""}를 넘습니다. 입력 월 ${won(p.incomeWon)}`,
    });
  }
  const assetOk = lim.assetMan == null ? null : p.assetMan <= lim.assetMan;
  if (lim.assetMan != null) {
    special.reasons.push({
      label: "자산",
      ok: assetOk,
      text: `${p.cls === "청년" ? "본인" : "세대"} 총자산 ${man(lim.assetMan)} 이하, 입력 ${man(p.assetMan)}`,
    });
  }
  special.ok = commonOk && hitPct != null && assetOk !== false;
  special.label = special.ok ? `특별공급 소득 ${special.rank}순위` : "특별공급 미달";
  if (!special.ok) special.rank = null;

  // ── 일반공급 — 공통 요건만 본다
  const general: MinganTrack = {
    key: "일반공급",
    ok: commonOk,
    rank: null,
    label: commonOk ? "일반공급 신청 가능 (추첨)" : "일반공급 미달",
    reasons: [{ label: "소득", ok: null, text: "일반공급은 소득과 자산, 지역 요건을 보지 않습니다. 경쟁하면 무작위 전산 추첨입니다" }],
    incomeLimit: null,
  };

  // ── 지역순위 — 특별공급에서 소득순위가 같을 때만 갈린다. 거주지를 안 고르면 매기지 않는다(3순위로 몰면 거짓말이다)
  let region: MinganVerdict["region"] = null;
  if (complexGu && p.gu) {
    const rank = p.gu === complexGu ? 1 : isSeoulGu(p.gu) ? 2 : 3;
    region = {
      rank,
      text: rank === 1 ? `단지가 있는 ${complexGu} 거주자라 1순위` : rank === 2 ? `그 외 서울 거주자라 2순위 (${complexGu} 거주자가 1순위)` : "그 외 지역이라 3순위",
    };
  }

  return { common, tracks: [special, general], region };
}

// ── 주택형 고르기 ───────────────────────────────────────────
// 민간임대 공고는 단지가 하나뿐이라(467건 중 465건) 고를 것은 단지가 아니라 주택형이다.
// 공급현황 한 줄이 「주택형 × 계층 × 특별/일반」이고 보증금과 월임대료가 거기 붙어 있다.

export type MinganPick = {
  key: string;
  supplyType: string;
  option: "특별공급" | "일반공급" | null;
  tenantClass: string;
  area: number | null;
  deposit: number | null;
  rent: number | null;
  units: number | null;
  depositOptions: DepositOption[] | null;
  /** 지금 조건으로 이 줄에 넣을 수 있나 */
  can: boolean;
};

const CLASS_WORDS = /청년|대학생|1인|신혼|부부|전체/;

/** 공급현황 줄의 공급대상이 내 계층인가. 계층이 안 적힌 줄(「전체」)과 계층 아닌 말이 든 줄은 둘 다에 보인다 */
export function minganClassMatches(tenantClass: string | null, cls: MinganClass): boolean {
  const t = tenantClass ?? "";
  if (!t || t === "전체" || !CLASS_WORDS.test(t)) return true;
  return cls === "청년" ? /청년|대학생|1인/.test(t) : /신혼|부부/.test(t);
}

function trackOf(income_option: string | null): MinganPick["option"] {
  if (!income_option) return null;
  if (income_option.includes("특별")) return "특별공급";
  if (income_option.includes("일반")) return "일반공급";
  return null;
}

/** 내 계층 줄만 추려 넣을 수 있는 것부터, 같으면 보증금이 낮은 것부터 */
export function minganPicks(supply: NoticeSupply[], p: MinganProfile, v: MinganVerdict): MinganPick[] {
  const okOf = new Map(v.tracks.map((t) => [t.key, t.ok] as const));
  const out: MinganPick[] = [];
  for (const s of supply) {
    if (!minganClassMatches(s.tenant_class, p.cls)) continue;
    const option = trackOf(s.income_option);
    // 구분이 안 적힌 줄은 어느 갈래인지 몰라 「넣을 수 있음」으로 보지 않고 판정을 비운다
    const can = option == null ? okOf.get("일반공급") === true : okOf.get(option) === true;
    out.push({
      key: `${s.id}`,
      supplyType: s.supply_type,
      option,
      tenantClass: s.tenant_class,
      area: s.area_exclusive,
      deposit: s.deposit,
      rent: s.rent,
      units: s.units_total && s.units_total > 0 ? s.units_total : null,
      depositOptions: s.deposit_options,
      can,
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.can) - Number(a.can) ||
      (a.deposit ?? Number.MAX_SAFE_INTEGER) - (b.deposit ?? Number.MAX_SAFE_INTEGER) ||
      a.supplyType.localeCompare(b.supplyType, "ko"),
  );
}

// ── 제도 일반 기준 카드 ─────────────────────────────────────
// 공고 상세의 「신청자격」 절에 쓴다. 시드의 supply_type 카드는 housing_type이 공공지원민간임대인 줄(ppmh_*)로 붙어
// 일반공급을 「자산·자동차 기준 없음」으로 적었는데, 공고문은 모든 계층에 자동차가액 한도를 건다. 그래서 여기서 직접 만든다.

export type MinganRuleCard = { title: string; sub: string; lines: { label: string; text: string }[] };

export function minganRuleCards(types: SupplyType[]): MinganRuleCard[] {
  const youth = minganLimits(types, "청년");
  const wed = minganLimits(types, "신혼부부");
  const carText = youth.carMan != null ? `자동차를 안 가졌거나 자동차가액 ${man(youth.carMan)} 이하` : "자동차가액 기준은 공고문 참조";
  return [
    {
      title: "공통",
      sub: "특별공급과 일반공급 모두",
      lines: [
        { label: "나이", text: "모집공고일 기준 19~39세" },
        { label: "혼인", text: "청년은 미혼, 신혼부부는 혼인 7년 이내 또는 예비신혼부부" },
        { label: "무주택", text: "신청자 본인 무주택 (특별공급은 입주예정 세대원 전부)" },
        { label: "자동차", text: carText },
        { label: "신청", text: "특별공급과 일반공급 중 주택형별로 한 건만" },
      ],
    },
    {
      title: "특별공급",
      sub: "공급 물량의 약 20%",
      lines: [
        { label: "소득", text: "해당 세대 월평균소득 120% 이하. 1순위 100% | 2순위 110% | 3순위 120%" },
        { label: "자산", text: `청년은 본인 총자산 ${youth.assetMan != null ? man(youth.assetMan) : "공고문 참조"} 이하, 신혼부부는 세대 ${wed.assetMan != null ? man(wed.assetMan) : "공고문 참조"} 이하` },
        { label: "지역", text: "동일 소득이면 단지 자치구 1순위, 그 외 서울 2순위, 그 외 지역 3순위 (대학과 직장 소재지도 인정)" },
        { label: "선정", text: "소득순위 → 지역순위 → 추첨" },
      ],
    },
    {
      title: "일반공급",
      sub: "공급 물량의 약 80%",
      lines: [
        { label: "소득", text: "소득 기준 없음" },
        { label: "자산", text: "자산 기준 없음. 자동차가액은 공통 기준을 봅니다" },
        { label: "지역", text: "지역 요건 없음" },
        { label: "선정", text: "무작위 전산 추첨" },
      ],
    },
  ];
}
