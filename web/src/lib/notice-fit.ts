// 공고별 「내 조건」 판정 — 순수 함수. 공고문에서 읽은 자격 묶음(notice_eligibility)에 내 조건을 대 본다.
//
// 세 양식이 묻는 게 다르다:
// - 장기전세(janggi): 면적 × 순위 × 출생자녀 가산 × 맞벌이 소득 매트릭스 + 청약 납입회차. 순위가 곧 당락 순서다.
// - 행복주택(haengbok): 계층별 소득(100%, 신혼 맞벌이 120%, 출생자녀 +10/+20%p) · 자산 · 자동차, 일반공급 순위(거주지),
//   우선공급 순위(단지 자치구 = 내 자치구면 1순위, 서울이면 2순위)와 배점(거주기간·청약 납입·나이·장애 등).
// - 매입임대(maeip): 소득 130% 이하면 1순위, 초과면 2순위. 동일순위는 추첨.
// - 청년 매입임대(cheongnyeon): 수급자·한부모·차상위면 1순위(소득·자산 심사 없음), 본인과 부모 소득 100%·국민임대 자산이면 2순위,
//   본인 소득 100%(1인 기준)·행복주택(청년) 자산이면 3순위. 동일순위는 가점(수급자 3, 한부모 3, 부모무주택 2, 장애인 본인 2 가구 1,
//   소득 50% 이하 3, 청약 24회 3 / 12회 2 / 6회 1) 합산 → 항목 순서 → 추첨.
//
// 여기서 나오는 답은 안내지 심사 결과가 아니다. 판정에 쓴 기준은 전부 reasons에 적어 돌려준다 — 왜 그렇게 봤는지가 보여야
// 사용자가 공고문에서 제 자리를 찾는다. 배점표의 점수 규칙(3년 이상 3점 등)은 공고문 표를 읽어 들이지 않고 행복주택 제도의
// 고정 규칙으로 두되, 화면은 공고문 배점표를 같이 그린다.
import type { EligAsset, EligClassBlock, EligIncomeTable, EligRankRow, EligRankTable, IncomeStandard, NoticeEligibilityData, RegionTier } from "@/types/eligibility";
import type { NoticeComplex, NoticeSupply } from "@/types/notice";

export type FitProfile = {
  /** 가구원 수(태아 포함) */
  household: number;
  /** 세대 월평균소득(원). 대학생은 본인+부모 합산 */
  incomeWon: number;
  dual: boolean;
  /** 2023.3.28. 이후 출생 자녀 수(태아 포함) */
  newborns: number;
  /** 2023.3.27. 이전 출생 미성년 자녀가 있다 */
  olderMinor: boolean;
  assetMan: number;
  carMan: number;
  /** 주택청약종합저축 납입 회차 */
  deposits: number;
  /** 거주 자치구(서울) 또는 "연접" / "경기기타" / "기타" */
  gu: string;
  /** 지금 사는 시(서울)·자치구에 산 햇수 */
  residenceYears: number;
  age: number;
  /** 2세 미만 자녀가 있다(행복주택 우선공급 우선 선정) */
  under2: boolean;
  /** 장애인·국가유공자 등(고령자·주거급여 배점 3점 항목) */
  special: boolean;
  /** 장기전세: 고른 표(group)와 신청면적 */
  group: string | null;
  area: string | null;
  /** 행복주택: 고른 계층 */
  cls: string | null;
  /** 청년 매입임대: 신청유형(대학생 · 취업준비생 · 청년 · 이공계인재) */
  applicantType: string | null;
  /** 청년 매입임대: 1순위 자격(수급자가구 · 한부모가족 · 차상위계층). 없으면 null */
  priorityClass: string | null;
  /** 청년 매입임대 3순위: 본인 월소득(원). incomeWon은 본인과 부모 합산 */
  selfIncomeWon: number;
  /** 청년 매입임대 가점: 부모 무주택 · 본인 장애인 · 부모 중 장애인 */
  parentsHomeless: boolean;
  disabledSelf: boolean;
  disabledFamily: boolean;
};

export type Reason = { label: string; ok: boolean | null; text: string };

