// GitHub Actions 워크플로를 바깥에서 부르는 일. 두 입구가 같이 쓴다 —
// `/api/cron/{job}`(무료 모니터가 때리는 방아쇠)와 `/admin/ingest`의 「지금 돌리기」 버튼.
//
// 판단 근거는 둘 다 읽기다. web은 DB를 읽기만 한다(CLAUDE.md 디렉터리 경계):
//   1. ingest_log — 파이프라인이 회차마다 남기는 실행 기록. 마지막 실행이 얼마나 됐나
//   2. GitHub 실행 목록 — 지금 queued/in_progress인 회차가 있나
// 상태를 우리가 따로 적어 두지 않으니 어긋날 일이 없다. 2번은 GitHub 자신의 상태라 더 정확하다.
import { query } from "@/lib/db";

export type Job = {
  /** .github/workflows/ 파일명 */
  workflow: string;
  /** 화면에 뜨는 이름 */
  label: string;
  /** 이 잡이 돌았는지 판정할 ingest_log 행 (stage, source) */
  stage: string;
  source: string;
  /** 이 시간이 안 지났으면 안 부른다(분) */
  minIntervalMin: number;
  /** workflow_dispatch 입력 */
  inputs?: Record<string, string>;
};

// 워크플로의 cron과 같은 주기를 쓴다. 여유를 조금 빼 둔 건 앞 회차가 늦게 끝났을 때
// 다음 회차가 「아직 안 됐다」로 밀리는 걸 막기 위해서다
export const JOBS: Record<string, Job> = {
  // 매시 :17 — 서울주거포털 목록 감시
  collect: {
    workflow: "collect.yml",
    label: "공고 수집",
    stage: "S1",
    source: "sh_scrape",
    minIntervalMin: 55,
  },
  // 하루 1회 21:40 UTC — i-sh 게시판 순찰. m_241 쪽 기록으로 판정한다
  patrol: {
    workflow: "patrol.yml",
    label: "게시판 순찰",
    stage: "S1",
    source: "ish_board",
    minIntervalMin: 20 * 60,
  },
};

const GITHUB_API = "https://api.github.com";

/** 이 람다 인스턴스가 방금 부른 잡. 모니터 여럿이 동시에 때릴 때의 좁은 경합을 줄인다.
 *  인스턴스마다 따로라 완벽하지 않지만, 뚫려도 GitHub의 concurrency 그룹이 줄을 세운다. */
const g = globalThis as unknown as { __zipgonggoCronSeen?: Map<string, number> };
const recent = (g.__zipgonggoCronSeen ??= new Map<string, number>());

async function gh(path: string, token: string, init?: RequestInit) {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    cache: "no-store",
  });
}

export type DispatchResult =
  | { status: 202; body: { job: string; dispatched: string; ageMin: number | null; at: string } }
  | { status: 200; body: { job: string; skipped: string; ageMin?: number | null; needMin?: number } }
  | { status: 404 | 501 | 502; body: { error: string; [k: string]: unknown } };

/**
 * 잡 하나를 부를지 판단하고, 불러야 하면 workflow_dispatch를 쏜다.
 * `force`는 관리자 콘솔의 「지금 돌리기」용 — 주기가 안 찼어도 부른다.
 * 다만 **이미 도는 중이면 force라도 안 부른다** — 같은 파이프라인 두 벌이 겹치면
 * upsert가 서로를 덮으며 db_error가 난다(2026-09-08 실측, ingest_log에 남아 있다).
 */
