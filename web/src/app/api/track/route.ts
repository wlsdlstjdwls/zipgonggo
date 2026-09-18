// 방문 한 줄 적기. 브라우저의 visit-tracker가 sendBeacon으로 때린다.
//
// **web이 DB에 쓰는 유일한 라우트다**(CLAUDE.md 예외, 사용자 결정 2026-09-16).
// 답은 언제나 204다 — 봇이든 못 쓸 값이든 「안 받았다」를 알려줄 이유가 없고,
// 집계가 실패해도 이용자 화면에는 아무 일도 일어나면 안 된다.
import { analyticsOn, cleanView, isBotUA, recordView, sweepOld } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const NO_CONTENT = new Response(null, { status: 204 });

export async function POST(req: Request) {
  // 개인정보처리방침의 시행일 전에는 한 줄도 안 적는다(lib/analytics.ts ANALYTICS_START)
  if (!analyticsOn()) return NO_CONTENT;
  // 봇 거르기 둘째 겹. User-Agent는 여기서만 보고 **저장하지 않는다**
  if (isBotUA(req.headers.get("user-agent"))) return NO_CONTENT;

  let body: unknown;
  try {
    // sendBeacon은 Blob으로 오고 fetch keepalive는 JSON으로 온다. 둘 다 텍스트로 읽어 파싱한다
    body = JSON.parse(await req.text());
  } catch {
    return NO_CONTENT;
  }
  if (!body || typeof body !== "object") return NO_CONTENT;

  const view = cleanView(body as Record<string, unknown>);
  if (!view) return NO_CONTENT;

  try {
    await recordView(view);
    // 청소용 크론을 따로 두지 않는다 — 100번에 한 번 지나가며 오래된 줄을 치운다
    if (Math.random() < 0.01) await sweepOld();
  } catch {
    // DB가 흔들려도 이용자 쪽에서는 아무 일도 없어야 한다
  }
  return NO_CONTENT;
}
