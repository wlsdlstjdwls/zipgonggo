import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ComplexExplorer } from "@/components/complex-explorer";
import { DetailAside } from "@/components/detail-aside";
import { ExternalLink } from "@/components/external-link";
import { NaverMap } from "@/components/naver-map";
import { SaveButton } from "@/components/save-button";
import { Spec, SpecList } from "@/components/spec-list";
import { agencyLabels } from "@/lib/agency";
import { applyPhase, count, dateK, dateMD, daysUntil, deadlineChip, moneyOf, num, won, wonShort } from "@/lib/format";
import { getAmendChain, getNoticeAreas, getNoticeBySlug, getNoticeComplexes } from "@/lib/queries";
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
  const [areas, chain, complexes] = await Promise.all([getNoticeAreas(n.id), getAmendChain(n), getNoticeComplexes(n.id)]);
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
  const hasSchedule = Boolean(n.apply_start_at || n.apply_end_at || n.announce_at);
  const ph = applyPhase(n);
  const dl = deadlineChip(n);
  // 헤드라인에서 뺀 금액 — 제원 패널 한 줄로. 범위가 있으면 "최소~최대"
  const moneyRow = m ? (range_ ? `${m.main}~${range_}` : `${m.main}부터`) : null;

  const steps: { label: string; value: string | null; on?: boolean }[] = [
    { label: "공고일", value: dateK(n.posted_at, true) },
    { label: "접수 시작", value: n.apply_start_at ? dateK(n.apply_start_at, true) : null },
    { label: "접수 마감", value: n.apply_end_at ? dateK(n.apply_end_at, true) : null, on: true },
    { label: "당첨자 발표", value: n.announce_at ? dateK(n.announce_at, true) : null },
  ];

  return (
    <article className="stage">
      {/* 뒤로가기 한 개만 — 「공고 | 지역 | 유형」 줄은 아래 태그와 겹쳐 뺐다(사용자 요청 2026-09-09) */}
      <div className="crumb">
        <Link href={ROUTES.home} className="back">← 목록</Link>
      </div>

      <div className="detail">
        <div className="detail-main">
          <header className="d-head">
            <div className="d-tags">
              {/* D-day는 오른쪽 카드가 크게 센다 — 여기서 또 세지 않는다 */}
              <span className="tag type">{n.housing_type}</span>
              <span className="tag">{n.agency}</span>
              {n.sector === "민간임대" && <span className="tag">{n.sector}</span>}
              {n.house_type && <span className="tag">{n.house_type}</span>}
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
              <h2>공급 단지 {count(complexes.length, "곳")}{hasUnits && ` | ${count(unitTotal, "호")}`}</h2>
              <ComplexExplorer items={complexes} hasUnits={hasUnits} noticeSlug={n.slug} />
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

          <section className="dsec">
            <h2>접수 일정</h2>
            {hasSchedule ? (
              <div className="steps">
                {steps.map((s) => (
                  <div key={s.label} className={`step${s.on && s.value ? " on" : ""}`}>
                    <span>{s.label}</span>
                    <b>{s.value ?? "—"}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="note" style={{ marginTop: 0 }}>공고일 {dateK(n.posted_at, true)}{n.source_status && `, 모집 상태 ${n.source_status}`}. 접수 기간은 {L.originalDoc}에서 확인하세요.</p>
            )}
            {hasSchedule && n.source_status && <p className="note">모집 상태 {n.source_status}</p>}
            {hasSchedule && n.schedule_source === "attachment" && <p className="note">일정은 첨부 공고문의 「입주자 모집 절차 및 일정」에서 읽었습니다. 순위별 세부 일정은 원문을 확인하세요.</p>}
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

          <section className="dsec">
            <h2>원문과 문의</h2>
            <ul className="link-list">
              <li><ExternalLink href={n.source_url}>{L.originalListItem} ↗</ExternalLink></li>
              {n.portal_url && <li><ExternalLink href={n.portal_url}>{L.portalListItem} ↗</ExternalLink></li>}
            </ul>
            <SpecList style={{ marginTop: 14 }}>
              <Spec label="문의처" value={n.contact} />
              <Spec label="단지명" value={n.complex_name} />
              <Spec label="총세대수" value={n.total_household != null ? num(n.total_household, "세대") : null} />
              <Spec label="난방" value={n.heating} />
              <Spec label="주소" value={n.address} wide />
            </SpecList>
            <div className="notice-bar" style={{ margin: "16px 0 0" }}>
              <span className="i">i</span>
              <span>본 자료는 참고용입니다. 정확한 내용과 최종 조건은 {n.agency}의 공식 공고문을 반드시 확인하세요.</span>
            </div>
          </section>
        </div>

        <DetailAside
          tone={dl.tone}
          ddayLabel={dl.unit}
          ddayNum={dl.num}
          ddayNote={n.apply_end_at ? `${dateK(n.apply_end_at, true)} 마감` : (n.source_status ?? "일정 미정")}
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
            { label: "공급기관", value: n.agency },
            { label: "공급유형", value: n.housing_type },
            { label: "지역", value: region },
            { label: "공급호수", value: n.supply_count != null ? num(n.supply_count, "호") : null },
            { label: "접수", value: period },
            { label: "문의처", value: n.contact },
          ]}
          updatedNote={`갱신 ${n.updated_at} | ${L.updatedVia}`}
        />
      </div>
    </article>
  );
}
