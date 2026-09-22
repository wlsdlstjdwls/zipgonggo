// 자격진단 — 순수 함수. 입력한 조건을 공급유형 사양(supply_type)에 하나씩 대 본다.
//
// 여기서 나오는 답은 **안내**지 심사 결과가 아니다. 실제 자격은 공고문과 기관 심사가 정한다.
// 그래서 통과/미달을 이유까지 다 적어 돌려준다 — "왜 안 되는지"를 보여야 사용자가 다음 수를 둘 수 있다.
import { wonKo } from "@/lib/format";
import type { EligibilityRules, IncomeStandard, RegionTier, SupplyType } from "@/types/eligibility";

/** 예비신혼부부(혼인신고 예정)는 미혼도 기혼도 아닌 별도 상태다 — 신혼부부 유형 상당수가 이 상태를 받아 준다 */
export type Marital = "미혼" | "예비신혼부부" | "기혼";

export type Profile = {
  age: number;
  marital: Marital;
  /** 혼인 몇 년차. 기혼일 때만 본다 */
  marriedYears: number;
  /** 예비신혼부부의 혼인(신고) 예정일 YYYY-MM-DD. 안 넣었으면 "" */
  weddingAt: string;
  /** 2세 이하 자녀. 신혼 유형의 혼인기간 제한을 면제받는 조건 */
  hasNewborn: boolean;
  household: number;
  /** 본인 월소득(원) */
  incomeSelfWon: number;
  /** 세대 합산 월소득(원) */
  incomeHouseholdWon: number;
  /** 총자산(만원) */
  assetMan: number;
  /** 본인 총자산(만원). asset_scope가 「본인」인 5개 유형(대학생·청년 계열)만 이 칸을 본다 */
  assetSelfMan: number;
  /** 자동차가액(만원). 0이면 미소유 */
  carMan: number;
  /** 세대 기준 무주택 — homeless_scope가 「세대원」인 24개 유형이 본다 */
  homeless: boolean;
  /** 본인 명의 무주택 — homeless_scope가 「본인」인 8개 유형(청년 계열)이 본다.
   *  세대가 무주택이면 본인도 당연히 무주택이라, 엔진은 `homelessSelf || homeless`로 본다 */
  homelessSelf: boolean;
  /** 해당하는 계층. 유형 사양의 필수계층·나이면제조건과 같은 말을 쓴다 */
  classes: string[];
  /** 거주지 시군구 또는 시도 */
  residence: string;
};

export type Check = { label: string; ok: boolean; detail: string };
export type Verdict = { type: SupplyType; ok: boolean; checks: Check[]; incomeLimitWon: number | null };

export const HOUSEHOLD_MAX = 7;
const MAN = 10_000;

