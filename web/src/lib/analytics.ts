// 방문 집계. **여기가 web이 DB에 쓰는 유일한 자리다**(CLAUDE.md 예외, 사용자 결정 2026-09-16).
// 방문은 브라우저에서만 생기는 사실이라 파이프라인이 알 길이 없다.
//
// 무엇을 적나 — 무작위 방문자 식별자, 경로, 유입 도메인, 시각. 넷뿐이다.
// IP도 User-Agent도 쿼리스트링도 안 적는다(User-Agent는 봇을 거르는 데만 쓰고 버린다).
import { query } from "@/lib/db";

/**
 * 집계를 시작하는 날(KST). 이 날 전에는 라우트가 아무것도 안 적는다.
 *
 * **왜 날짜로 막나** — 무작위 식별자라도 사람을 하나로 묶어 세는 이상 개인정보처리방침이 먼저 서야 한다.
 * 그래서 방침 시행일(PRIVACY_EFFECTIVE_DATE)과 이 날짜를 **같은 값으로** 맞춰 둔다.
 * 한쪽만 고치면 지면이 거짓말이 된다 — 옮길 땐 둘 다 옮긴다.
 *
 * 2026-09-17로 당겼다(사용자 결정). 방침의 「7일 전 공지」는 **앞으로의 변경**에 거는 약속이고,
 * 이번 건은 서비스를 열며 방침을 처음 세우는 자리라 같은 날 시행한다 — 방침 10항 문구도 그렇게 고쳤다.
 * 로컬에서 확인할 때는 env ANALYTICS_START로 덮어쓴다.
 */
export const ANALYTICS_START = process.env.ANALYTICS_START || "2026-09-17";

/** 오늘(KST)이 시행일에 닿았나 */
export function analyticsOn(): boolean {
  const todayKST = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return todayKST >= ANALYTICS_START;
}

/** 방문 기록 보관 기간. 지나면 지운다 */
export const RETENTION_MONTHS = 12;
/** 「동시접속」으로 칠 최근 시간(분) */
export const ONLINE_MIN = 5;

// ── 봇 거르기 ──────────────────────────────────────────────────────
//
// 첫 겹은 구조다: 집계가 JS 비콘이라 **스크립트를 안 도는 크롤러는 애초에 안 들어온다.**
// 구글·네이버(Yeti)·빙의 주력 크롤러가 여기서 거의 다 빠진다.
// 둘째 겹이 이 정규식 — 헤드리스 브라우저나 스크립트가 붙은 놈을 막는다.
// 셋째 겹은 브라우저 쪽 navigator.webdriver 확인(visit-tracker.tsx).
//
// **「naver」를 막으면 안 된다** — 네이버 앱 인앱 브라우저의 UA에 그 글자가 들어간다(진짜 사람이다).
// 네이버 크롤러는 「Yeti」, 다음 크롤러는 「Daumoa」라 그 이름을 막는다.
const BOT_UA =
  /(bot\b|bot\/|crawler|crawl(?:ing)?|spider|slurp|yeti|daumoa|mediapartners|adsbot|facebookexternalhit|embedly|scrapy|curl\/|wget|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|headless|phantomjs|puppeteer|playwright|selenium|webdriver|lighthouse|pingdom|uptimerobot|gtmetrix|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|applebot|amazonbot|claudebot|gptbot|ccbot|perplexity)/i;

/** User-Agent만 보고 봇인지. 빈 UA도 봇으로 친다(사람 브라우저는 반드시 보낸다) */
export function isBotUA(ua: string | null | undefined): boolean {
  if (!ua || ua.trim().length < 10) return true;
  return BOT_UA.test(ua);
}

// ── 적기 ──────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ViewInput = { visitorId: string; path: string; referrerHost?: string | null; entry?: boolean };

