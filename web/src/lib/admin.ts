// 관리자 콘솔이 읽는 값들. **읽기 전용이다** — web은 DB를 쓰지 않는다(CLAUDE.md 디렉터리 경계).
// 고칠 일이 생기면 pipeline 쪽 스테이지를 돌린다. 화면에서 하는 유일한 바깥 행동은
// 워크플로 dispatch(`lib/jobs.ts`)뿐이고, 그것도 GitHub를 부르는 것이지 DB를 건드리는 게 아니다.
//
// 캐시를 걸지 않는다. 다른 화면은 ISR로 한 시간 묵은 값을 보여도 되지만, 여기는
// 「지금 파이프라인이 살아 있나」를 보는 자리라 묵은 숫자가 거짓말이 된다.
import { query } from "@/lib/db";
import { CANONICAL_ONLY, NOT_CLOSED, TODAY } from "@/lib/queries";

// ── 파이프라인 신호등 ───────────────────────────────────────────────
//
// 우리가 아는 잡의 목록은 .github/workflows/의 두 파일에서 온다. ingest_log에 (stage, source)로 남는다.
// everyMin이 null인 잡은 **조건이 맞을 때만 도는 것**이라 오래 안 돌았다고 문제가 아니다 —
// 예: S3 첨부 파싱은 아직 안 읽은 첨부가 있을 때만, S6 좌표 조인은 새 단지가 들어왔을 때만.
export type JobSpec = {
  stage: string;
  source: string;
  label: string;
  /** 정상이라면 이 주기로 돈다(분). null이면 조건부 실행이라 지연 판정을 하지 않는다 */
  everyMin: number | null;
  /** 이 기록을 남기는 워크플로. 「지금 돌리기」 버튼이 붙는 자리 */
  job?: "collect" | "patrol";
};

export const PIPELINE: JobSpec[] = [
  { stage: "S1", source: "sh_scrape", label: "서울주거포털 목록", everyMin: 60, job: "collect" },
  { stage: "S1", source: "youth_scrape", label: "청년안심주택 게시판", everyMin: 60, job: "collect" },
  { stage: "S1", source: "ish_board", label: "i-sh 게시판(m_241)", everyMin: 24 * 60, job: "patrol" },
  { stage: "S1", source: "ish_247", label: "i-sh 게시판(m_247)", everyMin: 24 * 60, job: "patrol" },
  { stage: "S1", source: "myhome_api", label: "마이홈 API", everyMin: 24 * 60, job: "patrol" },
  { stage: "S3", source: "ish_result", label: "결과 글 파싱", everyMin: 24 * 60, job: "patrol" },
  { stage: "S3", source: "sh_attach", label: "SH 첨부 공고문", everyMin: null },
  { stage: "S3", source: "youth_attach", label: "민간임대 첨부", everyMin: null },
  { stage: "S2", source: "dedupe", label: "정본 묶기", everyMin: null },
  { stage: "S6", source: "juso_summary", label: "주소-좌표 조인", everyMin: null },
  { stage: "S0", source: "eligibility_xlsx", label: "자격 규칙 적재", everyMin: null },
];

/** 주기의 몇 배까지 봐주나. 워크플로가 한 회차 밀리는 건 흔하다(스케줄 이벤트는 SLA가 없다) */
export const LATE_FACTOR = 2;

export type JobHealth = JobSpec & {
  lastAt: Date | null;
  ok: boolean | null;
  itemCount: number | null;
  ageMin: number | null;
  runs7d: number;
  fails7d: number;
  /** 주기가 정해진 잡이 LATE_FACTOR배를 넘겨 소식이 없다 */
  late: boolean;
  /** 우리 목록에 없는 (stage, source). 파이프라인에 새 스테이지가 생기면 여기로 떨어진다 */
  unknown?: boolean;
};

type HealthRow = {
  stage: string;
  source: string;
  ok: boolean;
  item_count: number;
  started_at: Date;
  age_min: number;
  runs7d: number;
  fails7d: number;
};

