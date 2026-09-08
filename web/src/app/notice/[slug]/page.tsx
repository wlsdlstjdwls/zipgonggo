import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ComplexExplorer } from "@/components/complex-explorer";
import { ExternalLink } from "@/components/external-link";
import { NaverMap } from "@/components/naver-map";
import { SaveButton } from "@/components/save-button";
import { Spec, SpecList } from "@/components/spec-list";
import { agencyLabels } from "@/lib/agency";
import { count, dateK, dateMD, daysUntil, ddayChip, moneyOf, num, won, wonExact, wonKo, wonShort } from "@/lib/format";
import { getAmendChain, getNoticeAreas, getNoticeBySlug, getNoticeComplexes } from "@/lib/queries";
import { noticePath, ROUTES } from "@/lib/routes";
import { regionLabel } from "@/lib/sido";
import type { Notice, NoticeListItem } from "@/types/notice";

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
        <span className="chip amend">{label}</span> {n.title} <small>{dateK(n.posted_at)}</small>
      </Link>
    </li>
  );
}

// 보증금·임대료 표 — 열린 공고 데이터에서만 계산한다(하드코딩 금지, design/README.md).
// 납부 구성은 DB 값(계약금·중도금·잔금)이 있으면 그대로, 없고 전세형(월임대료 없음)이면 10%/90% 가정치로 보여 준다.
// 마이홈 API는 미기재를 0으로 주는 경우가 있어(실측 2026-09-08) 납부 구성은 0을 미기재로 본다.
// exact: 원 단위 원본. 화면은 "1억 960만 원"으로 읽히게 쓰고, 정확한 값은 마우스를 올리면 나온다
type PriceRow = { kind: string; deposit: string; rent: string; exact: [number | null, number | null] };
const pos = (v: number | null) => (v != null && v > 0 ? v : null);
function priceRows(n: Notice): PriceRow[] {
  const rows: PriceRow[] = [{ kind: "기본 (공고 최소값)", deposit: wonKo(n.min_deposit), rent: wonKo(n.min_rent), exact: [n.min_deposit, n.min_rent] }];
  const down = pos(n.min_down_payment), interim = pos(n.min_interim), balance = pos(n.min_balance);
  if (down != null || interim != null || balance != null) {
    if (down != null) rows.push({ kind: "납부 구성 · 계약금", deposit: wonKo(down), rent: "—", exact: [down, null] });
    if (interim != null) rows.push({ kind: "납부 구성 · 중도금", deposit: wonKo(interim), rent: "—", exact: [interim, null] });
    if (balance != null) rows.push({ kind: "납부 구성 · 잔금", deposit: wonKo(balance), rent: "—", exact: [balance, null] });
  } else if (n.min_rent == null && n.min_deposit != null) {
    rows.push({ kind: "납부 구성 · 계약금 (10% 가정)", deposit: wonKo(Math.round(n.min_deposit * 0.1)), rent: "—", exact: [Math.round(n.min_deposit * 0.1), null] });
    rows.push({ kind: "납부 구성 · 잔금 (90% 가정)", deposit: wonKo(Math.round(n.min_deposit * 0.9)), rent: "—", exact: [Math.round(n.min_deposit * 0.9), null] });
  }
  if ((n.max_deposit != null && n.max_deposit !== n.min_deposit) || (n.max_rent != null && n.max_rent !== n.min_rent)) {
    rows.push({ kind: "최대 (공고 최대값)", deposit: wonKo(n.max_deposit ?? n.min_deposit), rent: wonKo(n.max_rent ?? n.min_rent), exact: [n.max_deposit ?? n.min_deposit, n.max_rent ?? n.min_rent] });
  }
  return rows;
}

