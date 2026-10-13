// 단지 상세 「지난 커트라인」 — 이 단지가 지난 회차들에서 받은 최종 커트라인(notice_cutline, 0041).
// 같은 기관, 같은 유형 공고만 이름 열쇠로 모은다. 회차마다 한 묶음, 최근 회차가 위. 이번 결과를 보장하지 않는다는 말을 붙인다.
import Link from "next/link";
import { dateK } from "@/lib/format";
import { priorLabel } from "@/lib/notice-fit";
import { cutTarget } from "./notice-cutlines";
import { noticePath } from "@/lib/routes";
import type { CutlineRow } from "@/types/notice";

type Row = CutlineRow & { slug: string; title: string; posted_at: string };

export function ComplexCutlines({ rows, currentSlug }: { rows: Row[]; currentSlug: string }) {
  const rounds: { slug: string; title: string; posted_at: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const last = rounds[rounds.length - 1];
    if (last && last.slug === r.slug) last.rows.push(r);
    else rounds.push({ slug: r.slug, title: r.title, posted_at: r.posted_at, rows: [r] });
  }
  const reserve = rows.some((r) => r.reserve_cut);
  return (
    <section className="dsec" id="cutline">
      <h2>지난 커트라인</h2>
      <p className="note" style={{ margin: "0 0 12px" }}>
        이 단지가 지난 회차 당첨자 발표에서 받은 커트라인입니다. 원문 표기 그대로이며, 이번 공고의 결과를 보장하지 않습니다.
      </p>
      <div className="cl-wrap">
        <table className="cl-table">
          <thead>
            <tr>
              <th scope="col">회차</th><th scope="col" className="n">면적</th><th scope="col">대상</th>
              <th scope="col">당첨자</th>{reserve && <th scope="col">예비자</th>}
            </tr>
          </thead>
          <tbody>
            {rounds.map((g) =>
              g.rows.map((r, i) => (
                <tr key={`${g.slug}-${i}`} className={i === 0 ? "cl-first" : undefined}>
                  {i === 0 && (
                    <th scope="rowgroup" rowSpan={g.rows.length}>
                      {g.slug === currentSlug ? priorLabel(g.title) : <Link href={noticePath(g.slug)}>{priorLabel(g.title)}</Link>}
                      <small>{dateK(g.posted_at)} 공고</small>
                    </th>
                  )}
                  <td className="n">{r.supply_type ? `${r.supply_type}㎡` : ""}</td>
                  <td>{cutTarget(r)}</td>
                  <td>{r.winner_cut || "—"}</td>
                  {reserve && <td>{r.reserve_cut || "—"}</td>}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
