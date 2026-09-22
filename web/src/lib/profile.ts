// 「내 조건」 한 벌. 세 화면이 각자 묻던 값을 여기 하나로 모은다.
//
// 전에는 자가진단(/eligibility)·공공 공고의 「내 조건에 맞는 단지」·민간임대의 「내 조건에 맞는 주택형」이
// 서로를 몰랐다. 프로필 타입이 셋(Profile · FitProfile · MinganProfile), 저장 키가 둘,
// 자가진단은 아예 저장도 안 해서 같은 사람이 같은 소득을 세 번 넣었다(사용자 지적 2026-09-22).
//
// 이 파일이 그 셋의 **공통 칸**을 들고, 어댑터가 화면 타입으로 옮겨 준다.
// 공고마다 갈리는 값(공급 구분·면적·계층·신청유형·기준 회차)은 **여기 넣지 않는다** —
// 다음 공고에 들고 가 봐야 없는 값이라 지금처럼 공고 폼의 제 저장소에 남긴다.
//
// **민감 칸은 서버로 보내지 않는다.** 장애 여부처럼 건강과 이어지는 값은 브라우저에만 둔다
// (개인정보처리방침 3항, 사용자 결정 2026-09-22). 거르는 자리는 stripSensitive 하나뿐이고,
// 서버는 그걸 믿지 않고 sanitizeProfile에서 한 번 더 떨군다.
import type { Marital, Profile } from "./eligibility";
import type { MinganClass, MinganProfile } from "./mingan-fit";
import { MINGAN_CLASSES } from "./mingan-fit";
import type { FitProfile } from "./notice-fit";
import { seoulGus } from "./notice-fit";
import type { RegionTier } from "@/types/eligibility";

const MAN = 10_000;

export type UserProfile = {
  age: number;
  marital: Marital;
  /** 혼인 몇 년차. 기혼일 때만 본다 */
  marriedYears: number;
  household: number;
  /** 본인 월소득(원) */
  incomeSelfWon: number;
  /** 세대 합산 월소득(원) */
  incomeHouseholdWon: number;
  /** 총자산(만원) */
  assetMan: number;
  /** 자동차가액(만원) */
  carMan: number;
  homeless: boolean;
  /** 자가진단 어휘의 거주지 — 시군구 이름 | "그 외 지역" | "" */
  region: string;
  /** 공고 폼 어휘의 거주지 — 서울 자치구 | "연접" | "경기기타" | "기타" | "" */
  gu: string;
  residenceYears: number;
  dual: boolean;
  /** 2023.3.28. 이후 출생 자녀 수 */
  newborns: number;
  /** 2023.3.27. 이전 출생 미성년 자녀가 있다 */
  olderMinor: boolean;
  /** 2세 이하(행복주택은 2세 미만) 자녀가 있다. 자가진단의 hasNewborn과 같은 칸이다 */
  under2: boolean;
  /** 청약 납입 회차 */
  deposits: number;
  parentsHomeless: boolean;
  classes: string[];

  // ─────────── 여기부터 서버에 올리지 않는다(건강과 이어지는 값) ───────────
  disabledSelf: boolean;
  disabledFamily: boolean;
  /** 행복주택 고령자/주거급여 칸의 「장애인 | 국가유공자 등에 해당한다」 */
  special: boolean;
};

/** 저장된 한 벌 — 값과 언제 고쳤는지. 로컬과 서버 중 어느 쪽이 최신인지 이걸로 가른다 */
export type StoredProfile = { p: UserProfile; updatedAt: string };

export const DEFAULT_PROFILE: UserProfile = {
  age: 30,
  marital: "미혼",
  marriedYears: 0,
  household: 1,
  incomeSelfWon: 300 * MAN,
  incomeHouseholdWon: 300 * MAN,
  assetMan: 15_000,
  carMan: 0,
  homeless: true,
  region: "",
  gu: "",
  residenceYears: 3,
  dual: false,
  newborns: 0,
  olderMinor: false,
  under2: false,
  deposits: 24,
  parentsHomeless: false,
  classes: ["청년"],
  disabledSelf: false,
  disabledFamily: false,
  special: false,
};

