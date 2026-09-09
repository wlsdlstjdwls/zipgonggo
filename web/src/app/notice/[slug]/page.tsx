import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalcSeed } from "@/components/calc-context";
import { ComplexExplorer } from "@/components/complex-explorer";
import { DetailAside } from "@/components/detail-aside";
import { DetailHeadBar } from "@/components/detail-headbar";
import { ExternalLink } from "@/components/external-link";
import { GlossaryList, Term } from "@/components/glossary";
import { NaverMap } from "@/components/naver-map";
import { SaveButton } from "@/components/save-button";
import { Spec, SpecList } from "@/components/spec-list";
import { agencyLabels } from "@/lib/agency";
import { applyPhase, dateK, dateMD, daysUntil, deadlineChip, moneyOf, NO_DATE, num, won, wonShort } from "@/lib/format";
import { moveInLabel } from "@/lib/notice-view";
import { getAmendChain, getNoticeAreas, getNoticeBySlug, getNoticeComplexes, getNoticeSupply } from "@/lib/queries";
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
    alternates: { canonical: noticePath(n.slug) },
  };
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
  const [areas, chain, complexes, supply] = await Promise.all([
    getNoticeAreas(n.id), getAmendChain(n), getNoticeComplexes(n.id), getNoticeSupply(n.id),
  ]);
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

  const terms = [
    n.housing_type,
    ...(supplyKind ? (supplyKind === "신규 공급과 재공급" ? ["신규 공급", "재공급"] : [supplyKind]) : []),
    ...(supply.some((s) => s.units_reserve != null) ? ["공가", "예비입주자"] : []),
    ...(supply.some((s) => s.units_priority != null) ? ["우선공급", "일반공급"] : []),
    ...(supply.some((s) => s.income_option) ? ["소득있음", "소득없음"] : []),
    ...(moveIn ? ["입주 시작"] : []),
  ];

  // 흐름도 나머지 단계(서류심사 대상자 발표·서류 제출·계약 체결)와 당첨자 발표를 날짜순으로 섞는다.
  // 공고문에 있는데 화면에서 빠져 있었다(사용자 지적 2026-09-09) — 서류 제출일은 접수일만큼 급한 날짜다.
  // 공고문에 시각이 있으면 날짜 뒤에 붙인다(사용자 지적 2026-09-09: "보통 시간까지 명시돼 있는데 안 보인다").
  // 흐름도에 시각이 없는 양식도 있어 없으면 날짜만 — 없는 시각을 지어내지 않는다.
  const at = (d: string | null, t?: string | null) => (d ? `${dateK(d, true)}${t ? ` ${t}` : ""}` : null);

  const tail = [
    ...(n.schedule_steps ?? []).map((s) => ({
      label: s.label,
      value: at(s.start, s.start_time),
      sub: s.end ? `~ ${at(s.end, s.end_time)}` : null,
      at: s.start,
    })),
    ...(n.announce_at ? [{ label: "당첨자 발표", value: dateK(n.announce_at, true), sub: null, at: n.announce_at }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));

  // key = 사람이 달력에 적는 두 날짜. 나머지 단계보다 크게 그린다
  const steps: { label: string; value: string | null; sub?: string | null; on?: boolean; key?: boolean }[] = [
    { label: "공고일", value: dateK(n.posted_at, true) },
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
              {supplyKind && <span className="tag">{supplyKind}</span>}
              {n.amends_source_key && <span className="tag acc">정정공고</span>}
            </div>
            <h1 className="d-title">{n.title}</h1>
            {/* 헤드라인은 금액이 아니라 접수 상태다. 다만 한 줄로 — 본론은 아래 단지 목록과 지도다(사용자 요청 2026-09-09) */}
            <p className="d-when">
              <b className={`when ${ph.tone}`}>{ph.label}</b>
              {ph.note && <span>{ph.note}</span>}
            </p>
          </header>

          {complexes.length > 0 && (
            <section className="dsec lead">
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
          <section className="dsec lead">
            <h2>접수 일정</h2>
            {hasSchedule ? (
              <div className="steps">
                {steps.map((s) => (
                  <div key={s.label} className={`step${s.key ? " key" : ""}${s.on && s.value ? " on" : ""}`}>
                    <span>{s.label}</span>
                    <b>{s.value ?? "—"}</b>
                    {s.sub && <em>{s.sub}</em>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="note" style={{ marginTop: 0 }}>공고일 {dateK(n.posted_at, true)}. 접수 기간은 {L.originalDoc}에서 확인하세요.</p>
            )}
          </section>

          {showAreaTable && areas.length > 0 && (
            <section className="dsec">
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

          {/* 원문·포털 링크는 오른쪽 카드가 이미 준다 — 같은 링크를 두 번 걸지 않는다(사용자 요청 2026-09-09) */}
          <section className="dsec">
            <h2>공고 정보</h2>
            <SpecList>
              <Spec label="공급 유형" value={<Term>{n.housing_type}</Term>} />
              <Spec label="공급 구분" value={supplyKind} />
              <Spec label="입주 시작" value={moveIn} />
              <Spec label="문의처" value={n.contact} />
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
          ddayNote={n.apply_end_at ? `${at(n.apply_end_at, n.apply_end_tm)} 마감` : NO_DATE}
          cta={
            <>
              <ExternalLink className="btn acc lg" href={n.source_url}>{L.original}</ExternalLink>
              {n.portal_url && <ExternalLink className="btn lg" href={n.portal_url}>{L.portal}</ExternalLink>}
              <SaveButton id={n.id} variant="panel" />
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
          updatedNote={`갱신 ${n.updated_at} | ${L.updatedVia}`}
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
