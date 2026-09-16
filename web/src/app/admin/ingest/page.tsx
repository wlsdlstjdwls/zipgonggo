// 수집 이력 — ingest_log를 그대로 읽는다. 파이프라인이 회차마다 남기는 유일한 기록이라
// 「왜 이 공고가 안 들어왔나」를 여기서 시작해 푼다.
//
// message가 JSON이라 요약을 펼쳐 준다. 규격이 아니라 관행이라(스테이지마다 조금씩 다르다)
// 못 읽으면 원문을 그대로 보여준다 — 화면이 죽는 것보다 못난 표가 낫다.
import Link from "next/link";
import { isAdmin } from "@/lib/admin-auth";
import { elapsed, ingestFacets, listIngest, parseIngestMessage, stampKST } from "@/lib/admin";
import { JOBS, workflowRunsUrl } from "@/lib/jobs";
import { ROUTES } from "@/lib/routes";
import { RunButton } from "../run-button";

export const dynamic = "force-dynamic";

const PAGE = 50;

type Search = { stage?: string; source?: string; fails?: string; before?: string };

/** 지금 필터를 유지한 채 한 칸만 바꾼 주소. 칩은 전부 링크라 클라이언트 JS가 없다 */
function href(cur: Search, patch: Partial<Search>): string {
  const next = { ...cur, ...patch, before: undefined };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${ROUTES.adminIngest}?${s}` : ROUTES.adminIngest;
}

export default async function AdminIngest({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await isAdmin())) return null;

  const sp = await searchParams;
  const cur: Search = { stage: sp.stage, source: sp.source, fails: sp.fails, before: sp.before };
  const [facets, rows] = await Promise.all([
    ingestFacets(),
    listIngest({
      stage: cur.stage,
      source: cur.source,
      failsOnly: cur.fails === "1",
      before: cur.before ? Number(cur.before) : undefined,
      limit: PAGE,
    }),
  ]);
  const last = rows.at(-1);

  return (
    <div className="adm-page">
      <header className="adm-head">
        <h1>수집 이력</h1>
        <p className="adm-sub">최근 30일 실패 {facets.fails30d}회</p>
      </header>

      <div className="adm-runs">
        {Object.entries(JOBS).map(([name, job]) => (
          <RunButton key={name} job={name} label={job.label} runsUrl={workflowRunsUrl(job.workflow)} />
        ))}
      </div>

      <div className="adm-chips" role="group" aria-label="이력 필터">
        <Link href={href(cur, { stage: undefined, source: undefined, fails: undefined })} className={!cur.stage && !cur.source && !cur.fails ? "on" : ""}>
          전체
        </Link>
        <Link href={href(cur, { fails: cur.fails === "1" ? undefined : "1" })} className={cur.fails === "1" ? "on" : ""}>
          실패만
        </Link>
        <span className="adm-chip-gap" aria-hidden="true" />
        {facets.stages.map((s) => (
          <Link key={s} href={href(cur, { stage: cur.stage === s ? undefined : s })} className={cur.stage === s ? "on" : ""}>
            {s}
          </Link>
        ))}
        <span className="adm-chip-gap" aria-hidden="true" />
        {facets.sources.map((s) => (
          <Link key={s} href={href(cur, { source: cur.source === s ? undefined : s })} className={cur.source === s ? "on" : ""}>
            {s}
          </Link>
        ))}
      </div>

      <div className="adm-table">
        <table>
          <thead>
            <tr>
              <th>시각</th>
              <th>잡</th>
              <th className="num">건수</th>
              <th>요약</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = parseIngestMessage(r.message);
              return (
                <tr key={r.id} className={r.ok ? "" : "bad"}>
                  <td>
                    {stampKST(r.started_at)}
                    <small> {elapsed(r.started_at, r.finished_at)}</small>
                  </td>
                  <td>
                    <b>{r.stage}</b> / {r.source}
                    {!r.ok && <i className="adm-fail">실패</i>}
                  </td>
                  <td className="num">{r.item_count}</td>
                  <td className="adm-sum">
                    {s.counts.map((c) => (
                      <span key={c.label}>
                        {c.label} <b>{c.value}</b>
                      </span>
                    ))}
                    {s.skipped.length > 0 && (
                      <span className="skip">
                        건너뜀 {s.skipped.map((k) => `${k.label} ${k.value}`).join(" | ")}
                      </span>
                    )}
                    {s.errors.length > 0 && (
                      <details className="adm-err">
                        <summary>오류 {s.errors.length}</summary>
                        <ul>
                          {s.errors.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {s.raw && (
                      <details className="adm-err">
                        <summary>원문</summary>
                        <pre>{s.raw}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4}>기록이 없다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 커서는 id. 시각으로 넘기면 같은 초에 끝난 회차가 빠진다 */}
      {rows.length === PAGE && last && (
        <div className="adm-more">
          <Link href={`${href(cur, {})}${href(cur, {}).includes("?") ? "&" : "?"}before=${last.id}`}>
            더 보기
          </Link>
        </div>
      )}
    </div>
  );
}