export async function pipelineHealth(): Promise<JobHealth[]> {
  const rows = await query<HealthRow>(`
    WITH last AS (
      SELECT DISTINCT ON (stage, source) stage, source, ok, item_count, started_at
      FROM ingest_log ORDER BY stage, source, started_at DESC
    ), agg AS (
      SELECT stage, source, count(*) AS runs, count(*) FILTER (WHERE NOT ok) AS fails
      FROM ingest_log WHERE finished_at > now() - interval '7 days' GROUP BY 1, 2
    )
    SELECT l.stage, l.source, l.ok, l.item_count, l.started_at,
           EXTRACT(EPOCH FROM (now() - l.started_at)) / 60 AS age_min,
           coalesce(a.runs, 0)  AS "runs7d",
           coalesce(a.fails, 0) AS "fails7d"
    FROM last l LEFT JOIN agg a USING (stage, source)`);

  const byKey = new Map(rows.map((r) => [`${r.stage}|${r.source}`, r]));
  const health: JobHealth[] = PIPELINE.map((spec) => {
    const r = byKey.get(`${spec.stage}|${spec.source}`);
    byKey.delete(`${spec.stage}|${spec.source}`);
    const ageMin = r ? Math.floor(r.age_min) : null;
    return {
      ...spec,
      lastAt: r?.started_at ?? null,
      ok: r?.ok ?? null,
      itemCount: r?.item_count ?? null,
      ageMin,
      runs7d: r?.runs7d ?? 0,
      fails7d: r?.fails7d ?? 0,
      late: spec.everyMin !== null && ageMin !== null && ageMin > spec.everyMin * LATE_FACTOR,
    };
  });

  // 목록에 없던 (stage, source)도 버리지 않고 뒤에 붙인다 — 파이프라인이 늘었는데
  // 여기 상수를 안 고쳐서 새 스테이지가 조용히 안 보이는 일을 막는다
  for (const r of byKey.values()) {
    health.push({
      stage: r.stage,
      source: r.source,
      label: `${r.stage} ${r.source}`,
      everyMin: null,
      lastAt: r.started_at,
      ok: r.ok,
      itemCount: r.item_count,
      ageMin: Math.floor(r.age_min),
      runs7d: r.runs7d,
      fails7d: r.fails7d,
      late: false,
      unknown: true,
    });
  }
  return health;
}

// ── 공고 숫자 ──────────────────────────────────────────────────────

export type NoticeStats = {
  total: number;
  canonical: number;
  open: number;
  closing7d: number;
  new24h: number;
  updated24h: number;
  indexnowPending: number;
};