export type FitVerdict = {
  /** 이 공고에 넣을 수 있나. null이면 판정에 필요한 값이 없어 못 가른 것 */
  ok: boolean | null;
  /** 내가 서는 순위. 없으면 null */
  rank: number | null;
  rankLabel: string;
  /** 우선공급 순위(행복주택). 단지 자치구에 따라 갈려 여기서는 「내 자치구면 1순위」로만 적는다 */
  priorityRank: number | null;
  score: { total: number; max: number; lines: string[] } | null;
  reasons: Reason[];
  /** 판정에 쓴 소득 상한(원)과 비율 */
  incomeLimit: { pct: number; won: number | null } | null;
};

export const MAN = 10_000;
export const HOUSEHOLD_MAX = 7;

// ── 공통 ────────────────────────────────────────────────────

/** 출생자녀 가산: ① 2023.3.28. 이후 출생 1명만 +10%p ② 2명 이상 +20%p ③ 1명 + 이전 출생 미성년 자녀 +20%p */
export function birthBonus(p: Pick<FitProfile, "newborns" | "olderMinor">): 0 | 10 | 20 {
  if (p.newborns >= 2 || (p.newborns === 1 && p.olderMinor)) return 20;
  if (p.newborns === 1) return 10;
  return 0;
}

/** 가산 표의 열 번호 — 기본 | ①(1명) | ②③(2명 이상, 1명+이전 자녀). 행복주택 자산 표는 ①과 ③이 다른 열이라 4열 */
function bonusColumn(p: Pick<FitProfile, "newborns" | "olderMinor">, columns: number): number {
  if (columns >= 4) {
    if (p.newborns >= 2) return 3;
    if (p.newborns === 1) return p.olderMinor ? 2 : 1;
    return 0;
  }
  const b = birthBonus(p);
  return b === 20 ? 2 : b === 10 ? 1 : 0;
}

/**
 * 가구원수 × % → 월소득 상한(원). 공고문 소득표(검산 통과)에 그 칸이 있으면 그 값, 없으면 통계 100% 기준액 × %(+가산 %p).
 * 행복주택·매입임대 표는 1인 +20%p, 2인 +10%p(bump). 6인 이상은 공고문 각주의 1인당 금액을 더한다.
 */
export function incomeLimitWon(pct: number, household: number, table: EligIncomeTable | null, seed: IncomeStandard[], bump: Record<string, number> = {}): number | null {
  const h = Math.min(Math.max(household, 1), HOUSEHOLD_MAX);
  if (table?.verified) {
    const row = table.rows.find((r) => r.pct === pct);
    const i = table.households.indexOf(h);
    if (row && i >= 0 && row.won[i] != null) return row.won[i];
    const last = table.households[table.households.length - 1];
    const per = table.per_person_won?.[String(pct)];
    if (row && per && h > last && row.won[table.households.length - 1] != null) {
      return row.won[table.households.length - 1]! + per * (h - last);
    }
  }
  const base = seed.find((r) => r.household === h && r.pct === 100)?.monthly_won;
  if (base == null) return null;
  const b = bump[String(h)] ?? 0;
  return Math.round((base * (pct + b)) / 100);
}

function won(n: number): string {
  return `${Math.round(n / MAN).toLocaleString("ko-KR")}만 원`;
}

function man(n: number): string {
  return `${n.toLocaleString("ko-KR")}만 원`;
}

/** 서울 자치구 목록(region_tier). 폼의 거주지 선택지 */
export function seoulGus(tiers: RegionTier[]): string[] {
  return tiers.filter((t) => t.tier === "서울" && t.kind === "sigungu").map((t) => t.name);
}

export function isSeoul(gu: string): boolean {
  return gu !== "" && gu !== "연접" && gu !== "경기기타" && gu !== "기타";
}

// ── 장기전세 ────────────────────────────────────────────────

/** 표(group)에서 면적 선택지. 순위 없는 우선공급 표도 포함한다 */
export function janggiAreas(t: EligRankTable): string[] {
  return [...new Set(t.rows.map((r) => r.area).filter((a): a is string => !!a))];
}

/** 소득 외 기준 글에서 청약 납입회차 요건(「약정납입회차 24회 이상」)을 읽는다. 없으면 null */
function depositsRequired(req: string | null): number | null {
  const m = req?.match(/(\d+)\s*회\s*이상/);
  return m ? Number(m[1]) : null;
}

