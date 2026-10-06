// 공고 제목 → 이 공고가 실제로 모집하는 공급유형 코드.
//
// 왜 필요한가: 자격 묶음(notice_eligibility)을 못 읽은 공고는 제도 일반 기준(supply_type)으로 후퇴하는데,
// 매입임대는 제도 전체가 유형 6개다. 「청년 매입임대주택」 공고 한 장에 신매입Ⅰ·Ⅱ·장기미임대·일반·공공전세
// 카드까지 여섯 장이 서서, 정작 이 공고에 해당하는 한 장이 묻혔다(사용자 지적 2026-09-21).
//
// LH 매입임대 제목은 기관이 유형을 그대로 적는다 — 「청년」·「신혼·신생아Ⅰ」·「신혼·신생아Ⅱ(전세형)」·
// 「일반」·「장기미임대」. 그 말만 읽는다. **확실할 때만 답하고, 애매하면 빈 배열을 돌려 6장을 그대로 둔다.**
// 골라낸 유형 말고 나머지는 감추지 않고 접어 둔다(화면 쪽에서 <details>) — 잘못 골랐을 때 길이 막히면 안 된다.

/** 견줄 꼴로 — 공백과 가운뎃점/마침표/하이픈을 걷고 로마숫자를 아라비아로 눕힌다 */
function norm(title: string): string {
  return title
    .replace(/[\s·.\-–—_'"]/g, "")
    // Ⅱ를 먼저 — Ⅰ부터 눕히면 라틴 「II」가 「11」이 돼 버린다
    .replace(/Ⅱ|II/g, "2")
    .replace(/Ⅰ|I/g, "1");
}

/** 「일반」이 공급유형(일반공급)을 뜻하나. 「일반주택형」·「일반형」은 집의 꼴이라 뺀다 */
function isGeneral(t: string): boolean {
  return /일반(?!주택형|형)/.test(t);
}

/** 「신혼2」인지 「신혼1」인지. 전세형이면 Ⅱ다(LH가 Ⅱ만 전세형으로 공급한다) */
function newlywedCodes(t: string, one: string, two: string): string[] {
  if (t.includes("전세형")) return [two];
  // 「26년7차신혼신생아2」 — 차수 숫자를 집지 않게 신혼/신생아 바로 뒤만 본다.
  // 쉼표는 넘지 않는다 — 「신혼부부, 1인가구 대상」의 1은 유형 번호가 아니라 딴 대상이다
  const m = t.match(/(?:신혼|신생아)(?:부부)?[^0-9,]{0,8}([12])/);
  if (m) return [m[1] === "2" ? two : one];
  return [one, two];
}

/**
 * 제목이 대는 유형 코드. 빈 배열이면 "모르겠다"는 뜻이고, 그때는 부르는 쪽이 유형 전부를 그린다.
 * housing_type이 supply_type과 잇는 고리라 여기서도 유형별로 갈라 본다.
 */
export function recruitedTypeCodes(housingType: string, title: string): string[] {
  const t = norm(title);
  const out = new Set<string>();

  if (housingType === "매입임대") {
    // 든든전세는 매입임대 유형 어느 것과도 같지 않다. 전에는 손대지 않고 매입임대 6종을 다 펼쳤는데
    // 든든전세 공고에 청년/신혼 카드만 늘어섰다(사용자 지적 2026-10-06). 시드의 든든전세 카드(safe,
    // housing_type 든든전세)를 세우고 매입임대 6종은 접어 둔다 — 소득과 자산 무관, 무주택 세대구성원 추첨
    if (t.includes("든든전세")) return ["safe"];
    if (t.includes("장기미임대")) out.add("buy_long");
    if (t.includes("공공전세")) out.add("pub_ls");
    if (t.includes("청년") || t.includes("기숙사형")) out.add("buy_youth");
    // 미리내집(서울시)은 이름만 다른 신혼·신생아 매입임대Ⅱ다
    if (t.includes("미리내집")) out.add("buy_new2");
    if (t.includes("신혼") || t.includes("신생아")) for (const c of newlywedCodes(t, "buy_new1", "buy_new2")) out.add(c);
    // 「일반주택형」은 공급유형이 아니라 집의 꼴이다(공공한옥과 가르는 말) — 「일반공급」의 일반과 다르다
    if (isGeneral(t) || t.includes("기존주택") || t.includes("다자녀") || t.includes("한부모")) out.add("buy_gen");
  } else if (housingType === "전세임대") {
    if (t.includes("청년")) out.add("ls_youth");
    if (t.includes("다자녀")) out.add("ls_multi");
    if (t.includes("신혼") || t.includes("신생아")) for (const c of newlywedCodes(t, "ls_new1", "ls_new2")) out.add(c);
    if (isGeneral(t) || t.includes("기존주택")) out.add("ls_gen");
  }

  return [...out];
}
