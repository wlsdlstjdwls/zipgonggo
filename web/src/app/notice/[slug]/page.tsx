import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalcSeed } from "@/components/calc-context";
import { ComplexExplorer } from "@/components/complex-explorer";
import { DetailAside } from "@/components/detail-aside";
import { DetailHeadBar } from "@/components/detail-headbar";
import { ExternalLink } from "@/components/external-link";
import { GlossaryList, Term, TermText } from "@/components/glossary";
import { NaverMap } from "@/components/naver-map";
import { NoticeEligibilitySection } from "@/components/notice-eligibility";
import { NoticeFit } from "@/components/notice-fit";
import { NoticeFitMingan } from "@/components/notice-fit-mingan";
import { SaveButton } from "@/components/save-button";
import { ShareButton } from "@/components/share-button";
import { Spec, SpecList } from "@/components/spec-list";
import { agencyLabels } from "@/lib/agency";
import { HOUSEHOLD_MAX, ruleLines } from "@/lib/eligibility";
import { applyPhase, dateK, dateMD, daysUntil, deadlineChip, moneyOf, NO_DATE, num, won, wonKo, wonShort } from "@/lib/format";
import { MINGAN_INCOME_PCTS, minganRuleCards } from "@/lib/mingan-fit";
import { moveInLabel } from "@/lib/notice-view";
import {
  getAmendChain, getEligibilityRules, getNoticeAreas, getNoticeBySlug, getNoticeComplexes, getNoticeEligibility, getNoticeSupply, getPriorCompetition,
} from "@/lib/queries";
import { noticePath, ROUTES } from "@/lib/routes";
import { regionLabel } from "@/lib/sido";
import type { NoticeListItem } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

type Params = { params: Promise<{ slug: string }> };

async function load(params: Params["params"]) {
  const { slug } = await params;
  return getNoticeBySlug(decodeURIComponent(slug));
}

