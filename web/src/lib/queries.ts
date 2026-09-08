// notice 조회. 컬럼명은 db/schema.sql 그대로. 타입은 types/notice.ts.
// 발행 상태(publish) 필터는 S8이 생기기 전까지 걸지 않는다 — 지금은 전부 'parsed'.
// 목록·옵션은 unstable_cache로 REVALIDATE_SEC 캐시한다. 파이프라인이 DB를 갱신해도 그 안엔 반영된다(page.tsx revalidate와 동일).
import { unstable_cache } from "next/cache";
import { query } from "./db";
import { CACHE_TAG_NOTICE, PAGE_SIZE, REVALIDATE_SEC } from "./constants";
import { todayKST } from "./format";
import type { FilterOption, Notice, NoticeArea, NoticeFilters, NoticeListItem, NoticePage, NoticeSort, Sector } from "@/types/notice";

const CACHE_OPTS = { revalidate: REVALIDATE_SEC, tags: [CACHE_TAG_NOTICE] };

const LIST_COLS = `
  id, slug, title, agency, housing_type::text AS housing_type, sector::text AS sector, house_type, sido, sigungu, complex_name,
  supply_count, min_deposit, min_rent, posted_at, apply_start_at, apply_end_at, announce_at,
  status::text AS status, source_status, amends_source_key, source_url`;

function buildWhere(f: NoticeFilters, params: unknown[]): string[] {
  const where: string[] = [];
  if (f.sector) {
    params.push(f.sector);
    where.push(`sector = $${params.length}::rental_sector`);
  }
  if (f.sido) {
    params.push(f.sido);
    where.push(`sido = $${params.length}`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`housing_type::text = $${params.length}`);
  }
  return where;
}

function whereSql(where: string[]): string {
  return where.length ? "WHERE " + where.join(" AND ") : "";
}

// 마감 임박순 정렬키. 아직 안 지난 마감일 오름차순 → 마감 지난 것 → 마감일 없는 것.
const DEADLINE_RANK = `CASE WHEN apply_end_at IS NULL THEN 2 WHEN apply_end_at >= CURRENT_DATE THEN 0 ELSE 1 END`;
const DEADLINE_KEY = `CASE WHEN apply_end_at >= CURRENT_DATE THEN apply_end_at END`;

