// GitHub 크론이 안 돌 때를 위한 바깥 방아쇠.
//
// 2026-09-10 실측: collect.yml의 `17 * * * *`가 06:17·07:17 두 회차를 통째로 건너뛰었다.
// 저장소 설정에는 걸릴 게 없었다 — main에 있고, 워크플로 state는 active, YAML·크론 문법 정상,
// Actions 사용량 150/2000분, GitHub 상태 페이지에 장애 없음. 스케줄 이벤트는 SLA 없는
// 최선노력 배송이라 조용히 버려지고, 버려진 사실은 어디에도 안 남는다.
//
// 그래서 시각을 지키는 일을 GitHub 밖으로 뺀다. 이 라우트는 아무나 얼마나 자주 두드려도 되고,
// **실제로 워크플로를 부를지는 여기서 판단한다.** 그래서 방아쇠 쪽 정밀도가 필요 없다 —
// 무료 uptime 모니터(5분 간격), 실제 사용자 트래픽, Vercel Hobby 크론(하루 1회) 아무거나,
// 셋을 겹쳐 놔도 된다.
//
// 판단 근거 둘 다 읽기다. web은 DB를 읽기만 한다(CLAUDE.md 디렉터리 경계):
//   1. ingest_log — 파이프라인이 회차마다 남기는 실행 기록. 마지막 실행이 얼마나 됐나
//   2. GitHub 실행 목록 — 지금 queued/in_progress인 회차가 있나
// 상태를 우리가 따로 적어 두지 않으니 어긋날 일이 없다. 2번은 GitHub 자신의 상태라 더 정확하다.
import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// 워크플로를 부를지 말지가 매 요청 달라진다. 캐시되면 안 된다
export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

type Job = {
  /** .github/workflows/ 파일명 */
  workflow: string;
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
const JOBS: Record<string, Job> = {
  // 매시 :17 — 서울주거포털 목록 감시
  collect: { workflow: "collect.yml", stage: "S1", source: "sh_scrape", minIntervalMin: 55 },
  // 하루 1회 21:40 UTC — i-sh 게시판 순찰. m_241 쪽 기록으로 판정한다
  patrol: { workflow: "patrol.yml", stage: "S1", source: "ish_board", minIntervalMin: 20 * 60 },
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

export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const { job: name } = await ctx.params;
  const job = JOBS[name];
  if (!job) return NextResponse.json({ error: `모르는 잡: ${name}` }, { status: 404 });

  const secret = process.env.CRON_TRIGGER_SECRET;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!secret || !token || !repo) {
    return NextResponse.json(
      { error: "CRON_TRIGGER_SECRET · GITHUB_DISPATCH_TOKEN · GITHUB_REPO 가 있어야 한다" },
      { status: 501 },
    );
  }

  const u = new URL(req.url);
  const given = req.headers.get("x-cron-secret") ?? u.searchParams.get("secret");
  if (given !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const seen = recent.get(name);
  if (seen && now - seen < job.minIntervalMin * 60_000) {
    return NextResponse.json({ job: name, skipped: "just_dispatched" });
  }

  // 1) 마지막으로 돈 게 언제인가 — 파이프라인이 남긴 기록을 읽는다
  const rows = await query<{ started_at: Date }>(
    "SELECT started_at FROM ingest_log WHERE stage = $1 AND source = $2 ORDER BY started_at DESC LIMIT 1",
    [job.stage, job.source],
  );
  const last = rows[0]?.started_at ? new Date(rows[0].started_at).getTime() : null;
  const ageMin = last === null ? null : Math.floor((now - last) / 60_000);
  if (ageMin !== null && ageMin < job.minIntervalMin) {
    return NextResponse.json({ job: name, skipped: "fresh", ageMin, needMin: job.minIntervalMin });
  }

  // 2) 이미 도는 중이면 또 부르지 않는다. GitHub 자신의 상태라 우리가 적어 둔 것보다 정확하다
  const running = await gh(
    `/repos/${repo}/actions/workflows/${job.workflow}/runs?per_page=1&status=in_progress`,
    token,
  );
  const queued = await gh(
    `/repos/${repo}/actions/workflows/${job.workflow}/runs?per_page=1&status=queued`,
    token,
  );
  if (!running.ok || !queued.ok) {
    const detail = await running.text().catch(() => "");
    return NextResponse.json({ error: "GitHub 실행 목록 조회 실패", detail: detail.slice(0, 200) }, { status: 502 });
  }
  const busy =
    ((await running.json()) as { total_count: number }).total_count +
    ((await queued.json()) as { total_count: number }).total_count;
  if (busy > 0) return NextResponse.json({ job: name, skipped: "running", ageMin });

  // 3) 부른다. GITHUB_TOKEN이든 PAT든 workflow_dispatch는 언제나 실행을 만든다
  const res = await gh(`/repos/${repo}/actions/workflows/${job.workflow}/dispatches`, token, {
    method: "POST",
    body: JSON.stringify({ ref: "main", ...(job.inputs ? { inputs: job.inputs } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json({ error: "dispatch 실패", status: res.status, detail: detail.slice(0, 200) }, { status: 502 });
  }
  recent.set(name, now);
  return NextResponse.json({ job: name, dispatched: job.workflow, ageMin, at: new Date().toISOString() }, { status: 202 });
}
