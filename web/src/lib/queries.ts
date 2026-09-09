// notice 조회. 컬럼명은 db/schema.sql 그대로. 타입은 types/notice.ts.
// 발행 상태(publish) 필터는 S8이 생기기 전까지 걸지 않는다 — 지금은 전부 'parsed'.
// 목록·옵션은 unstable_cache로 REVALIDATE_SEC 캐시한다. 파이프라인이 DB를 갱신해도 그 안엔 반영된다(page.tsx revalidate와 동일).
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { query } from "./db";
import { CACHE_TAG_NOTICE, PAGE_SIZE, REVALIDATE_SEC } from "./constants";
import { todayKST } from "./format";
import type { FilterOption, HomeStats, Notice, NoticeArea, NoticeComplex, NoticeFilters, NoticeListItem, NoticePage, NoticeSort, NoticeSupply, Sector } from "@/types/notice";

const CACHE_OPTS = { revalidate: REVALIDATE_SEC, tags: [CACHE_TAG_NOTICE] };

const LIST_COLS = `
  id, slug, title, agency, housing_type::text AS housing_type, sector::text AS sector, house_type, sido, sigungu, complex_name,
  supply_count, min_deposit, min_rent, posted_at, apply_start_at, apply_end_at, announce_at,
  status::text AS status, source_status, amends_source_key, source_url, address, source_rank`;

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
  if (f.closing === "7d") where.push(CLOSING_7D);
  if (!f.closed) where.push(NOT_CLOSED);
  return where;
}

// 마감 7일 내: 오늘 포함 7일 안에 접수 마감. KPI·칩 카운트·목록 필터가 같은 식을 쓴다
const CLOSING_7D = `apply_end_at >= CURRENT_DATE AND apply_end_at < CURRENT_DATE + 7`;

// 마감: 상태가 접수마감이거나 마감일이 지났다. 기본 목록에서 감추고 「마감 포함」 칩으로만 꺼낸다.
// URL은 남는다(CLAUDE.md 하지 말 것 6) — 목록에서 감출 뿐 상세는 그대로 열린다.
const NOT_CLOSED = `NOT (status = '접수마감' OR (apply_end_at IS NOT NULL AND apply_end_at < CURRENT_DATE))`;

function whereSql(where: string[]): string {
  return where.length ? "WHERE " + where.join(" AND ") : "";
}

// 마감 임박순 정렬키. 아직 안 지난 마감일 오름차순 → 마감 지난 것 → 마감일 없는 것.
const DEADLINE_RANK = `CASE WHEN apply_end_at IS NULL THEN 2 WHEN apply_end_at >= CURRENT_DATE THEN 0 ELSE 1 END`;
const DEADLINE_KEY = `CASE WHEN apply_end_at >= CURRENT_DATE THEN apply_end_at END`;

// 커서: posted → "posted_at|id". deadline → "rank|apply_end_at|posted_at|id". 정렬키 전체를 담아야 같은 값이 겹쳐도 빠지지 않는다.
// 커서는 정렬 키를 그대로 담는다. source_rank는 NULL일 수 있어 빈 칸으로 싣고 아래에서 최댓값으로 되돌린다.
function encodeCursor(n: NoticeListItem, sort: NoticeSort): string {
  if (sort === "posted") return `${n.posted_at}|${n.source_rank ?? ""}|${n.id}`;
  const today = todayKST();
  const rank = n.apply_end_at === null ? 2 : n.apply_end_at >= today ? 0 : 1;
  return `${rank}|${n.apply_end_at ?? ""}|${n.posted_at}|${n.source_rank ?? ""}|${n.id}`;
}