export async function noticeStats(): Promise<NoticeStats> {
  const [r] = await query<NoticeStats>(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ${CANONICAL_ONLY})::int AS canonical,
           count(*) FILTER (WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED})::int AS open,
           count(*) FILTER (WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED}
                              AND apply_end_at >= ${TODAY} AND apply_end_at < ${TODAY} + 7)::int AS "closing7d",
           count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS "new24h",
           count(*) FILTER (WHERE updated_at > now() - interval '24 hours')::int AS "updated24h",
           -- 아직 한 번도 IndexNow에 안 알린 열린 공고. 발행기가 고르는 조건(마감 14일·공고일 60일)과
           -- 똑같지는 않다 — 여기서는 「알릴 게 남았나」를 크게 보는 용도다
           count(*) FILTER (WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED} AND indexnow_at IS NULL)::int AS "indexnowPending"
    FROM notice`);
  return r;
}

// ── 사람이 봐야 할 줄 ───────────────────────────────────────────────

export type QueueStats = {
  reviewOpen: number;
  reviewReasons: { reason: string; count: number }[];
  resultUnparsed: number;
  resultUnlinked: number;
  complexNoGeo: number;
  openNoSchedule: number;
};

export async function queueStats(): Promise<QueueStats> {
  const [reasons, [rest]] = await Promise.all([
    query<{ reason: string; count: number }>(
      `SELECT reason, count(*)::int AS count FROM review_queue WHERE NOT resolved GROUP BY 1 ORDER BY 2 DESC`,
    ),
    query<Omit<QueueStats, "reviewReasons" | "reviewOpen">>(`
      SELECT (SELECT count(*) FROM result_post WHERE parsed_at IS NULL)::int   AS "resultUnparsed",
             (SELECT count(*) FROM result_post WHERE notice_id IS NULL)::int   AS "resultUnlinked",
             -- 열린 공고에 걸린 단지 중 좌표를 못 붙인 것. 지도에 못 찍히는 지면이다.
             -- 마감 판정 식(CLOSED)은 컬럼 이름을 그대로 쓰므로 notice만 있는 안쪽 질의에 가둔다 —
             -- 밖에서 조인해 별칭을 붙이면 같은 식을 손으로 고쳐 쓰게 되고, 그때부터 목록과 어긋난다
             (SELECT count(*) FROM notice_complex
               WHERE geom IS NULL
                 AND notice_id IN (SELECT id FROM notice WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED}))::int
               AS "complexNoGeo",
             -- 접수 마감일이 아예 없는 열린 공고. D-day를 못 그리고 마감 판정도 발표일에만 기댄다
             (SELECT count(*) FROM notice
               WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED} AND apply_end_at IS NULL)::int AS "openNoSchedule"`),
  ]);
  return {
    reviewOpen: reasons.reduce((a, r) => a + r.count, 0),
    reviewReasons: reasons,
    ...rest,
  };
}

// ── 출처별 현황 ────────────────────────────────────────────────────

export type SourceRow = {
  source: string;
  agency: string;
  total: number;
  open: number;
  noEnd: number;
  complexes: number;
  noGeo: number;
  lastPosted: string | null;
};

export async function sourceBreakdown(): Promise<SourceRow[]> {
  // notice에 별칭을 안 붙인다 — CLOSED·CANONICAL_ONLY가 컬럼 이름을 그대로 쓰는 식이라
  // 별칭을 붙이는 순간 그 식을 손으로 고쳐 써야 하고, 그러면 목록 화면과 기준이 갈린다
  const rows = await query<SourceRow>(`
    SELECT source, agency,
           count(*)::int AS total,
           count(*) FILTER (WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED})::int AS open,
           count(*) FILTER (WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED} AND apply_end_at IS NULL)::int AS "noEnd",
           coalesce(sum(g.c), 0)::int      AS complexes,
           coalesce(sum(g.nogeom), 0)::int AS "noGeo",
           max(posted_at)::text AS "lastPosted"
    FROM notice
    LEFT JOIN LATERAL (
      SELECT count(*) AS c, count(*) FILTER (WHERE geom IS NULL) AS nogeom
      FROM notice_complex WHERE notice_id = notice.id
    ) g ON true
    GROUP BY 1, 2 ORDER BY open DESC, total DESC`);
  return rows;
}

// ── 수집 이력 ──────────────────────────────────────────────────────

export type IngestRow = {
  id: number;
  stage: string;
  source: string;
  ok: boolean;
  item_count: number;
  message: string | null;
  started_at: Date;
  finished_at: Date;
};

export type IngestFilter = {
  stage?: string;
  source?: string;
  /** true면 실패만 */
  failsOnly?: boolean;
  /** 이 id보다 작은 것부터(= 더 옛것). 「더 보기」 커서 */
  before?: number;
  limit?: number;
};

export async function listIngest(f: IngestFilter = {}): Promise<IngestRow[]> {
  return query<IngestRow>(
    `SELECT id, stage, source, ok, item_count, message, started_at, finished_at
     FROM ingest_log
     WHERE ($1::text   IS NULL OR stage  = $1)
       AND ($2::text   IS NULL OR source = $2)
       AND ($3::bool   IS NULL OR ok     = false)
       AND ($4::bigint IS NULL OR id     < $4)
     ORDER BY id DESC LIMIT $5`,
    [f.stage ?? null, f.source ?? null, f.failsOnly ? true : null, f.before ?? null, f.limit ?? 50],
  );
}

/** 최근 30일 실패 회차 수. 탭 뱃지 하나를 위한 값이라 따로 뽑는다 */
export async function recentFailCount(): Promise<number> {
  const [r] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ingest_log WHERE NOT ok AND finished_at > now() - interval '30 days'`,
  );
  return r.n;
}

