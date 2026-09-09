// 보증금·임대료 표 — 공고 상세(계약금/중도금/잔금/최대)와 단지 상세(공급대상별)가 함께 쓴다. lib/notice-view.ts의 PriceRow.
// showRent=false(장기전세 등 월임대료가 아예 없는 전세형)면 매 줄 "—"로만 채워지는 임대료 열 자체를 없앤다 —
// 「보증금과 임대료」라는 제목과 달리 실제론 전세라 임대료 개념이 없는데 빈 열만 남기면 오해를 산다(사용자 지적 2026-09-10).
import { wonExact } from "@/lib/format";
import type { PriceRow } from "@/lib/notice-view";

type Props = { rows: PriceRow[]; depositHead?: string; rentHead?: string; showRent?: boolean };

export function PriceTable({ rows, depositHead = "보증금", rentHead = "월임대료", showRent = true }: Props) {
  return (
    <div className={showRent ? "ptable" : "ptable no-rent"} role="table" aria-label={showRent ? "보증금과 임대료" : depositHead}>
      <div className="h" role="row">
        <span role="columnheader">구분</span>
        <span role="columnheader" style={{ textAlign: "right" }}>{depositHead}</span>
        {showRent && <span role="columnheader" style={{ textAlign: "right" }}>{rentHead}</span>}
      </div>
      {rows.map((r) => (
        <div key={r.id} className={r.group} role="row">
          <span className="k" role="cell">{r.label}{r.note && <small>{r.note}</small>}</span>
          <span className="d" role="cell" title={r.exact[0] != null ? wonExact(r.exact[0]) : undefined}>{r.deposit}</span>
          {showRent && <span className="r" role="cell" title={r.exact[1] != null ? wonExact(r.exact[1]) : undefined}>{r.rent}</span>}
        </div>
      ))}
    </div>
  );
}