/** 들어온 값을 믿지 않고 깎는다. 못 쓸 값이면 null — 라우트는 조용히 204를 돌려준다 */
export function cleanView(v: Partial<ViewInput>): ViewInput | null {
  const visitorId = String(v.visitorId ?? "");
  if (!UUID_RE.test(visitorId)) return null;

  // 경로만 받는다. 쿼리스트링은 떼고(개인정보가 섞일 수 있다) 길이도 자른다
  let path = String(v.path ?? "");
  if (!path.startsWith("/")) return null;
  path = path.split("?")[0].split("#")[0].slice(0, 200);
  // 운영자가 콘솔을 보는 것은 방문이 아니다
  if (path.startsWith("/admin")) return null;

  // 유입은 **도메인만** 남긴다. 경로·쿼리가 붙은 referrer는 그 자체로 개인정보가 될 수 있다
  let referrerHost: string | null = null;
  const raw = (v.referrerHost ?? "").toString().trim().toLowerCase().slice(0, 100);
  if (raw && !/[\s/]/.test(raw)) referrerHost = raw;

  return { visitorId, path, referrerHost, entry: Boolean(v.entry) };
}

/** 한 줄 적는다. 실패해도 화면에는 아무 영향이 없어야 한다 — 부르는 쪽에서 삼킨다 */
export async function recordView(v: ViewInput): Promise<void> {
  await query(
    `INSERT INTO page_view (visitor_id, path, referrer_host, entry) VALUES ($1::uuid, $2, $3, $4)`,
    [v.visitorId, v.path, v.referrerHost ?? null, v.entry ?? false],
  );
}

/** 오래된 기록 청소. 크론을 따로 두지 않고 100번에 한 번 지나가며 치운다 */
export async function sweepOld(): Promise<void> {
  await query(`DELETE FROM page_view WHERE created_at < now() - interval '${RETENTION_MONTHS} months'`);
}

// ── 읽기 ──────────────────────────────────────────────────────────

