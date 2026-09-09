// 계산기 순수 함수 — 상호전환(보증금↔월임대료)과 대출 상환. 화면·상태 없음, 원 단위 정수로 주고받는다.
//
// 상호전환 기본 이율은 SH 공고문 별표1 「임대금액 상세 안내」에서 역산해 맞춘 값이다(2026년 2차 행복주택, 53쪽):
//   두산위브더프레스티지 신혼부부 — 기준 보증금 109,600천 원 / 월 421,000원
//     보증금↑ 151,700천 원 · 월 210,500원 → (421,000-210,500)×12 / (151,700-109,600)천 = 연 6.0%
//     보증금↓  54,800천 원 · 월 535,100원 → (535,100-421,000)×12 / (109,600- 54,800)천 = 연 2.5%
//   창경궁롯데캐슬시그니처 청년(소득있음)도 같은 6.0% / 2.5%가 나온다.
// 이율과 전환 한도는 공고마다 다르므로 화면에서 고칠 수 있게 두고, 원문 확인 문구를 반드시 함께 낸다.

/** 보증금을 올릴 때(월임대료를 낮출 때) 적용하는 연이율 기본값(%) */
export const CONVERT_RATE_UP = 6.0;
/** 보증금을 내릴 때(월임대료를 올릴 때) 적용하는 연이율 기본값(%) */
export const CONVERT_RATE_DOWN = 2.5;

export type Conversion = {
  /** 전환 후 보증금(원) */
  deposit: number;
  /** 전환 후 월임대료(원). 0 밑으로는 안 내려간다 */
  rent: number;
  /** 기준 대비 보증금 증감(원). 양수면 올린 것 */
  depositDelta: number;
  /** 기준 대비 월임대료 증감(원). 보증금을 올렸으면 음수 */
  rentDelta: number;
  /** 이번 계산에 쓴 연이율(%) */
  rate: number;
};

/**
 * 보증금을 목표치로 바꿨을 때의 월임대료.
 * 보증금을 올리면 올린 만큼에 rateUp을, 내리면 내린 만큼에 rateDown을 걸어 월 단위로 나눈다.
 */
export function convert(
  baseDeposit: number,
  baseRent: number,
  deposit: number,
  rateUp = CONVERT_RATE_UP,
  rateDown = CONVERT_RATE_DOWN,
): Conversion {
  const depositDelta = Math.round(deposit - baseDeposit);
  const rate = depositDelta >= 0 ? rateUp : rateDown;
  const monthly = Math.round((Math.abs(depositDelta) * rate) / 100 / 12);
  const raw = depositDelta >= 0 ? baseRent - monthly : baseRent + monthly;
  // 공고문은 월임대료를 100원 단위로 절사한다 — 별표1 예시(535,167 → 535,100 · 513,417 → 513,400)로 확인
  const rent = Math.max(0, Math.floor(raw / 100) * 100);
  return { deposit: Math.round(deposit), rent, depositDelta, rentDelta: rent - baseRent, rate };
}

/** 월임대료가 0이 되는 보증금(원). 이 위로는 전환할 게 없다 — 슬라이더 오른쪽 끝. */
export function fullConversionDeposit(baseDeposit: number, baseRent: number, rateUp = CONVERT_RATE_UP): number {
  if (rateUp <= 0) return baseDeposit;
  return Math.round(baseDeposit + (baseRent * 12 * 100) / rateUp);
}

export type LoanPlan = "bullet" | "annuity" | "equal";

export type Loan = {
  /** 첫 달 상환액(원). 만기일시면 이자만 */
  first: number;
  /** 마지막 달 상환액(원). 원금균등은 첫 달보다 적다 */
  last: number;
  /** 총 이자(원) */
  interest: number;
  /** 총 상환액(원) */
  total: number;
};

/**
 * 상환 방식별 이자. principal 원, annualRate %, months 개월.
 * bullet 만기일시(이자만 내다 만기에 원금) · annuity 원리금균등 · equal 원금균등
 */
export function loan(principal: number, annualRate: number, months: number, plan: LoanPlan): Loan {
  const p = Math.max(0, Math.round(principal));
  const n = Math.max(1, Math.round(months));
  const i = annualRate / 100 / 12;
  if (p === 0) return { first: 0, last: 0, interest: 0, total: 0 };
  if (plan === "bullet") {
    const m = Math.round(p * i);
    return { first: m, last: m + p, interest: m * n, total: m * n + p };
  }
  if (plan === "equal") {
    const unit = p / n;
    const first = Math.round(unit + p * i);
    const last = Math.round(unit + unit * i);
    // 남은 원금이 매달 unit씩 줄어드는 등차수열 — 총이자 = p×i×(n+1)/2
    const interest = Math.round((p * i * (n + 1)) / 2);
    return { first, last, interest, total: p + interest };
  }
  // 원리금균등. 무이자면 단순 분할
  const m = i === 0 ? p / n : (p * i) / (1 - Math.pow(1 + i, -n));
  const monthly = Math.round(m);
  const interest = Math.round(m * n - p);
  return { first: monthly, last: monthly, interest, total: p + interest };
}