/** 순위 줄 하나의 소득 상한 %. 맞벌이는 표의 맞벌이 %, 출생자녀 가산은 기본 %에 +10/+20%p */
function janggiPct(row: EligRankRow, p: FitProfile): number | null {
  if (row.income_pct == null) return null;
  const withBonus = row.income_pct + birthBonus(p);
  return p.dual && row.dual_income_pct != null ? Math.max(row.dual_income_pct, withBonus) : withBonus;
}

/** 장기전세 순위 판정. 표(group)와 면적을 고른 뒤, 순위 줄을 위에서부터 대 본다 — 처음 맞는 줄이 내 순위다. */
export function fitJanggi(d: NoticeEligibilityData, p: FitProfile, seed: IncomeStandard[], complexGu?: string | null): FitVerdict {
  const table = d.rank_tables.find((t) => t.group === p.group) ?? d.rank_tables[0];
  const reasons: Reason[] = [];
  if (!table) return { ok: null, rank: null, rankLabel: "판정 불가", priorityRank: null, score: null, reasons, incomeLimit: null };
  const rows = table.rows.filter((r) => (p.area ? r.area === p.area : true));
  if (rows.length === 0) return { ok: null, rank: null, rankLabel: "면적을 고르세요", priorityRank: null, score: null, reasons, incomeLimit: null };

  // 자산·자동차 — 가산 표 열은 기본 | ① | ②③
  let assetOk: boolean | null = null;
  if (d.asset) {
    const col = bonusColumn(p, d.asset.columns.length);
    for (const r of d.asset.rows) {
      const lim = r.values_man[col] ?? r.values_man[0];
      if (lim == null) continue;
      const mine = r.label.includes("자동차") ? p.carMan : p.assetMan;
      const ok = mine <= lim;
      assetOk = assetOk === false ? false : ok;
      reasons.push({ label: r.label.includes("자동차") ? "자동차" : "자산", ok, text: `${d.asset.columns[col]} 기준 ${man(lim)} 이하, 입력 ${man(mine)}` });
    }
  }

  const ranked = rows.filter((r) => r.rank != null).sort((a, b) => a.rank! - b.rank!);
  const bonus = birthBonus(p);
  let hit: EligRankRow | null = null;
  let incomeLimit: FitVerdict["incomeLimit"] = null;
  let firstIncomeFail: string | null = null;
  for (const r of ranked.length ? ranked : rows) {
    const pct = janggiPct(r, p);
    const lim = pct == null ? null : incomeLimitWon(pct, p.household, d.income_table, seed);
    const incomeOk = pct == null || lim == null ? true : p.incomeWon <= lim;
    const need = depositsRequired(r.requirement);
    const depositOk = need == null ? true : p.deposits >= need;
    // 거주지 순위(매입형 50㎡ 미만): 단지 자치구와 내 자치구를 견준다. 단지를 모르면 통과로 보고 단지 목록에서 다시 가른다
    const req = r.requirement ?? "";
    let placeOk = true;
    if (/위치한 자치구 거주/.test(req)) placeOk = complexGu == null ? true : complexGu === p.gu;
    else if (/연접자치구 거주/.test(req)) placeOk = complexGu == null ? true : false;
    else if (/그 외 서울시 자치구 거주/.test(req)) placeOk = isSeoul(p.gu);
    if (incomeOk && depositOk && placeOk) {
      hit = r;
      incomeLimit = pct == null ? null : { pct, won: lim };
      break;
    }
    if (!incomeOk && firstIncomeFail == null && lim != null) firstIncomeFail = `${r.rank ?? ""}순위 ${pct}% 이하(월 ${won(lim)}) 초과`;
  }
  if (hit) {
    const pct = janggiPct(hit, p);
    const lim = incomeLimit?.won;
    if (pct != null) {
      reasons.unshift({ label: "소득", ok: true, text: `${p.area ?? ""} ${hit.rank != null ? `${hit.rank}순위` : ""} 기준 ${pct}% 이하${lim != null ? ` (월 ${won(lim)})` : ""}, 입력 월 ${won(p.incomeWon)}${bonus ? ` | 출생자녀 가산 +${bonus}%p` : ""}${p.dual && hit.dual_income_pct != null ? " | 맞벌이 완화" : ""}` });
    }
    const need = depositsRequired(hit.requirement);
    if (need != null) reasons.push({ label: "청약", ok: true, text: `약정납입회차 ${need}회 이상, 입력 ${p.deposits}회` });
    if (hit.requirement && need == null) reasons.push({ label: "기준", ok: null, text: hit.requirement });
  } else {
    reasons.unshift({ label: "소득", ok: false, text: firstIncomeFail ?? "이 면적의 어느 순위에도 맞지 않습니다" });
  }
  const ok = hit != null && assetOk !== false;
  return {
    ok,
    rank: hit?.rank ?? null,
    rankLabel: hit ? (hit.rank != null ? `${hit.rank}순위` : "신청 가능") : "미달",
    priorityRank: null,
    score: null,
    reasons,
    incomeLimit,
  };
}

