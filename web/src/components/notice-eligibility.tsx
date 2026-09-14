// 공고문에서 읽은 신청자격(notice_eligibility, 0024) — 제도 일반 시드 카드 대신 이 공고 자체의 기준을 그린다.
//
// 장기전세는 소득기준이 신청면적 × 순위 × 출생자녀 가산 × 맞벌이 네 축으로 갈리고, 동일순위 경쟁 시
// 선정 순서와 가감점 배점표가 따로 있다(사용자 지적 2026-09-14). 시드 한 줄(「200%」)로는 거짓말이 됐다.
// 여기 나오는 값은 파이프라인이 공고문 쪽 XML에서 좌표로 읽은 것이다. 소득표 금액은 검산(verified)을 통과했을 때만 싣는다.
import Link from "next/link";
import type { ReactNode } from "react";
import { wonKo } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import type { EligRankTable, EligScoreTable, EligSelection, NoticeEligibility } from "@/types/eligibility";

type Props = {
  elig: NoticeEligibility;
  /** 통계 기준연도(income_standard). 공고는 「통계청 발표 전년도」 값을 쓴다 */
  incomeYear: number;
  noticeYear: number | null;
  originalDoc: ReactNode;
};

function pages(list: number[]): string {
  // [6,7,8,30,31,32] → "6~8쪽, 30~32쪽"
  const runs: number[][] = [];
  for (const p of list) {
    const last = runs[runs.length - 1];
    if (last && p === last[last.length - 1] + 1) last.push(p);
    else runs.push([p]);
  }
  return runs.map((r) => (r.length > 1 ? `${r[0]}~${r[r.length - 1]}쪽` : `${r[0]}쪽`)).join(", ");
}

function pct(v: number | null): string {
  return v == null ? "—" : `${v}%`;
}

/** 같은 면적이 이어지는 줄은 첫 줄에만 면적을 쓰고 rowSpan으로 묶는다(공고문 표와 같은 모양) */
function spans<T>(rows: T[], key: (r: T) => string | null): number[] {
  const out = rows.map(() => 0);
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && key(rows[j]) === key(rows[i])) j++;
    out[i] = j - i;
    i = j;
  }
  return out;
}