/** NULLS LAST 정렬을 튜플 비교로 쓰려고 NULL을 맨 뒤 값으로 바꾼다. */
const RANK_LAST = 2_147_483_647;
function rankOrLast(v: string): number | null {
  if (v === "") return RANK_LAST;
  return /^\d+$/.test(v) ? Number(v) : null;
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
    // 같은 공고일 안에서는 기관 원본 목록 순서(source_rank)를 지킨다 — 사용자 요청 2026-09-08
    order = `posted_at DESC, source_rank ASC NULLS LAST, id DESC`;
    if (cursor) {
      const [posted, rank, id] = cursor.split("|");
      const r = rankOrLast(rank ?? "");
      if (DATE_RE.test(posted) && r !== null && /^\d+$/.test(id)) {
        // (posted DESC, rank ASC, id DESC)의 다음 행. rank만 오름차순이라 부호를 뒤집어 튜플로 비교한다
        params.push(posted, r, Number(id));
        const [pp, pr, pi] = [params.length - 2, params.length - 1, params.length];
        where.push(
          `(posted_at, -COALESCE(source_rank, ${RANK_LAST}), id) < ($${pp}::date, -$${pr}::int, $${pi}::bigint)`,
        );
      }
    }
  } else {
    order = `${DEADLINE_RANK}, ${DEADLINE_KEY} ASC, apply_end_at DESC NULLS LAST, posted_at DESC, source_rank ASC NULLS LAST, id DESC`;
    if (cursor) {
      const [rank, end, posted, srank, id] = cursor.split("|");
      const sr = rankOrLast(srank ?? "");
      if (/^[012]$/.test(rank) && DATE_RE.test(posted) && sr !== null && /^\d+$/.test(id)) {
        // 같은 rank 안에서 다음 행. NULL이 섞인 키라 튜플 비교 대신 풀어 쓴다.
        const r = Number(rank);
        params.push(r);
        const pr = params.length;
        params.push(posted, sr, Number(id));
        const tail = `(posted_at, -COALESCE(source_rank, ${RANK_LAST}), id) < ($${params.length - 2}::date, -$${params.length - 1}::int, $${params.length}::bigint)`;
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
  ["notice-page-v4"],
  CACHE_OPTS,
);

/** 탭·셀렉트 옵션. sector가 정해지면 그 안에서의 시도·유형 분포. 왕복 1회로 합친다.
 * 같은 요청 안(layout + page)에서 같은 sector로 두 번 불려도 react cache()가 한 번만 쏜다. */
export const listFilterOptions = cache(unstable_cache(
  async (sector?: Sector): Promise<{ sector: FilterOption[]; sido: FilterOption[]; type: FilterOption[] }> => {
    const params: unknown[] = [];
    const where = whereSql(buildWhere({ sector }, params));
    const rows = await query<{ kind: string; value: string; count: number }>(
      `SELECT 'sector' AS kind, sector::text AS value, count(*)::int AS count FROM notice WHERE ${NOT_CLOSED} GROUP BY 2
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
  ["notice-filter-options-v3"],
  CACHE_OPTS,
));

/** 필터 칩 「마감 7일 내」의 건수. **마감은 뺀다** — 목록이 기본으로 마감을 감추는데
 * 칩만 다른 수를 말하면 어긋난다(2026-09-09). 히어로·KPI를 걷어내며 나머지 집계는 뺐다. */
export const getHomeStats = unstable_cache(
  async (): Promise<HomeStats> => {
    const rows = await query<{ closing7: number }>(
      `SELECT count(*) FILTER (WHERE ${CLOSING_7D})::int AS closing7 FROM notice WHERE ${NOT_CLOSED}`,
    );
    return { closing7: rows[0]?.closing7 ?? 0 };
  },
  ["notice-home-stats-v3"],
  CACHE_OPTS,
);

export async function getNoticeBySlug(slug: string): Promise<Notice | null> {
  const rows = await query<Notice>(
    `SELECT ${LIST_COLS}, source_key, pnu, heating, total_household,
            min_down_payment, min_interim, min_balance, portal_url, contact,
            max_deposit, max_rent, schedule_source,
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

/** 공고의 공급 단지 목록. 자치구 → 단지명 순. 0건이면 화면에 섹션을 그리지 않는다. */
export async function getNoticeComplexes(noticeId: number): Promise<NoticeComplex[]> {
  return query<NoticeComplex>(
    `SELECT id, name, sido, sigungu, road_address, is_new, complex_code, source_page, heating, unit_count, min_deposit, min_rent, area_min, area_max FROM notice_complex
     WHERE notice_id = $1 ORDER BY sido <> '서울특별시', sigungu, name`,
    [noticeId],
  );
}

const SUPPLY_COLS = `
  id, complex_name, supply_type, accessible, tenant_class, income_option, is_new,
  units_total, units_priority, units_general, units_reserve,
  deposit, down_payment, balance, rent,
  area_exclusive, area_common, area_etc, area_total, move_in_from, source_page`;

// 공급현황 정렬: 신규 먼저, 그다음 공급유형(면적) 오름차순, 계층은 표에 나온 순서를 흉내낸다
const SUPPLY_ORDER = `
  is_new DESC,
  NULLIF(regexp_replace(supply_type, '[^0-9]', '', 'g'), '')::int NULLS LAST,
  supply_type, tenant_class, income_option NULLS FIRST, id`;

/** 단지 1곳의 공급현황 줄. 이름으로도 찾는다 — 단지 표기가 조금 달라 complex_id가 안 붙은 줄이 있다. */
export async function getComplexSupply(noticeId: number, complexId: number, complexName: string): Promise<NoticeSupply[]> {
  return query<NoticeSupply>(
    `SELECT ${SUPPLY_COLS} FROM notice_supply
     WHERE notice_id = $1 AND (complex_id = $2 OR complex_name = $3)
     ORDER BY ${SUPPLY_ORDER}`,
    [noticeId, complexId, complexName],
  );
}

/** 공고 전체 공급현황 줄. 0건이면 화면에 표를 그리지 않는다. */
export async function getNoticeSupply(noticeId: number): Promise<NoticeSupply[]> {
  return query<NoticeSupply>(
    `SELECT ${SUPPLY_COLS} FROM notice_supply WHERE notice_id = $1 ORDER BY complex_name, ${SUPPLY_ORDER}`,
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
      ? query<NoticeListItem>(`SELECT ${LIST_COLS} FROM notice WHERE amends_source_key = $1 ORDER BY posted_at DESC, source_rank ASC NULLS LAST, id DESC`, [
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
