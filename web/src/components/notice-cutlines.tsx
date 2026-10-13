// 공고 상세 「커트라인」 — 당첨자(또는 서류심사대상자) 발표 첨부의 단지 × 면적 × 대상별 커트라인(notice_cutline, 0041).
// 경쟁률이 「몇 명이 몰렸나」라면 이건 「몇 점이면 붙었나」다. 원문 글 그대로 싣는다 — 「1순위 22점 미성년자녀1명 전산추첨」을
// 우리 말로 풀면 원문과 어긋날 수 있다. 단지가 많은 회차(장기전세 130줄)는 앞 몇 곳만 펼치고 나머지는 접는다.
import { dateK, num } from "@/lib/format";
import type { CutlineRow, NoticeCutlines as Data } from "@/types/notice";

const OPEN_COMPLEXES = 10;

type Group = { name: string; sigungu: string; rows: CutlineRow[] };

function groups(rows: CutlineRow[]): Group[] {
  const out: Group[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.name === r.complex_name) last.rows.push(r);
    else out.push({ name: r.complex_name, sigungu: r.sigungu, rows: [r] });
  }
  return out;
}

/** 대상 칸. 구분과 대상이 같은 말을 되풀이하는 양식(「일반」 「일반1순위」)은 대상만 */
export function cutTarget(r: Pick<CutlineRow, "bracket" | "tenant_class">): string {
  const b = r.bracket.replace(/공급$/, "");
  if (!b || r.tenant_class.startsWith(b)) return r.tenant_class;
  return r.tenant_class ? `${b} ${r.tenant_class}` : b;
}

function Rows({ list, reserve }: { list: Group[]; reserve: boolean }) {
  return (
    <>
      {list.map((g) =>
        g.rows.map((r, i) => (
          <tr key={`${g.name}-${i}`} className={i === 0 ? "cl-first" : undefined}>
            {i === 0 && (
              <th scope="rowgroup" rowSpan={g.rows.length}>
                {g.name}
                {g.sigungu && <small>{g.sigungu}</small>}
              </th>
            )}
            <td className="n">{r.supply_type ? `${r.supply_type}㎡` : ""}</td>
            <td>{cutTarget(r)}</td>
            <td>{r.winner_cut || "—"}</td>
            {reserve && <td>{r.reserve_cut || "—"}</td>}
          </tr>
        )),
      )}
    </>
  );
}

export function NoticeCutlines({ data }: { data: Data }) {
  const all = groups(data.rows);
  const reserve = data.rows.some((r) => r.reserve_cut);
  const doc = data.stage === "document";
  const head = (
    <thead>
      <tr>
        <th scope="col">단지</th><th scope="col" className="n">면적</th><th scope="col">대상</th>
        <th scope="col">{doc ? "서류심사 대상" : "당첨자"}</th>
        {reserve && <th scope="col">예비자</th>}
      </tr>
    </thead>
  );
  return (
    <section className="dsec" id="cutline">
      <h2>
        {doc ? "서류심사 커트라인" : "커트라인"}
        <small className="dsec-src">{doc ? "서류심사대상자 발표" : "당첨자 발표"} 첨부 | {dateK(data.posted_at)} 게시</small>
      </h2>
      <p className="note" style={{ margin: "0 0 12px" }}>
        단지 {num(all.length, "곳")}, 면적과 대상별로 어디까지 {doc ? "서류심사 대상이 됐는지" : "붙었는지"}입니다. 원문 표기를 그대로 옮겼습니다.
        {doc && " 최종 당첨선은 서류심사 뒤 당첨자 발표 때 다시 나옵니다."}
        {" "}같은 점수면 기관이 전산추첨으로 가릅니다.
      </p>
      <div className="cl-wrap">
        <table className="cl-table">
          {head}
          <tbody><Rows list={all.slice(0, OPEN_COMPLEXES)} reserve={reserve} /></tbody>
        </table>
      </div>
      {all.length > OPEN_COMPLEXES && (
        <details className="cl-more">
          <summary>나머지 {num(all.length - OPEN_COMPLEXES, "곳")} 보기</summary>
          <div className="cl-wrap">
            <table className="cl-table">
              {head}
              <tbody><Rows list={all.slice(OPEN_COMPLEXES)} reserve={reserve} /></tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
