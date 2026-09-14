// notice 조회. 컬럼명은 db/schema.sql 그대로. 타입은 types/notice.ts.
// 발행 상태(publish) 필터는 S8이 생기기 전까지 걸지 않는다 — 지금은 전부 'parsed'.
// 목록·옵션은 unstable_cache로 REVALIDATE_SEC 캐시한다. 파이프라인이 DB를 갱신해도 그 안엔 반영된다(page.tsx revalidate와 동일).
import { unstable_cache } from "next/cache";
import type { EligibilityRules, IncomeStandard, RegionTier, SupplyType, NoticeEligibility } from "@/types/eligibility";
import { cache } from "react";
import { query } from "./db";
import { CACHE_TAG_ELIGIBILITY, CACHE_TAG_NOTICE, PAGE_SIZE, REVALIDATE_SEC } from "./constants";
import { todayKST } from "./format";
import type { ComplexImage, Facets, FilterOption, Notice, NoticeArea, NoticeComplex, NoticeFilters, NoticeListItem, NoticePage, NoticeSort, NoticeSupply, NoticeUnit, Sector } from "@/types/notice";

const CACHE_OPTS = { revalidate: REVALIDATE_SEC, tags: [CACHE_TAG_NOTICE] };

const LIST_COLS = `
  id, slug, title, agency, housing_type::text AS housing_type, sector::text AS sector, house_type, sido, sigungu, complex_name,
  supply_count, min_deposit, min_rent, posted_at, apply_start_at, apply_end_at, announce_at,
  status::text AS status, source_status, amends_source_key, source_url, address, source_rank`;

