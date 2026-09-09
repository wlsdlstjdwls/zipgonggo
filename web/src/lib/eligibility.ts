// 자격진단 — 순수 함수. 입력한 조건을 공급유형 사양(supply_type)에 하나씩 대 본다.
//
// 여기서 나오는 답은 **안내**지 심사 결과가 아니다. 실제 자격은 공고문과 기관 심사가 정한다.
// 그래서 통과/미달을 이유까지 다 적어 돌려준다 — "왜 안 되는지"를 보여야 사용자가 다음 수를 둘 수 있다.
import type { EligibilityRules, IncomeStandard, RegionTier, SupplyType } from "@/types/eligibility";

/** 예비신혼부부(혼인신고 예정)는 미혼도 기혼도 아닌 별도 상태다 — 신혼부부 유형 상당수가 이 상태를 받아 준다 */
export type Marital = "미혼" | "예비신혼부부" | "기혼";

export type Profile = {
  age: number;
  marital: Marital;
  /** 혼인 몇 년차. 기혼일 때만 본다 */
  marriedYears: number;
  /** 2세 이하 자녀. 신혼 유형의 혼인기간 제한을 면제받는 조건 */
  hasNewborn: boolean;
  household: number;
  /** 본인 월소득(원) */
  incomeSelfWon: number;
  /** 세대 합산 월소득(원) */
  incomeHouseholdWon: number;
  /** 총자산(만원) */
  assetMan: number;
  /** 자동차가액(만원). 0이면 미소유 */
  carMan: number;
  homeless: boolean;
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
  if (t.marital === "무관") return null;
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
    return { label: "혼인", ok: true, detail: "예비신혼부부(혼인신고 예정)로 신청할 수 있다" };
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

function checkAsset(t: SupplyType, p: Profile): Check | null {
  if (t.asset_limit_man === null) return null;
  return {
    label: "자산",
    ok: p.assetMan <= t.asset_limit_man,
    detail: `${t.asset_scope} 총자산 ${man(t.asset_limit_man)} 이하, 입력 ${man(p.assetMan)}`,
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

function checkHomeless(t: SupplyType, p: Profile): Check {
  return { label: "무주택", ok: p.homeless, detail: `${t.homeless_scope} 기준 무주택이어야 한다` };
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
