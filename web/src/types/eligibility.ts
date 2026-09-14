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
  /** 가장 최근 장기전세 공고문에서 읽은 자격 묶음. /eligibility가 면적×순위 매트릭스를 풀 때 쓴다. 없으면 null */
  janggi?: { slug: string; title: string; data: NoticeEligibilityData } | null;
};

// ── 공고문에서 읽은 신청자격 묶음 (notice_eligibility, 0024) ──
// 모양은 pipeline/parsers/sh_eligibility.py Eligibility.as_json()과 같이 든다. 화면은 읽기만 한다.

/** 양식. janggi 장기전세(면적×순위 표) · haengbok 행복주택(계층 절) · maeip 매입임대(순위 두 줄 표) ·
 * cheongnyeon 청년 매입임대(순위 셋 표 + 신청유형 + 가점 배점표) */
export type EligKind = "janggi" | "haengbok" | "maeip" | "cheongnyeon";

export type EligRankRow = {
  /** 신청면적 라벨(장기전세). 매입임대 표는 면적 열이 없어 null */
  area: string | null;
  rank: number | null;
  income_pct: number | null;
  dual_income_pct: number | null;
  requirement: string | null;
  /** 청년 매입임대 「자격」 열(수급자가구 · 한부모가족 · 차상위계층 · 일반). 다른 양식은 없다 */
  label?: string | null;
  /** 요건 칸의 ※ 주석(인정 범위 등) */
  note?: string | null;
  /** 청년 매입임대 2·3순위 자산 기준(만 원). 1순위는 null */
  asset_man?: number | null;
  car_man?: number | null;
  /** 소득을 누구 것으로 보나 — 「본인과 부모」(2순위) · 「본인」(3순위) */
  income_scope?: string | null;
};
export type EligRankTable = { group: string; classes: string[]; rows: EligRankRow[] };
export type EligMatrix = { columns: string[]; rows: { area: string | null; applicant: string; pcts: (number | null)[] }[] };
export type EligAsset = { columns: string[]; rows: { label: string; values_man: (number | null)[] }[] };
export type EligIncomeTable = {
  households: number[];
  rows: {
    pct: number;
    won: (number | null)[];
    /** 행복주택 소득표의 적용 조건 칸(「공통 (청년계층은 …)」「신혼부부 계층 (맞벌이인 동시에 …)」). 장기전세·매입임대는 없다 */
    conditions?: string[];
  }[];
  verified?: boolean;
  /** 검산에 쓴 통계연도. 2025년 공고(제49차)는 2024년 통계다 — 없으면 화면은 income_standard 최신 연도로 후퇴 */
  base_year?: number;
  /** 행복주택·매입임대 표는 1인 +20%p, 2인 +10%p를 더한 값이 직접 적혀 있다. 키는 가구원수 문자열 */
  bump?: Record<string, number>;
  /** 6인 이상 가구는 5인 값에 1인당 이 금액을 더한다(행복주택 각주). 키는 % 문자열 */
  per_person_won?: Record<string, number>;
  notes?: string[];
};
export type EligSelection = {
  title: string;
  rows: { group: string | null; area: string | null; steps: string[] }[];
  tie_break: string | null;
  /** 선정 방법 글머리(청년 매입임대 「• 순위 간 경합이 있을 경우 …」). 다른 양식은 없다 */
  notes?: string[];
};
export type EligScoreTable = {
  group: string | null;
  points: number[];
  items: { label: string; cells: string[]; note: string | null;
    /** 적용대상(청년 매입임대 배점표 — 1순위 · 공통 · 2,3순위). 다른 양식은 없다 */
    target?: string | null }[];
};
export type EligPenalties = { rows: { label: string; points: number }[]; notes: string[] };

/** 행복주택 계층 절 하나(4-2 대학생 … 4-6 주거급여수급자). sh_eligibility_haengbok._parse_class */
export type EligClassBlock = {
  name: string;
  general: { intro: string | null; requirements: string[]; ranks: { rank: number; text: string }[]; notes: string[] };
  priority: { intro: string | null; ranks: { rank: number; text: string }[]; score: EligScoreTable | null; notes: string[] };
  selection: EligSelection | null;
  notes: string[];
};

export type NoticeEligibilityData = {
  kind?: EligKind;
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
  class_blocks?: EligClassBlock[];
  /** 청년 매입임대 신청유형 표(대학생 · 취업준비생 · 청년 · 이공계인재). 다른 양식은 없다 */
  applicant_types?: { name: string; text: string }[];
  /** 표 밖 유의사항(청년 매입임대 배점표 각주 등) */
  notes?: string[];
};

export type NoticeEligibility = {
  source_pages: number[];
  data: NoticeEligibilityData;
  /** 소득표 검산(100% 기준액 × %) 통과 여부. false면 소득표 금액을 내보내지 않는다 */
  verified: boolean;
  parsed_at: string;
};
