// 대시보드 — 「파이프라인이 살아 있나」와 「사람이 손봐야 할 게 얼마나 쌓였나」 두 가지를 본다.
// 숫자를 클릭해 파고드는 화면은 아직 없다. 여기서 이상을 보고 수집 이력으로 넘어가는 게 지금의 동선이다.
import Link from "next/link";
import { isAdmin } from "@/lib/admin-auth";
import { ago, dashboardData, elapsed, parseIngestMessage, stampKST, type JobHealth } from "@/lib/admin";
import { JOBS, workflowRunsUrl } from "@/lib/jobs";
import { ROUTES } from "@/lib/routes";
import { RunButton } from "./run-button";

export const dynamic = "force-dynamic";

/** 주기 표기. 조건부 실행은 「필요할 때」 — 오래 안 돌았다고 문제가 아니다 */
function cadence(everyMin: number | null): string {
  if (everyMin === null) return "필요할 때";
  if (everyMin >= 1440) return `하루 ${Math.round(24 / (everyMin / 60))}회`;
  return `${everyMin}분마다`;
}

function JobCard({ h }: { h: JobHealth }) {
  // 빨강은 둘뿐이다 — 마지막 회차가 실패했거나, 주기가 정해진 잡이 두 배를 넘겨 소식이 없거나.
  // 조건부 잡은 아무리 오래 안 돌아도 노랑조차 안 준다(그게 정상 동작이라 경보가 무뎌진다)
  const tone = h.ok === null ? "none" : !h.ok ? "bad" : h.late ? "late" : "ok";
  return (
    <li className={`adm-job ${tone}`}>
      <b>{h.label}</b>
      <span className="adm-job-key">
        {h.stage} / {h.source}
        {h.unknown && <i title="코드의 잡 목록에 없는 기록">새 스테이지</i>}
      </span>
      <span className="adm-job-when">
        {ago(h.ageMin)}
        {h.itemCount !== null && h.itemCount > 0 && <em>{h.itemCount}건</em>}
      </span>
      <span className="adm-job-meta">
        {cadence(h.everyMin)}
        {h.runs7d > 0 && ` | 7일 ${h.runs7d}회`}
        {h.fails7d > 0 && <strong> | 실패 {h.fails7d}</strong>}
      </span>
    </li>
  );
}

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="adm-stat">
      <span>{label}</span>
      <b>{typeof value === "number" ? value.toLocaleString("ko-KR") : value}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

