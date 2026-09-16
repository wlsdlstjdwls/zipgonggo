// 한국에서 나가는 구멍. **이 함수가 하는 일은 「대신 GET/POST 해 주기」 하나뿐이다.**
//
// 왜 있나: 한국 정부·서울시 사이트가 GitHub Actions 러너(Azure 미국) IP의 연결을 간헐로 안 받는다.
// apis.data.go.kr · business.juso.go.kr · housing.seoul.go.kr 셋 다 **TCP ConnectTimeout**으로 끝나고
// (재시도 4/4 전멸), 같은 시각 한국 회선에선 전부 0.04초에 붙는다(2026-09-16 실측).
// 응답이 아니라 연결 단계에서 끊기니 키·파라미터를 고쳐서 될 일이 아니다.
//
// **왜 web이 아니라 따로 사는가**: 처음엔 web에 라우트로 뒀는데 `preferredRegion = "icn1"`이
// 안 먹었다 — zipgonggo 프로젝트는 Fluid Compute가 켜져 있고(functionDefaultRegions=["iad1"]),
// Fluid는 함수별 리전 지정을 무시하고 프로젝트 기본 리전에서 전부 돌린다. 실측에서 200은 오는데
// x-egress-region이 iad1이었다. web의 Fluid를 끄면 사용자 화면이 느려지니, 리전만 다른
// **별도 프로젝트**로 뗐다. 리전은 vercel.json의 regions가 정한다.
//
// 덤으로 CLAUDE.md의 「web과 pipeline은 DB 스키마로만 통신한다」 경계를 안 뚫어도 됐다 —
// 여기는 web도 pipeline도 아닌 네트워크 경로다. DB를 아예 안 만진다.
//
// 좁게 지키는 방법 셋 —
//   1. 파싱을 안 한다. 받은 바이트를 그대로 돌려준다. 공고 해석은 전부 pipeline 몫이다
//   2. 아무 데나 못 보낸다. ALLOWED_HOSTS에 적힌 곳만 간다(SSRF 방지)
//   3. 아무나 못 쓴다. EGRESS_SECRET을 아는 쪽만 연다

/** 여기 적힌 호스트로만 나간다. pipeline/sources/egress.py의 PROXIED_HOSTS와 같아야 한다 */
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

/** 바깥 서버를 기다려 줄 시간. vercel.json의 maxDuration보다 짧아야 한다 */
const UPSTREAM_TIMEOUT_MS = 45_000;

/** 파이프라인이 그대로 보게 넘길 헤더. 나머지는 버린다 */
const PASS_THROUGH = ["content-type", "content-disposition", "location"];

const DEFAULT_UA = "Mozilla/5.0 (compatible; zipgonggo-pipeline/0.1; +https://zipgonggo.com)";

function deny(res, status, error) {
  res.status(status).json({ error });
}

/** 본문을 통째로 모은다. POST 폼 전송(i-sh 게시판)은 바이트 그대로 상류에 넘긴다 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  const secret = process.env.EGRESS_SECRET;
  if (!secret) return deny(res, 501, "EGRESS_SECRET 이 있어야 한다");
  if (req.headers["x-egress-secret"] !== secret) return deny(res, 401, "unauthorized");
  if (req.method !== "GET" && req.method !== "POST") return deny(res, 405, `안 받는 메서드: ${req.method}`);

  const target = new URL(req.url, "http://x").searchParams.get("url");
  if (!target) return deny(res, 400, "url 파라미터가 있어야 한다");

  let dest;
  try {
    dest = new URL(target);
  } catch {
    return deny(res, 400, "url 을 못 읽었다");
  }
  // https만. http로 열어 두면 사내망 평문 주소를 찔러 볼 구멍이 된다
  if (dest.protocol !== "https:") return deny(res, 400, `https 만 된다: ${dest.protocol}`);
  if (!ALLOWED_HOSTS.has(dest.hostname)) return deny(res, 403, `허용 안 된 호스트: ${dest.hostname}`);

  const payload = req.method === "POST" ? await readBody(req) : null;

  // 리다이렉트를 따라가지 않는다 — 허용 호스트 검사를 건너뛰고 아무 데나 가 버린다.
  // 3xx면 Location을 그대로 돌려주고, 따라갈지는 부른 쪽이 판단한다(ThrottledHttp가 이미 그렇게 쓴다)
  let upstream;
  try {
    upstream = await fetch(dest, {
      method: req.method,
      ...(payload ? { body: payload } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        // 부른 쪽이 준 것만 넘긴다. 쿠키·인증 헤더는 통째로 안 넘긴다
        "user-agent": req.headers["x-egress-user-agent"] ?? DEFAULT_UA,
        ...(req.headers["x-egress-referer"] ? { referer: req.headers["x-egress-referer"] } : {}),
        ...(req.headers["x-egress-accept"] ? { accept: req.headers["x-egress-accept"] } : {}),
        // POST 본문을 상대가 읽으려면 형식을 알려 줘야 한다(대개 form-urlencoded)
        ...(payload && req.headers["content-type"] ? { "content-type": req.headers["content-type"] } : {}),
      },
    });
  } catch (e) {
    // 여기서 죽는다는 건 한국에서도 안 붙는다는 뜻이다 — 그때는 진짜 상대 서버 문제다
    res.status(502).json({ error: `상류 요청 실패: ${e?.message ?? e}`, host: dest.hostname });
    return;
  }

  const declared = Number(upstream.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return deny(res, 413, `너무 크다: ${declared} 바이트`);

  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return deny(res, 413, `너무 크다: ${body.byteLength} 바이트`);

  for (const h of PASS_THROUGH) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  // **부른 쪽이 어디서 나갔는지 볼 수 있어야 한다.** icn1이 아니면 우회가 통째로 무의미하다 —
  // 2026-09-16에 그걸 모르고 iad1에서 도는 구멍을 한 번 켤 뻔했다
  res.setHeader("x-egress-region", process.env.VERCEL_REGION ?? "unknown");
  // 상류 상태코드를 그대로 얹는다 — 404·503을 200으로 바꿔 돌려주면 부른 쪽 재시도 판단이 망가진다
  res.status(upstream.status).send(body);
}