// ── 행복주택 ────────────────────────────────────────────────

const CLASS_KEYS: [RegExp, string][] = [
  [/대학생/, "대학생"],
  [/청년/, "청년"],
  [/신혼|한부모/, "신혼부부"],
  [/고령자/, "고령자"],
  [/주거급여/, "주거급여수급자"],
];

/** 계층 절 이름 → 짧은 이름(대학생 | 청년 | 신혼부부 | 고령자 | 주거급여수급자). 공급현황 공급대상과 맞추는 열쇠 */
export function classKey(name: string): string {
  return CLASS_KEYS.find(([re]) => re.test(name))?.[1] ?? name;
}

/** 계층별 소득 상한 %: 기본 100. 신혼부부 맞벌이 120. 출생자녀 가산 +10/+20%p(공고문 소득표 조건 칸과 같은 규칙) */
function haengbokPct(key: string, p: FitProfile): number {
  const base = key === "신혼부부" && p.dual ? 120 : 100;
  return base + birthBonus(p);
}

function assetRow(asset: EligAsset | null, key: string, kind: "총자산" | "자동차") {
  if (!asset) return null;
  const label = key === "주거급여수급자" ? null : key;
  if (!label) return null;
  return asset.rows.find((r) => r.label.includes(kind) && r.label.includes(label)) ?? null;
}

/** 우선공급 배점(계층별 고정 규칙). 공고문 배점표의 항목 이름과 맞춘다 */
function haengbokScore(key: string, p: FitProfile): FitVerdict["score"] {
  const lines: string[] = [];
  let total = 0;
  let max = 0;
  const seoul = isSeoul(p.gu);
  if (key === "대학생") {
    max = 3;
    const pt = p.residenceYears >= 3 ? 3 : 1;
    total += pt;
    lines.push(`거주 ${p.residenceYears}년 → ${pt}점 (취업준비생은 자치구 거주기간, 대학생은 부모 거주지 기준. 우선공급 1순위만 적용)`);
  } else if (key === "청년" || key === "신혼부부") {
    max = 6;
    const a = seoul && p.residenceYears >= 3 ? 3 : seoul ? 1 : 0;
    total += a;
    lines.push(`서울 거주 ${seoul ? `${p.residenceYears}년` : "아님"} → ${a}점 (3년 이상 3점, 미만 1점)`);
    const b = p.deposits >= 24 ? 3 : p.deposits >= 6 ? 1 : 0;
    total += b;
    lines.push(`청약 납입 ${p.deposits}회 → ${b}점 (24회 이상 3점, 6~23회 1점)`);
  } else if (key === "고령자") {
    max = 9;
    const a = p.age >= 75 ? 3 : p.age >= 70 ? 2 : p.age >= 65 ? 1 : 0;
    total += a;
    lines.push(`나이 ${p.age}세 → ${a}점 (75세 이상 3점, 70~74세 2점, 65~69세 1점)`);
    const b = seoul && p.residenceYears >= 5 ? 3 : seoul ? 2 : 0;
    total += b;
    lines.push(`자치구 거주 ${seoul ? `${p.residenceYears}년` : "아님"} → ${b}점 (해당 자치구 5년 이상 3점, 미만 2점, 그 외 서울 1점)`);
    const c = p.special ? 3 : 0;
    total += c;
    lines.push(`장애인 | 국가유공자 등 → ${c}점`);
  } else if (key === "주거급여수급자") {
    max = 6;
    const b = seoul && p.residenceYears >= 5 ? 3 : seoul ? 2 : 0;
    total += b;
    lines.push(`자치구 거주 ${seoul ? `${p.residenceYears}년` : "아님"} → ${b}점 (해당 자치구 5년 이상 3점, 미만 2점, 그 외 서울 1점)`);
    const c = p.special ? 3 : 0;
    total += c;
    lines.push(`국가유공자 | 장애인 | 한부모가족 등 → ${c}점`);
  } else {
    return null;
  }
  return { total, max, lines };
}