function RankTable({ t }: { t: EligRankTable }) {
  const areaSpan = spans(t.rows, (r) => r.area);
  const ranked = t.rows.some((r) => r.rank != null);
  return (
    <div className="ne-block">
      <h4 className="ne-group">
        {t.group}
        {t.classes.length > 0 && <span className="ne-classes">{t.classes.join(" | ")}</span>}
      </h4>
      <div className="tbl ne-tbl">
        <table>
          <thead>
            <tr>
              <th>신청면적</th>
              {ranked && <th>순위</th>}
              <th className="num">소득기준</th>
              <th className="num">맞벌이</th>
              <th>소득 외 기준</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i}>
                {areaSpan[i] > 0 && <td rowSpan={areaSpan[i]} className="ne-area">{r.area}</td>}
                {ranked && <td className="ne-rank">{r.rank != null ? `${r.rank}순위` : "—"}</td>}
                <td className="num">{pct(r.income_pct)}</td>
                <td className="num">{r.dual_income_pct != null ? pct(r.dual_income_pct) : <span className="ne-dim">완화 없음</span>}</td>
                <td className="ne-req">{r.requirement ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SelectionTable({ t }: { t: EligSelection }) {
  const groupSpan = spans(t.rows, (r) => r.group);
  const hasArea = t.rows.some((r) => r.area);
  return (
    <div className="ne-block">
      <h4 className="ne-group">{t.title}</h4>
      <div className="tbl ne-tbl">
        <table>
          <thead>
            <tr>
              <th>구분</th>
              {hasArea && <th>신청면적</th>}
              <th>선정 순서</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i}>
                {groupSpan[i] > 0 && <td rowSpan={groupSpan[i]} className="ne-area">{r.group ?? "—"}</td>}
                {hasArea && <td className="ne-rank">{r.area ?? "—"}</td>}
                <td className="ne-steps">
                  {r.steps.map((s, k) => (
                    <span key={k} className="ne-step">
                      {k > 0 && <em aria-hidden="true">→</em>}
                      {s}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.tie_break && <p className="elig-memo">배점이 같을 때: {t.tie_break}</p>}
    </div>
  );
}

function ScoreTable({ t }: { t: EligScoreTable }) {
  return (
    <div className="ne-block">
      {t.group && <h4 className="ne-group">{t.group}</h4>}
      <div className="tbl ne-tbl">
        <table>
          <thead>
            <tr>
              <th>가점 항목</th>
              {t.points.map((p) => <th key={p} className="num">{p}점</th>)}
            </tr>
          </thead>
          <tbody>
            {t.items.map((it, i) => (
              <tr key={i}>
                <td className="ne-item">
                  {it.label}
                  {it.note && <small>{it.note}</small>}
                </td>
                {it.cells.map((c, k) => <td key={k} className="num ne-cell">{c || "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NoticeEligibilitySection({ elig, incomeYear, noticeYear, originalDoc }: Props) {
  const d = elig.data;
  const income = elig.verified && d.income_table ? d.income_table : null;
  return (
    <section className="dsec ne">
      <h2>신청자격</h2>
      <p className="note" style={{ margin: "0 0 12px" }}>
        {originalDoc} {pages(d.source_pages)}에서 읽은 기준입니다. 최종 자격은 공고문과 기관 심사가 정합니다.{" "}
        <Link href={ROUTES.eligibility}>내 조건으로 신청 가능한 유형 진단하기 →</Link>
      </p>

      {d.rank_tables.length > 0 && (
        <>
          <h3 className="elig-sub">소득기준과 신청순위</h3>
          <p className="ne-lead">소득은 가구원수별 가구당 월평균소득 대비 비율입니다. 신청면적과 순위마다 다르고, 맞벌이면 완화된 기준을 씁니다.</p>
          {d.rank_tables.map((t, i) => <RankTable key={i} t={t} />)}
        </>
      )}

      {(d.bonus_conditions.length > 0 || d.income_matrix) && (
        <>
          <h3 className="elig-sub">출생자녀 가산</h3>
          {d.bonus_conditions.length > 0 && (
            <ul className="ne-list">
              {d.bonus_conditions.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
          {d.income_matrix && (
            <div className="tbl ne-tbl">
              <table>
                <thead>
                  <tr>
                    <th>신청면적</th>
                    <th>신청자</th>
                    {d.income_matrix.columns.map((c) => <th key={c} className="num">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.income_matrix.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="ne-area">{r.area ?? "—"}</td>
                      <td className="ne-req">{r.applicant || "전체"}</td>
                      {r.pcts.map((p, k) => <td key={k} className="num">{p == null ? <span className="ne-dim">—</span> : `${p}%`}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.bonus_notes.map((n, i) => <p key={i} className="elig-memo">{n}</p>)}
        </>
      )}

      {d.asset && (
        <>
          <h3 className="elig-sub">자산 기준</h3>
          <div className="tbl ne-tbl">
            <table>
              <thead>
                <tr>
                  <th>항목</th>
                  {d.asset.columns.map((c) => <th key={c} className="num">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.asset.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="ne-area">{r.label}</td>
                    {r.values_man.map((v, k) => (
                      <td key={k} className="num" title={v == null ? undefined : `${(v * 10_000).toLocaleString("ko-KR")}원`}>
                        {v == null ? "—" : `${wonKo(v * 10_000)} 이하`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {income && (
        <>
          <h3 className="elig-sub">
            가구원수별 가구당 월평균소득 기준
            <small>{income.base_year ?? incomeYear}년 소득 통계 기준{noticeYear ? `, ${noticeYear}년 공고에 적용` : ""}</small>
          </h3>
          <p className="ne-lead">공고문은 통계청이 발표한 전년도 도시근로자 가구당 월평균소득을 씁니다. 연도가 공고보다 한 해 앞서는 이유입니다.</p>
          <div className="tbl ne-tbl">
            <table>
              <thead>
                <tr>
                  <th>비율</th>
                  {income.households.map((h) => <th key={h} className="num">{h}인</th>)}
                </tr>
              </thead>
              <tbody>
                {income.rows.map((r) => (
                  <tr key={r.pct}>
                    <td className="ne-area">{r.pct}%</td>
                    {r.won.map((v, k) => (
                      <td key={k} className="num" title={v == null ? undefined : `${v.toLocaleString("ko-KR")}원`}>{v == null ? "—" : wonKo(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {d.selection.length > 0 && (
        <>
          <h3 className="elig-sub">동일순위 경쟁 시 입주자 선정 기준</h3>
          <p className="ne-lead">같은 순위 안에서 경쟁이 있으면 아래 순서로 정합니다.</p>
          {d.selection.map((t, i) => <SelectionTable key={i} t={t} />)}
        </>
      )}

      {d.score_tables.length > 0 && (
        <>
          <h3 className="elig-sub">가점과 감점 배점표</h3>
          {d.score_tables.map((t, i) => <ScoreTable key={i} t={t} />)}
          {d.penalties && (
            <div className="ne-block">
              <h4 className="ne-group">감점</h4>
              <div className="tbl ne-tbl">
                <table>
                  <thead><tr><th>감점 기준</th><th className="num">점수</th></tr></thead>
                  <tbody>
                    {d.penalties.rows.map((r, i) => (
                      <tr key={i}><td className="ne-item">{r.label}</td><td className="num">{r.points}점</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.penalties.notes.map((n, i) => <p key={i} className="elig-memo">{n}</p>)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
