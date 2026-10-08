// 단지 상세 「보증금과 임대료」/「전세금」 — 슬라이더로 못 그리는 금액(장기전세, 전세형 매입임대, 호실 범위)을 낸다. lib/notice-view.ts의 PriceRow.
//
// 전에는 「구분 | 보증금 | 월임대료」 머리가 달린 표였다. 값이 하나뿐인 집도 표 머리부터 그려
// "전세금 여기는 아직도 표"라는 지적(사용자 2026-10-08)에 목록으로 바꿨다 — 라벨 ← → 큰 금액.
// 계약금과 잔금은 줄 둘 대신 그 위 금액을 나눈 막대 하나로 그린다(얼마를 먼저 내고 얼마를 나중에 내는지가 한눈에).
// showRent=false(월임대료 개념이 없는 전세형)면 임대료 자리를 아예 그리지 않는다(사용자 지적 2026-09-10).
import { wonExact } from "@/lib/format";
import type { PriceRow } from "@/lib/notice-view";

type Props = { rows: PriceRow[]; depositHead?: string; rentHead?: string; showRent?: boolean };

/** 금액 줄마다 바로 밑의 계약금/잔금 줄을 붙여 한 덩이로 */
function bundle(rows: PriceRow[]): { head: PriceRow; pays: PriceRow[] }[] {
  const out: { head: PriceRow; pays: PriceRow[] }[] = [];
  for (const r of rows) {
    if (r.group === "pay" && out.length) out[out.length - 1].pays.push(r);
    else out.push({ head: r, pays: [] });
  }
  return out;
}

export function PriceTable({ rows, depositHead = "보증금", rentHead = "월임대료", showRent = true }: Props) {
  return (
    <div className="plist" aria-label={showRent ? "보증금과 임대료" : depositHead}>
      {bundle(rows).map(({ head: r, pays }) => {
        const total = pays.reduce((a, p) => a + (p.exact[0] ?? 0), 0);
        return (
          <div key={r.id} className={`pl-row ${r.group}`}>
            <div className="pl-top">
              <span className="k">{r.label}{r.note && <small>{r.note}</small>}</span>
              <span className="v">
                <b title={r.exact[0] != null ? wonExact(r.exact[0]) : undefined}>{r.deposit}</b>
                {showRent && r.exact[1] != null && (
                  <em title={wonExact(r.exact[1])}>{rentHead === "월임대료" ? "월 " : `${rentHead} `}{r.rent}</em>
                )}
              </span>
            </div>
            {pays.length > 0 && total > 0 && (
              <div className="pl-split">
                <div className="bar" aria-hidden="true">
                  {pays.map((p) => <i key={p.id} style={{ flexGrow: p.exact[0] ?? 0 }} />)}
                </div>
                <div className="parts">
                  {pays.map((p) => (
                    <span key={p.id} title={p.exact[0] != null ? wonExact(p.exact[0]) : undefined}>
                      {p.label} <b>{p.deposit}</b>{p.note && <small>{p.note}</small>}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