/** 행복주택 판정. 계층을 고르면 그 절의 요건으로 소득·자산·자동차·나이를 보고, 일반공급 순위와 우선공급 배점을 센다. */
export function fitHaengbok(d: NoticeEligibilityData, p: FitProfile, seed: IncomeStandard[]): FitVerdict & { block: EligClassBlock | null; key: string } {
  const block = (d.class_blocks ?? []).find((c) => c.name === p.cls) ?? (d.class_blocks ?? [])[0] ?? null;
  const reasons: Reason[] = [];
  if (!block) return { ok: null, rank: null, rankLabel: "계층을 고르세요", priorityRank: null, score: null, reasons, incomeLimit: null, block: null, key: "" };
  const key = classKey(block.name);
  const bump = d.income_table?.bump ?? { "1": 20, "2": 10 };
  const pct = haengbokPct(key, p);
  const lim = incomeLimitWon(pct, p.household, d.income_table, seed, bump);
  let ok = true;

  if (key === "청년") {
    const ageOk = p.age >= 19 && p.age <= 39;
    reasons.push({ label: "나이", ok: ageOk, text: `19~39세 (사회초년생은 나이 무관, 소득 업무 5년 이내), 입력 ${p.age}세` });
    // 사회초년생 갈래가 있어 나이 미달만으로 탈락시키지 않는다
  } else if (key === "고령자") {
    const ageOk = p.age >= 65;
    ok = ok && ageOk;
    reasons.push({ label: "나이", ok: ageOk, text: `65세 이상, 입력 ${p.age}세` });
  }
  if (key === "주거급여수급자") {
    reasons.push({ label: "자격", ok: null, text: "공고일 기준 주거급여수급자증명서가 있어야 합니다" });
  } else {
    const incomeOk = lim == null ? null : p.incomeWon <= lim;
    ok = ok && incomeOk !== false;
    const bonus = birthBonus(p);
    reasons.push({
      label: "소득",
      ok: incomeOk,
      text: `${key === "대학생" ? "본인과 부모 합산" : "세대 합산"} ${pct}% 이하${lim != null ? ` (월 ${won(lim)}, 1인 +20%p 2인 +10%p 반영)` : ""}, 입력 월 ${won(p.incomeWon)}${key === "신혼부부" && p.dual ? " | 맞벌이 120%" : ""}${bonus ? ` | 출생자녀 가산 +${bonus}%p` : ""}`,
    });
    const col = d.asset ? bonusColumn(p, d.asset.columns.length) : 0;
    const a = assetRow(d.asset, key, "총자산");
    if (a) {
      const limA = a.values_man[col] ?? a.values_man[0];
      if (limA != null) {
        const assetOk = p.assetMan <= limA;
        ok = ok && assetOk;
        reasons.push({ label: "자산", ok: assetOk, text: `총자산 ${man(limA)} 이하${col ? ` (${d.asset!.columns[col]})` : ""}, 입력 ${man(p.assetMan)}` });
      }
    }
    const c = assetRow(d.asset, key, "자동차");
    if (c) {
      const limC = c.values_man[col] ?? c.values_man[0];
      if (limC != null) {
        const carOk = limC === 0 ? p.carMan === 0 : p.carMan <= limC;
        ok = ok && carOk;
        reasons.push({ label: "자동차", ok: carOk, text: limC === 0 ? "자동차를 소유하지 않아야 합니다" : `자동차가액 ${man(limC)} 이하, 입력 ${man(p.carMan)}` });
      }
    }
  }
  if (key === "대학생" || key === "청년") reasons.push({ label: "혼인", ok: null, text: "혼인 중이 아니어야 합니다" });
  if (key === "신혼부부") reasons.push({ label: "혼인", ok: null, text: "혼인 7년 이내 또는 6세 이하 자녀 (예비신혼부부, 한부모가족 포함)" });

  // 일반공급 순위: 서울·연접 1순위 → 경기 나머지 2순위 → 그 외 3순위. 대학생은 대학 소재지, 청년·신혼은 소득근거지로도 인정
  let rank: number | null = null;
  if (block.general.ranks.length) {
    rank = isSeoul(p.gu) || p.gu === "연접" ? 1 : p.gu === "경기기타" ? 2 : 3;
    reasons.push({ label: "일반공급", ok: null, text: `${rank}순위 (거주지 기준. ${key === "대학생" ? "대학 소재지" : "소득근거지"}로도 인정)` });
  }
  const priorityRank = isSeoul(p.gu) ? 2 : null;
  reasons.push({ label: "우선공급", ok: null, text: isSeoul(p.gu) ? `단지가 ${p.gu}면 1순위, 그 외 서울 단지는 2순위` : "서울 거주자만 신청할 수 있습니다" });
  if (p.under2) reasons.push({ label: "우선 선정", ok: true, text: "2세 미만 자녀가 있어 우선공급에서 순위·배점보다 먼저 선정됩니다" });

  return {
    ok,
    rank,
    rankLabel: rank != null ? `일반공급 ${rank}순위` : "신청 가능",
    priorityRank,
    score: isSeoul(p.gu) ? haengbokScore(key, p) : null,
    reasons,
    incomeLimit: { pct, won: lim },
    block,
    key,
  };
}

