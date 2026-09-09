// 공고 용어 사전 — 공고문에 나오는 말을 화면에서 그대로 쓰되, 뜻을 페이지 안에서 바로 펴 준다
// (사용자 요청 2026-09-09: "용어들 링크처럼 걸어서 아래쪽에 설명 표시").
//
// 정의는 SH·LH 공고문과 공공주택 특별법 시행규칙의 표현을 우리 말로 줄인 것이다. 법령 해석이 아니라 읽기 보조다 —
// 각 설명 끝에서 원문을 다시 보라고 말하지 않는다(페이지 밑 고지 한 줄이 이미 말한다).

export type GlossaryEntry = { term: string; def: string };

/** term은 화면에 그대로 쓰는 말. 키이자 라벨이다 */
export const GLOSSARY: readonly GlossaryEntry[] = [
  { term: "우선공급", def: "일반 신청자보다 먼저 배정받는 몫. 고령자, 장애인, 노부모 부양자, 국가유공자, 다자녀 가구처럼 공고가 정한 대상에게 돌아간다. 여기에 해당하지 않아도 일반공급으로 신청할 수 있다." },
  { term: "일반공급", def: "우선공급을 뺀 나머지 몫. 자격을 갖춘 신청자끼리 순위와 배점으로 겨룬다." },
  { term: "예비입주자", def: "당첨자가 계약을 포기하거나 자격을 잃었을 때 순번대로 들어가는 대기자. 이번 공고에서 뽑는 예비자 수가 따로 적혀 있으면 그만큼 순번을 준다." },
  { term: "공가", def: "지금 비어 있어 바로 입주자를 받는 호실. 재공급 공고의 모집 호수는 대부분 이 공가 수다." },
  { term: "신규 공급", def: "이번에 처음 입주자를 모집하는 단지나 호실. 준공 전이면 입주 시작이 앞날짜로 잡힌다." },
  { term: "재공급", def: "이미 입주가 끝난 단지에서 비거나 반납된 호실을 다시 모집하는 것. 대개 바로 입주할 수 있다." },
  { term: "주거약자용", def: "휠체어 통행 폭, 단차 제거, 안전 손잡이 같은 편의시설을 갖춘 호실. 공급유형 뒤에 S가 붙는다. 장애인과 고령자 등 주거약자에게 우선 배정된다." },
  { term: "전용면적", def: "현관 안쪽에서 우리 세대만 쓰는 면적. 방과 거실, 주방, 화장실이 여기 들어간다." },
  { term: "공용면적", def: "계단, 복도, 엘리베이터처럼 이웃과 나눠 쓰는 면적. 주거공용과 기타공용(관리사무소, 주차장 등)으로 나뉜다." },
  { term: "계약면적", def: "전용면적과 공용면적을 모두 더한 면적. 계약서에 적히는 값이다." },
  { term: "계약금", def: "당첨 뒤 계약할 때 먼저 내는 돈. 보증금의 일부다." },
  { term: "잔금", def: "계약금을 뺀 나머지 보증금. 입주 지정 기간에 낸다." },
  { term: "전세전환", def: "월임대료를 보증금으로 바꿔 월세를 낮추는 것. 공고가 정한 한도와 이율 안에서 고를 수 있다. 보증금이 가장 커지는 쪽이다." },
  { term: "월세전환", def: "보증금을 월임대료로 바꿔 목돈을 줄이는 것. 보증금이 가장 작아지는 쪽이다." },
  { term: "소득있음", def: "청년 유형에서 본인에게 근로 또는 사업 소득이 있는 경우. 소득과 자산 기준을 본인 기준으로 본다." },
  { term: "소득없음", def: "청년 유형에서 본인 소득이 없는 경우. 부모의 소득과 자산을 함께 본다." },
  { term: "매입임대", def: "공사가 기존 주택을 사들여 고쳐 빌려주는 방식. 아파트 단지가 아니라 다가구주택이나 빌라 한 호실 단위인 경우가 많다." },
  { term: "장기전세", def: "월임대료 없이 보증금만 내고 최장 20년까지 사는 유형. 시세보다 낮은 전세금으로 공급한다." },
  { term: "행복주택", def: "청년, 신혼부부, 대학생, 고령자 등을 대상으로 직장이나 학교에서 가까운 곳에 공급하는 임대주택." },
  { term: "입주 시작", def: "입주 지정 기간이 열리는 시점. 준공 전 단지는 예정일이라 공사 일정에 따라 밀릴 수 있다." },
];

const BY_TERM = new Map(GLOSSARY.map((g) => [g.term, g]));

/** 문자열 안에서 사전에 있는 말을 찾는 패턴. 긴 말 먼저 — 「신규 공급」이 「공급」보다 먼저 잡혀야 한다 */
// 사전의 말은 한글과 공백뿐이라 정규식 특수문자가 없다 — 이스케이프 없이 그대로 잇는다
const TERM_RE = new RegExp([...GLOSSARY].map((g) => g.term).sort((a, b) => b.length - a.length).join("|"), "g");

/** 문자열을 [보통 글자 | 사전에 있는 말] 조각으로 나눈다. 라벨·표 칸처럼 우리가 만든 짧은 문자열에만 쓴다 */
export function splitTerms(text: string): { text: string; term: boolean }[] {
  const out: { text: string; term: boolean }[] = [];
  let last = 0;
  TERM_RE.lastIndex = 0;
  for (let m = TERM_RE.exec(text); m; m = TERM_RE.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), term: false });
    out.push({ text: m[0], term: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), term: false });
  return out;
}

export function glossaryOf(term: string): GlossaryEntry | undefined {
  return BY_TERM.get(term);
}

/** 화면에서 실제로 쓴 용어만, 사전 순서 그대로. 안 쓴 말을 페이지 밑에 늘어놓지 않는다 */
export function glossaryFor(terms: readonly string[]): GlossaryEntry[] {
  const want = new Set(terms);
  return GLOSSARY.filter((g) => want.has(g.term));
}

/** 앵커 id — 용어 자체가 한글이라 인코딩 대신 사전 순번을 쓴다 */
export function glossaryId(term: string): string {
  const i = GLOSSARY.findIndex((g) => g.term === term);
  return `g-${i < 0 ? "x" : i}`;
}