/** 서버에 올리지 않는 칸. 늘리기는 쉽고 줄이기는 어렵다 — 줄이려면 방침 3항을 먼저 고친다 */
export const SENSITIVE_KEYS = ["disabledSelf", "disabledFamily", "special"] as const satisfies readonly (keyof UserProfile)[];

/**
 * 서버에 올리지 않는 계층. 장애인과 국가유공자는 건강(상이등급)과 이어져 민감정보로 다뤄야 하고,
 * 북한이탈주민은 출신과 이어져 같은 무게로 본다. **셋 다 브라우저에는 그대로 남아** 진단은 똑같이 돈다 —
 * 서버 사본에서만 빠진다. 이 목록을 줄이려면 개인정보처리방침 3항과 별도 동의부터 손봐야 한다.
 */
export const SENSITIVE_CLASSES = ["장애인", "국가유공자", "북한이탈주민"];

const MARITALS: Marital[] = ["미혼", "예비신혼부부", "기혼"];

/** 화면의 min/max와 같은 값. 여기가 느슨하면 남이 보낸 값이 그대로 DB에 들어간다 */
const NUM_RANGE: Record<string, [number, number]> = {
  age: [0, 120],
  marriedYears: [0, 60],
  household: [1, 7],
  incomeSelfWon: [0, 100_000 * MAN],
  incomeHouseholdWon: [0, 100_000 * MAN],
  assetMan: [0, 1_000_000],
  carMan: [0, 100_000],
  residenceYears: [0, 80],
  newborns: [0, 10],
  deposits: [0, 600],
};

const MAX_CLASSES = 16;
const MAX_TEXT = 30;

function clampNum(key: string, v: unknown, fallback: number): number {
  const [lo, hi] = NUM_RANGE[key] ?? [0, Number.MAX_SAFE_INTEGER];
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function text(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length <= MAX_TEXT ? v : fallback;
}

/**
 * 어디서 온 값이든(로컬 저장소, 브라우저가 보낸 JSON) 이 문을 지나야 프로필이 된다.
 * 모르는 키는 버리고, 수치는 화면과 같은 범위로 자르고, 계층은 개수와 길이를 끊는다.
 *
 * `keepSensitive`가 false면 민감 칸과 민감 계층을 **떨군다** — 서버가 부를 때 쓴다.
 */
export function sanitizeProfile(raw: unknown, keepSensitive = true): UserProfile {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PROFILE;
  const classes = Array.isArray(o.classes)
    ? o.classes.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= MAX_TEXT).slice(0, MAX_CLASSES)
    : d.classes;
  const bool = (k: keyof UserProfile) => (typeof o[k] === "boolean" ? (o[k] as boolean) : (d[k] as boolean));
  return {
    age: clampNum("age", o.age, d.age),
    marital: MARITALS.includes(o.marital as Marital) ? (o.marital as Marital) : d.marital,
    marriedYears: clampNum("marriedYears", o.marriedYears, d.marriedYears),
    household: clampNum("household", o.household, d.household),
    incomeSelfWon: clampNum("incomeSelfWon", o.incomeSelfWon, d.incomeSelfWon),
    incomeHouseholdWon: clampNum("incomeHouseholdWon", o.incomeHouseholdWon, d.incomeHouseholdWon),
    assetMan: clampNum("assetMan", o.assetMan, d.assetMan),
    carMan: clampNum("carMan", o.carMan, d.carMan),
    homeless: bool("homeless"),
    region: text(o.region, d.region),
    gu: text(o.gu, d.gu),
    residenceYears: clampNum("residenceYears", o.residenceYears, d.residenceYears),
    dual: bool("dual"),
    newborns: clampNum("newborns", o.newborns, d.newborns),
    olderMinor: bool("olderMinor"),
    under2: bool("under2"),
    deposits: clampNum("deposits", o.deposits, d.deposits),
    parentsHomeless: bool("parentsHomeless"),
    classes: keepSensitive ? classes : classes.filter((c) => !SENSITIVE_CLASSES.includes(c)),
    disabledSelf: keepSensitive ? bool("disabledSelf") : false,
    disabledFamily: keepSensitive ? bool("disabledFamily") : false,
    special: keepSensitive ? bool("special") : false,
  };
}

