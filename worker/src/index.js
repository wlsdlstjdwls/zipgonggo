// 집공고 바깥 방아쇠 — 10분마다 web의 /api/cron/{잡}을 때린다.
//
// 왜 여기 있나: GitHub 스케줄이 이 저장소에서 한 번도 발화하지 않았다(2026-09-10 확진).
// dispatch는 5/5 성공인데 event=schedule은 0건 — 즉 on: 블록은 파싱됐고, 배송만 안 온다.
// 같은 증상 신고가 GitHub 커뮤니티에 여럿 쌓여 있고 전부 미해결이다. 자세한 건
// docs/automation.md 「GitHub 스케줄은 방아쇠로 못 쓴다」.
//
// 이 Worker는 「언제 부를지」만 맡는다. 「부를지 말지」는 라우트가 판단한다 —
// ingest_log 나이와 GitHub 실행 상태를 읽어서 skipped: fresh / running으로 되돌려준다.
// 그래서 10분마다 때려도, 예약 작업과 겹쳐도, GitHub 크론이 나중에 살아나도 안전하다.
//
// 시크릿은 Worker secret에 둔다(`wrangler secret put`). URL 쿼리로 안 넘기는 건
// 남의 로그에 평문으로 남지 않게 하기 위해서다 — 라우트가 x-cron-secret 헤더를 받는다.

/** 때릴 잡. web/src/app/api/cron/[job]/route.ts 의 JOBS와 같아야 한다 */
const JOBS = ["collect", "patrol"];

/** Vercel 콜드 스타트를 감안한 상한. 넘기면 이번 회차만 버리고 10분 뒤가 이어받는다 */
const TIMEOUT_MS = 30_000;

/**
 * 잡 하나를 때리고 결과를 한 줄로 만든다. 던지지 않는다 —
 * 하나가 죽어도 나머지는 가야 한다.
 */
async function trigger(env, job) {
  const url = `${env.BASE_URL}/api/cron/${job}`;
  try {
    const res = await fetch(url, {
      headers: { "x-cron-secret": env.CRON_TRIGGER_SECRET },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    return { job, status: res.status, body: body.slice(0, 300) };
  } catch (e) {
    // 타임아웃과 네트워크 오류가 여기로 온다. 재시도 안 한다 — 다음 회차가 이어받는다
    return { job, status: 0, body: `요청 실패: ${e?.message ?? e}` };
  }
}

async function runAll(env) {
  if (!env.CRON_TRIGGER_SECRET) {
    console.error("CRON_TRIGGER_SECRET 이 없다 — wrangler secret put 을 안 했다");
    return [];
  }
  const out = [];
  // 차례로 때린다. 동시에 보내면 라우트의 인메모리 중복 차단이 서로 다른 인스턴스로 갈라진다
  for (const job of JOBS) {
    const r = await trigger(env, job);
    console.log(`${r.job} | ${r.status} | ${r.body}`);
    out.push(r);
  }
  return out;
}

export default {
  /** 크론 트리거 — wrangler.toml 의 crons */
  async scheduled(event, env) {
    // await로 붙든다. ctx.waitUntil로 던지면 핸들러가 먼저 끝나면서 작업이 버려진다
    // (2026-09-10 `wrangler dev --test-scheduled`에서 34ms 만에 로그 0줄로 확인)
    await runAll(env);
  },

  /**
   * 손으로 확인할 구멍. 크론을 기다리지 않고 지금 때려 본다.
   * 시크릿을 헤더로 넣어야 열린다 — 아무나 열면 dispatch 남발이 된다.
   */
  async fetch(req, env) {
    const given = req.headers.get("x-cron-secret");
    if (!env.CRON_TRIGGER_SECRET || given !== env.CRON_TRIGGER_SECRET) {
      return new Response("unauthorized\n", { status: 401 });
    }
    const results = await runAll(env);
    return Response.json({ at: new Date().toISOString(), results });
  },
};