// ── 매입임대 ────────────────────────────────────────────────

export function fitMaeip(d: NoticeEligibilityData, p: FitProfile, seed: IncomeStandard[]): FitVerdict {
  const t = d.rank_tables[0];
  const reasons: Reason[] = [];
  if (!t) return { ok: null, rank: null, rankLabel: "판정 불가", priorityRank: null, score: null, reasons, incomeLimit: null };
  const bump = d.income_table?.bump ?? { "1": 20, "2": 10 };
  const rows = [...t.rows].sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
  for (const r of rows) {
    if (r.income_pct == null) {
      reasons.push({ label: "소득", ok: true, text: `${r.rank}순위: ${r.requirement ?? ""}` });
      return { ok: true, rank: r.rank, rankLabel: `${r.rank}순위`, priorityRank: null, score: null, reasons, incomeLimit: null };
    }
    const lim = incomeLimitWon(r.income_pct, p.household, d.income_table, seed, bump);
    if (lim == null || p.incomeWon <= lim) {
      reasons.push({ label: "소득", ok: true, text: `${r.income_pct}% 이하${lim != null ? ` (월 ${won(lim)})` : ""}, 입력 월 ${won(p.incomeWon)}` });
      return { ok: true, rank: r.rank, rankLabel: `${r.rank}순위`, priorityRank: null, score: null, reasons, incomeLimit: { pct: r.income_pct, won: lim } };
    }
    reasons.push({ label: "소득", ok: false, text: `${r.rank}순위 ${r.income_pct}% 이하(월 ${won(lim)}) 초과` });
  }
  return { ok: false, rank: null, rankLabel: "미달", priorityRank: null, score: null, reasons, incomeLimit: null };
}

// ── 청년 매입임대 ───────────────────────────────────────────

/** 청년 매입임대 가점(공고문 배점표 ①~⑦). 점수는 제도 고정값 — 화면은 공고문 배점표를 같이 그린다 */
export const CHEONGNYEON_SCORE_MAX = 11;