/** 서버로 보낼 몸. 민감 칸과 민감 계층을 뺀 사본이다 — 원본은 그대로 브라우저에 남는다 */
export function stripSensitive(p: UserProfile): UserProfile {
  return sanitizeProfile({ ...p }, false);
}

/**
 * 서버에서 온 값을 로컬 값에 얹는다. **민감 칸은 로컬 것을 지킨다** —
 * 서버는 그 칸을 애초에 모르니 서버 값으로 덮으면 제 브라우저에 넣어 둔 값이 지워진다.
 */
export function mergeFromServer(local: UserProfile, server: UserProfile): UserProfile {
  return {
    ...server,
    disabledSelf: local.disabledSelf,
    disabledFamily: local.disabledFamily,
    special: local.special,
    classes: [...new Set([...server.classes, ...local.classes.filter((c) => SENSITIVE_CLASSES.includes(c))])],
  };
}

// ───────────────────────────── 거주지 어휘 옮기기 ─────────────────────────────
//
// 화면마다 고르는 말이 다르다.
//   자가진단  서울 자치구 | 연접 시군구 이름(광명시 등) | "그 외 지역"
//   공공 공고  서울 자치구 | "연접" | "경기기타" | "기타"
//   민간임대  서울 자치구 | "기타"
// 서울 자치구는 셋이 같은 말을 쓰지만 바깥은 정보량이 다르다. 그래서 **두 칸을 다 들고**
// 각 화면이 제 칸에 쓰고, 건너편 칸은 **애매하지 않을 때만** 따라 고친다.
// 「연접」에서 「광명시」를 되살릴 수는 없다 — 그럴 땐 건너편을 건드리지 않는 게 맞다.

/** 자가진단 거주지 → 공고 폼 거주지 */
export function regionToGu(region: string, tiers: RegionTier[]): string {
  if (!region) return "";
  const t = tiers.find((x) => x.name === region);
  if (t?.tier === "서울") return region;
  if (t?.tier === "연접") return "연접";
  return "기타";
}

/** 공고 폼 거주지 → 자가진단 거주지. 되살릴 수 없으면 null(기존 값을 지킨다) */
export function guToRegion(gu: string, tiers: RegionTier[]): string | null {
  if (!gu) return null;
  if (seoulGus(tiers).includes(gu)) return gu;
  if (gu === "기타" || gu === "경기기타") return "그 외 지역";
  return null; // "연접" — 어느 시군구인지 모른다
}

/**
 * 한쪽만 차 있는 거주지를 서로 채워 준다. 시군구 목록을 들고 있는 화면이 마운트 때 한 번 부른다 —
 * 옛 키에서 옮겨 온 값(gu만 있다)과 자가진단에서 넣은 값(region만 있다)이 서로를 모른 채 남는 걸 막는다.
 * 채울 게 없으면 null — 그때는 쓰지 않는다(쓰면 갱신 시각만 튄다).
 */
export function reconcileRegion(p: UserProfile, tiers: RegionTier[]): Partial<UserProfile> | null {
  if (p.region && !p.gu) return { gu: regionToGu(p.region, tiers) };
  if (p.gu && !p.region) {
    const region = guToRegion(p.gu, tiers);
    return region === null ? null : { region };
  }
  return null;
}

// ───────────────────────────── 화면 타입 어댑터 ─────────────────────────────

/** 공통 프로필 → 자가진단 Profile */
export function toElig(p: UserProfile): Profile {
  return {
    age: p.age,
    marital: p.marital,
    marriedYears: p.marriedYears,
    hasNewborn: p.under2,
    household: p.household,
    incomeSelfWon: p.incomeSelfWon,
    incomeHouseholdWon: p.incomeHouseholdWon,
    assetMan: p.assetMan,
    carMan: p.carMan,
    homeless: p.homeless,
    classes: p.classes,
    residence: p.region,
  };
}

/** 자가진단 Profile → 공통 프로필에 얹을 조각 */
export function fromElig(v: Profile, tiers: RegionTier[]): Partial<UserProfile> {
  return {
    age: v.age,
    marital: v.marital,
    marriedYears: v.marriedYears,
    under2: v.hasNewborn,
    household: v.household,
    incomeSelfWon: v.incomeSelfWon,
    incomeHouseholdWon: v.incomeHouseholdWon,
    assetMan: v.assetMan,
    carMan: v.carMan,
    homeless: v.homeless,
    classes: v.classes,
    region: v.residence,
    gu: regionToGu(v.residence, tiers),
  };
}

