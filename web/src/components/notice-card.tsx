import Link from "next/link";
import type { NoticeListItem } from "@/lib/queries";
import { dateK, ddayBadge, won } from "@/lib/format";

export function NoticeCard({ n }: { n: NoticeListItem }) {
  const badge = ddayBadge(n.apply_start_at, n.apply_end_at);
  const region = [n.sido, n.sigungu].filter(Boolean).join(" ");
  return (
    <li>
      <Link href={`/notice/${encodeURIComponent(n.slug)}`} className="card">
        <div className="card-top">
          <span className={`badge ${badge.tone}`}>{badge.label}</span>
          <span className="chip type">{n.housing_type}</span>
          {n.house_type && <span className="chip">{n.house_type}</span>}
          {n.amends_source_key && <span className="chip amend">정정공고</span>}
        </div>
        <h2 className="card-title">{n.title}</h2>
        <div className="card-meta">
          <span>{n.agency}</span>
          <span>{region || "전국"}</span>
          {n.complex_name && <span>{n.complex_name}</span>}
          {n.supply_count != null && <span>{n.supply_count.toLocaleString("ko-KR")}호</span>}
          <span>접수 {dateK(n.apply_start_at)} ~ {dateK(n.apply_end_at)}</span>
        </div>
        <div className="card-money">
          <div><span>최소 보증금</span><b>{won(n.min_deposit)}</b></div>
          <div><span>최소 월임대료</span><b>{won(n.min_rent)}</b></div>
        </div>
      </Link>
    </li>
  );
}
