import Link from "next/link";
import type { NoticeListItem } from "@/lib/queries";
import { dateK, ddayBadge, won } from "@/lib/format";

// 벤치마크(docs/references/공고지도1.png) 카드 구조: 지역 배지 + 큰 헤드라인 + 칩 3개 + 버튼 2개. 사진 없음.
function headline(n: NoticeListItem): string {
  const parts: string[] = [];
  if (n.supply_count != null) parts.push(`${n.supply_count.toLocaleString("ko-KR")}호`);
  if (n.min_rent != null) parts.push(`월 ${won(n.min_rent)}~`);
  else if (n.min_deposit != null) parts.push(`보증금 ${won(n.min_deposit)}~`);
  if (parts.length) return parts.join(" · ");
  return n.complex_name ?? n.housing_type;
}

function shortSido(s: string): string {
  return s.replace(/(특별자치시|특별자치도|특별시|광역시|통합특별시)$/u, "").replace(/도$/u, "") || s;
}

export function NoticeCard({ n }: { n: NoticeListItem }) {
  const badge = ddayBadge(n.apply_start_at, n.apply_end_at, n.status);
  const href = `/notice/${encodeURIComponent(n.slug)}`;
  return (
    <li className="card">
      <div className={`card-hero ${n.sector === "민간임대" ? "private" : "public"}`}>
        <div className="card-hero-top">
          <span className="region-badge">📍 {shortSido(n.sido)}{n.sigungu ? ` ${n.sigungu}` : ""}</span>
          <span className={`badge ${badge.tone}`}>{badge.label}</span>
        </div>
        <p className="card-headline">{headline(n)}</p>
        <p className="card-headline-sub">
          {n.agency} {n.housing_type}
          {n.complex_name && n.supply_count != null ? ` · ${n.complex_name}` : n.announce_at ? ` · 발표 ${dateK(n.announce_at)}` : ""}
        </p>
      </div>
      <div className="card-body">
        <div className="card-chips">
          <span className="chip">{n.agency}</span>
          <span className="chip type">{n.housing_type}</span>
          <span className={`chip sector ${n.sector === "민간임대" ? "private" : ""}`}>{n.sector}</span>
          <span className="chip">{dateK(n.posted_at)} 공고</span>
          {n.amends_source_key && <span className="chip amend">정정</span>}
        </div>
        <h2 className="card-title"><Link href={href}>{n.title}</Link></h2>
        <div className="card-money">
          <div><span>최소 보증금</span><b>{won(n.min_deposit)}</b></div>
          <div><span>최소 월임대료</span><b>{won(n.min_rent)}</b></div>
        </div>
        <div className="card-actions">
          <Link href={href} className="btn primary">상세</Link>
          <a href={n.source_url} className="btn" target="_blank" rel="noopener noreferrer">원문 ↗</a>
        </div>
      </div>
    </li>
  );
}