export function fitCheongnyeon(d: NoticeEligibilityData, p: FitProfile, seed: IncomeStandard[]): FitVerdict {
  const t = d.rank_tables[0];
  const reasons: Reason[] = [];
  if (!t) return { ok: null, rank: null, rankLabel: "판정 불가", priorityRank: null, score: null, reasons, incomeLimit: null };
  const bump = d.income_table?.bump ?? { "1": 20, "2": 10 };
  const rows = t.rows;
  const r2 = rows.find((r) => r.rank === 2);
  const r3 = rows.find((r) => r.rank === 3);

  // 공통 요건: 미혼 무주택 본인 + 신청유형
  const type = p.applicantType ?? "";
  if (/청년|이공계/.test(type)) {
    const ageOk = p.age >= 19 && p.age <= 39;
    reasons.push({ label: "나이", ok: ageOk, text: `${type} 유형은 19~39세, 입력 ${p.age}세` });
  } else if (type) {
    reasons.push({ label: "유형", ok: null, text: `${type}: ${(d.applicant_types ?? []).find((x) => x.name === type)?.text ?? "공고문 신청유형 요건"}` });
  }
  reasons.push({ label: "혼인", ok: null, text: "혼인 중이 아니고 본인이 무주택자여야 합니다" });
  const ageBad = /청년|이공계/.test(type) && !(p.age >= 19 && p.age <= 39);

  let rank: number | null = null;
  let limit: { pct: number; won: number | null } | null = null;
  if (p.priorityClass) {
    rank = 1;
    reasons.push({ label: "자격", ok: true, text: `1순위: ${p.priorityClass} (순위 자격을 입증하면 소득과 자산 심사 없음)` });
  } else {
    const pct2 = r2?.income_pct ?? 100;
    const lim2 = incomeLimitWon(pct2, p.household, d.income_table, seed, bump);
    const income2 = lim2 == null ? null : p.incomeWon <= lim2;
    const asset2 = r2?.asset_man == null ? null : p.assetMan <= r2.asset_man;
    const car2 = r2?.car_man == null ? null : p.carMan <= r2.car_man;
    if (income2 !== false && asset2 !== false && car2 !== false) {
      rank = 2;
      limit = { pct: pct2, won: lim2 };
      reasons.push({ label: "소득", ok: income2, text: `2순위: 본인과 부모 합산 ${pct2}% 이하${lim2 != null ? ` (${p.household}인 월 ${won(lim2)})` : ""}, 입력 월 ${won(p.incomeWon)}` });
      if (r2?.asset_man != null) reasons.push({ label: "자산", ok: asset2, text: `본인과 부모 총자산 ${man(r2.asset_man)} 이하, 입력 ${man(p.assetMan)}` });
      if (r2?.car_man != null) reasons.push({ label: "자동차", ok: car2, text: `자동차가액 ${man(r2.car_man)} 이하, 입력 ${man(p.carMan)}` });
    } else {
      reasons.push({
        label: "2순위", ok: false,
        text: income2 === false ? `본인과 부모 합산 소득 ${pct2}% (월 ${won(lim2!)}) 초과` : asset2 === false ? `본인과 부모 총자산 ${man(r2!.asset_man!)} 초과` : `자동차가액 ${man(r2!.car_man!)} 초과`,
      });
      const pct3 = r3?.income_pct ?? 100;
      const lim3 = incomeLimitWon(pct3, 1, d.income_table, seed, bump);
      const income3 = lim3 == null ? null : p.selfIncomeWon <= lim3;
      const asset3 = r3?.asset_man == null ? null : p.assetMan <= r3.asset_man;
      const car3 = r3?.car_man == null ? null : p.carMan <= r3.car_man;
      if (r3 && income3 !== false && asset3 !== false && car3 !== false) {
        rank = 3;
        limit = { pct: pct3, won: lim3 };
        reasons.push({ label: "소득", ok: income3, text: `3순위: 본인 ${pct3}% 이하 (1인 기준${lim3 != null ? ` 월 ${won(lim3)}` : ""}), 입력 본인 월 ${won(p.selfIncomeWon)}` });
        if (r3.asset_man != null) reasons.push({ label: "자산", ok: asset3, text: `본인 총자산 ${man(r3.asset_man)} 이하, 입력 ${man(p.assetMan)}` });
        if (r3.car_man != null) reasons.push({ label: "자동차", ok: car3, text: `자동차가액 ${man(r3.car_man)} 이하, 입력 ${man(p.carMan)}` });
      } else if (r3) {
        reasons.push({
          label: "3순위", ok: false,
          text: income3 === false ? `본인 소득 ${pct3} % (1인 월 ${won(lim3!)}) 초과` : asset3 === false ? `본인 총자산 ${man(r3.asset_man!)} 초과` : `자동차가액 ${man(r3.car_man!)} 초과`,
        });
      }
    }
  }

  // 가점 — 순위 내 경쟁 때 합산. ①② 수급자·한부모는 1순위만, ⑥ 소득 50%는 2·3순위만
  const lines: string[] = [];
  let total = 0;
  if (rank === 1 && /수급자/.test(p.priorityClass ?? "")) { total += 3; lines.push("① 수급자가구 3점"); }
  if (rank === 1 && /한부모/.test(p.priorityClass ?? "")) { total += 3; lines.push("② 한부모가족 3점"); }
  if (p.parentsHomeless) { total += 2; lines.push("③ 부모 무주택 2점"); }
  if (p.disabledSelf) { total += 2; lines.push("④ 장애인(본인) 2점"); }
  if (p.disabledFamily) { total += 1; lines.push("⑤ 장애인(가구) 1점"); }
  if (rank === 2 || rank === 3) {
    const half = incomeLimitWon(50, rank === 2 ? p.household : 1, d.income_table, seed, bump);
    const mine = rank === 2 ? p.incomeWon : p.selfIncomeWon;
    if (half != null && mine <= half) { total += 3; lines.push(`⑥ 소득 50% 이하 (월 ${won(half)}) 3점`); }
  }
  const dep = p.deposits >= 24 ? 3 : p.deposits >= 12 ? 2 : p.deposits >= 6 ? 1 : 0;
  if (dep) { total += dep; lines.push(`⑦ 청약 납입 ${p.deposits}회 ${dep}점`); }

  const ok = rank == null ? false : ageBad ? false : true;
  return {
    ok,
    rank,
    rankLabel: rank != null ? `${rank}순위` : "미달",
    priorityRank: null,
    score: rank != null ? { total, max: CHEONGNYEON_SCORE_MAX, lines } : null,
    reasons,
    incomeLimit: limit,
  };
}

