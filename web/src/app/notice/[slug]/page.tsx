import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "@/components/external-link";
import { NaverMap } from "@/components/naver-map";
import { Spec, SpecList } from "@/components/spec-list";
import { StatusBadge } from "@/components/status-badge";
import { agencyLabels } from "@/lib/agency";
import { dateK, daysUntil, ddayBadge, num, won, wonExact } from "@/lib/format";
import { getAmendChain, getNoticeAreas, getNoticeBySlug } from "@/lib/queries";
import { noticePath, ROUTES } from "@/lib/routes";
import { regionLabel } from "@/lib/sido";
import type { NoticeListItem } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;

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
    title: `${n.title} — ${n.housing_type} ${supply} 보증금·임대료·접수일정`.replace(/\s+/g, " "),
    description: `${n.agency} ${n.title}. 접수 ${dateK(n.apply_start_at)}~${dateK(n.apply_end_at)}${dday}. ${regionLabel(n)} ${supply}. 최소 보증금 ${won(n.min_deposit)}, 최소 월임대료 ${won(n.min_rent)}.`,
    alternates: { canonical: noticePath(n.slug) },
  };
}

function AmendLink({ n, label }: { n: NoticeListItem; label: string }) {
  return (
    <li>
      <Link href={noticePath(n.slug)}>
        <span className="chip amend">{label}</span> {n.title} <small style={{ color: "var(--muted)" }}>{dateK(n.posted_at)}</small>
      </Link>
    </li>
  );
}