export default async function AdminDashboard() {
  // 레이아웃이 이미 걸렀지만 한 번 더 본다 — 자식 세그먼트는 레이아웃과 나란히 렌더될 수 있다
  if (!(await isAdmin())) return null;

  // 질의 하나로 전부 받는다 — 나눠 던지면 왕복이 늘고, 동시에 던지면 커넥션을 새로 여느라 더 걸린다
  const { health, stats, queue, sources, recent, visits } = await dashboardData();

  const broken = health.filter((h) => h.ok === false || h.late);

  return (
    <div className="adm-page">
      <header className="adm-head">
        <h1>대시보드</h1>
        <p className="adm-sub">
          {broken.length === 0 ? (
            <>파이프라인 {health.length}개 잡 모두 정상</>
          ) : (
            <strong>손봐야 할 잡 {broken.length}개 — {broken.map((h) => h.label).join(" | ")}</strong>
          )}
        </p>
      </header>

      <section className="adm-sec">
        <h2>파이프라인</h2>
        <div className="adm-runs">
          {Object.entries(JOBS).map(([name, job]) => (
            <RunButton key={name} job={name} label={job.label} runsUrl={workflowRunsUrl(job.workflow)} />
          ))}
        </div>
        <ul className="adm-jobs">
          {health.map((h) => (
            <JobCard key={`${h.stage}|${h.source}`} h={h} />
          ))}
        </ul>
      </section>

      <section className="adm-sec">
        <h2>
          방문
          <Link href={ROUTES.adminVisitors}>기간별로 보기</Link>
        </h2>
        <div className="adm-stats">
          <Stat label="동시접속" value={visits.online} note="최근 5분" />
          <Stat label="오늘 방문" value={visits.todayVisitors} note={`${visits.todayViews.toLocaleString("ko-KR")}뷰`} />
          <Stat label="누적 방문" value={visits.totalVisitors} note={`${visits.totalViews.toLocaleString("ko-KR")}뷰`} />
        </div>
      </section>

      <section className="adm-sec">
        <h2>공고</h2>
        <div className="adm-stats">
          <Stat label="열린 공고" value={stats.open} note={`마감 7일 내 ${stats.closing7d}건`} />
          <Stat label="24시간 신규" value={stats.new24h} note={`값이 바뀐 건 ${stats.updated24h}건`} />
          <Stat label="정본 공고" value={stats.canonical} note={`전체 ${stats.total.toLocaleString("ko-KR")}건`} />
          <Stat label="IndexNow 미발행" value={stats.indexnowPending} note="열린 공고 중" />
        </div>
      </section>

      <section className="adm-sec">
        <h2>쌓여 있는 것</h2>
        <div className="adm-stats">
          <Stat
            label="검수 대기"
            value={queue.reviewOpen}
            note={queue.reviewReasons.map((r) => `${r.reason} ${r.count}`).join(" | ") || "없음"}
          />
          <Stat label="결과 글 미파싱" value={queue.resultUnparsed} note={`원 공고 못 붙임 ${queue.resultUnlinked}건`} />
          <Stat label="좌표 없는 단지" value={queue.complexNoGeo} note="열린 공고 기준" />
          <Stat label="마감일 없는 공고" value={queue.openNoSchedule} note="열린 공고 기준" />
        </div>
        {/* 왜 숫자만 있고 처리 버튼이 없나 — 이 화면은 DB를 읽기만 한다(CLAUDE.md).
            검수 큐를 승인·반려하려면 파이프라인 쪽에 스테이지를 만들어 돌린다 */}
        <p className="adm-note">
          처리는 파이프라인 몫이다. 이 콘솔은 DB를 읽기만 한다 — 고칠 일은 스테이지를 돌려서 한다.
        </p>
      </section>

      <section className="adm-sec">
        <h2>출처별</h2>
        <div className="adm-table">
          <table>
            <thead>
              <tr>
                <th>출처</th>
                <th>기관</th>
                <th className="num">열린 공고</th>
                <th className="num">전체</th>
                <th className="num">단지</th>
                <th className="num">좌표 없음</th>
                <th>마지막 공고일</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={`${s.source}|${s.agency}`}>
                  <td>{s.source}</td>
                  <td>{s.agency}</td>
                  <td className="num">
                    <b>{s.open}</b>
                    {s.noEnd > 0 && <i title="접수 마감일이 없는 공고"> (마감일 없음 {s.noEnd})</i>}
                  </td>
                  <td className="num">{s.total}</td>
                  <td className="num">{s.complexes || "—"}</td>
                  <td className="num">{s.noGeo > 0 ? <strong>{s.noGeo}</strong> : "—"}</td>
                  <td>{s.lastPosted ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="adm-sec">
        <h2>
          최근 수집
          <Link href={ROUTES.adminIngest}>전체 보기</Link>
        </h2>
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
              {recent.map((r) => {
                const s = parseIngestMessage(r.message);
                return (
                  <tr key={r.id} className={r.ok ? "" : "bad"}>
                    <td>
                      {stampKST(r.started_at)}
                      <small> {elapsed(r.started_at, r.finished_at)}</small>
                    </td>
                    <td>
                      {r.stage} / {r.source}
                    </td>
                    <td className="num">{r.item_count}</td>
                    <td className="adm-sum">
                      {s.counts.slice(0, 4).map((c) => (
                        <span key={c.label}>
                          {c.label} <b>{c.value}</b>
                        </span>
                      ))}
                      {s.errors.length > 0 && <span className="err">오류 {s.errors.length}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
