import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NaverMap } from "@/components/naver-map";
import { dateK, daysUntil, ddayBadge, num, won, wonExact } from "@/lib/format";
import { getAmendChain, getNoticeAreas, getNoticeBySlug, type NoticeListItem } from "@/lib/queries";

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
  const region = [n.sido, n.sigungu].filter(Boolean).join(" ");
  const supply = n.supply_count != null ? `${n.supply_count.toLocaleString("ko-KR")}호` : "";
  return {
    title: `${n.title} — ${n.housing_type} ${supply} 보증금·임대료·접수일정`.replace(/\s+/g, " "),
    description: `${n.agency} ${n.title}. 접수 ${dateK(n.apply_start_at)}~${dateK(n.apply_end_at)}${dday}. ${region} ${supply}. 최소 보증금 ${won(n.min_deposit)}, 최소 월임대료 ${won(n.min_rent)}.`,
    alternates: { canonical: `/notice/${encodeURIComponent(n.slug)}` },
  };
}

function AmendLink({ n, label }: { n: NoticeListItem; label: string }) {
  return (
    <li>
      <Link href={`/notice/${encodeURIComponent(n.slug)}`}>
        <span className="chip amend">{label}</span> {n.title} <small style={{ color: "var(--muted)" }}>{dateK(n.posted_at)}</small>
      </Link>
    </li>
  );
}

export default async function NoticePage({ params }: Params) {
  const n = await load(params);
  if (!n) notFound();
  const [areas, chain] = await Promise.all([getNoticeAreas(n.id), getAmendChain(n)]);
  const badge = ddayBadge(n.apply_start_at, n.apply_end_at);
  const region = [n.sido, n.sigungu].filter(Boolean).join(" ");
  const multiArea = areas.length > 1 || (areas.length === 1 && areas[0].sigungu === null && !n.sigungu);

  return (
    <article>
      <header className="detail-head">
        <div className="card-top">
          <span className={`badge ${badge.tone}`}>{badge.label}</span>
          <span className="chip type">{n.housing_type}</span>
          {n.house_type && <span className="chip">{n.house_type}</span>}
          <span className="chip">{n.status}</span>
        </div>
        <h1>{n.title}</h1>
        <div className="card-meta">
          <span>{n.agency}</span>
          <span>{region || "전국"}</span>
          {n.complex_name && <span>{n.complex_name}</span>}
          {n.supply_count != null && <span>공급 {num(n.supply_count, "호")}</span>}
          {n.total_household != null && <span>총 {num(n.total_household, "세대")}</span>}
        </div>
        <div className="btn-row">
          <a className="btn primary" href={n.source_url} target="_blank" rel="noopener noreferrer">기관 원문 공고 보기 ↗</a>
          {n.portal_url && <a className="btn" href={n.portal_url} target="_blank" rel="noopener noreferrer">마이홈포털 ↗</a>}
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
        <dl className="kv">
          <dt>공고일</dt><dd>{dateK(n.posted_at, true)}</dd>
          <dt>접수 시작</dt><dd>{dateK(n.apply_start_at, true)}</dd>
          <dt>접수 마감</dt><dd>{dateK(n.apply_end_at, true)} <span className={`badge ${badge.tone}`}>{badge.label}</span></dd>
          <dt>당첨자 발표</dt><dd>{dateK(n.announce_at, true)}</dd>
        </dl>
      </section>

      <section className="section">
        <h2>보증금·임대료 (공고 내 최소값)</h2>
        <div className="money-grid">
          <div className="cell"><span>임대보증금</span><b>{won(n.min_deposit)}</b><small>{wonExact(n.min_deposit)}</small></div>
          <div className="cell"><span>월임대료</span><b>{won(n.min_rent)}</b><small>{wonExact(n.min_rent)}</small></div>
          <div className="cell"><span>계약금</span><b>{won(n.min_down_payment)}</b><small>{wonExact(n.min_down_payment)}</small></div>
          <div className="cell"><span>잔금</span><b>{won(n.min_balance)}</b><small>{wonExact(n.min_balance)}</small></div>
        </div>
        <p className="note">
          공고에 기재된 최소값입니다. 호실·형별 금액은 기관 원문 공고문을 확인하세요.
          {n.min_deposit == null && " 이 공고는 API에 금액이 기재되지 않았습니다."}
        </p>
      </section>

      {n.address ? (
        <section className="section">
          <h2>위치</h2>
          <dl className="kv">
            <dt>주소</dt><dd>{n.address}</dd>
            {n.heating && <><dt>난방</dt><dd>{n.heating}</dd></>}
          </dl>
          <div style={{ marginTop: 12 }}>
            <NaverMap address={n.address} title={n.complex_name ?? n.title} />
          </div>
          <p className="note">지도 위치는 주소 기준 근사치입니다.</p>
        </section>
      ) : (
        <section className="section">
          <h2>공급 지역</h2>
          <p className="note" style={{ marginTop: 0, marginBottom: 8 }}>
            이 공고는 주택별 주소가 공고문 첨부에만 있습니다. 시군구별 공급호수는 아래와 같습니다.
          </p>
        </section>
      )}

      {(multiArea || !n.address) && areas.length > 0 && (
        <section className="section">
          <h2>시군구별 공급호수</h2>
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

      <section className="section">
        <h2>문의</h2>
        <dl className="kv">
          <dt>문의처</dt><dd>{n.contact ?? "—"}</dd>
          <dt>공급기관</dt><dd>{n.agency}</dd>
          <dt>갱신</dt><dd>{n.updated_at} (마이홈포털 API)</dd>
        </dl>
      </section>

      <Link href="/" className="back">← 공고 목록</Link>
    </article>
  );
}