// ── 단지 고르기 ─────────────────────────────────────────────

export type ComplexPick = {
  c: NoticeComplex;
  /** 이 단지에서 내 순위 태그. 행복주택은 우선공급과 일반공급 두 트랙을 따로 단다(트랙이 섞여 보인다는 사용자 지적 2026-09-14) */
  tags: { text: string; tone: "acc" | "soft" }[];
  /** 정렬 열쇠 — 작을수록 위 */
  order: number;
  /** 면적·금액 한 줄 */
  sub: string;
};

/** 면적 라벨(「60㎡ 이하」「60㎡ 초과 85㎡ 이하」「50㎡ 미만」)을 구간으로 */
export function areaBand(label: string | null): { lo: number; hi: number } | null {
  if (!label) return null;
  const nums = [...label.matchAll(/(\d+(?:\.\d+)?)\s*㎡\s*(이하|초과|미만|이상)/g)].map((m) => [Number(m[1]), m[2]] as const);
  if (nums.length === 0) return null;
  let lo = 0;
  let hi = Infinity;
  for (const [n, k] of nums) {
    if (k === "이하" || k === "미만") hi = n;
    else lo = n;
  }
  return { lo, hi };
}

/** 공급현황에서 단지별 전용면적·보증금·월임대료·공급대상을 모은다(장기전세는 단지 표에 면적이 없다) */
export function complexFacts(supply: NoticeSupply[]): Map<string, { areas: number[]; deposit: number | null; rent: number | null; classes: Set<string> }> {
  const m = new Map<string, { areas: number[]; deposit: number | null; rent: number | null; classes: Set<string> }>();
  for (const s of supply) {
    const f = m.get(s.complex_name) ?? { areas: [], deposit: null, rent: null, classes: new Set<string>() };
    if (s.area_exclusive != null) f.areas.push(s.area_exclusive);
    if (s.deposit != null) f.deposit = f.deposit == null ? s.deposit : Math.min(f.deposit, s.deposit);
    if (s.rent != null) f.rent = f.rent == null ? s.rent : Math.min(f.rent, s.rent);
    if (s.tenant_class) f.classes.add(s.tenant_class);
    m.set(s.complex_name, f);
  }
  return m;
}