// 커서: posted → "posted_at|id". deadline → "rank|apply_end_at|posted_at|id". 정렬키 전체를 담아야 같은 값이 겹쳐도 빠지지 않는다.
function encodeCursor(n: NoticeListItem, sort: NoticeSort): string {
  if (sort === "posted") return `${n.posted_at}|${n.id}`;
  const today = todayKST();
  const rank = n.apply_end_at === null ? 2 : n.apply_end_at >= today ? 0 : 1;
  return `${rank}|${n.apply_end_at ?? ""}|${n.posted_at}|${n.id}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function listNoticesPageRaw(f: NoticeFilters, cursor: string | null, limit: number): Promise<NoticePage> {
  const sort: NoticeSort = f.sort === "deadline" ? "deadline" : "posted";
  const params: unknown[] = [];
  const where = buildWhere(f, params);
  const countParams = [...params];
  const countWhere = whereSql(where);

  let order: string;
  if (sort === "posted") {
    order = `posted_at DESC, id DESC`;
    if (cursor) {
      const [posted, id] = cursor.split("|");
      if (DATE_RE.test(posted) && /^\d+$/.test(id)) {
        params.push(posted, Number(id));
        where.push(`(posted_at, id) < ($${params.length - 1}::date, $${params.length}::bigint)`);
      }
    }
  } else {
    order = `${DEADLINE_RANK}, ${DEADLINE_KEY} ASC, apply_end_at DESC NULLS LAST, posted_at DESC, id DESC`;
    if (cursor) {
      const [rank, end, posted, id] = cursor.split("|");
      if (/^[012]$/.test(rank) && DATE_RE.test(posted) && /^\d+$/.test(id)) {
        // 같은 rank 안에서 다음 행. NULL이 섞인 키라 튜플 비교 대신 풀어 쓴다.
        const r = Number(rank);
        params.push(r);
        const pr = params.length;
        params.push(posted, Number(id));
        const tail = `(posted_at, id) < ($${params.length - 1}::date, $${params.length}::bigint)`;
        if ((r === 0 || r === 1) && DATE_RE.test(end)) {
          params.push(end);
          const pe = params.length;
          // rank 0은 마감일 오름차순(다음 = 더 늦은 마감), rank 1은 내림차순(다음 = 더 이른 마감)
          const cmp = r === 0 ? ">" : "<";
          where.push(
            `(${DEADLINE_RANK} > $${pr} OR (${DEADLINE_RANK} = $${pr} AND (apply_end_at ${cmp} $${pe}::date OR (apply_end_at = $${pe}::date AND ${tail}))))`,
          );
        } else {
          where.push(`(${DEADLINE_RANK} > $${pr} OR (${DEADLINE_RANK} = $${pr} AND ${tail}))`);
        }
      }
    }
  }

  params.push(limit + 1);
  const [rows, cnt] = await Promise.all([
    query<NoticeListItem>(`SELECT ${LIST_COLS} FROM notice ${whereSql(where)} ORDER BY ${order} LIMIT $${params.length}`, params),
    query<{ c: number }>(`SELECT count(*)::int AS c FROM notice ${countWhere}`, countParams),
  ]);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1], sort) : null, total: cnt[0]?.c ?? 0 };
}

/** 목록 1페이지. cursor는 이전 페이지의 nextCursor. */
export const listNoticesPage = unstable_cache(
  (f: NoticeFilters, cursor: string | null = null, limit: number = PAGE_SIZE) => listNoticesPageRaw(f, cursor, limit),
  ["notice-page"],
  CACHE_OPTS,
);

/** 탭·셀렉트 옵션. sector가 정해지면 그 안에서의 시도·유형 분포. 왕복 1회로 합친다. */
export const listFilterOptions = unstable_cache(
  async (sector?: Sector): Promise<{ sector: FilterOption[]; sido: FilterOption[]; type: FilterOption[] }> => {
    const params: unknown[] = [];
    const where = whereSql(buildWhere({ sector }, params));
    const rows = await query<{ kind: string; value: string; count: number }>(
      `SELECT 'sector' AS kind, sector::text AS value, count(*)::int AS count FROM notice GROUP BY 2
       UNION ALL
       SELECT 'sido', sido, count(*)::int FROM notice ${where} GROUP BY 2
       UNION ALL
       SELECT 'type', housing_type::text, count(*)::int FROM notice ${where} GROUP BY 2
       ORDER BY 1, 3 DESC, 2`,
      params,
    );
    const pick = (k: string) => rows.filter((r) => r.kind === k).map(({ value, count }) => ({ value, count }));
    return { sector: pick("sector").sort((a, b) => a.value.localeCompare(b.value, "ko")), sido: pick("sido"), type: pick("type") };
  },
  ["notice-filter-options"],
  CACHE_OPTS,
);

export async function getNoticeBySlug(slug: string): Promise<Notice | null> {
  const rows = await query<Notice>(
    `SELECT ${LIST_COLS}, source_key, address, pnu, heating, total_household,
            min_down_payment, min_interim, min_balance, portal_url, contact,
            to_char(updated_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS updated_at
     FROM notice WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function getNoticeAreas(noticeId: number): Promise<NoticeArea[]> {
  return query<NoticeArea>(
    `SELECT sido, sigungu, supply_count FROM notice_area WHERE notice_id = $1
     ORDER BY sigungu IS NULL, supply_count DESC NULLS LAST, sigungu`,
    [noticeId],
  );
}

// 정정 관계: 이 공고가 대체하는 원공고 / 이 공고를 대체한 정정공고들.
export async function getAmendChain(n: Pick<Notice, "source_key" | "amends_source_key">) {
  const [original, amendments] = await Promise.all([
    n.amends_source_key
      ? query<NoticeListItem>(`SELECT ${LIST_COLS} FROM notice WHERE source_key = $1`, [n.amends_source_key])
      : Promise.resolve([] as NoticeListItem[]),
    n.source_key
      ? query<NoticeListItem>(`SELECT ${LIST_COLS} FROM notice WHERE amends_source_key = $1 ORDER BY posted_at DESC, id DESC`, [
          n.source_key,
        ])
      : Promise.resolve([] as NoticeListItem[]),
  ]);
  return { original: original[0] ?? null, amendments };
}

export type SitemapNotice = { slug: string; updated_at: string; closed: boolean };

/** 사이트맵용 전 공고. 마감 여부로 priority를 가른다. */
export const listSitemapNotices = unstable_cache(
  async (limit: number): Promise<SitemapNotice[]> =>
    query<SitemapNotice>(
      `SELECT slug, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
              (status = '접수마감' OR (apply_end_at IS NOT NULL AND apply_end_at < CURRENT_DATE)) AS closed
       FROM notice ORDER BY posted_at DESC, id DESC LIMIT $1`,
      [limit],
    ),
  ["notice-sitemap"],
  CACHE_OPTS,
);
