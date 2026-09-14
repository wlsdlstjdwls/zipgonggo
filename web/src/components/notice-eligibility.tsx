// 공고문에서 읽은 신청자격(notice_eligibility, 0024) — 제도 일반 시드 카드 대신 이 공고 자체의 기준을 그린다.
//
// 세 양식(lib/notice-fit.ts 머리말): 장기전세는 면적×순위×출생자녀 가산×맞벌이 매트릭스 + 선정 순서 + 가감점표,
// 행복주택은 계층 절(요건·순위·배점·선정), 매입임대는 순위 두 줄. 표가 여러 장이라 **한 번에 다 펴지 않는다** —
// 제목 밑에 한 줄 요약을 두고, 순위 표만 펼친 채 나머지는 <details>로 접는다(사용자 지적 2026-09-14: "나열식이라 보기 힘들다").
// 값은 파이프라인이 공고문 쪽 XML에서 좌표로 읽은 것이다. 소득표 금액은 검산(verified)을 통과했을 때만 싣는다.
import type { ReactNode } from "react";
import { wonKo } from "@/lib/format";
import { classKey } from "@/lib/notice-fit";
import type { EligClassBlock, EligRankTable, EligScoreTable, EligSelection, NoticeEligibility } from "@/types/eligibility";
import { ClassTabs } from "./class-tabs";

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

/** 접이식 묶음. 기본은 접힘 — 순위 표처럼 먼저 봐야 할 것만 open */
function Fold({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="ne-fold" open={open}>
      <summary>
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </summary>
      <div className="ne-fold-body">{children}</div>
    </details>
  );
}

