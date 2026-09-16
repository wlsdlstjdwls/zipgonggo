// 한국에서 나가는 구멍. **이 라우트가 하는 일은 「대신 GET 해 주기」 하나뿐이다.**
//
// 왜 있나: 한국 정부·서울시 사이트가 GitHub Actions 러너(Azure 미국) IP의 연결을 간헐로 안 받는다.
// apis.data.go.kr · business.juso.go.kr · housing.seoul.go.kr 셋 다 **TCP ConnectTimeout**으로 끝나고
// (재시도 4/4 전멸), 같은 시각 한국 회선에선 전부 0.04초에 붙는다(2026-09-16 실측).
// 응답이 아니라 연결 단계에서 끊기니 키·파라미터를 고쳐서 될 일이 아니다.
//
// 플랜이 Pro라 라우트별 preferredRegion이 실제로 먹는다. 이 라우트만 icn1(서울)에 두면
// 바깥으로 나가는 요청이 한국에서 출발한다. **DB를 안 만지는 라우트라 리전을 떼도 손해가 없다** —
// Neon은 us-east-1이라 DB를 읽는 라우트는 계속 iad1이다(layout.tsx).
//
// **경계에 대하여**: CLAUDE.md는 「web과 pipeline은 DB 스키마로만 통신한다」고 못 박는다.
// 이건 그 예외다(사용자 승인 2026-09-16). 예외를 좁게 지키는 방법은 셋이다 —
//   1. 파싱을 안 한다. 받은 바이트를 그대로 돌려준다. 공고 해석은 전부 pipeline 몫이다
//   2. 아무 데나 못 보낸다. ALLOWED_HOSTS에 적힌 곳만 간다(SSRF 방지)
//   3. 아무나 못 쓴다. EGRESS_SECRET을 아는 쪽만 연다
// 이 셋을 지키는 한 이 라우트는 「네트워크 경로」지 「로직」이 아니다.
import { NextResponse } from "next/server";

// 이 라우트의 존재 이유 그 자체다. 바꾸면 우회가 통째로 무의미해진다
export const preferredRegion = "icn1";
export const dynamic = "force-dynamic";
// 첨부 PDF·HWP가 큰 게 있다. Pro 기본 상한 안에서 넉넉히 잡는다
export const maxDuration = 60;

/** 여기 적힌 호스트로만 나간다. 한 줄 늘릴 때마다 docs/data-sources.md도 같이 본다 */
const ALLOWED_HOSTS = new Set([
  "apis.data.go.kr",        // 마이홈 모집공고 API
  "business.juso.go.kr",    // 행안부 주소 검색
  "housing.seoul.go.kr",    // SH 서울주거포털
  "www.i-sh.co.kr",         // i-sh 게시판·첨부
  "i-sh.co.kr",
  "soco.seoul.go.kr",       // 서울시 청년안심주택
]);

/** 돌려줄 응답 상한. 넘으면 파이프라인이 직접 받으러 가는 게 낫다 */
const MAX_BYTES = 25 * 1024 * 1024;

/** 바깥 서버를 기다려 줄 시간. 라우트 자체 상한(maxDuration)보다 짧아야 한다 */
const UPSTREAM_TIMEOUT_MS = 45_000;

/** 파이프라인이 그대로 보게 넘길 헤더. 나머지는 버린다 */
const PASS_THROUGH = ["content-type", "content-disposition", "content-length", "location"];

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET(req: Request) {
  return relay(req, null);
}

// i-sh 게시판 목록은 GET 파라미터를 안 받고 mainform POST만 받는다(sources/ish_board.py).
// 본문과 content-type을 그대로 실어 보낸다 — 여기서 해석하지 않는다
export async function POST(req: Request) {
  return relay(req, await req.arrayBuffer());
}

async function relay(req: Request, payload: ArrayBuffer | null) {
  const secret = process.env.EGRESS_SECRET;
  if (!secret) return deny(501, "EGRESS_SECRET 이 있어야 한다");
  if (req.headers.get("x-egress-secret") !== secret) return deny(401, "unauthorized");

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return deny(400, "url 파라미터가 있어야 한다");

  let dest: URL;
  try {
    dest = new URL(target);
  } catch {
    return deny(400, "url 을 못 읽었다");
  }
  // https만. http로 열어 두면 사내망 평문 주소를 찔러 볼 구멍이 된다
  if (dest.protocol !== "https:") return deny(400, `https 만 된다: ${dest.protocol}`);
  if (!ALLOWED_HOSTS.has(dest.hostname)) return deny(403, `허용 안 된 호스트: ${dest.hostname}`);

  // 리다이렉트를 따라가지 않는다 — 허용 호스트 검사를 건너뛰고 아무 데나 가 버린다.
  // 3xx면 Location을 그대로 돌려주고, 따라갈지는 부른 쪽이 판단한다(ThrottledHttp가 이미 그렇게 쓴다)
  let upstream: Response;
  try {
    upstream = await fetch(dest, {
      method: payload === null ? "GET" : "POST",
      ...(payload === null ? {} : { body: payload }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        // 부른 쪽이 준 것만 넘긴다. 쿠키·인증 헤더는 통째로 안 넘긴다
        "user-agent": req.headers.get("x-egress-user-agent") ?? "Mozilla/5.0 (compatible; zipgonggo-pipeline/0.1; +https://zipgonggo.com)",
        ...(req.headers.get("x-egress-referer") ? { referer: req.headers.get("x-egress-referer")! } : {}),
        ...(req.headers.get("x-egress-accept") ? { accept: req.headers.get("x-egress-accept")! } : {}),
        // POST 본문을 상대가 읽으려면 형식을 알려 줘야 한다(대개 form-urlencoded)
        ...(payload !== null && req.headers.get("content-type")
          ? { "content-type": req.headers.get("content-type")! }
          : {}),
      },
    });
  } catch (e) {
    // 여기서 죽는다는 건 한국에서도 안 붙는다는 뜻이다 — 그때는 진짜 상대 서버 문제다
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `상류 요청 실패: ${msg}`, host: dest.hostname }, { status: 502 });
  }

  const declared = Number(upstream.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return deny(413, `너무 크다: ${declared} 바이트`);

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return deny(413, `너무 크다: ${body.byteLength} 바이트`);

  const headers = new Headers();
  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // 상류 상태코드를 그대로 얹는다 — 404·503을 200으로 바꿔 돌려주면 부른 쪽 재시도 판단이 망가진다
  headers.set("x-egress-region", process.env.VERCEL_REGION ?? "unknown");
  return new NextResponse(body, { status: upstream.status, headers });
}