/** 사양에 실제로 쓰인 계층 이름만 모아 선택지로. 목록을 코드에 박아 두면 시드와 어긋난다. */
export function classOptions(types: SupplyType[]): string[] {
  const set = new Set<string>();
  for (const t of types) {
    for (const c of t.required_class) set.add(c);
    for (const c of t.age_exempt) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

/** 거주지가 어느 등급인지. 시군구로 먼저 찾고, 없으면 시도 단위(인천광역시)로 본다. */
export function tierOf(residence: string, tiers: RegionTier[]): string {
  const hit = tiers.find((t) => t.name === residence);
  if (hit) return hit.tier;
  const sido = tiers.find((t) => t.kind === "sido" && residence.startsWith(t.name));
  return sido ? sido.tier : "기타";
}

/** 가구원수 × % → 월소득 한도(원). 표에 없는 가구원수는 마지막 줄로 갈음한다. */
export function incomeLimit(income: IncomeStandard[], household: number, pct: number): number | null {
  const size = Math.min(Math.max(household, 1), HOUSEHOLD_MAX);
  return income.find((r) => r.household === size && r.pct === pct)?.monthly_won ?? null;
}

function incomeOf(scope: string, p: Profile): number {
  // 본인+부모 합산은 부모 소득을 따로 안 받는다 — 세대 합산으로 갈음하고 화면에서 그렇게 밝힌다
  return scope === "본인" || scope === "청년특공_분기" ? p.incomeSelfWon : p.incomeHouseholdWon;
}

function won(n: number): string {
  return `${Math.round(n / MAN).toLocaleString("ko-KR")}만 원`;
}

function man(n: number): string {
  return `${n.toLocaleString("ko-KR")}만 원`;
}

function has(list: string[], classes: string[]): boolean {
  return list.some((c) => classes.includes(c));
}

function checkAge(t: SupplyType, p: Profile): Check | null {
  const bounded = t.age_min > 0 || t.age_max < 999;
  if (!bounded) return null;
  const exempt = has(t.age_exempt, p.classes);
  const range = `${t.age_min}~${t.age_max === 999 ? "제한 없음" : `${t.age_max}세`}`;
  if (exempt) return { label: "나이", ok: true, detail: `${t.age_exempt.join(" | ")} 해당이라 나이 제한 면제` };
  const ok = p.age >= t.age_min && p.age <= t.age_max;
  return { label: "나이", ok, detail: `기준 ${range}, 입력 ${p.age}세` };
}

function checkMarital(t: SupplyType, p: Profile): Check | null {
  if (t.marital === "무관") {
    // 미혼도 기혼도 받지만 기혼이면 혼인기간을 본다 — 청년안심주택 일반공급이 그렇다
    // (「19~39세 미혼 청년 또는 혼인 7년 이내 신혼부부」가 공통 요건이고, 일반공급은 소득·지역만 안 본다).
    if (!t.marital_max_yr || p.marital !== "기혼") return null;
    const ok = p.marriedYears <= t.marital_max_yr;
    return { label: "혼인기간", ok, detail: `미혼이거나 혼인 ${t.marital_max_yr}년 이내, 입력 ${p.marriedYears}년차` };
  }
  if (t.marital === "미혼") {
    return { label: "혼인", ok: p.marital === "미혼", detail: "미혼만 신청할 수 있다" };
  }
  // 혼인 유형 — 예비신혼부부(혼인신고 예정)·한부모·신생아 가구도 받아 주는 유형이라
  // 실제 혼인 여부와 별개로 신청 자격을 준다
  const engaged = p.marital === "예비신혼부부";
  const byClass = has(["한부모", "신생아"], p.classes);
  if (p.marital !== "기혼" && !engaged && !byClass) {
    return { label: "혼인", ok: false, detail: "혼인가구(예비신혼부부와 한부모 포함)만 신청할 수 있다" };
  }
  if (engaged) {
    // 예비신혼부부는 **입주 전까지 혼인신고를 마쳐야** 자격이 선다 — 예정일을 넣었으면 그대로 적어 준다.
    // 입주지정기간은 공고마다 다르니 여기서 가르지 않는다(공고 지면이 일정을 안다)
    const when = p.weddingAt ? `혼인 예정일 ${p.weddingAt}` : "혼인신고 예정";
    return { label: "혼인", ok: true, detail: `예비신혼부부(${when})로 신청할 수 있다. 입주 전까지 혼인신고를 마쳐야 한다` };
  }
  if (!t.marital_max_yr) return { label: "혼인", ok: true, detail: "혼인기간 제한 없음" };
  if (t.newborn_exempt && p.hasNewborn) {
    return { label: "혼인기간", ok: true, detail: `2세 이하 자녀가 있어 혼인 ${t.marital_max_yr}년 제한 면제` };
  }
  const ok = byClass || p.marriedYears <= t.marital_max_yr;
  return { label: "혼인기간", ok, detail: `기준 혼인 ${t.marital_max_yr}년 이내, 입력 ${p.marriedYears}년차` };
}

function checkClass(t: SupplyType, p: Profile): Check | null {
  if (t.required_class.length === 0) return null;
  return {
    label: "계층",
    ok: has(t.required_class, p.classes),
    detail: `${t.required_class.join(" | ")} 중 하나에 해당해야 한다`,
  };
}

function checkIncome(t: SupplyType, p: Profile, limit: number | null): Check | null {
  if (t.income_pct === null || limit === null) return null;
  const mine = incomeOf(t.income_scope, p);
  const scope = t.income_scope === "본인+부모" ? "본인과 부모 합산(세대 합산으로 갈음)" : `${t.income_scope} 기준`;
  return {
    label: "소득",
    ok: mine <= limit,
    detail: `${scope} 도시근로자 ${t.income_pct}% 이하는 월 ${won(limit)}, 입력 월 ${won(mine)}`,
  };
}

/** 자산을 누구 것으로 보나. 「본인」은 청년 계열 5개뿐이고 나머지는 세대 기준이다.
 *  부모와 사는 청년이 세대 자산 때문에 청년 유형까지 떨어지던 자리다(2026-09-22 정정). */
function assetOf(scope: string, p: Profile): number {
  return scope === "본인" ? p.assetSelfMan : p.assetMan;
}

function checkAsset(t: SupplyType, p: Profile): Check | null {
  if (t.asset_limit_man === null) return null;
  const mine = assetOf(t.asset_scope, p);
  return {
    label: "자산",
    ok: mine <= t.asset_limit_man,
    detail: `${t.asset_scope} 총자산 ${man(t.asset_limit_man)} 이하, 입력 ${man(mine)}`,
  };
}

function checkCar(t: SupplyType, p: Profile): Check | null {
  if (t.car_limit_man === null) return null;
  if (t.car_limit_man === 0) {
    return { label: "자동차", ok: p.carMan === 0, detail: "자동차를 소유하지 않아야 한다" };
  }
  return {
    label: "자동차",
    ok: p.carMan <= t.car_limit_man,
    detail: `자동차가액 ${man(t.car_limit_man)} 이하, 입력 ${man(p.carMan)}`,
  };
}

/**
 * 무주택을 누구 기준으로 보나. 시드가 「본인」 8개와 「세대원」 24개로 갈라 두었는데
 * 전에는 이 칸을 안 보고 세대 기준 하나로만 판정했다 — **부모가 집을 가진 청년이
 * 청년 매입임대·행복주택 대학생까지 전부 미달로 떨어졌다**(2026-09-22 정정).
 *
 * 세대가 무주택이면 본인도 무주택이므로 `homelessSelf || homeless`로 본다.
 * 옛 저장분은 `homelessSelf`가 없어 sanitize가 `homeless` 값을 복사해 넣는다 — 판정이 그대로 유지된다.
 */
function checkHomeless(t: SupplyType, p: Profile): Check {
  const self = t.homeless_scope === "본인";
  const ok = self ? p.homelessSelf || p.homeless : p.homeless;
  const input = self
    ? `본인 명의 주택 ${p.homelessSelf || p.homeless ? "없음" : "있음"}`
    : `세대 안에 주택 ${p.homeless ? "없음" : "있음"}`;
  return { label: "무주택", ok, detail: `${t.homeless_scope} 기준 무주택이어야 한다. 입력 ${input}` };
}

function checkRegion(t: SupplyType, p: Profile, tier: string): Check | null {
  if (t.region_limit !== "서울") return null;
  return { label: "거주지", ok: tier === "서울", detail: `서울 거주자만 신청할 수 있다. 입력 ${p.residence || "미입력"}` };
}

/** 유형 하나를 진단한다. checks에는 실제로 본 항목만 담긴다 — 안 보는 기준을 통과로 적으면 오해를 부른다. */
export function diagnose(t: SupplyType, p: Profile, rules: EligibilityRules): Verdict {
  const limit = t.income_pct === null ? null : incomeLimit(rules.income, p.household, t.income_pct);
  const tier = tierOf(p.residence, rules.tiers);
  const checks = [
    checkAge(t, p),
    checkMarital(t, p),
    checkClass(t, p),
    checkHomeless(t, p),
    checkIncome(t, p, limit),
    checkAsset(t, p),
    checkCar(t, p),
    checkRegion(t, p, tier),
  ].filter((c): c is Check => c !== null);
  return { type: t, ok: checks.every((c) => c.ok), checks, incomeLimitWon: limit };
}

export function diagnoseAll(p: Profile, rules: EligibilityRules): Verdict[] {
  return rules.types.map((t) => diagnose(t, p, rules));
}

// 공고상세용 — 프로필 없이 유형 사양 자체를 문구로 보여준다. diagnose()의 조건 계산과 같은 기준을 쓰되
// 통과/미달을 매기지 않는다. null이면 그 항목은 이 유형에서 안 보는 기준이라 화면에서도 뺀다.

export function ageRuleText(t: SupplyType): string {
  const bounded = t.age_min > 0 || t.age_max < 999;
  if (!bounded) return "나이 제한 없음";
  const range = `${t.age_min}~${t.age_max === 999 ? "제한 없음" : `${t.age_max}세`}`;
  return t.age_exempt.length ? `${range} (${t.age_exempt.join("/")}은 면제)` : range;
}

export function maritalRuleText(t: SupplyType): string | null {
  if (t.marital === "무관") return t.marital_max_yr ? `미혼이거나 혼인 ${t.marital_max_yr}년 이내` : null;
  if (t.marital === "미혼") return "미혼만 신청 가능";
  const yr = t.marital_max_yr ? `혼인 ${t.marital_max_yr}년 이내` : "혼인기간 제한 없음";
  const newborn = t.newborn_exempt ? ", 2세 이하 자녀가 있으면 기간 면제" : "";
  return `${yr}${newborn} (예비신혼부부/한부모/신생아 가구 포함)`;
}

export function classRuleText(t: SupplyType): string | null {
  return t.required_class.length ? `${t.required_class.join("/")} 중 하나 해당` : null;
}

export function incomeRuleText(t: SupplyType): string | null {
  if (t.income_pct === null) return null;
  const scope = t.income_scope === "본인+부모" ? "본인+부모(세대 합산으로 갈음)" : t.income_scope;
  return `${scope} 도시근로자 월평균소득 ${t.income_pct}% 이하`;
}

export function assetRuleText(t: SupplyType): string | null {
  if (t.asset_limit_man === null) return null;
  return `${t.asset_scope} 총자산 ${wonKo(t.asset_limit_man * MAN)} 이하`;
}

export function carRuleText(t: SupplyType): string | null {
  if (t.car_limit_man === null) return null;
  if (t.car_limit_man === 0) return "자동차 소유 불가";
  return `자동차가액 ${wonKo(t.car_limit_man * MAN)} 이하`;
}

export function regionRuleText(t: SupplyType): string | null {
  return t.region_limit === "서울" ? "서울 거주자만 신청 가능" : null;
}

/** 유형 하나를 카드로 그릴 때 쓰는 라벨-문구 줄. 표(가로 스크롤)보다 카드가 모바일에서 읽기 쉽다는
 *  지적(2026-09-09)에 따라, 공고상세 신청자격은 표가 아니라 이 줄들을 쌓은 카드로 그린다. */
export function ruleLines(t: SupplyType): { label: string; text: string }[] {
  const lines: { label: string; text: string }[] = [{ label: "나이", text: ageRuleText(t) }];
  const marital = maritalRuleText(t);
  if (marital) lines.push({ label: t.marital === "혼인" ? "혼인기간" : "혼인", text: marital });
  const cls = classRuleText(t);
  if (cls) lines.push({ label: "계층", text: cls });
  lines.push({ label: "무주택", text: `${t.homeless_scope} 기준 무주택이어야 한다` });
  lines.push({ label: "소득", text: incomeRuleText(t) ?? "소득 기준 없음" });
  const asset = assetRuleText(t);
  const car = carRuleText(t);
  if (asset) lines.push({ label: "자산", text: asset });
  if (car) lines.push({ label: "자동차", text: car });
  if (!asset && !car) lines.push({ label: "자산", text: "자산/자동차 기준 없음" });
  const region = regionRuleText(t);
  if (region) lines.push({ label: "거주지", text: region });
  return lines;
}