function buildWhere(f: NoticeFilters, params: unknown[]): string[] {
  const where: string[] = [CANONICAL_ONLY];
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

// 정본만. 같은 공고가 기관 seq 여러 개로 들어와도 목록엔 한 번만 나온다(S2가 canonical_id를 채운다).
// 딸림 글의 URL은 살아 있고 상세도 열린다 — 목록에서만 뺀다(CLAUDE.md 하지 말 것 6).
const CANONICAL_ONLY = `canonical_id IS NULL`;

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
      `SELECT 'sector' AS kind, sector::text AS value, count(*)::int AS count FROM notice WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED} GROUP BY 2
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

// 패싯(facet) 집계 — 칩·셀렉트에 붙는 수량. 지금 걸린 다른 필터를 반영한다(사용자 지적 2026-09-09:
// "지역이 바뀌면 그 지역의 수량이 나와야 한다"). 자기 자신은 빼고 센다 — 검색 패싯의 표준 규칙이다.
// 서울을 고른 상태에서 유형 셀렉트는 "서울 안에서 각 유형이 몇 건"을 보여 주고,
// 시도 셀렉트는 유형·마감 조건만 걸린 채 "각 시도가 몇 건"을 보여 준다(자기 필터를 빼야 다른 지역으로 갈아탈 수 있다).
type FacetAxis = "sector" | "sido" | "type" | "closing";

async function listFacetsRaw(f: NoticeFilters): Promise<Facets> {
  const params: unknown[] = [];
  const w = (omit: FacetAxis, extra?: string) => {
    const parts = buildWhere({ ...f, [omit]: undefined }, params);
    if (extra) parts.push(extra);
    return whereSql(parts);
  };
  const rows = await query<{ kind: string; value: string; count: number }>(
    `SELECT 'sector' AS kind, sector::text AS value, count(*)::int AS count FROM notice ${w("sector")} GROUP BY 2
     UNION ALL
     SELECT 'sido', sido, count(*)::int FROM notice ${w("sido")} GROUP BY 2
     UNION ALL
     SELECT 'type', housing_type::text, count(*)::int FROM notice ${w("type")} GROUP BY 2
     UNION ALL
     SELECT 'stat', 'closing7', count(*)::int FROM notice ${w("closing", CLOSING_7D)}
     UNION ALL
     SELECT 'stat', 'total', count(*)::int FROM notice ${w("sector")}
     ORDER BY 1, 3 DESC, 2`,
    params,
  );
  const pick = (k: string) => rows.filter((r) => r.kind === k).map(({ value, count }) => ({ value, count }));
  const stat = (v: string) => rows.find((r) => r.kind === "stat" && r.value === v)?.count ?? 0;
  return {
    sector: pick("sector").sort((a, b) => a.value.localeCompare(b.value, "ko")),
    sido: pick("sido"),
    type: pick("type"),
    closing7: stat("closing7"),
    total: stat("total"),
  };
}

/** 스코프 바·필터 바가 쓰는 수량 묶음. 필터가 바뀌면 /api/facets로 다시 받는다. */
export const listFacets = unstable_cache(
  (f: NoticeFilters) => listFacetsRaw(f),
  ["notice-facets-v1"],
  CACHE_OPTS,
);

export async function getNoticeBySlug(slug: string): Promise<Notice | null> {
  const rows = await query<Notice>(
    `SELECT ${LIST_COLS}, source_key, pnu, heating, total_household,
            min_down_payment, min_interim, min_balance, portal_url, contact,
            max_deposit, max_rent, schedule_source, schedule_steps,
            to_char(apply_start_tm, 'HH24:MI') AS apply_start_tm,
            to_char(apply_end_tm, 'HH24:MI') AS apply_end_tm,
            canonical_id,
            (SELECT c.slug FROM notice c WHERE c.id = notice.canonical_id) AS canonical_slug,
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

/** 공고의 공급 단지 목록. 자치구 → 단지명 순. 0건이면 화면에 섹션을 그리지 않는다.
 * tenant_classes는 이 단지의 공급현황에 적힌 공급대상(청년·신혼부부·고령자…)을 모은 것이다 —
 * 탐색기의 공급대상 필터가 쓴다(사용자 요청 2026-09-09). 공급현황이 없는 공고는 빈 배열이다.
 * 청년은 소득 조건까지 붙여 「청년 소득있음」·「청년 소득없음」으로 가른다(사용자 요청 2026-09-09) —
 * 자격도 배점도 갈리는 서로 다른 줄이라 하나로 묶으면 필터가 뜻을 잃는다. */
export async function getNoticeComplexes(noticeId: number): Promise<NoticeComplex[]> {
  return query<NoticeComplex>(
    `SELECT c.id, c.name, c.sido, c.sigungu, c.road_address, c.is_new, c.complex_code, c.source_page,
            c.heating, c.unit_count, c.min_deposit, c.min_rent, c.area_min, c.area_max, c.sh_bizns_cd,
            COALESCE(t.classes, ARRAY[]::text[]) AS tenant_classes
     FROM notice_complex c
     LEFT JOIN LATERAL (
       SELECT array_agg(DISTINCT s.tenant_class || COALESCE(' ' || s.income_option, '') ORDER BY s.tenant_class || COALESCE(' ' || s.income_option, '')) AS classes
       FROM notice_supply s
       WHERE s.notice_id = c.notice_id AND (s.complex_id = c.id OR s.complex_name = c.name)
     ) t ON true
     WHERE c.notice_id = $1
     ORDER BY c.sido <> '서울특별시', c.sigungu, c.name`,
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

/** 단지 1곳의 사진·도면(0023). SH주택정보에서 모은 것이라 코드가 안 붙은 단지는 빈 배열.
 *  순서: 평면도 → 전경 → 배치도 → 실내. 평면도를 먼저 보여준다 — 청약자가 제일 먼저 찾는 그림이다. */
export async function getComplexImages(biznsCd: string | null): Promise<ComplexImage[]> {
  if (!biznsCd) return [];
  return query<ComplexImage>(
    `SELECT kind, sply_ty, label, source_url, file_name
       FROM sh_house_image WHERE bizns_cd = $1
      ORDER BY array_position(ARRAY['평면도','전경','배치도','실내'], kind), sply_ty, sort_no, id`,
    [biznsCd],
  );
}

/** 단지 1곳의 호실 목록(0021). 매입임대 별첨이 있는 공고에만 있다 — 나머지는 빈 배열.
 *  동 → 호 순. 동이 없는 다세대주택은 호만으로 줄 세운다. */
export async function getComplexUnits(noticeComplexId: number): Promise<NoticeUnit[]> {
  return query<NoticeUnit>(
    `SELECT id, unit_key, building, road_address, room, floor, area_m2, room_layout, elevator,
            deposit, rent, deposit_jeonse, rent_jeonse, deposit_wolse, rent_wolse
       FROM unit WHERE notice_complex_id = $1
      ORDER BY building NULLS FIRST, road_address NULLS FIRST, floor NULLS LAST, room`,
    [noticeComplexId],
  );
}

/** 공고 전체 공급현황 줄. 0건이면 화면에 표를 그리지 않는다. */
/** 공고문에서 읽은 신청자격 묶음(0024). 없으면 null — 화면은 제도 일반 시드로 후퇴한다 */
export async function getNoticeEligibility(noticeId: number): Promise<NoticeEligibility | null> {
  const rows = await query<NoticeEligibility>(
    `SELECT source_pages, data, verified, parsed_at::text AS parsed_at FROM notice_eligibility WHERE notice_id = $1`,
    [noticeId],
  );
  return rows[0] ?? null;
}

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
       FROM notice WHERE canonical_id IS NULL ORDER BY posted_at DESC, id DESC LIMIT $1`,
      [limit],
    ),
  ["notice-sitemap"],
  CACHE_OPTS,
);


/* ── 자격진단 사양 (0020) ────────────────────────────────
   공고와 무관한 제도 규칙이라 공고 캐시 태그(CACHE_TAG_NOTICE)를 쓰지 않는다 — 따로 태그를 둔다.
   전엔 태그가 아예 없어 시간이 차기 전엔 revalidateTag로도 못 지웠다(2026-09-09, /api/revalidate 추가) */

export const getEligibilityRules = unstable_cache(
  async (): Promise<EligibilityRules> => {
    const [types, income, tiers] = await Promise.all([
      query<SupplyType>(
        `SELECT code, category, name, housing_type, sort_order, age_min, age_max, age_exempt, marital,
                marital_max_yr, newborn_exempt, required_class, homeless_scope, income_scope, income_pct,
                asset_scope, asset_limit_man, car_limit_man, region_limit, birth_bonus, note,
                ranking_method, ranks, general_ranks, score
           FROM supply_type ORDER BY sort_order`,
      ),
      query<IncomeStandard & { year: number }>(
        `SELECT household, pct, monthly_won, year FROM income_standard
          WHERE year = (SELECT max(year) FROM income_standard) ORDER BY household, pct`,
      ),
      query<RegionTier>(`SELECT name, kind, tier FROM region_tier ORDER BY tier, name`),
    ]);
    return { types, income, tiers, incomeYear: income[0]?.year ?? 0 };
  },
  ["eligibility-rules"],
  { revalidate: REVALIDATE_SEC, tags: [CACHE_TAG_ELIGIBILITY] },
);
