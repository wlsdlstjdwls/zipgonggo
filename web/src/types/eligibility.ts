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

// ── 공고문에서 읽은 신청자격 묶음 (notice_eligibility, 0024) ──
// 모양은 pipeline/parsers/sh_eligibility.py Eligibility.as_json()과 같이 든다. 화면은 읽기만 한다.

export type EligRankRow = {
  area: string;
  rank: number | null;
  income_pct: number | null;
  dual_income_pct: number | null;
  requirement: string | null;
};
export type EligRankTable = { group: string; classes: string[]; rows: EligRankRow[] };
export type EligMatrix = { columns: string[]; rows: { area: string | null; applicant: string; pcts: (number | null)[] }[] };
export type EligAsset = { columns: string[]; rows: { label: string; values_man: (number | null)[] }[] };
export type EligIncomeTable = {
  households: number[];
  rows: { pct: number; won: (number | null)[] }[];
  verified?: boolean;
  /** 검산에 쓴 통계연도. 2025년 공고(제49차)는 2024년 통계다 — 없으면 화면은 income_standard 최신 연도로 후퇴 */
  base_year?: number;
};
export type EligSelection = {
  title: string;
  rows: { group: string | null; area: string | null; steps: string[] }[];
  tie_break: string | null;
};
export type EligScoreTable = {
  group: string | null;
  points: number[];
  items: { label: string; cells: string[]; note: string | null }[];
};
export type EligPenalties = { rows: { label: string; points: number }[]; notes: string[] };

export type NoticeEligibilityData = {
  source_pages: number[];
  rank_tables: EligRankTable[];
  bonus_conditions: string[];
  bonus_notes: string[];
  income_matrix: EligMatrix | null;
  asset: EligAsset | null;
  income_table: EligIncomeTable | null;
  selection: EligSelection[];
  score_tables: EligScoreTable[];
  penalties: EligPenalties | null;
};

export type NoticeEligibility = {
  source_pages: number[];
  data: NoticeEligibilityData;
  /** 소득표 검산(100% 기준액 × %) 통과 여부. false면 소득표 금액을 내보내지 않는다 */
  verified: boolean;
  parsed_at: string;
};
