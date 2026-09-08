import Link from "next/link";
import type { CSSProperties } from "react";
import type { NoticeListItem } from "@/types/notice";
import { dateK, ddayBadge, num, won } from "@/lib/format";
import { noticePath } from "@/lib/routes";
import { regionShort } from "@/lib/sido";
import { ExternalLink } from "./external-link";
import { StatusBadge } from "./status-badge";

// 벤치마크(docs/references/공고지도1.png) 카드 구조를 따르되 정보는 6개로 줄였다(2026-09-08 사용자 요청).
//   지역 배지 · D-day · 헤드라인(금액) · 공고 제목 · 칩 3개(기관·유형·공고일) · 버튼 2개
// 뺀 것: 별도 금액 2열, 공공/민간 칩(탭이 이미 구분), 발표일, 단지명·호수는 헤드라인 보조줄로 흡수.
// 보증금·임대료는 감추지 않는다(CLAUDE.md 하지 말 것 3) — 헤드라인이 금액이다.

function headline(n: NoticeListItem): { main: string; sub: string } {
  const sub: string[] = [];
  let main: string;
  if (n.min_rent != null) {
    main = `월 ${won(n.min_rent)}~`;
    if (n.min_deposit != null) sub.push(`보증금 ${won(n.min_deposit)}~`);
  } else if (n.min_deposit != null) {
    main = `보증금 ${won(n.min_deposit)}~`;
  } else if (n.supply_count != null) {
    main = `${num(n.supply_count)}호 모집`;
  } else {
    main = n.complex_name ?? n.housing_type;
  }
  if (n.supply_count != null && !main.endsWith("호 모집")) sub.push(num(n.supply_count, "호"));
  if (n.complex_name && main !== n.complex_name) sub.push(n.complex_name);
  // SH 목록처럼 금액·호수가 없는 공고: 유형이 헤드라인이므로 보조줄은 발표일 또는 안내문으로 채운다
  if (sub.length === 0) sub.push(n.announce_at ? `발표 ${dateK(n.announce_at)}` : "금액·호수는 원문 공고문 확인");
  return { main, sub: sub.join(" · ") };
}

/** 공고일 칩: 2026.08.31 → 26.08.31 공고 (벤치마크 표기) */
function postedChip(ymd: string): string {
  return `${dateK(ymd).slice(2)} 공고`;
}

export function NoticeCard({ n, style }: { n: NoticeListItem; style?: CSSProperties }) {
  const badge = ddayBadge(n.apply_start_at, n.apply_end_at, n.status);
  const href = noticePath(n.slug);
  const h = headline(n);
  return (
    <li className="card" style={style}>
      <div className={`card-hero ${n.sector === "민간임대" ? "private" : "public"}`}>
        <div className="card-hero-top">
          <span className="region-badge">📍 {regionShort(n)}</span>
          <StatusBadge badge={badge} />
        </div>
        <p className="card-headline">{h.main}</p>
        <p className="card-headline-sub">{h.sub}</p>
      </div>
      <div className="card-body">
        <div className="card-chips">
          <span className="chip">{n.agency}</span>
          <span className="chip type">{n.housing_type}</span>
          <span className="chip">{postedChip(n.posted_at)}</span>
          {n.amends_source_key && <span className="chip amend">정정</span>}
        </div>
        <h2 className="card-title"><Link href={href}>{n.title}</Link></h2>
        <div className="card-actions">
          <Link href={href} className="btn primary">상세</Link>
          <ExternalLink href={n.source_url} className="btn">원문 ↗</ExternalLink>
        </div>
      </div>
    </li>
  );
}
