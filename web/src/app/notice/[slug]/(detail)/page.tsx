import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AreaMap } from "@/components/area-map";
import { CalcSeed } from "@/components/calc-context";
import { ComplexExplorer } from "@/components/complex-explorer";
import { ComplexFactsSection } from "@/components/complex-facts";
import { DetailAside } from "@/components/detail-aside";
import { DetailHeadBar } from "@/components/detail-headbar";
import { DetailNav } from "@/components/detail-nav";
import { EligRuleCards, type RuleCardView } from "@/components/elig-rule-cards";
import { ExternalLink } from "@/components/external-link";
import { GlossaryList, Term, TermText } from "@/components/glossary";
import { NaverMap } from "@/components/naver-map";
import { NoticeEligibilitySection } from "@/components/notice-eligibility";
import { NoticeFit } from "@/components/notice-fit";
import { NoticeFitMingan } from "@/components/notice-fit-mingan";
import { SaveButton } from "@/components/save-button";
import { ShareButton } from "@/components/share-button";
import { JsonLd } from "@/components/json-ld";
import { agencyLabels } from "@/lib/agency";
import { AREA_MIN_COUNT } from "@/lib/constants";
import { HOUSEHOLD_MAX, incomeLimit, incomePctFor, ruleLines } from "@/lib/eligibility";
import { noticeGraph } from "@/lib/jsonld";
import { applyPhase, dateK, dateMD, daysUntil, deadlineChip, isClosed, moneyOf, NO_DATE, num, todayKST, won, wonKo, wonShort } from "@/lib/format";
import { MINGAN_INCOME_PCTS, minganRuleCards } from "@/lib/mingan-fit";
import { recruitedTypeCodes } from "@/lib/notice-supply-type";
import { moveInLabel } from "@/lib/notice-view";
import {
  getAmendChain, getComplexFacts, getEligibilityRules, getNoticeAreas, getNoticeBySlug, getNoticeComplexes, getNoticeEligibility, getNoticeSupply, getPriorCompetition,
  listFilterOptions,
} from "@/lib/queries";
import { programDoc } from "@/lib/programs";
import { areaPath, noticePath, programPath, ROUTES } from "@/lib/routes";
import { regionLabel, sidoShort } from "@/lib/sido";
import type { Notice, NoticeListItem } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

type Params = { params: Promise<{ slug: string }> };

async function load(params: Params["params"]) {
  const { slug } = await params;
  return getNoticeBySlug(decodeURIComponent(slug));
}

/** meta description과 JSON-LD가 **같은 문장**을 쓴다 — 둘이 어긋나면 구조화 데이터가 스팸으로 읽힌다 */
function noticeDescription(n: Notice): string {
  const d = daysUntil(n.apply_end_at);
  // 발표가 끝난 공고는 마감일이 몇 년 뒤로 적혀 있어도 마감이다(lib/format.ts isClosed 주석)
  const dday = isClosed(n) ? "(마감)" : d === null ? "" : `(D-${d})`;
  const supply = n.supply_count != null ? num(n.supply_count, "호") : "";
  return `${n.agency} ${n.title}. 접수 ${dateK(n.apply_start_at)}~${dateK(n.apply_end_at)}${dday}. ${regionLabel(n)} ${supply}. 최소 보증금 ${won(n.min_deposit)}, 최소 월임대료 ${won(n.min_rent)}.`;
}

// docs/url-structure.md 공고 페이지 템플릿. 호실이 아직 없어 "{n}호실" 자리는 공급호수로 채운다.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const n = await load(params);
  if (!n) return { title: "공고를 찾을 수 없습니다" };
  const supply = n.supply_count != null ? num(n.supply_count, "호") : "";
  return {
    title: `${n.title} — ${n.housing_type} ${supply} 보증금/임대료/접수일정`.replace(/\s+/g, " "),
    description: noticeDescription(n),
    // 같은 공고가 기관 seq 여러 개로 들어온 경우 정본을 가리킨다. URL은 살려 두고 색인만 하나로 모은다
    alternates: { canonical: noticePath(n.canonical_slug ?? n.slug) },
  };
}

/** 접수 일정 한 칸의 날짜 — 날짜와 시각을 따로 그린다. 좁은 칸에서는 둘 사이에서만 줄이 바뀐다 */
type Stamp = { date: string; time: string | null };

function Stamped({ v, pre }: { v: Stamp; pre?: string }) {
  return (
    <>
      <span>{pre}{v.date}</span>
      {v.time && <i>{v.time}</i>}
    </>
  );
}

type RuleCard = Omit<RuleCardView, "lines"> & { lines: { label: string; text: string }[] };

// 신청자격 카드 — 유형마다 빠진 항목이 달라 가로로 훑을 수가 없었다(2026-09-21).
// 쓰이는 기준을 모두 모아 같은 차례로 세우고, 그 유형이 안 보는 기준은 감추지 않고 「해당 없음」이라 쓴다.
// 목록에 없는 라벨(민간임대의 「선정」·「신청」)이 뒤로 밀리되 사라지지는 않게 순서만 정해 준다
const SLOT_ORDER = ["나이", "혼인", "계층", "무주택", "소득", "자산", "자동차", "거주지", "지역"];
const slotOf = (label: string) => (label === "혼인기간" ? "혼인" : label);
const slotRank = (s: string) => {
  const i = SLOT_ORDER.indexOf(s);
  return i < 0 ? SLOT_ORDER.length : i;
};

