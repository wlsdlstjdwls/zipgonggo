// 공급유형 자격·배점 사양. db/migrations/0020_eligibility_rules.sql 그대로 — 화면은 읽기만 한다.

/** 소득·자산·자동차의 null은 "안 본다"는 뜻이다. 0(자동차를 아예 못 가짐)과 구분해야 한다. */
export type SupplyType = {
  code: string;
  category: string;
  name: string;
  housing_type: string | null;
  sort_order: number;
  age_min: number;
  age_max: number;
  age_exempt: string[];
  marital: "미혼" | "혼인" | "무관" | string;
  marital_max_yr: number;
  newborn_exempt: boolean;
  required_class: string[];
  homeless_scope: string;
  income_scope: string;
  income_pct: number | null;
  asset_scope: string;
  asset_limit_man: number | null;
  car_limit_man: number | null;
  region_limit: string;
  birth_bonus: boolean;
  note: string | null;
  ranking_method: string | null;
  ranks: string[];
  general_ranks: string[];
  score: Record<string, string>;
};

export type IncomeStandard = { household: number; pct: number; monthly_won: number };
export type RegionTier = { name: string; kind: "sido" | "sigungu" | string; tier: "서울" | "연접" | string };

export type EligibilityRules = {
  types: SupplyType[];
  income: IncomeStandard[];
  tiers: RegionTier[];
  incomeYear: number;
};
