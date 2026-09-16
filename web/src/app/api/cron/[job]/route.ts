// GitHub 크론이 안 돌 때를 위한 바깥 방아쇠.
//
// 2026-09-10 실측: collect.yml의 `17 * * * *`가 06:17·07:17 두 회차를 통째로 건너뛰었다.
// 저장소 설정에는 걸릴 게 없었다 — main에 있고, 워크플로 state는 active, YAML·크론 문법 정상,
// Actions 사용량 150/2000분, GitHub 상태 페이지에 장애 없음. 스케줄 이벤트는 SLA 없는
// 최선노력 배송이라 조용히 버려지고, 버려진 사실은 어디에도 안 남는다.
//
// 그래서 시각을 지키는 일을 GitHub 밖으로 뺀다. 이 라우트는 아무나 얼마나 자주 두드려도 되고,
// **실제로 워크플로를 부를지는 안에서 판단한다**(`lib/jobs.ts`). 그래서 방아쇠 쪽 정밀도가 필요 없다 —
// 무료 uptime 모니터(5분 간격), 실제 사용자 트래픽, Vercel Hobby 크론(하루 1회) 아무거나,
// 셋을 겹쳐 놔도 된다.
//
// 판단 로직 자체는 관리자 콘솔의 「지금 돌리기」와 같은 함수를 쓴다 — 두 벌로 갈라지면 한쪽만 고쳐진다.
import { NextResponse } from "next/server";
import { dispatchJob } from "@/lib/jobs";

// 워크플로를 부를지 말지가 매 요청 달라진다. 캐시되면 안 된다
export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const { job: name } = await ctx.params;

  const secret = process.env.CRON_TRIGGER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_TRIGGER_SECRET 이 있어야 한다" }, { status: 501 });
  }
  const u = new URL(req.url);
  const given = req.headers.get("x-cron-secret") ?? u.searchParams.get("secret");
  if (given !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { status, body } = await dispatchJob(name);
  return NextResponse.json(body, { status });
}