/** 카드 묶음을 칸 맞춤(subgrid)에 올릴 꼴로. align이 false면 줄을 있는 그대로 둔다 */
function alignCards(cards: RuleCard[], align: boolean) {
  const slots = align
    ? [...new Set(cards.flatMap((c) => c.lines.map((l) => slotOf(l.label))))].sort((a, b) => slotRank(a) - slotRank(b))
    : [];
  const out = align
    ? cards.map((c) => ({
        ...c,
        lines: slots.map((s) => {
          const h = c.lines.find((l) => slotOf(l.label) === s);
          // 「해당 없음」은 내가 해당하지 않는다는 말로 읽혔다(2026-10-06) — 이 유형이 그 기준을 안 본다는 뜻을 그대로 쓴다
          return h ? { label: h.label, text: h.text, off: false } : { label: s, text: "보지 않음", off: true };
        }),
      }))
    : cards.map((c) => ({ ...c, lines: c.lines.map((l) => ({ label: l.label, text: l.text, off: false })) }));
  const anyNote = align && out.some((c) => c.note);
  // 칸 맞춤에 쓸 줄 수 — 머리줄 + 기준 줄들 + (메모 줄)
  return { cards: out, align, anyNote, rows: 1 + slots.length + (anyNote ? 1 : 0) };
}

function AmendLink({ n, label }: { n: NoticeListItem; label: string }) {
  return (
    <li>
      <Link href={noticePath(n.slug)}>
        <span className="chip amend">{label}</span> {n.title} <small>{dateK(n.posted_at)}</small>
      </Link>
    </li>
  );
}