export default async function NoticePage({ params }: Params) {
  const n = await load(params);
  if (!n) notFound();
  const [areas, chain, complexes] = await Promise.all([getNoticeAreas(n.id), getAmendChain(n), getNoticeComplexes(n.id)]);
  const newCount = complexes.filter((c) => c.is_new).length;
  // 매입임대 별첨(호실 단위)이면 호수·면적·금액 열을 더 보여준다
  const hasUnits = complexes.some((c) => c.unit_count != null);
  const unitTotal = complexes.reduce((a, c) => a + (c.unit_count ?? 0), 0);
  const d = ddayChip(n);
  const m = moneyOf(n);
  const L = agencyLabels(n);
  const showAreaTable = areas.length > 1 || (areas.length === 1 && areas[0].supply_count != null && !n.address);
  const hasMoney = n.min_deposit != null || n.min_rent != null || pos(n.min_down_payment) != null || pos(n.min_balance) != null;
  const region = regionLabel(n) || "전국";
  const period = n.apply_start_at || n.apply_end_at ? `${dateMD(n.apply_start_at)}–${dateMD(n.apply_end_at)}` : null;
  // 상한(첨부 공급현황 표)이 하한과 다를 때만 범위 표기. 월임대료 공고는 월임대료 범위, 전세형은 보증금 범위
  const hi = n.min_rent != null ? n.max_rent : n.max_deposit;
  const lo = n.min_rent != null ? n.min_rent : n.min_deposit;
  const range_ = hi != null && lo != null && hi > lo ? wonShort(hi) : null;
  const hasSchedule = Boolean(n.apply_start_at || n.apply_end_at || n.announce_at);

  const steps: { label: string; value: string | null; on?: boolean }[] = [
    { label: "공고일", value: dateK(n.posted_at, true) },
    { label: "접수 시작", value: n.apply_start_at ? dateK(n.apply_start_at, true) : null },
    { label: "접수 마감", value: n.apply_end_at ? dateK(n.apply_end_at, true) : null, on: true },
    { label: "당첨자 발표", value: n.announce_at ? dateK(n.announce_at, true) : null },
  ];

  return (
    <article className="stage">
      <div className="crumb">
        <Link href={ROUTES.home} className="back">← 지도</Link>
        <span>공고 · {region} · {n.housing_type}</span>
      </div>

      <div className="detail">
        <div className="detail-main">
          <header className="d-head">
            <div className="d-tags">
              <span className={`tag ${d.tone}`}>{d.num} {d.unit}</span>
              <span className="tag type">{n.housing_type}</span>
              <span className="tag">{n.agency}</span>
              {n.sector === "민간임대" && <span className="tag">{n.sector}</span>}
              {n.house_type && <span className="tag">{n.house_type}</span>}
              {n.amends_source_key && <span className="tag acc">정정공고</span>}
            </div>
            <h1 className="d-title">{n.title}</h1>
            {m ? (
              <>
                <span className="jumbo-label">{m.label}</span>
                <b className="jumbo">{range_ ? `${m.main}~${range_}` : m.main}</b>
                {!range_ && <span className="jumbo-from">부터</span>}
                {m.sub && <span className="jumbo-sub">{m.sub} 부터 · 공고 최소값</span>}
                {range_ && <span className="jumbo-sub">단지·면적별 {m.label} 범위 · 첨부 공고문 공급현황 표</span>}
              </>
            ) : (
              <>
                <span className="jumbo-label">보증금 · 임대료</span>
                <span className="jumbo-sub" style={{ marginTop: 0 }}>목록 데이터에 금액이 없습니다. {L.originalDoc}의 표를 확인하세요.</span>
              </>
            )}
          </header>

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
              <p className="note" style={{ marginTop: 0 }}>공고일 {dateK(n.posted_at, true)}{n.source_status && ` · 모집 상태 ${n.source_status}`} · 접수 기간은 {L.originalDoc}에서 확인하세요.</p>
            )}
            {hasSchedule && n.source_status && <p className="note">모집 상태 {n.source_status}</p>}
            {hasSchedule && n.schedule_source === "attachment" && <p className="note">일정은 첨부 공고문의 「입주자 모집 절차 및 일정」에서 읽었습니다. 순위별 세부 일정은 원문을 확인하세요.</p>}
          </section>

          {hasMoney && (
            <section className="dsec">
              <h2>보증금 · 임대료</h2>
              <div className="ptable" role="table" aria-label="보증금·임대료">
                <div className="h" role="row"><span role="columnheader">구분</span><span role="columnheader" style={{ textAlign: "right" }}>보증금</span><span role="columnheader" style={{ textAlign: "right" }}>월임대료</span></div>
                {priceRows(n).map((r) => (
                  <div key={r.kind} role="row">
                    <span className="k" role="cell">{r.kind}</span>
                    <span className="d" role="cell" title={r.exact[0] != null ? wonExact(r.exact[0]) : undefined}>{r.deposit}</span>
                    <span className="r" role="cell" title={r.exact[1] != null ? wonExact(r.exact[1]) : undefined}>{r.rent}</span>
                  </div>
                ))}
              </div>
              <p className="note">단지·호실별 금액은 {L.originalDoc}의 표를 따릅니다.</p>
            </section>
          )}

          {complexes.length > 0 && (
            <section className="dsec">
              <h2>공급 단지 {count(complexes.length, "곳")}{hasUnits && ` · ${count(unitTotal, "호")}`}</h2>
              <p className="note" style={{ margin: "0 0 12px" }}>
                {hasUnits
                  ? "첨부 공고문의 「주택목록」(호실 단위)을 단지별로 묶은 목록입니다. 보증금·월임대료는 단지 안 최소값이고, 호별 금액은 원문 표를 확인하세요."
                  : `첨부 공고문의 「주택 위치 안내」 표를 재구성한 목록입니다.${newCount > 0 ? ` 이번 공고 신규 단지 ${newCount}곳.` : ""} 단지별 면적·호수·금액은 원문 표를 확인하세요.`}
              </p>
              <ComplexExplorer items={complexes} hasUnits={hasUnits} />
            </section>
          )}

          {n.address && (
            <section className="dsec">
              <h2>위치</h2>
              <div className="d-map"><NaverMap address={n.address} title={n.complex_name ?? n.title} /></div>
              <p className="note">지도 위치는 주소 기준 근사치입니다. {n.address}</p>
            </section>
          )}

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
            <h2>원문 · 문의</h2>
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

        <aside className="aside">
          <div className="aside-in">
            <div className={`dcard tone-${d.tone}`}>
              <span>{d.days === null || d.days < 0 ? "접수" : `${d.unit}까지`}</span>
              <b>{d.num}</b>
              <p>{n.apply_end_at ? `${dateK(n.apply_end_at, true)} ${d.days !== null && d.days < 0 ? "마감됨" : "마감"}` : (n.source_status ?? "일정 미정")}</p>
            </div>
            <ExternalLink className="btn acc lg" href={n.source_url}>{L.original}</ExternalLink>
            {n.portal_url && <ExternalLink className="btn lg" href={n.portal_url}>{L.portal}</ExternalLink>}
            <SaveButton id={n.id} variant="panel" />
            <div className="specs">
              <span className="t">공고 제원</span>
              <div className="r"><span>공급기관</span><b>{n.agency}</b></div>
              <div className="r"><span>공급유형</span><b>{n.housing_type}</b></div>
              <div className="r"><span>지역</span><b>{region}</b></div>
              <div className="r"><span>공급호수</span><b>{n.supply_count != null ? num(n.supply_count, "호") : "—"}</b></div>
              <div className="r"><span>접수</span><b>{period ?? "—"}</b></div>
              <div className="r"><span>문의처</span><b>{n.contact ?? "—"}</b></div>
              <span className="u">갱신 {n.updated_at} · {L.updatedVia}</span>
            </div>
          </div>
        </aside>
      </div>
    </article>
  );
}
