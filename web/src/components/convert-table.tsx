// 단지 상세 「보증금과 임대료」 — 공급대상 × 공급유형마다 전세전환 / 기본 / 월세전환 세 줄.
// 사용자 요청 2026-09-09: 신혼부부와 청년이 함께 있으면 각각의 전환 폭을 따로 보여 준다.
// 값은 lib/notice-view.ts의 complexPriceGroups가 만든다 — 여기선 그리기만 한다.
import { wonExact } from "@/lib/format";
import type { PriceGroup } from "@/lib/notice-view";
import { num } from "@/lib/format";

export function ConvertTable({ groups }: { groups: PriceGroup[] }) {
  return (
    <div className="ctable">
      {groups.map((g) => (
        <section key={g.id} className="ct-g">
          <h4 className="ct-h">
            <b>{g.label}</b>
            <span>{g.note}</span>
            {g.units != null && <em>{num(g.units, "호")}</em>}
          </h4>
          <div className="ct-t" role="table" aria-label={`${g.label} ${g.note} 보증금과 임대료`}>
            <div className="ct-r ct-head" role="row">
              <span role="columnheader">구분</span>
              <span role="columnheader">보증금</span>
              <span role="columnheader">월임대료</span>
            </div>
            {g.rows.map((r) => (
              <div key={r.kind} className={`ct-r k-${r.kind}`} role="row">
                <span className="k" role="cell">
                  {r.label}
                  {r.pct != null && <small>보증금 {r.pct}%</small>}
                </span>
                <span className="d" role="cell" title={r.exact[0] != null ? wonExact(r.exact[0]) : undefined}>{r.deposit}</span>
                <span className="r" role="cell" title={r.exact[1] != null ? wonExact(r.exact[1]) : undefined}>{r.rent}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