/** 기간 칩. 라벨과 일수를 한곳에 둔다 */
export const RANGES = [
  { key: "1", label: "1일", days: 1 },
  { key: "7", label: "1주일", days: 7 },
  { key: "30", label: "1개월", days: 30 },
  { key: "90", label: "3개월", days: 90 },
  { key: "365", label: "1년", days: 365 },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

/** 아무것도 안 고른 기본 기간. 첫 화면은 「오늘 어떤가」를 보는 자리다 */
export const DEFAULT_RANGE = RANGES[0];

export function rangeOf(key: string | undefined): (typeof RANGES)[number] {
  return RANGES.find((r) => r.key === key) ?? DEFAULT_RANGE;
}

export type VisitorSummary = {
  online: number;
  todayVisitors: number;
  todayViews: number;
  totalVisitors: number;
  totalViews: number;
  rangeVisitors: number;
  rangeViews: number;
};

export type DayPoint = { day: string; visitors: number; views: number };
export type PathRow = { path: string; visitors: number; views: number };
export type RefRow = { host: string | null; visitors: number; views: number };

export type VisitorReport = VisitorSummary & {
  days: DayPoint[];
  paths: PathRow[];
  refs: RefRow[];
  pathTotal: number;
};

// KST 기준 오늘 0시(타임스탬프). 날짜 경계를 UTC로 잡으면 KST 00~09시가 어제로 샌다
const TODAY_START = `((now() AT TIME ZONE 'Asia/Seoul')::date::timestamp AT TIME ZONE 'Asia/Seoul')`;
/** N일 전 0시(KST). 오늘 포함이라 1일이면 오늘 하루다 */
const rangeStart = (n: string) =>
  `(((now() AT TIME ZONE 'Asia/Seoul')::date - (${n}::int - 1))::timestamp AT TIME ZONE 'Asia/Seoul')`;

/**
 * 방문 화면이 쓰는 값 전부. 여기도 **질의 한 번**이다 —
 * 나눠 던지면 왕복이 늘고 동시에 던지면 커넥션을 새로 여느라 더 걸린다(lib/admin.ts 주석).
 */
export async function visitorReport(days: number, topN = 20): Promise<VisitorReport> {
  const [row] = await query<{
    summary: VisitorSummary;
    days: DayPoint[];
    paths: PathRow[];
    refs: RefRow[];
    path_total: number;
  }>(
    `WITH win AS (
       SELECT * FROM page_view WHERE created_at >= ${rangeStart("$1")}
     ), summary AS (
       SELECT (SELECT count(DISTINCT visitor_id) FROM page_view
                WHERE created_at > now() - interval '${ONLINE_MIN} minutes')::int AS online,
              (SELECT count(DISTINCT visitor_id) FROM page_view WHERE created_at >= ${TODAY_START})::int
                AS "todayVisitors",
              (SELECT count(*) FROM page_view WHERE created_at >= ${TODAY_START})::int AS "todayViews",
              (SELECT count(DISTINCT visitor_id) FROM page_view)::int AS "totalVisitors",
              (SELECT count(*) FROM page_view)::int                   AS "totalViews",
              (SELECT count(DISTINCT visitor_id) FROM win)::int       AS "rangeVisitors",
              (SELECT count(*) FROM win)::int                         AS "rangeViews"
     ), grid AS (
       -- 기록이 없는 날도 0으로 채운다. 안 그러면 막대 그래프에 빈 칸이 생겨 추이가 거짓으로 보인다
       SELECT generate_series((now() AT TIME ZONE 'Asia/Seoul')::date - ($1::int - 1),
                              (now() AT TIME ZONE 'Asia/Seoul')::date,
                              interval '1 day')::date AS day
     ), daily AS (
       SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
              count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS views
       FROM win GROUP BY 1
     ), series AS (
       SELECT g.day::text AS day, coalesce(d.visitors, 0) AS visitors, coalesce(d.views, 0) AS views
       FROM grid g LEFT JOIN daily d USING (day)
     ), paths AS (
       SELECT path, count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS views
       FROM win GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT $2
     ), refs AS (
       -- 유입은 **첫 조회(entry)**만 센다. 안에서 옮겨 다닐 때는 referrer가 안 바뀌어 같은 출처가 부풀려진다
       SELECT referrer_host AS host, count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS views
       FROM win WHERE entry GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT $2
     )
     SELECT (SELECT to_jsonb(s) FROM summary s) AS summary,
            (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.day), '[]'::jsonb) FROM series s) AS days,
            (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.visitors DESC, p.views DESC), '[]'::jsonb)
               FROM paths p) AS paths,
            (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.visitors DESC, r.views DESC), '[]'::jsonb)
               FROM refs r) AS refs,
            (SELECT count(DISTINCT path)::int FROM win) AS path_total`,
    [String(days), topN],
  );
  return { ...row.summary, days: row.days, paths: row.paths, refs: row.refs, pathTotal: row.path_total };
}

/** 대시보드 위쪽에 얹는 작은 요약. 대시보드 질의에 끼워 넣기 좋게 SQL 조각으로 낸다 */
export const VISIT_SUMMARY_SQL = `
  SELECT (SELECT count(DISTINCT visitor_id) FROM page_view
           WHERE created_at > now() - interval '${ONLINE_MIN} minutes')::int AS online,
         (SELECT count(DISTINCT visitor_id) FROM page_view WHERE created_at >= ${TODAY_START})::int
           AS "todayVisitors",
         (SELECT count(*) FROM page_view WHERE created_at >= ${TODAY_START})::int AS "todayViews",
         (SELECT count(DISTINCT visitor_id) FROM page_view)::int AS "totalVisitors",
         (SELECT count(*) FROM page_view)::int AS "totalViews"`;

export type VisitCards = Pick<
  VisitorSummary,
  "online" | "todayVisitors" | "todayViews" | "totalVisitors" | "totalViews"
>;

/** 경로를 사람 말로. 「/notice/sh-2026-…」보다 「공고」가 먼저 읽힌다 */
export function pathKind(path: string): string {
  if (path === "/") return "홈";
  if (path.startsWith("/notice/")) return path.split("/").length > 3 ? "단지" : "공고";
  if (path.startsWith("/area/")) return "지역";
  if (path.startsWith("/eligibility")) return "자격진단";
  if (path.startsWith("/terms") || path.startsWith("/privacy")) return "약관";
  return "기타";
}