export default async function NoticePage({ params }: Params) {
  const n = await load(params);
  if (!n) notFound();
  const [areas, chain, complexes, supply, eligRules, noticeElig, prior, options, facts] = await Promise.all([
    getNoticeAreas(n.id), getAmendChain(n), getNoticeComplexes(n.id), getNoticeSupply(n.id), getEligibilityRules(),
    getNoticeEligibility(n.id),
    // 「내 조건」에 붙일 직전 같은 계열 공고의 경쟁률(사용자 요청 2026-09-14). 결과 표가 없는 계열은 null
    getPriorCompetition(n),
    // 이 시도가 /area로 발행되는지 — 미달 시도는 /로 301이라 빵부스러기·태그가 리다이렉트를 가리키면 안 된다.
    // 레이아웃도 같은 함수를 부르지만 React cache가 한 요청 안에서 한 번만 돌린다
    listFilterOptions(undefined),
    // 마이홈 단지정보로 채운 단지 사실(S5). 첨부를 못 여는 LH 공고에 실을 수 있는 유일한 단지 쪽 사실이다.
    // S5가 PNU 후보를 하나로 못 좁힌 공고는 complex_code가 비어 있어 null이 온다 — 섹션을 안 그린다
    getComplexFacts(n.complex_code, n.housing_type),
  ]);
  // 빵부스러기(JSON-LD BreadcrumbList) — 화면의 「← 목록」·지역 태그와 같은 길이어야 한다
  const areaLink = (options.sido.find((o) => o.value === n.sido)?.count ?? 0) >= AREA_MIN_COUNT ? areaPath(n.sido) : null;
  const crumbs = [
    { name: "공고 목록", path: ROUTES.home },
    ...(areaLink ? [{ name: sidoShort(n.sido), path: areaLink }] : []),
    { name: n.title, path: noticePath(n.canonical_slug ?? n.slug) },
  ];
  // 공고문에서 읽은 자격 묶음(notice_eligibility, 0024)이 있으면 그것을 그린다 — 장기전세는 면적×순위×자녀가산×맞벌이로
  // 갈려 시드 한 줄로는 거짓말이었다(사용자 지적 2026-09-14). 없는 공고만 아래 제도 일반 기준(supply_type)으로 후퇴한다.
  // supply_type.housing_type이 notice.housing_type과 잇는 고리(0020). 유형마다 조건 종류가 달라
  // null인 항목은 그 유형에서 안 보는 기준이라 화면에서도 뺀다.
  // 민간임대(청년안심주택)는 사업자마다 조판이 달라 공고문 자격 묶음을 못 읽는다. 자격은 단지가 달라도 같은 제도 고정 규칙이라
  // 시드 카드(ppmh_*, 일반공급을 「자산·자동차 기준 없음」으로 적는다) 대신 공고문에서 확인한 규칙을 직접 그린다(lib/mingan-fit.ts)
  const isMingan = !noticeElig && n.housing_type === "공공지원민간임대";
  const allTypes = noticeElig || isMingan ? [] : eligRules.types.filter((t) => t.housing_type === n.housing_type);
  // 제목이 대는 유형만 앞에 세운다 — 「청년 매입임대주택」 공고 한 장에 제도 전체 6종이 늘어서서
  // 정작 이 공고 유형이 묻혔다(사용자 지적 2026-09-21). 못 고르면 예전처럼 전부 그린다.
  // 고른 뒤에도 나머지를 지우지 않고 접어 둔다 — 제목으로 가른 것이라 틀렸을 때 길이 막히면 안 된다
  const picked = allTypes.length ? recruitedTypeCodes(n.housing_type, n.title) : [];
  // 든든전세는 매입임대 유형이 아니라 따로 선 시드(safe, housing_type 든든전세)라 allTypes 밖에서 찾는다
  const hit = eligRules.types.filter((t) => picked.includes(t.code));
  const eligTypes = hit.length ? hit : allTypes;
  const restTypes = hit.length ? allTypes.filter((t) => !picked.includes(t.code)) : [];
  const minganCards = isMingan ? minganRuleCards(eligRules.types) : [];
  // 공급현황 표를 못 읽은 공고(첨부가 안내문이거나 CID 폰트)는 고를 주택형이 없어 「내 조건」을 띄우지 않는다
  const minganFit = isMingan && supply.length > 0;
  // 소득 줄에 %만 있으면 얼마인지 알려면 접힌 표를 열어 맞춰 봐야 했다(사용자 지적 2026-10-06) — 1인 가구 금액을 바로 붙인다.
  // 내 가구원수 기준 금액은 저장된 조건이 있을 때 판정 줄(EligRuleCards)이 따로 말한다
  // 1인 가구 금액은 소규모 가구 가산(+20%p)을 얹은 값이다 — 공고도 「(1인) 4,576,036원」처럼 가산한 금액을 싣는다
  const oneLimit = (t: (typeof eligRules.types)[number]) => {
    const pct = incomePctFor(t, { dual: false, marital: "미혼", household: 1 });
    return pct == null ? null : incomeLimit(eligRules.income, 1, pct);
  };
  const cardOf = (t: (typeof eligRules.types)[number]): RuleCard => ({
    key: t.code,
    title: t.category,
    // 시드의 든든전세 카드는 HUG 이름표를 달고 있다 — LH 공고에서 「(HUG)」를 달면 다른 기관 공고처럼 읽힌다
    sub: t.code === "safe" && !/HUG|주택도시보증/.test(n.agency) ? "" : t.name,
    // 시드의 「무관」은 선정 방식이 아니라 빈칸이다 — 오른쪽 꼬리표로 달면 뜻이 없다
    right: t.ranking_method && t.ranking_method !== "무관" ? t.ranking_method : null,
    lines: ruleLines(t).map((l) => {
      const lim = l.label === "소득" ? oneLimit(t) : null;
      return lim ? { ...l, text: `${l.text} (1인 가구 월 ${won(lim)})` } : l;
    }),
    note: t.note,
    // 판정에 안 쓰는 배점/순위 칸은 덜어 낸다 — 카드마다 통째로 실으면 RSC 짐이 유형 수만큼 불어난다
    type: { ...t, score: {}, ranks: [], general_ranks: [], note: null },
  });
  // 제목이 다른 제도(든든전세)를 가리키면 절 머리도 그 제도 이름으로
  const ruleHousing = eligTypes.every((t) => t.housing_type === eligTypes[0]?.housing_type) && eligTypes[0]?.housing_type ? eligTypes[0].housing_type : n.housing_type;
  const ruleCards: RuleCard[] = minganCards.length
    ? minganCards.map((c) => ({ key: c.title, title: c.title, sub: c.sub, right: null, lines: c.lines, note: null }))
    : eligTypes.map(cardOf);
  const noticeYear = n.posted_at ? new Date(n.posted_at).getFullYear() : null;
  // 신청자격에 실제로 쓰인 %만 열로 추린다 — 8종 전부 보여주면 모바일에서 표가 너무 넓어진다
  const incomePcts = minganCards.length
    ? [...MINGAN_INCOME_PCTS]
    : [...new Set(eligTypes.map((t) => t.income_pct).filter((p): p is number => p !== null))].sort((a, b) => a - b);
  const incomeRows = incomePcts.length
    ? Array.from({ length: HOUSEHOLD_MAX }, (_, i) => i + 1).map((h) => ({
        household: h,
        values: incomePcts.map((pct) => eligRules.income.find((r) => r.household === h && r.pct === pct)?.monthly_won ?? null),
      }))
    : [];
  // 매입임대 별첨(호실 단위)이면 호수·면적·금액 열을 더 보여준다
  const hasUnits = complexes.some((c) => c.unit_count != null);
  const unitTotal = complexes.reduce((a, c) => a + (c.unit_count ?? 0), 0);
  const m = moneyOf(n);
  const L = agencyLabels(n);
  const showAreaTable = areas.length > 1 || (areas.length === 1 && areas[0].supply_count != null && !n.address);
  // 시도가 하나뿐이면 줄마다 되풀이하지 않고 제목에서 한 번만 말한다(사용자 지적 2026-09-21)
  const oneSido = new Set(areas.map((a) => a.sido)).size === 1;
  const areaMax = areas.reduce((a, x) => Math.max(a, x.supply_count ?? 0), 0);
  // 지도에 찍을 시군구. 시군구를 모르는 줄(미지정)은 찍을 자리가 없다
  const areaPins = areas.filter((a) => a.sigungu).map((a) => ({ sido: a.sido, sigungu: a.sigungu as string, count: a.supply_count }));
  const region = regionLabel(n) || "전국";
  const period = n.apply_start_at || n.apply_end_at ? `${dateMD(n.apply_start_at)}–${dateMD(n.apply_end_at)}` : null;
  // 상한(첨부 공급현황 표)이 하한과 다를 때만 범위 표기. 월임대료 공고는 월임대료 범위, 전세형은 보증금 범위
  const hi = n.min_rent != null ? n.max_rent : n.max_deposit;
  const lo = n.min_rent != null ? n.min_rent : n.min_deposit;
  const range_ = hi != null && lo != null && hi > lo ? wonShort(hi) : null;
  const hasSchedule = Boolean(n.apply_start_at || n.apply_end_at || n.announce_at || n.schedule_steps?.length);
  const ph = applyPhase(n);
  const dl = deadlineChip(n);
  // 헤드라인에서 뺀 금액 — 제원 패널 한 줄로. 범위가 있으면 "최소~최대"
  const moneyRow = m ? (range_ ? `${m.main}~${range_}` : `${m.main}부터`) : null;
  // 공급 구분과 입주 시작 — 공고문에는 있는데 화면에 없던 값이다(사용자 요청 2026-09-09).
  // 공급현황 표가 있으면 그 표가 근거, 없으면 단지 표의 [신규] 표시로 가른다.
  const newRows = supply.filter((s) => s.is_new).length;
  const oldRows = supply.length - newRows;
  const supplyKind = supply.length
    ? (newRows > 0 && oldRows > 0 ? "신규 공급과 재공급" : newRows > 0 ? "신규 공급" : "재공급")
    : complexes.length
      ? (complexes.some((c) => c.is_new) && complexes.some((c) => !c.is_new) ? "신규 공급과 재공급"
        : complexes.some((c) => c.is_new) ? "신규 공급" : "재공급")
      : null;
  // 입주 시작 예정 — 표에 여러 값이 있으면 가장 이른 것 하나. 「(예정)」 열이라 확정일이 아니다
  const moveInRaw = supply.map((s) => s.move_in_from).filter(Boolean).sort()[0] ?? null;
  const moveIn = moveInLabel(moveInRaw);

  // 이 화면에 실제로 링크가 걸린 말만 편다 — 공급현황 표(우선공급·공가·소득 조건)는 단지 상세에만 있다.
  // 설명은 있는데 본문에 링크가 없으면 어디를 눌러야 할지 알 수 없다(사용자 지적 2026-09-09)
  const terms = [
    n.housing_type,
    ...(supplyKind ? (supplyKind === "신규 공급과 재공급" ? ["신규 공급", "재공급"] : [supplyKind]) : []),
    ...(moveIn ? ["입주 시작"] : []),
  ];

  // 흐름도 나머지 단계(서류심사 대상자 발표·서류 제출·계약 체결)와 당첨자 발표를 날짜순으로 섞는다.
  // 공고문에 있는데 화면에서 빠져 있었다(사용자 지적 2026-09-09) — 서류 제출일은 접수일만큼 급한 날짜다.
  // 공고문에 시각이 있으면 날짜 뒤에 붙인다(사용자 지적 2026-09-09: "보통 시간까지 명시돼 있는데 안 보인다").
  // 흐름도에 시각이 없는 양식도 있어 없으면 날짜만 — 없는 시각을 지어내지 않는다.
  // 날짜와 시각은 따로 들고 다닌다 — 한 문자열로 붙이면 「2026.09.30 (수) 17:00」이 칸을 넘긴다(사용자 지적 2026-09-09).
  // 칸 안에서 둘 사이만 줄바꿈되게 두 조각으로 그린다(globals.css .step b).
  const at = (d: string | null, t?: string | null): Stamp | null => (d ? { date: dateK(d, true), time: t || null } : null);

  const tail = [
    ...(n.schedule_steps ?? []).map((s) => ({
      label: s.label,
      value: at(s.start, s.start_time),
      sub: at(s.end, s.end_time),
      at: s.start,
      /* 끝나는 날. 기간형 단계(서류 제출 09.28~09.30)는 끝날까지가 「진행 중」이다 */
      till: s.end || s.start,
    })),
    ...(n.announce_at ? [{ label: "당첨자 발표", value: at(n.announce_at, null), sub: null, at: n.announce_at, till: n.announce_at }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));

  // 카드는 사람이 달력에 적는 날짜만. 두 가지를 고쳤다(2026-09-21):
  //  - 접수가 하루짜리면 같은 날짜를 카드 두 장이 되풀이했다(LH 「09.29 / 09.29」) — 한 장으로 합치고 시각을 밑줄로 단다
  //  - 날짜를 못 읽은 공고는 「—」 카드 두 장이 자리만 먹었다 — 카드를 걷고 왜 비었는지 한 줄로 말한다
  const oneDay = Boolean(n.apply_start_at && n.apply_start_at === n.apply_end_at);
  const applyHours = [n.apply_start_tm, n.apply_end_tm].filter(Boolean).join(" ~ ") || null;
  const keyCards: { label: string; value: Stamp; foot?: string | null; from: string | null; till: string | null }[] = oneDay
    ? [{ label: "접수", value: { date: dateK(n.apply_start_at, true), time: null }, foot: applyHours, from: n.apply_start_at, till: n.apply_start_at }]
    : [
        ...(n.apply_start_at ? [{ label: "접수 시작", value: at(n.apply_start_at, n.apply_start_tm) as Stamp, from: n.apply_start_at, till: n.apply_start_at }] : []),
        ...(n.apply_end_at ? [{ label: "접수 마감", value: at(n.apply_end_at, n.apply_end_tm) as Stamp, from: n.apply_end_at, till: n.apply_end_at }] : []),
      ];
  // 카드로 올라간 접수 날짜는 목록에서 뺀다 — 한 값은 한 곳
  const restSteps: { label: string; value: Stamp | null; sub?: Stamp | null; from?: string | null; till?: string | null }[] = [
    { label: "공고일", value: at(n.posted_at, null), from: n.posted_at, till: n.posted_at },
    ...tail,
    ...(n.announce_at ? [] : [{ label: "당첨자 발표", value: null }]),
  ];

  // 지난 일정은 흐리게, 오늘과 앞으로의 일정은 눈에 띄게(사용자 요청 2026-09-22).
  // 「이미 지난 것보다 앞으로의 일정에 포커스」 — 지우지는 않는다. 흐름을 읽으려면 지난 단계도 있어야 한다.
  // 기준은 KST 오늘. ISR 한 시간이라 자정 직후 최대 한 시간은 어제 기준으로 보일 수 있다 —
  // 날짜 단위 표시라 「오늘」이 하루 어긋나는 게 전부고, 마감 판정(applyPhase)은 여기 기대지 않는다.
  const today = todayKST();
  type When = "past" | "now" | "ahead";
  const whenOf = (from?: string | null, till?: string | null): When | null => {
    const a = from ?? till;
    const b = till ?? from;
    if (!a || !b) return null;
    if (b < today) return "past";
    if (a <= today) return "now";
    return "ahead";
  };
  // 앞으로 남은 것 중 가장 이른 하나에만 꼬리표를 단다. 여럿에 붙이면 강조가 아니라 배경이 된다
  const keyWhen = keyCards.map((s) => whenOf(s.from, s.till));
  const keyNext = keyWhen.indexOf("ahead");
  const restWhen = restSteps.map((s) => whenOf(s.from, s.till));
  const restNext = restWhen.indexOf("ahead");
  /** 꼬리표 글자 — 「예정」보다 「D-3」이 쓸모 있다(사용자 결정 2026-09-22). 기간형 단계는 시작일까지 센다 */
  const dtag = (from?: string | null, till?: string | null) => {
    const d = daysUntil(from ?? till ?? null);
    return d == null ? null : d <= 0 ? "오늘" : `D-${d}`;
  };

  // 민간임대 카드(공통/특별공급/일반공급)는 **서로 대등한 유형이 아니다** — 한 제도를 세 측면으로 쪼갠 것이라
  // 공통 카드의 빈 소득 줄을 「해당 없음」으로 채우면 "소득을 안 본다"는 거짓말이 된다. 칸 맞춤은 유형 카드에만 건다
  const mainBlock = alignCards(ruleCards, minganCards.length === 0);
  // 판정은 지역 제한이 「서울」인 유형만 등급표를 본다 — 서울 등급 줄만 넘겨 클라이언트 짐을 줄인다
  const seoulTiers = eligRules.tiers.filter((t) => t.tier === "서울");
  const restBlock = alignCards(restTypes.map(cardOf), true);

  // 차례 — 머리글 밑에 붙어 따라다닌다(components/detail-nav.tsx). 여기 적힌 id는 아래 섹션의 id와 같아야 한다
  const navItems = [
    ...(complexes.length > 0 ? [{ id: "complexes", label: `단지 ${num(complexes.length, "곳")}` }] : []),
    ...(facts ? [{ id: "complex", label: "단지 정보" }] : []),
    { id: "schedule", label: "일정" },
    ...(noticeElig || minganFit ? [{ id: "fit", label: "내 조건" }] : []),
    ...(noticeElig || ruleCards.length > 0 ? [{ id: "eligibility", label: "신청자격" }] : []),
    ...(showAreaTable && areas.length > 0 ? [{ id: "areas", label: "지역별 호수" }] : []),
  ];

  return (
    <article className="stage">
      {/* 구조화 데이터 — docs/url-structure.md: 공고 페이지는 ItemList + Event.
          canonical과 같은 경로로 @id를 만든다(정본이 따로 있으면 정본) */}
      <JsonLd graph={noticeGraph(n, complexes, noticePath(n.canonical_slug ?? n.slug), crumbs, noticeDescription(n))} />
      {/* 머리글이 헤더에 가리면 제목·상태를 헤더 자리에 띄운다(사용자 요청 2026-09-09) */}
      <DetailHeadBar
        title={n.title}
        sub={`${n.agency} | ${n.housing_type}`}
        state={{ label: ph.label, tone: ph.tone }}
        back={{ href: ROUTES.home, label: "← 목록" }}
        action={<ExternalLink className="btn" href={n.source_url}>{L.original}</ExternalLink>}
      />
      {/* 머리글과 차례는 두 칸(본문|패널) **밖**에 둔다(2026-09-21) — 제목이 오른쪽 패널 폭만큼 눌리지 않고,
          좁은 화면에서 오른쪽 패널(마감·금액·원문)을 제목 바로 밑으로 끌어올릴 수 있다 */}
      <header className="d-head">
        <div className="d-tags">
          {/* 뒤로가기는 이 줄 맨 앞에 — 혼자 한 행을 쓰지 않는다(사용자 요청 2026-09-09) */}
          <Link href={ROUTES.home} className="d-back">← 목록</Link>
          {/* D-day는 오른쪽 카드가 크게 센다 — 여기서 또 세지 않는다 */}
          <span className="tag type"><Term>{n.housing_type}</Term></span>
          {/* 사업 태그(0039) — 같은 사업의 다른 공고와 제도 설명으로 건너가는 길. 글이 있는 사업만 링크로 단다 */}
          {(n.programs ?? []).filter((p) => programDoc(p)).map((p) => (
            <Link key={p} href={programPath(p)} className="tag link">{p}</Link>
          ))}
          <span className="tag">{n.agency}</span>
          {/* 지역 태그는 /area/{시도}로 가는 링크다 — 상세에서 같은 지역 다른 공고로 건너가는 유일한 길이고,
              크롤러가 상세에서 목록으로 되돌아 나가는 길이기도 하다(2026-09-15 SEO 점검) */}
          {areaLink && <Link href={areaLink} className="tag link">{sidoShort(n.sido)}</Link>}
          {n.sector === "민간임대" && <span className="tag">{n.sector}</span>}
          {n.house_type && <span className="tag">{n.house_type}</span>}
          {/* 공급/재공급은 태그 줄에서 바로 읽혀야 한다(사용자 요청 2026-09-09) */}
          {supplyKind && <span className="tag"><TermText>{supplyKind}</TermText></span>}
          {n.amends_source_key && <span className="tag acc">정정공고</span>}
        </div>
        <h1 className="d-title">{n.title}</h1>
        {/* 같은 공고가 기관 seq 여러 개로 올라온 경우. URL은 살려 두고(하지 말 것 6)
            최신 글로 보내 준다 — 여기 남은 값은 옛 회차의 것일 수 있다 */}
        {n.canonical_slug && (
          <p className="d-canon">
            이 공고는 <Link href={noticePath(n.canonical_slug)}>최신 공고문</Link>으로 대체됐습니다.
            아래 내용은 이 회차 기준입니다.
          </p>
        )}
        {/* 헤드라인은 금액이 아니라 접수 상태다. 다만 한 줄로 — 본론은 아래 단지 목록과 지도다(사용자 요청 2026-09-09) */}
        <p className="d-when">
          <b className={`when ${ph.tone}`}>{ph.label}</b>
          {ph.note && <span>{ph.note}</span>}
        </p>
      </header>

      {/* 긴 페이지의 차례 — 무엇이 어디 있는지 먼저 보인다(사용자 지적 2026-09-14: "나열식이라 보기 힘들다").
          헤더 밑에 붙어 따라오고 지금 읽는 섹션을 표시한다(2026-09-21) */}
      <DetailNav items={navItems} />

      <div className="detail hd-out">
        {/* 지도와 목록은 본문 칸 **밖**의 형제다(2026-09-22) — 폰에서 이 덩이만 요약 패널보다도 위로
            끌어올리려면 그래야 한다(사용자 요청). 넓은 화면에서는 격자 1행 1열이라 자리가 전과 같다 */}
        {complexes.length > 0 && (
          <div className="detail-lead">
            <section className="dsec lead" id="complexes">
              {/* 제목 줄(「공급 단지 62곳 | 1,484호」)은 탐색기 머리의 수량과 같은 말이라 뺐다(사용자 요청 2026-09-09).
                  호수는 탐색기 안 수량 줄이 이어받는다 */}
              <h2 className="sr-only">공급 단지</h2>
              <ComplexExplorer items={complexes} hasUnits={hasUnits} unitTotal={unitTotal} noticeSlug={n.slug} />
            </section>
          </div>
        )}
        <div className="detail-main">

          {/* 단지 탐색기가 이미 같은 곳에 핀을 찍고 있으면 그리지 않는다 — 민간임대(단지 1곳)는 공고 주소와 단지 주소가
              같아 지도가 두 번 나왔다(사용자 지적 2026-09-15). 단지가 여럿인 공고는 notice.address가 비어 있어 원래 안 그린다 */}
          {n.address && complexes.length === 0 && (
            <section className="dsec lead">
              <h2>위치</h2>
              <div className="d-map"><NaverMap address={n.address} title={n.complex_name ?? n.title} sub={n.housing_type} /></div>
              <p className="note">지도 위치는 주소 기준 근사치입니다. 핀이나 로드뷰 버튼을 누르면 거리뷰가 열립니다. {n.address}</p>
            </section>
          )}

          {/* 첨부를 못 여는 공고(LH)에 단지 쪽 사실을 싣는 자리. 지도 바로 밑이 맞다 —
              「여기가 어디인가」 다음에 오는 물음이 「이 단지는 어떤 단지인가」다.
              단지가 여럿인 공고는 위 탐색기가 그 자리를 이미 맡고 있어 S5가 코드를 안 붙인다 */}
          {facts && <ComplexFactsSection facts={facts} housingType={n.housing_type} />}

          {(chain.original || chain.amendments.length > 0) && (
            <section className="dsec">
              <h2>정정 이력</h2>
              <ul className="amend-list">
                {chain.original && <AmendLink n={chain.original} label="원공고" />}
                {chain.amendments.map((a) => <AmendLink key={a.id} n={a} label="정정공고" />)}
              </ul>
            </section>
          )}

          {/* 자리는 원래대로 정정 이력 다음이다(사용자 정정 2026-09-09) — 올리지 않고 lead 톤과
              접수 시작·마감 강조로만 눈에 띄게 한다 */}
          <section className="dsec lead" id="schedule">
            <h2>접수 일정</h2>
            {hasSchedule ? (
              <>
                {/* 달력에 적는 날짜만 카드. 나머지 단계는 한 줄씩 — 카드 여덟 장이 나란히 서면 어느 것이 급한지 안 보였다(2026-09-14) */}
                {keyCards.length > 0 ? (
                  <div className="steps">
                    {keyCards.map((s, i) => {
                      const w = keyWhen[i];
                      const next = w === "ahead" && i === keyNext;
                      return (
                        <div key={s.label} className={`step key${w === "past" ? " past" : w === "now" ? " on now" : next ? " on" : ""}`}>
                          <span>
                            {s.label}
                            {w === "now" && <i className="st-flag now">오늘</i>}
                            {next && <i className="st-flag next">{dtag(s.from, s.till)}</i>}
                          </span>
                          <b><Stamped v={s.value} /></b>
                          {s.foot && <em>{s.foot}</em>}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* 빈 카드를 세우느니 왜 비었는지 말한다 — 공고문에서 접수 기간을 못 읽은 회차다 */
                  <p className="note" style={{ margin: "0 0 2px" }}>접수 기간은 {L.originalDoc}에서 확인하세요.</p>
                )}
                <ol className="tl">
                  {restSteps.map((s, i) => {
                    const w = restWhen[i];
                    const next = w === "ahead" && i === restNext;
                    return (
                      <li key={s.label} className={w === "past" ? "past" : w === "now" ? "now" : next ? "next" : undefined}>
                        <span>
                          {s.label}
                          {w === "now" && <i className="st-flag now">{s.sub ? "진행 중" : "오늘"}</i>}
                          {next && <i className="st-flag next">{dtag(s.from, s.till)}</i>}
                        </span>
                        <b>{s.value ? <Stamped v={s.value} /> : "—"}{s.sub && <em><Stamped v={s.sub} pre=" ~ " /></em>}</b>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <p className="note" style={{ marginTop: 0 }}>공고일 {dateK(n.posted_at, true)}. 접수 기간은 {L.originalDoc}에서 확인하세요.</p>
            )}
          </section>

          {noticeElig && (
            <section className="dsec lead" id="fit">
              <h2>내 조건에 맞는 단지</h2>
              <NoticeFit data={noticeElig.data} complexes={complexes} supply={supply} income={eligRules.income} tiers={eligRules.tiers} noticeSlug={n.slug} prior={prior} />
            </section>
          )}

          {minganFit && (
            <section className="dsec lead" id="fit">
              <h2>내 조건에 맞는 주택형</h2>
              <NoticeFitMingan
                supply={supply} types={eligRules.types} income={eligRules.income} tiers={eligRules.tiers}
                complexGu={complexes[0]?.sigungu ?? n.sigungu ?? null} incomeYear={eligRules.incomeYear} noticeYear={noticeYear}
              />
            </section>
          )}

          {noticeElig && (
            <NoticeEligibilitySection elig={noticeElig} incomeYear={eligRules.incomeYear} noticeYear={noticeYear} originalDoc={L.originalDoc} />
          )}

          {ruleCards.length > 0 && (
            <section className="dsec" id="eligibility">
              <h2>신청자격 <small className="dsec-src">{minganCards.length ? "청년안심주택 민간임대 제도 기준" : `${ruleHousing} 제도 일반 기준`}</small></h2>
              <p className="ne-sum">
                {minganCards.length
                  ? <>특별공급과 일반공급으로 나뉩니다. 이 공고가 실제로 모집하는 계층과 세부 조건은 {L.originalDoc} 기준.</>
                  : restTypes.length > 0
                    ? <>공고 제목이 가리키는 유형은 <b>{eligTypes.map((t) => (t.code === "safe" ? t.category : t.name)).join(" | ")}</b>입니다. 세부 조건은 {L.originalDoc} 기준.</>
                    : <>유형 {eligTypes.length}개. 이 공고가 실제로 모집하는 유형과 세부 조건은 {L.originalDoc} 기준.</>}{" "}
                {/* 2026-10-06에 자격진단을 열었다 — 여기서 넣은 조건이 위 카드의 판정에도 그대로 쓰인다 */}
                <Link href={ROUTES.eligibility}>내 조건으로 진단하기 →</Link>
              </p>
              <EligRuleCards block={mainBlock} income={eligRules.income} tiers={seoulTiers} />

              {/* 제목으로 가른 것이라 틀릴 수 있다 — 나머지 유형을 지우지 않고 접어 둔다 */}
              {restBlock.cards.length > 0 && (
                <details className="ne-fold">
                  <summary>
                    <b>{n.housing_type} 제도의 다른 유형 {restBlock.cards.length}가지</b>
                    <small>이 공고에는 해당하지 않을 수 있습니다</small>
                  </summary>
                  <div className="ne-fold-body"><EligRuleCards block={restBlock} income={eligRules.income} tiers={seoulTiers} /></div>
                </details>
              )}

              {incomeRows.length > 0 && (
                <details className="ne-fold">
                  {/* 공고는 통계청 발표 전년도 소득을 쓴다 — 「2025년」만 쓰면 옛 값처럼 읽힌다(사용자 지적 2026-09-14).
                      시드보다 오래된 공고에 「이 공고에 적용」이라 적으면 거짓말이다(당시엔 다른 표를 썼다) */}
                  <summary>
                    <b>가구원수별 월평균소득 기준</b>
                    <small>
                      {eligRules.incomeYear}년 소득 통계 기준
                      {noticeYear ? (noticeYear > eligRules.incomeYear ? `, ${noticeYear}년 공고에 적용` : `, 지금 기준이라 ${noticeYear}년 공고 당시와 다릅니다`) : ""}
                    </small>
                  </summary>
                  <div className="tbl ne-fold-body">
                    <table>
                      <thead>
                        <tr>
                          <th>가구원수</th>
                          {incomePcts.map((pct) => <th key={pct} className="num">{pct}%</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {incomeRows.map((row) => (
                          <tr key={row.household}>
                            <td>{row.household}인</td>
                            {row.values.map((v, i) => (
                              <td key={incomePcts[i]} className="num">{v != null ? wonKo(v) : "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </section>
          )}

          {showAreaTable && areas.length > 0 && (
            <section className="dsec" id="areas">
              <h2>
                {n.address ? "시군구별 공급호수" : "공급 지역"}
                {/* 시도가 하나면 제목이 그 말을 한 번만 한다 — 표 안에서 「서울특별시」가 24줄 되풀이됐다(사용자 지적 2026-09-21) */}
                {oneSido && <small className="dsec-src">{areas[0].sido} {num(areas.length, "곳")}</small>}
              </h2>
              {!n.address && (
                <p className="note" style={{ margin: "0 0 12px" }}>
                  주택별 주소는 공고문 첨부에만 있습니다.{areaPins.length > 0 ? " 아래는 시군구 단위로 센 호수입니다." : ""}
                </p>
              )}
              {/* 「주소는 있는데 왜 지도가 없냐」(사용자 지적 2026-09-21) — 단지 좌표가 없는 공고에 우리가 아는
                  가장 좁은 위치가 시군구다. 단지 탐색기나 「위치」 지도가 이미 있으면 그리지 않는다 */}
              {areaPins.length > 0 && complexes.length === 0 && !n.address && (
                <>
                  <AreaMap items={areaPins} label={`${region} 공급 지역 지도`} />
                  <p className="note" style={{ margin: "8px 0 14px" }}>핀은 시군구 중심입니다 — 주택이 실제로 있는 자리가 아닙니다.</p>
                </>
              )}
              <ul className="area-grid">
                {areas.map((a, i) => (
                  <li key={i}>
                    {/* 시군구를 모르는 줄은 시도 이름만 — 「강원 미지정」처럼 없는 말을 채우지 않는다 */}
                    <b>{a.sigungu ? (oneSido ? a.sigungu : `${sidoShort(a.sido)} ${a.sigungu}`) : sidoShort(a.sido)}</b>
                    <span>{num(a.supply_count, "호")}</span>
                    {/* 어느 구에 몰렸는지 눈으로 — 가장 많은 곳을 100으로 잡은 비율 띠 */}
                    {a.supply_count != null && areaMax > 0 && (
                      <i style={{ "--w": `${Math.round((a.supply_count / areaMax) * 100)}%` } as React.CSSProperties} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <GlossaryList terms={terms} />
        </div>

        <DetailAside
          tone={dl.tone}
          ddayLabel={dl.unit}
          ddayNum={dl.num}
          ddayNote={n.apply_end_at ? `${dateK(n.apply_end_at, true)}${n.apply_end_tm ? ` ${n.apply_end_tm}` : ""} 마감` : NO_DATE}
          /* 좁은 화면 하단 바에 세울 단 하나의 문. 이 패널은 폰에서 지면 2/3 아래로 내려간다(2026-09-21) */
          primary={<ExternalLink className="btn acc" href={n.source_url}>{L.originalShort}</ExternalLink>}
          cta={
            <>
              <ExternalLink className="btn acc lg" href={n.source_url}>{L.original}</ExternalLink>
              {n.portal_url && <ExternalLink className="btn lg" href={n.portal_url}>{L.portal}</ExternalLink>}
              <div className="cta-row">
                <SaveButton id={n.id} variant="panel" />
                <ShareButton title={n.title} text={`${n.agency} | ${n.housing_type}`} />
              </div>
            </>
          }
          /* 「공고 제원」과 「공고 정보」를 한 패널로 합쳤다(사용자 요청 2026-09-22: "이거 합쳐주고
             너무 많이 영역을 차지하는 것 같음"). 합치면서 **지면이 이미 말하는 값은 뺐다** —
             공급 기관·공급 유형·공급 구분은 제목 위 태그 줄이, 공고일과 접수 기간은 「접수 일정」이 센다.
             값이 빈 줄도 AsideSpecs가 지운다(「공급호수 준비 중」 같은 줄이 자리만 먹었다) */
          rows={[
            { label: m ? m.label : "금액", value: moneyRow ?? "원문 확인", lead: true },
            ...(m?.sub ? [{ label: "보증금", value: `${m.sub.replace("보증금 ", "")}부터`, lead: true }] : []),
            { label: "지역", value: region },
            { label: "공급호수", value: n.supply_count != null ? num(n.supply_count, "호") : null },
            { label: "입주 시작", value: moveIn },
            { label: "단지명", value: n.complex_name },
            /* 총세대수·난방·주소는 단지 정보 섹션이 더 정확한 값(마이홈 단지정보)으로 이미 말한다 —
               한 값은 한 곳. 두 벌을 나란히 두면 387세대와 388세대가 같은 지면에 뜬다 */
            ...(facts ? [] : [
              { label: "총세대수", value: n.total_household != null ? num(n.total_household, "세대") : null },
              { label: "난방", value: n.heating },
              { label: "주소", value: n.address },
            ]),
            { label: "문의처", value: n.contact },
          ]}
        />
      </div>

      {/* 고지는 본문 칸이 아니라 페이지 맨 밑 — 왼쪽 칸에 두면 오른쪽 카드 길이에 따라 푸터와 멀어진다(사용자 지적 2026-09-09) */}
      <div className="notice-bar foot">
        <span className="i">i</span>
        <span>본 자료는 참고용입니다. 정확한 내용과 최종 조건은 {n.agency}의 공식 공고문을 반드시 확인하세요.</span>
      </div>

      {/* 계산기는 헤더 버튼이 연다 — 이 공고 최소 금액을 첫 값으로 넘긴다(사용자 제안 2026-09-09) */}
      <CalcSeed deposit={n.min_deposit} rent={n.min_rent} sourceLabel={L.originalDoc} />
    </article>
  );
}