/** 필터 칩에 쓸 값 목록. 코드 상수가 아니라 **DB에 실제로 있는 값**을 보여준다 */
export async function ingestFacets(): Promise<{ stages: string[]; sources: string[]; fails30d: number }> {
  const [stages, sources, [f]] = await Promise.all([
    query<{ v: string }>(`SELECT DISTINCT stage AS v FROM ingest_log ORDER BY 1`),
    query<{ v: string }>(`SELECT DISTINCT source AS v FROM ingest_log ORDER BY 1`),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ingest_log WHERE NOT ok AND finished_at > now() - interval '30 days'`,
    ),
  ]);
  return { stages: stages.map((r) => r.v), sources: sources.map((r) => r.v), fails30d: f.n };
}

// ── ingest_log.message 읽기 ────────────────────────────────────────
//
// 스테이지들이 실행 요약을 JSON 문자열로 적는다(실측: {"calls":…,"rows":…,"inserted":…,
// "updated":…,"skipped":{…},"errors":[…]}). 규격이 아니라 관행이라 **파싱에 실패해도
// 화면이 죽으면 안 된다** — 못 읽으면 원문을 그대로 보여준다.
export type IngestSummary = {
  counts: { label: string; value: number }[];
  skipped: { label: string; value: number }[];
  errors: string[];
  raw: string | null;
};

const COUNT_LABELS: Record<string, string> = {
  calls: "요청",
  rows: "읽은 줄",
  groups: "묶음",
  inserted: "넣음",
  updated: "고침",
  deleted: "지움",
  matched: "맞춤",
  submitted: "제출",
};

export function parseIngestMessage(message: string | null): IngestSummary {
  if (!message) return { counts: [], skipped: [], errors: [], raw: null };
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(message);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("객체가 아니다");
    data = parsed as Record<string, unknown>;
  } catch {
    return { counts: [], skipped: [], errors: [], raw: message };
  }

  const counts: { label: string; value: number }[] = [];
  for (const [key, label] of Object.entries(COUNT_LABELS)) {
    const v = data[key];
    if (typeof v === "number") counts.push({ label, value: v });
  }
  // 목록에 없는 숫자 키도 흘리지 않는다 — 스테이지가 새 지표를 적기 시작해도 보인다
  for (const [key, v] of Object.entries(data)) {
    if (typeof v === "number" && !(key in COUNT_LABELS)) counts.push({ label: key, value: v });
  }

  const skipped: { label: string; value: number }[] = [];
  const skipObj = data.skipped;
  if (skipObj && typeof skipObj === "object" && !Array.isArray(skipObj)) {
    for (const [k, v] of Object.entries(skipObj as Record<string, unknown>)) {
      if (typeof v === "number" && v > 0) skipped.push({ label: k, value: v });
    }
    skipped.sort((a, b) => b.value - a.value);
  }

  const errors = Array.isArray(data.errors) ? data.errors.map((e) => String(e)) : [];
  return { counts, skipped, errors, raw: null };
}

// ── 화면 표기 ──────────────────────────────────────────────────────

/** 「3분 전」 「2시간 전」 「4일 전」. 서버에서 만든다 — 클라이언트 시계와 어긋나도 서버 기준이 맞다 */
export function ago(min: number | null): string {
  if (min === null) return "기록 없음";
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 로그 표의 시각. 한국 시간으로 고정한다 — 운영자도 서버도 여기 기준으로 말한다 */
export function stampKST(d: Date | string): string {
  return new Date(d).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 걸린 시간. 1분 아래는 초로 */
export function elapsed(a: Date | string, b: Date | string): string {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 0) return "—";
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}초` : `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`;
}