function RankTable({ t }: { t: EligRankTable }) {
  const areaSpan = spans(t.rows, (r) => r.area);
  const ranked = t.rows.some((r) => r.rank != null);
  const hasArea = t.rows.some((r) => r.area);
  const hasDual = t.rows.some((r) => r.dual_income_pct != null);
  return (
    <div className="ne-block">
      {t.group !== "신청자격" && (
        <h4 className="ne-group">
          {t.group}
          {t.classes.length > 0 && <span className="ne-classes">{t.classes.join(" | ")}</span>}
        </h4>
      )}
      <div className="tbl ne-tbl">
        <table>
          <thead>
            <tr>
              {hasArea && <th>신청면적</th>}
              {ranked && <th>순위</th>}
              <th className="num">소득기준</th>
              {hasDual && <th className="num">맞벌이</th>}
              <th>소득 외 기준</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i}>
                {hasArea && areaSpan[i] > 0 && <td rowSpan={areaSpan[i]} className="ne-area">{r.area}</td>}
                {ranked && <td className="ne-rank">{r.rank != null ? `${r.rank}순위` : "—"}</td>}
                <td className="num">{pct(r.income_pct)}</td>
                {hasDual && <td className="num">{r.dual_income_pct != null ? pct(r.dual_income_pct) : <span className="ne-dim">완화 없음</span>}</td>}
                <td className="ne-req">{r.requirement ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SelectionTable({ t, title }: { t: EligSelection; title?: boolean }) {
  const groupSpan = spans(t.rows, (r) => r.group);
  const hasArea = t.rows.some((r) => r.area);
  const hasGroup = t.rows.some((r) => r.group);
  return (
    <div className="ne-block">
      {title !== false && <h4 className="ne-group">{t.title}</h4>}
      <div className="tbl ne-tbl">
        <table>
          <thead>
            <tr>
              {hasGroup && <th>구분</th>}
              {hasArea && <th>신청면적</th>}
              <th>선정 순서</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i}>
                {hasGroup && groupSpan[i] > 0 && <td rowSpan={groupSpan[i]} className="ne-area">{r.group ?? "—"}</td>}
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
                {it.cells.map((c, k) => <td key={k} className={`ne-cell${c.length > 24 ? " wrap" : ""}`}>{c || "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RankList({ rows }: { rows: { rank: number; text: string }[] }) {
  return (
    <div className="tbl ne-tbl">
      <table>
        <thead><tr><th>순위</th><th>요건</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rank}><td className="ne-rank">{r.rank}순위</td><td className="ne-req">{r.text}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notes({ items, title = "유의사항" }: { items: string[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <Fold title={title} hint={`${items.length}건`}>
      <ul className="ne-list">
        {items.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
    </Fold>
  );
}

/** 행복주택 계층 절 하나 — 일반공급 요건·순위 → 우선공급 순위·배점 → 경쟁 시 선정 순서 → 유의사항 */
function ClassBlock({ c }: { c: EligClassBlock }) {
  return (
    <div className="ne-class">
      <div className="ne-sub">
        <h4 className="ne-group">일반공급 요건</h4>
        {c.general.intro && <p className="ne-lead">{c.general.intro}</p>}
        <ul className="ne-list ne-reqs">
          {c.general.requirements.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        {c.general.ranks.length > 0 && (
          <>
            <h4 className="ne-group">일반공급 순위</h4>
            <RankList rows={c.general.ranks} />
          </>
        )}
      </div>
      {c.priority.ranks.length > 0 && (
        <div className="ne-sub">
          <h4 className="ne-group">우선공급 순위 <span className="ne-classes">일반공급 요건을 갖추고 아래 순위에 드는 사람</span></h4>
          <RankList rows={c.priority.ranks} />
        </div>
      )}
      {c.priority.score && (
        <div className="ne-sub">
          <h4 className="ne-group">우선공급 배점</h4>
          <ScoreTable t={c.priority.score} />
          {c.priority.notes.length > 0 && <p className="elig-memo">{c.priority.notes[0]}</p>}
        </div>
      )}
      {c.selection && (
        <div className="ne-sub">
          <h4 className="ne-group">경쟁 시 입주자 선정 순서</h4>
          <SelectionTable t={c.selection} title={false} />
        </div>
      )}
      <Notes items={[...c.general.notes, ...c.priority.notes.slice(1), ...c.notes]} />
    </div>
  );
}

/** 제목 밑 한 줄 요약 — 표를 펴기 전에 「무엇이 갈리는지」만 */
function summary(elig: NoticeEligibility): string {
  const d = elig.data;
  const kind = d.kind ?? "janggi";
  if (kind === "haengbok") {
    const names = (d.class_blocks ?? []).map((c) => classKey(c.name));
    const assets = d.asset?.rows.filter((r) => r.label.includes("총자산")).map((r) => r.values_man[0]).filter((v): v is number => v != null) ?? [];
    const asset = assets.length ? `총자산 ${wonKo(Math.min(...assets) * 10_000)}~${wonKo(Math.max(...assets) * 10_000)}(계층별)` : "";
    return [`계층 ${names.join(" | ")}`, "소득 100% (신혼 맞벌이 120%, 출생자녀 +10~20%p)", asset].filter(Boolean).join(" | ");
  }
  if (kind === "maeip") {
    const r1 = d.rank_tables[0]?.rows.find((r) => r.rank === 1);
    return r1?.income_pct != null ? `소득 ${r1.income_pct}% 이하 1순위, 초과 2순위 | 동일순위 추첨` : "순위별 소득 기준";
  }
  const pcts = d.rank_tables.flatMap((t) => t.rows.map((r) => r.income_pct)).filter((v): v is number => v != null);
  const duals = d.rank_tables.flatMap((t) => t.rows.map((r) => r.dual_income_pct)).filter((v): v is number => v != null);
  const asset = d.asset?.rows.find((r) => r.label.includes("총자산"))?.values_man[0];
  return [
    pcts.length ? `면적과 순위에 따라 소득 ${Math.min(...pcts)}~${Math.max(...pcts)}%${duals.length ? ` (맞벌이 최대 ${Math.max(...duals)}%)` : ""}` : "",
    asset != null ? `총자산 ${wonKo(asset * 10_000)} 이하` : "",
    d.score_tables.length ? "동일순위는 가감점" : "",
  ].filter(Boolean).join(" | ");
}

export function NoticeEligibilitySection({ elig, incomeYear, noticeYear, originalDoc }: Props) {
  const d = elig.data;
  const kind = d.kind ?? "janggi";
  const income = elig.verified && d.income_table ? d.income_table : null;
  const hasConditions = income?.rows.some((r) => r.conditions && r.conditions.length > 0);
  return (
    <section className="dsec ne" id="eligibility">
      <h2>신청자격 <small className="dsec-src">{originalDoc} {pages(d.source_pages)}</small></h2>
      <p className="ne-sum">{summary(elig)}</p>

      {kind === "haengbok" && (d.class_blocks?.length ?? 0) > 0 && (
        <ClassTabs tabs={d.class_blocks!.map((c) => ({ key: c.name, label: classKey(c.name), body: <ClassBlock c={c} /> }))} />
      )}

      {kind !== "haengbok" && d.rank_tables.length > 0 && (
        <Fold title={kind === "maeip" ? "신청 순위" : "소득기준과 신청순위"} open
          hint={kind === "maeip" ? undefined : "면적과 순위마다 다르고, 맞벌이면 완화된 기준"}>
          {d.rank_tables.map((t, i) => <RankTable key={i} t={t} />)}
        </Fold>
      )}

      {(d.bonus_conditions.length > 0 || d.income_matrix) && (
        <Fold title="출생자녀 가산" hint="2023.3.28. 이후 출생 자녀가 있으면 소득·자산 기준이 오른다">
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
        </Fold>
      )}

      {d.asset && (
        <Fold title={kind === "haengbok" ? "자산과 자동차 기준" : "자산 기준"} hint={kind === "haengbok" ? "계층별, 출생자녀가 있으면 완화" : undefined}>
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
                        {v == null ? "—" : v === 0 ? "소유 불가" : `${wonKo(v * 10_000)} 이하`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      )}

      {income && (
        <Fold title="가구원수별 월평균소득 기준액" open={kind === "maeip"}
          hint={`${income.base_year ?? incomeYear}년 소득 통계 기준${noticeYear ? `, ${noticeYear}년 공고에 적용` : ""}`}>
          <p className="ne-lead">
            공고문은 통계청이 발표한 전년도 도시근로자 가구당 월평균소득을 씁니다. 연도가 공고보다 한 해 앞서는 이유입니다.
            {income.bump && Object.keys(income.bump).length > 0 && " 1인 가구는 20%p, 2인 가구는 10%p를 더한 금액이 표에 그대로 적혀 있습니다."}
          </p>
          <div className="tbl ne-tbl">
            <table>
              <thead>
                <tr>
                  <th>비율</th>
                  {hasConditions && <th>적용 조건</th>}
                  {income.households.map((h) => <th key={h} className="num">{h}인</th>)}
                </tr>
              </thead>
              <tbody>
                {income.rows.map((r) => (
                  <tr key={r.pct}>
                    <td className="ne-area">{r.pct}%</td>
                    {hasConditions && <td className="ne-req">{(r.conditions ?? []).join(" / ") || "—"}</td>}
                    {r.won.map((v, k) => (
                      <td key={k} className="num" title={v == null ? undefined : `${v.toLocaleString("ko-KR")}원`}>{v == null ? "—" : wonKo(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {income.per_person_won && Object.keys(income.per_person_won).length > 0 && (
            <p className="elig-memo">
              6인 이상 가구는 5인 값에 1인당 {Object.entries(income.per_person_won).map(([k, v]) => `${k}% ${wonKo(v)}`).join(", ")}을 더합니다.
            </p>
          )}
        </Fold>
      )}

      {d.selection.length > 0 && (
        <Fold title={kind === "maeip" ? "동일순위 경쟁 시" : "동일순위 경쟁 시 입주자 선정 기준"} hint="같은 순위 안에서 경쟁하면 이 순서로 정한다" open={kind === "maeip"}>
          {d.selection.map((t, i) => <SelectionTable key={i} t={t} title={d.selection.length > 1} />)}
        </Fold>
      )}

      {d.score_tables.length > 0 && (
        <Fold title="가점과 감점 배점표">
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
        </Fold>
      )}
      <p className="note ne-foot">최종 자격은 공고문과 기관 심사가 정합니다.</p>
    </section>
  );
}