export default async function NoticePage({ params }: Params) {
  const n = await load(params);
  if (!n) notFound();
  const [areas, chain] = await Promise.all([getNoticeAreas(n.id), getAmendChain(n)]);
  const badge = ddayBadge(n.apply_start_at, n.apply_end_at, n.status);
  const L = agencyLabels(n);
  const showAreaTable = areas.length > 1 || (areas.length === 1 && areas[0].supply_count != null && !n.address);
  const hasMoney = n.min_deposit != null || n.min_rent != null || n.min_down_payment != null || n.min_balance != null;

  return (
    <article>
      {/* 헤더 — 벤치마크(공고지도3): 제목 + 상태 칩. 우리는 D-day와 원문 버튼을 더 올린다 */}
      <header className="detail-head">
        <div className="card-top">
          <StatusBadge badge={badge} />
          <span className="chip type">{n.housing_type}</span>
          <span className={`chip sector ${n.sector === "민간임대" ? "private" : ""}`}>{n.sector}</span>
          {n.house_type && <span className="chip">{n.house_type}</span>}
          {n.source_status && n.source_status !== badge.label && <span className="chip">{n.source_status}</span>}
        </div>
        <h1>{n.title}</h1>
        {n.min_deposit != null && (
          <p className="deposit-lead">보증금 <b>{wonExact(n.min_deposit)}</b> <small style={{ color: "var(--muted)" }}>부터</small></p>
        )}
        <SpecList>
          <Spec label="공급기관" value={n.agency} />
          <Spec label="공급유형" value={n.housing_type} />
          <Spec label="지역" value={regionLabel(n) || "전국"} />
          <Spec label="단지명" value={n.complex_name} />
          <Spec label="공급호수" value={n.supply_count != null ? num(n.supply_count, "호") : null} />
          <Spec label="총세대수" value={n.total_household != null ? num(n.total_household, "세대") : null} />
          <Spec label="주택유형" value={n.house_type} />
          <Spec label="난방" value={n.heating} />
          <Spec label="주소" value={n.address} wide />
        </SpecList>
        <div className="btn-row">
          <ExternalLink className="btn primary" href={n.source_url}>{L.original}</ExternalLink>
          {n.portal_url && <ExternalLink className="btn" href={n.portal_url}>{L.portal}</ExternalLink>}
        </div>
      </header>

      {(chain.original || chain.amendments.length > 0) && (
        <section className="section">
          <h2>정정 이력</h2>
          <ul className="amend-list">
            {chain.original && <AmendLink n={chain.original} label="원공고" />}
            {chain.amendments.map((a) => <AmendLink key={a.id} n={a} label="정정공고" />)}
          </ul>
        </section>
      )}

      <section className="section">
        <h2>접수 일정</h2>
        <SpecList>
          <Spec label="공고일" value={dateK(n.posted_at, true)} />
          <Spec label="접수 시작" value={n.apply_start_at ? dateK(n.apply_start_at, true) : null} />
          <Spec label="접수 마감" value={n.apply_end_at ? <>{dateK(n.apply_end_at, true)} <StatusBadge badge={badge} /></> : null} />
          <Spec label="당첨자 발표" value={n.announce_at ? dateK(n.announce_at, true) : null} />
          <Spec label="모집 상태" value={n.source_status} />
        </SpecList>
        {!n.apply_end_at && (
          <p className="note">접수 기간은 {L.originalDoc}에서 확인하세요. 목록 데이터에 접수 일정이 없습니다.</p>
        )}
      </section>

      {/* 금액 표 — 벤치마크(공고지도3)의 구분/보증금/임대료 3열. 호실 파싱 전엔 공고 최소값 1행 */}
      <section className="section">
        <h2>보증금·임대료</h2>
        {hasMoney ? (
          <table className="price-table">
            <thead><tr><th>구분</th><th>보증금</th><th>월임대료</th></tr></thead>
            <tbody>
              <tr>
                <td>기본 (공고 최소값)</td>
                <td><b>{wonExact(n.min_deposit)}</b><small>{won(n.min_deposit)}</small></td>
                <td><b>{wonExact(n.min_rent)}</b><small>{won(n.min_rent)}</small></td>
              </tr>
              {(n.min_down_payment != null || n.min_interim != null || n.min_balance != null) && (
                <tr>
                  <td>납부 구성</td>
                  <td colSpan={2} style={{ textAlign: "left" }}>
                    계약금 {wonExact(n.min_down_payment)} · 중도금 {wonExact(n.min_interim)} · 잔금 {wonExact(n.min_balance)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <p className="note" style={{ marginTop: 0 }}>
            이 공고는 목록 데이터에 금액이 없습니다. 호실·형별 보증금과 임대료는 원문 공고문의 표를 확인하세요.
          </p>
        )}
        <p className="note">전세전환·월세전환 금액과 호실별 금액은 첨부 공고문 파싱 후 표로 제공됩니다.</p>
      </section>

      {n.address ? (
        <section className="section">
          <h2>위치</h2>
          <NaverMap address={n.address} title={n.complex_name ?? n.title} />
          <p className="note">지도 위치는 주소 기준 근사치입니다. {n.address}</p>
        </section>
      ) : null}

      {showAreaTable && areas.length > 0 && (
        <section className="section">
          <h2>{n.address ? "시군구별 공급호수" : "공급 지역"}</h2>
          {!n.address && <p className="note" style={{ marginTop: 0, marginBottom: 8 }}>주택별 주소는 공고문 첨부에만 있습니다.</p>}
          <table>
            <thead><tr><th>시도</th><th>시군구</th><th className="num">공급호수</th></tr></thead>
            <tbody>
              {areas.map((a, i) => (
                <tr key={i}>
                  <td>{a.sido}</td>
                  <td>{a.sigungu ?? <span style={{ color: "var(--muted)" }}>미지정</span>}</td>
                  <td className="num">{num(a.supply_count, "호")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="notice-bar">
        <span className="i">i</span>
        <span>본 자료는 참고용입니다. 정확한 내용과 최종 조건은 {n.agency}의 공식 공고문을 반드시 확인하세요.</span>
      </div>

      <section className="section">
        <h2>원문·문의</h2>
        <ul className="link-list">
          <li><ExternalLink href={n.source_url}>📄 {L.originalListItem} ↗</ExternalLink></li>
          {n.portal_url && <li><ExternalLink href={n.portal_url}>🔗 {L.portalListItem} ↗</ExternalLink></li>}
        </ul>
        <SpecList style={{ marginTop: 12 }}>
          <Spec label="문의처" value={n.contact} />
          <Spec label="공급기관" value={n.agency} />
          <Spec label="갱신" value={`${n.updated_at} (${L.updatedVia})`} />
        </SpecList>
      </section>

      <Link href={ROUTES.home} className="back">← 공고 목록</Link>
    </article>
  );
}