/**
 * 공통 프로필 → 공고 폼 FitProfile의 공통 칸만.
 * 공고 전용 칸(group·area·cls·applicantType·priorityClass)은 호출한 쪽이 제 공고 값으로 채운다.
 */
export function toFit(p: UserProfile): Omit<FitProfile, "group" | "area" | "cls" | "applicantType" | "priorityClass"> {
  return {
    household: p.household,
    incomeWon: p.incomeHouseholdWon,
    dual: p.dual,
    newborns: p.newborns,
    olderMinor: p.olderMinor,
    assetMan: p.assetMan,
    carMan: p.carMan,
    deposits: p.deposits,
    gu: p.gu,
    residenceYears: p.residenceYears,
    age: p.age,
    under2: p.under2,
    special: p.special,
    selfIncomeWon: p.incomeSelfWon,
    parentsHomeless: p.parentsHomeless,
    disabledSelf: p.disabledSelf,
    disabledFamily: p.disabledFamily,
  };
}

/** 공고 폼 FitProfile → 공통 프로필에 얹을 조각. 공고 전용 칸은 올리지 않는다 */
export function fromFit(v: FitProfile, tiers: RegionTier[]): Partial<UserProfile> {
  const region = guToRegion(v.gu, tiers);
  return {
    household: v.household,
    incomeHouseholdWon: v.incomeWon,
    incomeSelfWon: v.selfIncomeWon,
    dual: v.dual,
    newborns: v.newborns,
    olderMinor: v.olderMinor,
    assetMan: v.assetMan,
    carMan: v.carMan,
    deposits: v.deposits,
    gu: v.gu,
    residenceYears: v.residenceYears,
    age: v.age,
    under2: v.under2,
    special: v.special,
    parentsHomeless: v.parentsHomeless,
    disabledSelf: v.disabledSelf,
    disabledFamily: v.disabledFamily,
    ...(region === null ? {} : { region }),
  };
}

/** 공통 프로필 → 민간임대 MinganProfile. 계층은 이 화면이 아는 넷 안에서만 고른다 */
export function toMingan(p: UserProfile): MinganProfile {
  const cls = (MINGAN_CLASSES as readonly string[]).find((c) => p.classes.includes(c)) as MinganClass | undefined;
  const picked: MinganClass = cls ?? (p.marital === "미혼" ? "청년" : "신혼부부");
  const gu = p.gu && p.gu !== "연접" && p.gu !== "경기기타" ? p.gu : p.gu ? "기타" : "";
  return {
    cls: picked,
    age: p.age,
    // 신혼부부 1인 가구는 소득 한도가 무조건 넘는다 — 화면과 같은 보정을 여기서도 한 번
    household: picked === "신혼부부" && p.household < 2 ? 2 : p.household,
    incomeWon: p.incomeHouseholdWon,
    assetMan: p.assetMan,
    carMan: p.carMan,
    homeless: p.homeless,
    gu,
  };
}

/** 민간임대 MinganProfile → 공통 프로필에 얹을 조각 */
export function fromMingan(v: MinganProfile, tiers: RegionTier[], prev: UserProfile): Partial<UserProfile> {
  const region = guToRegion(v.gu, tiers);
  // 민간 화면은 서울 밖을 "기타" 하나로 뭉갠다 — 이미 "연접"·"경기기타"를 골라 둔 사람의 값을 이걸로 덮지 않는다
  const gu = v.gu === "기타" && (prev.gu === "연접" || prev.gu === "경기기타") ? prev.gu : v.gu;
  return {
    age: v.age,
    household: v.household,
    incomeHouseholdWon: v.incomeWon,
    assetMan: v.assetMan,
    carMan: v.carMan,
    homeless: v.homeless,
    gu,
    // 계층 칩은 자가진단 쪽 목록이 더 넓다 — 민간에서 고른 하나를 넣되 나머지는 그대로 둔다
    classes: [...new Set([...prev.classes.filter((c) => !(MINGAN_CLASSES as readonly string[]).includes(c)), v.cls])],
    ...(region === null ? {} : { region }),
  };
}