// docs/url-structure.md 공고 페이지 템플릿. 호실이 아직 없어 "{n}호실" 자리는 공급호수로 채운다.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const n = await load(params);
  if (!n) return { title: "공고를 찾을 수 없습니다" };
  const d = daysUntil(n.apply_end_at);
  const dday = d === null ? "" : d < 0 ? "(마감)" : `(D-${d})`;
  const supply = n.supply_count != null ? num(n.supply_count, "호") : "";
  return {
    title: `${n.title} — ${n.housing_type} ${supply} 보증금/임대료/접수일정`.replace(/\s+/g, " "),
    description: `${n.agency} ${n.title}. 접수 ${dateK(n.apply_start_at)}~${dateK(n.apply_end_at)}${dday}. ${regionLabel(n)} ${supply}. 최소 보증금 ${won(n.min_deposit)}, 최소 월임대료 ${won(n.min_rent)}.`,
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
  const [areas, chain, complexes, supply, eligRules, noticeElig, prior] = await Promise.all([
    getNoticeAreas(n.id), getAmendChain(n), getNoticeComplexes(n.id), getNoticeSupply(n.id), getEligibilityRules(),
    getNoticeEligibility(n.id),
    // 「내 조건」에 붙일 직전 같은 계열 공고의 경쟁률(사용자 요청 2026-09-14). 결과 표가 없는 계열은 null
    getPriorCompetition(n),
  ]);
  // 공고문에서 읽은 자격 묶음(notice_eligibility, 0024)이 있으면 그것을 그린다 — 장기전세는 면적×순위×자녀가산×맞벌이로
  // 갈려 시드 한 줄로는 거짓말이었다(사용자 지적 2026-09-14). 없는 공고만 아래 제도 일반 기준(supply_type)으로 후퇴한다.
  // supply_type.housing_type이 notice.housing_type과 잇는 고리(0020). 유형마다 조건 종류가 달라
  // null인 항목은 그 유형에서 안 보는 기준이라 화면에서도 뺀다.
  // 민간임대(청년안심주택)는 사업자마다 조판이 달라 공고문 자격 묶음을 못 읽는다. 자격은 단지가 달라도 같은 제도 고정 규칙이라
  // 시드 카드(ppmh_*, 일반공급을 「자산·자동차 기준 없음」으로 적는다) 대신 공고문에서 확인한 규칙을 직접 그린다(lib/mingan-fit.ts)
  const isMingan = !noticeElig && n.housing_type === "공공지원민간임대";
  const eligTypes = noticeElig || isMingan ? [] : eligRules.types.filter((t) => t.housing_type === n.housing_type);
  const minganCards = isMingan ? minganRuleCards(eligRules.types) : [];
  // 공급현황 표를 못 읽은 공고(첨부가 안내문이거나 CID 폰트)는 고를 주택형이 없어 「내 조건」을 띄우지 않는다
  const minganFit = isMingan && supply.length > 0;
  const ruleCards = minganCards.length
    ? minganCards.map((c) => ({ key: c.title, title: c.title, sub: c.sub, right: null as string | null, lines: c.lines, note: null as string | null }))
    : eligTypes.map((t) => ({ key: t.code, title: t.category, sub: t.name, right: t.ranking_method, lines: ruleLines(t), note: t.note }));
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
    })),
    ...(n.announce_at ? [{ label: "당첨자 발표", value: at(n.announce_at, null), sub: null, at: n.announce_at }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));

  // key = 사람이 달력에 적는 두 날짜. 나머지 단계보다 크게 그린다
  const steps: { label: string; value: Stamp | null; sub?: Stamp | null; on?: boolean; key?: boolean }[] = [
    { label: "공고일", value: at(n.posted_at, null) },
    { label: "접수 시작", value: at(n.apply_start_at, n.apply_start_tm), key: true },
    { label: "접수 마감", value: at(n.apply_end_at, n.apply_end_tm), on: true, key: true },
    ...tail,
    ...(n.announce_at ? [] : [{ label: "당첨자 발표", value: null }]),
  ];

  return (
    <article className="stage">
      {/* 머리글이 헤더에 가리면 제목·상태를 헤더 자리에 띄운다(사용자 요청 2026-09-09) */}
      <DetailHeadBar
        title={n.title}
        sub={`${n.agency} | ${n.housing_type}`}
        state={{ label: ph.label, tone: ph.tone }}
        back={{ href: ROUTES.home, label: "← 목록" }}
        action={<ExternalLink className="btn" href={n.source_url}>{L.original}</ExternalLink>}
      />
      <div className="detail">
        <div className="detail-main">
          <header className="d-head">
            <div className="d-tags">
              {/* 뒤로가기는 이 줄 맨 앞에 — 혼자 한 행을 쓰지 않는다(사용자 요청 2026-09-09) */}
              <Link href={ROUTES.home} className="d-back">← 목록</Link>
              {/* D-day는 오른쪽 카드가 크게 센다 — 여기서 또 세지 않는다 */}
              <span className="tag type"><Term>{n.housing_type}</Term></span>
              <span className="tag">{n.agency}</span>
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

          {/* 긴 페이지의 차례 — 무엇이 어디 있는지 먼저 보인다(사용자 지적 2026-09-14: "나열식이라 보기 힘들다") */}
          <nav className="d-nav" aria-label="이 페이지 차례">
            {complexes.length > 0 && <a href="#complexes">단지 {num(complexes.length, "곳")}</a>}
            <a href="#schedule">일정</a>
            {(noticeElig || minganFit) && <a href="#fit">내 조건</a>}
            {(noticeElig || ruleCards.length > 0) && <a href="#eligibility">신청자격</a>}
            {showAreaTable && areas.length > 0 && <a href="#areas">지역별 호수</a>}
            <a href="#info">공고 정보</a>
          </nav>

          {complexes.length > 0 && (
            <section className="dsec lead" id="complexes">
              {/* 제목 줄(「공급 단지 62곳 | 1,484호」)은 탐색기 머리의 수량과 같은 말이라 뺐다(사용자 요청 2026-09-09).
                  호수는 탐색기 안 수량 줄이 이어받는다 */}
              <h2 className="sr-only">공급 단지</h2>
              <ComplexExplorer items={complexes} hasUnits={hasUnits} unitTotal={unitTotal} noticeSlug={n.slug} />
            </section>
          )}

          {n.address && (
            <section className="dsec lead">
              <h2>위치</h2>
              <div className="d-map"><NaverMap address={n.address} title={n.complex_name ?? n.title} sub={n.housing_type} /></div>
              <p className="note">지도 위치는 주소 기준 근사치입니다. 핀이나 로드뷰 버튼을 누르면 거리뷰가 열립니다. {n.address}</p>
            </section>
          )}

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
                {/* 달력에 적는 두 날짜만 카드. 나머지 단계는 한 줄씩 — 카드 여덟 장이 나란히 서면 어느 것이 급한지 안 보였다(2026-09-14) */}
                <div className="steps">
                  {steps.filter((s) => s.key).map((s) => (
                    <div key={s.label} className={`step key${s.on && s.value ? " on" : ""}`}>
                      <span>{s.label}</span>
                      <b>{s.value ? <Stamped v={s.value} /> : "—"}</b>
                      {s.sub && <em><Stamped v={s.sub} pre="~ " /></em>}
                    </div>
                  ))}
                </div>
                <ol className="tl">
                  {steps.filter((s) => !s.key).map((s) => (
                    <li key={s.label}>
                      <span>{s.label}</span>
                      <b>{s.value ? <Stamped v={s.value} /> : "—"}{s.sub && <em><Stamped v={s.sub} pre=" ~ " /></em>}</b>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="note" style={{ marginTop: 0 }}>공고일 {dateK(n.posted_at, true)}. 접수 기간은 {L.originalDoc}에서 확인하세요.</p>
            )}
          </section>

          {noticeElig && (
            <section className="dsec lead" id="fit">
              <h2>내 조건에 맞는 단지</h2>
              <p className="note" style={{ margin: "0 0 12px" }}>
                이 공고문의 소득과 자산, 순위 기준에 내 조건을 대 보고 맞는 단지를 추립니다. 값은 어디로도 보내지 않습니다.
              </p>
              <NoticeFit data={noticeElig.data} complexes={complexes} supply={supply} income={eligRules.income} tiers={eligRules.tiers} noticeSlug={n.slug} prior={prior} />
            </section>
          )}

          {minganFit && (
            <section className="dsec lead" id="fit">
              <h2>내 조건에 맞는 주택형</h2>
              <p className="note" style={{ margin: "0 0 12px" }}>
                청년안심주택 민간임대의 소득과 자산, 순위 기준에 내 조건을 대 보고 넣을 수 있는 주택형을 추립니다. 값은 어디로도 보내지 않습니다.
              </p>
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
              <h2>신청자격 <small className="dsec-src">{minganCards.length ? "청년안심주택 민간임대 제도 기준" : `${n.housing_type} 제도 일반 기준`}</small></h2>
              <p className="ne-sum">
                {minganCards.length
                  ? <>특별공급과 일반공급으로 나뉩니다. 이 공고가 실제로 모집하는 계층과 세부 조건은 {L.originalDoc} 기준.</>
                  : <>유형 {eligTypes.length}개. 이 공고가 실제로 모집하는 유형과 세부 조건은 {L.originalDoc} 기준.</>}{" "}
                <Link href={ROUTES.eligibility}>내 조건으로 진단하기 →</Link>
              </p>
              {/* 표(가로 스크롤)는 좁은 화면에서 유형 열이 밀려나 안 보인다는 지적(2026-09-09) — 자가진단
                  카드(elig-card/elig-why)와 같은 모양으로 유형 하나당 카드 하나씩 쌓는다 */}
              <ul className="elig-list">
                {ruleCards.map((c) => (
                  <li key={c.key} className="elig-card">
                    <div className="elig-card-h">
                      <b>{c.title}</b>
                      <span>{c.sub}</span>
                      {c.right && <span className="elig-card-r"><small>{c.right}</small></span>}
                    </div>
                    <ul className="elig-why">
                      {c.lines.map((l) => (
                        <li key={l.label}><span>{l.label}</span><p>{l.text}</p></li>
                      ))}
                    </ul>
                    {c.note && <p className="elig-memo">{c.note}</p>}
                  </li>
                ))}
              </ul>

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
              <h2>{n.address ? "시군구별 공급호수" : "공급 지역"}</h2>
              {!n.address && <p className="note" style={{ margin: "0 0 12px" }}>주택별 주소는 공고문 첨부에만 있습니다.</p>}
              <div className="tbl">
                <table>
                  <thead><tr><th>시도</th><th>시군구</th><th className="num">공급호수</th></tr></thead>
                  <tbody>
                    {areas.map((a, i) => (
                      <tr key={i}>
                        <td>{a.sido}</td>
                        <td>{a.sigungu ?? <span style={{ color: "var(--dim)" }}>미지정</span>}</td>
                        <td className="num">{num(a.supply_count, "호")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 원문·포털 링크는 오른쪽 카드가 이미 준다 — 같은 링크를 두 번 걸지 않는다(사용자 요청 2026-09-09).
              공급 구분·입주 시작·문의처도 태그 줄과 제원 패널이 이미 말한다 — 「한 값은 한 곳」(2026-09-14). 여기엔 그 밖의 값만 */}
          <section className="dsec" id="info">
            <h2>공고 정보</h2>
            <SpecList>
              <Spec label="공급 기관" value={n.agency} />
              <Spec label="공고일" value={dateK(n.posted_at)} />
              <Spec label="공급 유형" value={<Term>{n.housing_type}</Term>} />
              <Spec label="단지명" value={n.complex_name} />
              <Spec label="총세대수" value={n.total_household != null ? num(n.total_household, "세대") : null} />
              <Spec label="난방" value={n.heating} />
              <Spec label="주소" value={n.address} wide />
            </SpecList>
          </section>

          <GlossaryList terms={terms} />
        </div>

        <DetailAside
          tone={dl.tone}
          ddayLabel={dl.unit}
          ddayNum={dl.num}
          ddayNote={n.apply_end_at ? `${dateK(n.apply_end_at, true)}${n.apply_end_tm ? ` ${n.apply_end_tm}` : ""} 마감` : NO_DATE}
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
          rows={[
            { label: m ? m.label : "금액", value: moneyRow ?? "원문 확인" },
            ...(m?.sub ? [{ label: "보증금", value: `${m.sub.replace("보증금 ", "")}부터` }] : []),
            /* 공급기관·공급유형은 제목 위 태그가 이미 말한다 — 카드에서 뺐다(사용자 지적 2026-09-09) */
            { label: "지역", value: region },
            { label: "공급호수", value: n.supply_count != null ? num(n.supply_count, "호") : null },
            { label: "공급 구분", value: supplyKind },
            { label: "입주 시작", value: moveIn },
            { label: "접수", value: period ?? NO_DATE },
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