export async function dispatchJob(name: string, opts: { force?: boolean } = {}): Promise<DispatchResult> {
  const job = JOBS[name];
  if (!job) return { status: 404, body: { error: `모르는 잡: ${name}` } };

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    return { status: 501, body: { error: "GITHUB_DISPATCH_TOKEN 과 GITHUB_REPO 가 있어야 한다" } };
  }

  const now = Date.now();
  const seen = recent.get(name);
  if (!opts.force && seen && now - seen < job.minIntervalMin * 60_000) {
    return { status: 200, body: { job: name, skipped: "just_dispatched" } };
  }

  // 1) 마지막으로 돈 게 언제인가 — 파이프라인이 남긴 기록을 읽는다
  const rows = await query<{ started_at: Date }>(
    "SELECT started_at FROM ingest_log WHERE stage = $1 AND source = $2 ORDER BY started_at DESC LIMIT 1",
    [job.stage, job.source],
  );
  const last = rows[0]?.started_at ? new Date(rows[0].started_at).getTime() : null;
  const ageMin = last === null ? null : Math.floor((now - last) / 60_000);
  if (!opts.force && ageMin !== null && ageMin < job.minIntervalMin) {
    return { status: 200, body: { job: name, skipped: "fresh", ageMin, needMin: job.minIntervalMin } };
  }

  // 2) GitHub 쪽 실행 목록. 도는 중인지와 **마지막 회차가 언제 시작했는지**를 같이 본다.
  //
  // ingest_log만 보면 안 되는 이유: GitHub 자신의 schedule이 회차를 만든 직후엔 아직
  // ingest_log에 아무것도 없다. 그 틈에 이쪽이 dispatch를 쏘면 같은 잡이 두 벌 돈다 —
  // 2026-09-16 00:20에 20초 차로 실제로 그랬다(dispatch 00:20:15Z · schedule 00:20:36Z).
  // 크래시로 ingest_log를 못 남긴 회차도 여기서는 보인다.
  //
  // 한 번만 부른다 — status 필터 없이 최근 것부터 받아서 둘 다 여기서 센다.
  const res0 = await gh(`/repos/${repo}/actions/workflows/${job.workflow}/runs?per_page=10&branch=main`, token);
  if (!res0.ok) {
    const detail = await res0.text().catch(() => "");
    return { status: 502, body: { error: "GitHub 실행 목록 조회 실패", detail: detail.slice(0, 200) } };
  }
  const { workflow_runs: runs = [] } = (await res0.json()) as {
    workflow_runs?: { status: string; created_at: string }[];
  };
  if (runs.some((r) => r.status !== "completed")) {
    return { status: 200, body: { job: name, skipped: "running", ageMin } };
  }
  const lastRun = runs.reduce<number | null>((max, r) => {
    const t = Date.parse(r.created_at);
    return Number.isNaN(t) ? max : Math.max(max ?? t, t);
  }, null);
  const runAgeMin = lastRun === null ? null : Math.floor((now - lastRun) / 60_000);
  if (!opts.force && runAgeMin !== null && runAgeMin < job.minIntervalMin) {
    // 이름을 따로 둔다 — 「ingest_log가 최신이라」 건너뛴 것과 「방금 회차가 떠서」 건너뛴 것은
    // 다른 얘기다. 뒤엣것만 자꾸 뜨면 워크플로가 돌긴 도는데 기록을 못 남기고 있다는 뜻이다
    return { status: 200, body: { job: name, skipped: "run_just_started", ageMin: runAgeMin, needMin: job.minIntervalMin } };
  }

  // 3) 부른다. GITHUB_TOKEN이든 PAT든 workflow_dispatch는 언제나 실행을 만든다
  const res = await gh(`/repos/${repo}/actions/workflows/${job.workflow}/dispatches`, token, {
    method: "POST",
    body: JSON.stringify({ ref: "main", ...(job.inputs ? { inputs: job.inputs } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { status: 502, body: { error: "dispatch 실패", githubStatus: res.status, detail: detail.slice(0, 200) } };
  }
  recent.set(name, now);
  return { status: 202, body: { job: name, dispatched: job.workflow, ageMin, at: new Date().toISOString() } };
}

/** 워크플로 실행 목록 화면 주소. 「지금 돌리기」 뒤에 사람이 눈으로 따라갈 곳 */
export function workflowRunsUrl(workflow: string): string | null {
  const repo = process.env.GITHUB_REPO;
  return repo ? `https://github.com/${repo}/actions/workflows/${workflow}` : null;
}
