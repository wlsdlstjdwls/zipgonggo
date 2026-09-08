// 보증금·임대료 표 — 공고 상세(계약금/중도금/잔금/최대)와 단지 상세(공급대상별)가 함께 쓴다. lib/notice-view.ts의 PriceRow.
import { wonExact } from "@/lib/format";
import type { PriceRow } from "@/lib/notice-view";

type Props = { rows: PriceRow[]; rentHead?: string };

export function PriceTable({ rows, rentHead = "월임대료" }: Props) {
  return (
    <div className="ptable" role="table" aria-label="보증금과 임대료">
      <div className="h" role="row">
        <span role="columnheader">구분</span>
        <span role="columnheader" style={{ textAlign: "right" }}>보증금</span>
        <span role="columnheader" style={{ textAlign: "right" }}>{rentHead}</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className={r.group} role="row">
          <span className="k" role="cell">{r.label}{r.note && <small>{r.note}</small>}</span>
          <span className="d" role="cell" title={r.exact[0] != null ? wonExact(r.exact[0]) : undefined}>{r.deposit}</span>
          <span className="r" role="cell" title={r.exact[1] != null ? wonExact(r.exact[1]) : undefined}>{r.rent}</span>
        </div>
      ))}
    </div>
  );
}
