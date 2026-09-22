// notice 조회. 컬럼명은 db/schema.sql 그대로. 타입은 types/notice.ts.
// 발행 상태(publish) 필터는 S8이 생기기 전까지 걸지 않는다 — 지금은 전부 'parsed'.
// 목록·옵션은 unstable_cache로 REVALIDATE_SEC 캐시한다. 파이프라인이 DB를 갱신해도 그 안엔 반영된다(page.tsx revalidate와 동일).
import { unstable_cache } from "next/cache";
import type { EligibilityRules, IncomeStandard, JanggiRule, RegionTier, SupplyType, NoticeEligibility } from "@/types/eligibility";
import { cache } from "react";
import { query } from "./db";
import { CACHE_TAG_ELIGIBILITY, CACHE_TAG_NOTICE, PAGE_SIZE, REVALIDATE_SEC } from "./constants";
import { isClosed, todayKST } from "./format";
import type { ComplexFacts, ComplexImage, Facets, FilterOption, Notice, NoticeArea, NoticeComplex, NoticeFilters, NoticeListItem, NoticePage, NoticeSort, NoticeSupply, NoticeUnit, PriorCompetition, PriorResultRow, SearchComplexHit, SearchNoticeHit, Sector, YouthHouse } from "@/types/notice";

const CACHE_OPTS = { revalidate: REVALIDATE_SEC, tags: [CACHE_TAG_NOTICE] };

// 화면에 싣는 제목. 기관 원문의 「[민간임대] 」 접두어만 뗀다(사용자 결정 2026-09-16).
// 유형 태그(「공공지원민간임대」)가 이미 같은 말을 해서 목록에서 한 줄에 두 번 읽혔다.
// **DB의 title은 원문 그대로 둔다** — 벗기는 건 읽는 이 자리뿐이라 원문 대조가 언제든 된다.
// SELECT에서 하는 이유: 지면·메타·RSS·JSON-LD·OG가 전부 이 행을 받아 쓴다. 그리는 쪽에서 하면
// 열몇 자리 중 하나를 빠뜨려 어디선 붙고 어디선 떨어진다.
const titleCol = (alias = "") =>
  `regexp_replace(${alias}title, '^\\s*\\[민간임대\\]\\s*', '') AS title`;

/* ── 「사진 있음」 배지의 근거 (0023·0026) ────────────────────────────────────
   사진과 도면을 한 덩이로 세지 않는다. 배지가 「사진」이라고 적혀 있으면 열었을 때 사진이 나와야 한다 —
   평면도만 있는 단지에 사진 배지를 달면 배지가 거짓말이 된다(단지 1,930곳 중 도면만 있는 곳 115곳, 2026-09-21).
   종류 이름은 출처마다 다르다: SH는 전경·실내, 청년안심주택은 전경·투시도·편의시설이 실물이다. */
const PHOTO_KINDS_SH = `('전경', '실내')`;
const PHOTO_KINDS_YOUTH = `('전경', '투시도', '편의시설')`;

/** 단지 한 곳(별칭 c)에 실물 사진이 있나 */
const COMPLEX_HAS_PHOTO = `(
  EXISTS (SELECT 1 FROM sh_house_image i WHERE i.bizns_cd = c.sh_bizns_cd AND i.kind IN ${PHOTO_KINDS_SH})
  OR EXISTS (SELECT 1 FROM youth_house_image i WHERE i.home_code = c.youth_home_code AND i.kind IN ${PHOTO_KINDS_YOUTH}))`;

/** 도면(평면도·층별 도면·배치도)이 있나. 사진이 있으면 화면은 사진 쪽을 쓴다 */
const COMPLEX_HAS_PLAN = `(
  EXISTS (SELECT 1 FROM sh_house_image i WHERE i.bizns_cd = c.sh_bizns_cd AND i.kind NOT IN ${PHOTO_KINDS_SH})
  OR EXISTS (SELECT 1 FROM youth_house_image i WHERE i.home_code = c.youth_home_code AND i.kind NOT IN ${PHOTO_KINDS_YOUTH}))`;

/* 공고 한 건(notice)에 딸린 단지 중 한 곳이라도 사진이 있나. 목록 한 장은 20행이고 이 식은 LIMIT 뒤에
   남은 행에만 돈다 — 색인(idx_notice_complex_notice, idx_sh_house_image_lookup)을 그대로 탄다 */
const NOTICE_HAS_PHOTO = `(EXISTS (
  SELECT 1 FROM notice_complex c WHERE c.notice_id = notice.id AND ${COMPLEX_HAS_PHOTO}))`;

const LIST_COLS = `
  id, slug, ${titleCol()}, agency, housing_type::text AS housing_type, sector::text AS sector, house_type, sido, sigungu, complex_name,
  supply_count, min_deposit, min_rent, posted_at, apply_start_at, apply_end_at, announce_at,
  status::text AS status, source_status, amends_source_key, source_url, address, source_rank,
  ${NOTICE_HAS_PHOTO} AS has_photo`;

/** LIST_COLS가 내놓은 **결과 이름** 그대로. CTE 밖에서 다시 고를 때 쓴다 —
 *  LIST_COLS를 두 번 쓰면 `regexp_replace(title …)`가 이미 벗겨진 title에 또 걸려 식이 깨진다. */
const LIST_OUT = `
  id, slug, title, agency, housing_type, sector, house_type, sido, sigungu, complex_name,
  supply_count, min_deposit, min_rent, posted_at, apply_start_at, apply_end_at, announce_at,
  status, source_status, amends_source_key, source_url, address, source_rank, has_photo`;

function buildWhere(f: NoticeFilters, params: unknown[]): string[] {
  const where: string[] = [CANONICAL_ONLY];
  if (f.sector) {
    params.push(f.sector);
    where.push(`sector = $${params.length}::rental_sector`);
  }
  if (f.agency) {
    params.push(f.agency);
    where.push(`agency = $${params.length}`);
  }
  if (f.sido) {
    params.push(f.sido);
    where.push(`sido = $${params.length}`);
  }
  // 시군구는 시도 안에서만 뜻이 선다(「강서구」가 서울과 부산에 둘 다 있다) — parseNoticeFilters가 이미 걸러 보내지만
  // API로 직접 들어오는 길도 있어 여기서 한 번 더 묶는다
  if (f.sido && f.sigungu) {
    params.push(f.sigungu);
    where.push(`sigungu = $${params.length}`);
  }
  // 예산. 금액을 못 읽은 공고(83%만 값이 있다)는 상한을 걸면 빠진다 — 「얼마인지 모르는 집」을
  // 예산 안이라고 말할 수는 없다. 대신 상한을 안 걸면 그대로 다 보인다
  if (f.maxDeposit) {
    params.push(f.maxDeposit);
    where.push(`min_deposit IS NOT NULL AND min_deposit <= $${params.length}`);
  }
  // 전세형(min_rent = 0)은 어떤 월세 상한에도 걸린다 — 월세가 0이니 당연히 통과다
  if (f.maxRent) {
    params.push(f.maxRent);
    where.push(`min_rent IS NOT NULL AND min_rent <= $${params.length}`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`housing_type::text = $${params.length}`);
  }
  if (f.closing === "7d") where.push(CLOSING_7D);
  if (!f.closed) where.push(NOT_CLOSED);
  return where;
}

// 오늘(KST). Neon의 TimeZone은 GMT라 CURRENT_DATE를 그대로 쓰면 KST 00시~09시 동안 UTC 어제가 나온다 —
// 그 아홉 시간엔 어제 마감된 공고가 목록에 남고 화면 D-day(todayKST)만 「마감」으로 떠 서로 어긋났다(사용자 지적 2026-09-15).
export const TODAY = `(now() AT TIME ZONE 'Asia/Seoul')::date`;

// 정본만. 같은 공고가 기관 seq 여러 개로 들어와도 목록엔 한 번만 나온다(S2가 canonical_id를 채운다).
// 딸림 글의 URL은 살아 있고 상세도 열린다 — 목록에서만 뺀다(CLAUDE.md 하지 말 것 6).
export const CANONICAL_ONLY = `canonical_id IS NULL`;

// 마감 7일 내: 오늘 포함 7일 안에 접수 마감. KPI·칩 카운트·목록 필터가 같은 식을 쓴다
const CLOSING_7D = `apply_end_at >= ${TODAY} AND apply_end_at < ${TODAY} + 7`;

// 마감: 상태가 접수마감이거나, 마감일이 지났거나, 당첨자 발표일이 지났다. 기본 목록에서 감추고 「마감 포함」 칩으로만 꺼낸다.
// URL은 남는다(CLAUDE.md 하지 말 것 6) — 목록에서 감출 뿐 상세는 그대로 열린다.
// 발표일 조건이 필요한 이유: 마이홈 API의 endDe에 「예비입주자 명부 유효기간」이 들어오는 공고가 있다.
// LH 예비입주자 정례모집(울산 2025-09-15)은 접수가 2025-09-29~10-01인데 endDe가 2029-10-01이라
// 마감일만 보면 4년 뒤까지 접수 중이다 — 발표(2026-01-30)가 끝났다는 사실이 더 확실하다(사용자 지적 2026-09-15).
// 상시·수시모집은 발표일도 함께 미래로 잡혀 있어 이 조건에 걸리지 않는다. format.ts의 isClosed와 같은 규칙.
export const CLOSED = `(status = '접수마감'
  OR (apply_end_at IS NOT NULL AND apply_end_at < ${TODAY})
  OR (announce_at IS NOT NULL AND announce_at < ${TODAY}))`;
export const NOT_CLOSED = `NOT ${CLOSED}`;

function whereSql(where: string[]): string {
  return where.length ? "WHERE " + where.join(" AND ") : "";
}

// 마감 임박순 정렬키. 아직 안 지난 마감일 오름차순 → 마감 지난 것 → 마감일 없는 것.
// 「마감 포함」으로 켜서 볼 때 발표까지 끝난 공고가 먼 마감일(위 CLOSED 주석)만 믿고 맨 앞에 서지 않게 rank 1로 내린다.
const DEADLINE_RANK = `CASE WHEN apply_end_at IS NULL THEN 2 WHEN apply_end_at >= ${TODAY} AND NOT ${CLOSED} THEN 0 ELSE 1 END`;
const DEADLINE_KEY = `CASE WHEN apply_end_at >= ${TODAY} AND NOT ${CLOSED} THEN apply_end_at END`;

// 커서: posted → "posted_at|id". deadline → "rank|apply_end_at|posted_at|id". 정렬키 전체를 담아야 같은 값이 겹쳐도 빠지지 않는다.
// 커서는 정렬 키를 그대로 담는다. source_rank는 NULL일 수 있어 빈 칸으로 싣고 아래에서 최댓값으로 되돌린다.
function encodeCursor(n: NoticeListItem, sort: NoticeSort): string {
  if (sort === "rent") return `${n.min_rent ?? ""}|${n.min_deposit ?? ""}|${n.id}`;
  if (sort === "posted") return `${n.posted_at}|${n.source_rank ?? ""}|${n.id}`;
  const today = todayKST();
  // DEADLINE_RANK와 같은 식이어야 한다 — 어긋나면 다음 페이지가 통째로 빠지거나 겹친다
  const rank = n.apply_end_at === null ? 2 : n.apply_end_at >= today && !isClosed(n) ? 0 : 1;
  return `${rank}|${n.apply_end_at ?? ""}|${n.posted_at}|${n.source_rank ?? ""}|${n.id}`;
}

/** NULLS LAST 정렬을 튜플 비교로 쓰려고 NULL을 맨 뒤 값으로 바꾼다. */
const RANK_LAST = 2_147_483_647;
// 금액 NULL을 맨 뒤로 보내는 값. 원 단위라 int를 넘어 bigint로 쓴다 — 실제 보증금은 10억을 안 넘는다
const MONEY_LAST = 999_999_999_999;
const RENT_KEY = `COALESCE(min_rent, ${MONEY_LAST})`;

/** 금액 커서 한 칸. 빈 칸(값이 NULL이던 행)은 SQL의 COALESCE와 같은 맨 뒤 값으로 되돌린다.
 *  rankOrLast와 따로 두는 이유 — 되돌릴 값이 int 최댓값이 아니라 MONEY_LAST다 */
function moneyOrLast(v: string): number | null {
  if (v === "") return MONEY_LAST;
  return /^\d+$/.test(v) ? Number(v) : null;
}
function rankOrLast(v: string): number | null {
  if (v === "") return RANK_LAST;
  return /^\d+$/.test(v) ? Number(v) : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function listNoticesPageRaw(f: NoticeFilters, cursor: string | null, limit: number): Promise<NoticePage> {
  const sort: NoticeSort = f.sort === "deadline" || f.sort === "rent" ? f.sort : "posted";
  const params: unknown[] = [];
  const where = buildWhere(f, params);
  const countParams = [...params];
  const countWhere = whereSql(where);

  let order: string;
  if (sort === "rent") {
    // 월세 낮은 순. 금액을 못 읽은 공고는 맨 뒤로 — 0원(전세형)과 「모름」은 다른 값이다
    order = `${RENT_KEY} ASC, min_deposit ASC NULLS LAST, id DESC`;
    if (cursor) {
      const [rent, dep, id] = cursor.split("|");
      const r = moneyOrLast(rent ?? "");
      const d = moneyOrLast(dep ?? "");
      if (r !== null && d !== null && /^\d+$/.test(id)) {
        params.push(r, d, Number(id));
        const [pr, pd, pi] = [params.length - 2, params.length - 1, params.length];
        // (rent ASC, deposit ASC, id DESC)의 다음 행. id만 내림차순이라 부호를 뒤집어 튜플로 비교한다
        where.push(
          `(${RENT_KEY}, COALESCE(min_deposit, ${MONEY_LAST}), -id) > ($${pr}::bigint, $${pd}::bigint, -$${pi}::bigint)`,
        );
      }
    }
  } else if (sort === "posted") {
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
  ["notice-page-v7"],
  CACHE_OPTS,
);

/** 관심 공고(★) 화면(/my)이 쓰는 조회 — id 묶음을 한 번에 읽는다.
 *  마감분도 빼지 않는다: 담아 둔 공고가 마감됐다는 사실 자체가 그 화면이 알려 줄 일이다.
 *  정본 필터(CANONICAL_ONLY)도 걸지 않는다 — 딸림 글을 담았어도 그 상세는 살아 있다(CLAUDE.md 하지 말 것 5).
 *  **unstable_cache로 감싸지 않는다** — id 조합이 사람마다 달라 캐시 키가 매번 새로 생긴다(캐시가 아니라 쓰레기가 된다). */
export async function listNoticesByIds(ids: number[]): Promise<NoticeListItem[]> {
  if (ids.length === 0) return [];
  return query<NoticeListItem>(
    `SELECT ${LIST_COLS} FROM notice WHERE id = ANY($1::bigint[])
     ORDER BY ${DEADLINE_RANK}, ${DEADLINE_KEY} ASC NULLS LAST, posted_at DESC, id DESC`,
    [ids],
  );
}

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
  ["notice-filter-options-v4"],
  CACHE_OPTS,
));

// 패싯(facet) 집계 — 칩·셀렉트에 붙는 수량. 지금 걸린 다른 필터를 반영한다(사용자 지적 2026-09-09:
// "지역이 바뀌면 그 지역의 수량이 나와야 한다"). 자기 자신은 빼고 센다 — 검색 패싯의 표준 규칙이다.
// 서울을 고른 상태에서 유형 셀렉트는 "서울 안에서 각 유형이 몇 건"을 보여 주고,
// 시도 셀렉트는 유형·마감 조건만 걸린 채 "각 시도가 몇 건"을 보여 준다(자기 필터를 빼야 다른 지역으로 갈아탈 수 있다).
type FacetAxis = "sector" | "agency" | "sido" | "type" | "closing";

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
     SELECT 'agency', agency, count(*)::int FROM notice ${w("agency")} GROUP BY 2
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
    // 기관은 공고 많은 순 그대로 둔다 — SH·LH·서울시가 위에 서고 지방 개발공사(1~9건)가 아래로 내려간다
    agency: pick("agency"),
    sido: pick("sido"),
    type: pick("type"),
    closing7: stat("closing7"),
    total: stat("total"),
  };
}

/** 스코프 바·필터 바가 쓰는 수량 묶음. 필터가 바뀌면 /api/facets로 다시 받는다. */
export const listFacets = unstable_cache(
  (f: NoticeFilters) => listFacetsRaw(f),
  ["notice-facets-v4"],
  CACHE_OPTS,
);

/** 공고 한 건. 같은 요청 안에서 가드 layout·generateMetadata·page가 각각 부르므로 react cache()로 묶는다 —
 * 안 묶으면 한 페이지에 같은 질의가 세 번 나간다(왕복이 곧 시간, 55차 「적재는 왕복 수가 곧 시간이다」). */
export const getNoticeBySlug = cache(async (slug: string): Promise<Notice | null> => {
  const rows = await query<Notice>(
    `SELECT ${LIST_COLS}, source_key, pnu, complex_code, heating, total_household,
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
});

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
 * 자격도 배점도 갈리는 서로 다른 줄이라 하나로 묶으면 필터가 뜻을 잃는다.
 * 단지 상세도 가드 layout·generateMetadata·page가 같이 부른다 — getNoticeBySlug와 같은 이유로 cache()로 묶는다. */
export const getNoticeComplexes = cache(async (noticeId: number): Promise<NoticeComplex[]> => {
  return query<NoticeComplex>(
    `SELECT c.id, c.name, c.sido, c.sigungu, c.road_address, c.is_new, c.complex_code, c.source_page,
            c.heating, c.unit_count, c.min_deposit, c.min_rent, c.area_min, c.area_max,
            c.sh_bizns_cd, c.youth_home_code,
            ${COMPLEX_HAS_PHOTO} AS has_photo, ${COMPLEX_HAS_PLAN} AS has_plan,
            ST_Y(c.geom::geometry) AS lat, ST_X(c.geom::geometry) AS lng,
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
});

const SUPPLY_COLS = `
  id, complex_name, supply_type, accessible, tenant_class, income_option, is_new,
  units_total, units_priority, units_general, units_reserve,
  deposit, down_payment, balance, rent,
  area_exclusive, area_common, area_etc, area_total, move_in_from, source_page, deposit_options`;

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

/** 마이홈 단지정보로 채운 단지 사실 + 형 표 + 대기현황(S5, 0031·0032).
 *
 *  **왜 공고 지면에 이게 필요했나.** 마이홈 API 공고(LH 328건)는 첨부를 못 열어 자식 표가 한 줄도 없다 —
 *  robots.txt가 LH 첨부 경로를 막는다(docs/data-sources.md 6절). 목록 필드만 실은 지면이라
 *  구글이 「크롤링됨 — 현재 색인이 생성되지 않음」으로 밀어냈다(2026-09-17 실측).
 *  공고문 대신 **개방 API가 주는 단지 쪽 사실**을 싣는다.
 *
 *  형·대기는 **이 공고의 공급유형 것만** 추린다. 한 단지에 영구임대와 50년임대가 같이 있는 경우가 흔해
 *  전부 실으면 이 공고로 신청할 수 없는 금액이 표에 섞인다.
 *  코드가 없으면(PNU 후보가 여럿이라 S5가 안 이은 공고) null을 돌려 화면이 섹션을 통째로 접는다. */
export async function getComplexFacts(complexCode: string | null, housingType: string): Promise<ComplexFacts | null> {
  if (!complexCode) return null;
  const rows = await query<ComplexFacts>(
    `SELECT c.complex_code, c.name, c.agency, c.road_address, c.completed_on::text AS completed_on,
            c.household_cnt, c.parking_cnt, c.building_style, c.elevator, c.heating,
            COALESCE(t.types, '[]'::json) AS types,
            COALESCE(w.rows, '[]'::json) AS waitlist,
            w.surveyed_on::text AS surveyed_on
       FROM complex c
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'style_name', style_name, 'exclusive_area', exclusive_area, 'exclusive_area_max', exclusive_area_max,
                  'common_area', common_area, 'common_area_max', common_area_max,
                  'base_deposit', base_deposit, 'base_rent', base_rent,
                  'conversion_deposit_limit', conversion_deposit_limit)
                ORDER BY exclusive_area, style_name) AS types
           FROM complex_type WHERE complex_id = c.id AND housing_type::text = $2
       ) t ON true
       LEFT JOIN LATERAL (
         SELECT max(surveyed_on) AS surveyed_on,
                json_agg(json_build_object(
                  'style_name', style_name, 'draw_unit', draw_unit,
                  'waiting_cnt', waiting_cnt, 'vacated_cnt', vacated_cnt)
                ORDER BY style_name, draw_unit) AS rows
           FROM waitlist
          WHERE complex_code = c.complex_code AND housing_type::text = $2
            AND surveyed_on = (SELECT max(surveyed_on) FROM waitlist WHERE complex_code = c.complex_code)
       ) w ON true
      WHERE c.complex_code = $1`,
    [complexCode, housingType],
  );
  return rows[0] ?? null;
}

/** 단지 1곳의 포털 사실(0027). 공고문 첨부에 없는 값 — **관리비**·운영사·시행사·입주예정일·연락처.
 *  민간임대 단지에만 있다. 코드가 없거나 포털에서 내려간 단지는 null. */
export async function getYouthHouse(homeCode: string | null): Promise<YouthHouse | null> {
  if (!homeCode) return null;
  const rows = await query<YouthHouse>(
    `SELECT home_code, name, maint_low, maint_high, households, manager, developer, builder,
            movein::text AS movein, phone, homepage, subway, scale, source_url
       FROM youth_house WHERE home_code = $1`,
    [homeCode],
  );
  return rows[0] ?? null;
}

/** 단지 1곳의 사진·도면. 공공임대는 SH주택정보(0023), 민간임대는 청년안심주택 포털(0026)에서 온다.
 *  한 단지가 두 출처에 다 있지는 않다 — 코드가 붙은 쪽만 읽고, 둘 다 없으면 빈 배열.
 *  순서: 평면도를 맨 앞에 둔다 — 청약자가 제일 먼저 찾는 그림이다.
 *  매입임대(다가구·원룸)에는 평면도가 없고 그 자리에 「층별 도면」이 온다(imgTy 08, 2026-09-21). */
export async function getComplexImages(biznsCd: string | null, homeCode: string | null = null): Promise<ComplexImage[]> {
  if (biznsCd) {
    return query<ComplexImage>(
      `SELECT 'sh' AS source, bizns_cd AS code, kind, sply_ty, label, source_url, file_name
         FROM sh_house_image WHERE bizns_cd = $1
        ORDER BY array_position(ARRAY['평면도','층별 도면','전경','배치도','실내'], kind), sply_ty, sort_no, id`,
      [biznsCd],
    );
  }
  if (homeCode) {
    return query<ComplexImage>(
      `SELECT 'youth' AS source, home_code AS code, kind, sply_ty, label, source_url, file_name
         FROM youth_house_image WHERE home_code = $1
        ORDER BY array_position(ARRAY['평면도','전경','투시도','편의시설'], kind), sply_ty, sort_no, id`,
      [homeCode],
    );
  }
  return [];
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

/* ── 유형 허브(/type)와 지역×유형(/area/{시군구}/{유형}) ────────────────────
   docs/url-structure.md의 남은 두 축. 둘 다 서버가 목록을 그대로 그리는 착지 페이지다 —
   홈처럼 클라이언트 필터 상태(ListStateProvider)를 태우지 않는다. 검색에서 바로 들어오는 자리라
   URL 하나에 결과 하나가 맞고, ISR 캐시도 한 장으로 끝난다.

   지역은 notice.sigungu가 아니라 **notice_area**로 센다 — 여러 시군구에 걸친 공고가 있어
   notice.sigungu 한 칸만 보면 시군구 89개, notice_area로 보면 132개다(실측 2026-09-16). */

/** 지역×유형 발행 최소 건수 — 얇은 페이지 방지 규칙(CLAUDE.md 4: 지역×유형은 5건 이상).
 *  값은 constants.ts에 있다(검색이 pg를 물지 않고 보려고). 부르는 쪽이 옮겨 다니지 않게 여기서 재수출한다 */
export { AREA_TYPE_MIN_COUNT } from "./constants";

export type AreaTypePair = { sido: string; sigungu: string; housing_type: string; count: number; ambiguous: boolean };

/** (시군구, 유형) 쌍 **전부**. 발행 대상은 `count >= AREA_TYPE_MIN_COUNT`인 것만이지만,
 *  미달 쌍도 URL로 들어올 수 있어(링크를 지우지 않는다 — CLAUDE.md 5) 페이지가 제 건수를 알아야 한다.
 *  ambiguous면 같은 이름의 시군구가 다른 시도에도 있어 URL 앞에 시도 통칭을 붙인다. 180행 남짓이라 통째로 받는다 */
export const listAreaTypePairs = cache(unstable_cache(
  async (): Promise<AreaTypePair[]> =>
    query<AreaTypePair>(
      `WITH pair AS (
         SELECT a.sido, a.sigungu, n.housing_type::text AS housing_type, count(DISTINCT n.id)::int AS count
           FROM notice_area a JOIN notice n ON n.id = a.notice_id
          WHERE n.canonical_id IS NULL AND a.sigungu IS NOT NULL
          GROUP BY 1, 2, 3),
       dup AS (SELECT sigungu FROM notice_area WHERE sigungu IS NOT NULL GROUP BY 1 HAVING count(DISTINCT sido) > 1)
       SELECT p.*, (p.sigungu IN (SELECT sigungu FROM dup)) AS ambiguous
         FROM pair p ORDER BY p.count DESC, p.sido, p.sigungu`,
    ),
  ["area-type-pairs-v1"],
  CACHE_OPTS,
));

export type TypeHub = { housing_type: string; total: number; open: number; sidos: number };

/** 유형별 전국 현황. /type/{유형}의 「전국 공고 현황」과 유형 목록이 같이 쓴다 */
export const listTypeHubs = cache(unstable_cache(
  async (): Promise<TypeHub[]> =>
    query<TypeHub>(
      `SELECT housing_type::text AS housing_type, count(*)::int AS total,
              count(*) FILTER (WHERE ${NOT_CLOSED})::int AS open,
              count(DISTINCT sido)::int AS sidos
         FROM notice WHERE ${CANONICAL_ONLY} GROUP BY 1 ORDER BY 2 DESC`,
    ),
  ["type-hubs-v1"],
  CACHE_OPTS,
));

/** 착지 페이지가 그리는 목록. 진행 중을 먼저, 그다음 최신순. 페이징 없이 limit까지만 */
export const listLandingNotices = unstable_cache(
  async (f: { type: string; sido?: string; sigungu?: string }, limit: number): Promise<NoticeListItem[]> => {
    const params: unknown[] = [f.type];
    const where = [CANONICAL_ONLY, `housing_type::text = $1`];
    if (f.sigungu) {
      params.push(f.sigungu);
      const pSigungu = params.length;
      params.push(f.sido ?? null);
      const pSido = params.length;
      where.push(`EXISTS (SELECT 1 FROM notice_area a
                           WHERE a.notice_id = notice.id AND a.sigungu = $${pSigungu}
                             AND ($${pSido}::text IS NULL OR a.sido = $${pSido}))`);
    } else if (f.sido) {
      params.push(f.sido);
      where.push(`sido = $${params.length}`);
    }
    params.push(limit);
    return query<NoticeListItem>(
      `SELECT ${LIST_COLS} FROM notice ${whereSql(where)}
        ORDER BY (${CLOSED}), posted_at DESC, source_rank ASC NULLS LAST, id DESC LIMIT $${params.length}`,
      params,
    );
  },
  ["landing-notices-v1"],
  CACHE_OPTS,
);

/** 검색의 「바로 가기」가 쓰는 원천 — 시도 분포 + 시군구×유형 + 유형 허브.
 *
 *  **세 조회를 한 왕복으로 합친다.** /api/search는 레이아웃을 타지 않아 react cache() 중복 제거가 없다 —
 *  키를 한 자 칠 때마다 커넥션 세 개가 따로 열렸다. 셋 다 같은 주기로 갱신되는 정적에 가까운 집계라
 *  한 문장 안에 json_agg로 말아 담는 게 맞다. */
export const listShortcutSource = cache(unstable_cache(
  async (): Promise<{ sido: FilterOption[]; pairs: AreaTypePair[]; hubs: TypeHub[] }> => {
    const rows = await query<{ sido: FilterOption[]; pairs: AreaTypePair[]; hubs: TypeHub[] }>(
      `SELECT
         (SELECT coalesce(json_agg(t), '[]'::json) FROM (
            SELECT sido AS value, count(*)::int AS count FROM notice
             WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED} GROUP BY 1 ORDER BY 2 DESC, 1) t) AS sido,
         (SELECT coalesce(json_agg(t), '[]'::json) FROM (
            WITH pair AS (
              SELECT a.sido, a.sigungu, n.housing_type::text AS housing_type, count(DISTINCT n.id)::int AS count
                FROM notice_area a JOIN notice n ON n.id = a.notice_id
               WHERE n.canonical_id IS NULL AND a.sigungu IS NOT NULL
               GROUP BY 1, 2, 3),
            dup AS (SELECT sigungu FROM notice_area WHERE sigungu IS NOT NULL GROUP BY 1 HAVING count(DISTINCT sido) > 1)
            SELECT p.*, (p.sigungu IN (SELECT sigungu FROM dup)) AS ambiguous
              FROM pair p ORDER BY p.count DESC, p.sido, p.sigungu) t) AS pairs,
         (SELECT coalesce(json_agg(t), '[]'::json) FROM (
            SELECT housing_type::text AS housing_type, count(*)::int AS total,
                   count(*) FILTER (WHERE ${NOT_CLOSED})::int AS open,
                   count(DISTINCT sido)::int AS sidos
              FROM notice WHERE ${CANONICAL_ONLY} GROUP BY 1 ORDER BY 2 DESC) t) AS hubs`,
    );
    return rows[0] ?? { sido: [], pairs: [], hubs: [] };
  },
  ["search-shortcut-source-v1"],
  CACHE_OPTS,
));

/* ── 검색 (0033·0034) ──────────────────────────────────────
   자유 입력 한 칸. 필터로는 못 닿던 길 — 「고덕리엔파크」나 「강동구」처럼 **이름을 아는 사람**이 들어오는 문이다.

   말 다듬기(공백 제거·소문자)는 lib/search.ts의 searchNorm이 하고, DB 쪽 search_norm()과 규칙이 같다.
   찾는 식은 마이그레이션이 굳혀 둔 함수(notice_search_key·complex_search_key)를 그대로 부른다 —
   **식을 여기서 풀어 쓰면 GIN 인덱스가 안 잡힌다**(0034 머리글).

   unstable_cache로 감싸지 않는다. 찾는 말이 사람마다 달라 캐시 키가 매번 새로 생긴다(listNoticesByIds와 같은 이유) —
   같은 말을 또 치는 건 CDN이 /api/search 응답 한 장으로 받는 게 맞는 층이다. */

/** 이 말이 들어간 공고. 제목으로 시작하는 것 → 최신 순.
 *
 *  **진행 중과 마감을 각각 limit까지 준다.** 전에는 한 덩이로 정렬해 앞에서 잘라서,
 *  진행 중이 limit을 채우면 마감분은 한 건도 못 왔다 — 화면에서 「마감 공고 보기」를 열 방법이 없었다.
 *  row_number를 closed로 갈라 매기면 왕복 한 번으로 두 몫을 같이 받는다(쿼리를 둘로 쪼개지 않는 이유:
 *  Neon은 병렬 쿼리가 늘수록 새 커넥션을 열 확률이 올라간다). */
export async function searchNotices(term: string, limit: number): Promise<SearchNoticeHit[]> {
  return query<SearchNoticeHit>(
    `WITH hit AS (
       SELECT ${LIST_COLS}, ${CLOSED} AS closed, (search_norm(title) LIKE $1 || '%') AS head
         FROM notice
        WHERE ${CANONICAL_ONLY}
          AND notice_search_key(title, complex_name, address, agency, sido, sigungu) LIKE '%' || $1 || '%'
     ),
     ranked AS (
       SELECT hit.*, row_number() OVER (PARTITION BY closed ORDER BY head DESC, posted_at DESC, id DESC) AS rn
         FROM hit
     )
     SELECT ${LIST_OUT}, closed FROM ranked WHERE rn <= $2
      ORDER BY closed, head DESC, posted_at DESC, id DESC`,
    [term, limit],
  );
}

/** 이 말이 들어간 단지. 같은 단지가 여러 공고에 나오므로 이름+주소로 접고 가장 최근 공고를 업고 온다.
 *  단지 지면은 공고에 매달려 있어(/notice/{공고}/{단지}) 어느 공고를 업느냐가 곧 어느 URL로 보내느냐다 —
 *  진행 중인 공고를 먼저 고른다. 지난 공고밖에 없으면 그거라도 준다(URL을 죽이지 않는다 — CLAUDE.md 5). */
export async function searchComplexes(term: string, limit: number): Promise<SearchComplexHit[]> {
  return query<SearchComplexHit>(
    `WITH hit AS (
       SELECT DISTINCT ON (search_norm(c.name), search_norm(c.road_address))
              c.id, c.name, c.complex_code, c.sido, c.sigungu, c.road_address,
              n.slug AS notice_slug, ${titleCol("n.")}, n.posted_at::text AS posted_at, ${CLOSED} AS closed
         FROM notice_complex c JOIN notice n ON n.id = c.notice_id
        WHERE n.canonical_id IS NULL
          AND complex_search_key(c.name, c.road_address, c.sido, c.sigungu) LIKE '%' || $1 || '%'
        ORDER BY search_norm(c.name), search_norm(c.road_address), (${CLOSED}), n.posted_at DESC, c.id
     ),
     ranked AS (
       SELECT hit.*, (search_norm(name) LIKE $1 || '%') AS head,
              row_number() OVER (PARTITION BY closed
                                 ORDER BY (search_norm(name) LIKE $1 || '%') DESC, posted_at DESC, name) AS rn
         FROM hit
     )
     SELECT id, name, complex_code, sido, sigungu, road_address, notice_slug, title AS notice_title, posted_at, closed
       FROM ranked
      WHERE rn <= $2
      ORDER BY closed, head DESC, posted_at DESC, name`,
    [term, limit],
  );
}

/* ── 단지 페이지 색인 기준 (docs/url-structure.md 얇은 페이지 방지) ──────────────
   단지 상세는 호실 상세 자리를 대신 채우고 있어 그 기준을 그대로 받는다 — 「고유 필드 8개 이상 + 건물 단위 좌표」.
   전에는 좌표가 아예 없어 전량 noindex였다(2026-09-09 주석). S6가 도로명주소 요약DB를 오프라인 조인해
   좌표를 채운 뒤로는 1,920장 중 1,894장에 건물 좌표가 있다 — 이제 갈림길은 필드 수다.

   세는 필드는 「그 단지에만 있는 값」 열둘. 공고에서 물려받는 값(기관·유형·접수일정)은 세지 않는다 —
   같은 공고의 단지끼리 똑같아서 그걸로는 페이지가 두꺼워지지 않는다.
   실측(2026-09-16): 7개와 8개 사이에서 646장 → 236장으로 끊긴다. 기준선이 데이터의 결을 타고 있다. */
const COMPLEX_FIELDS = `
  (c.road_address IS NOT NULL)::int + (c.heating IS NOT NULL)::int + (c.unit_count IS NOT NULL)::int
  + (c.min_deposit IS NOT NULL)::int + (c.min_rent IS NOT NULL)::int
  + (c.area_min IS NOT NULL)::int + (c.area_max IS NOT NULL)::int
  + (EXISTS (SELECT 1 FROM notice_supply s WHERE s.notice_id = c.notice_id AND (s.complex_id = c.id OR s.complex_name = c.name)))::int
  + (EXISTS (SELECT 1 FROM unit u WHERE u.notice_complex_id = c.id))::int
  + (EXISTS (SELECT 1 FROM sh_house_image i WHERE i.bizns_cd = c.sh_bizns_cd))::int
  + (EXISTS (SELECT 1 FROM youth_house_image i WHERE i.home_code = c.youth_home_code))::int
  + (EXISTS (SELECT 1 FROM youth_house y WHERE y.home_code = c.youth_home_code))::int`;

/** docs/url-structure.md: 호실 상세는 고유 필드 8개 이상 & 좌표 건물 단위 */
export const COMPLEX_MIN_FIELDS = 8;
const COMPLEX_INDEXABLE = `(c.geom IS NOT NULL AND (${COMPLEX_FIELDS}) >= ${COMPLEX_MIN_FIELDS})`;

/** 단지 한 곳을 색인해도 되나. generateMetadata가 부른다 — 왕복 1회, 캐시는 목록과 같은 태그. */
export const isComplexIndexable = unstable_cache(
  async (complexId: number): Promise<boolean> => {
    const rows = await query<{ ok: boolean }>(
      `SELECT ${COMPLEX_INDEXABLE} AS ok FROM notice_complex c WHERE c.id = $1`,
      [complexId],
    );
    return rows[0]?.ok ?? false;
  },
  ["complex-indexable-v1"],
  CACHE_OPTS,
);

export type SitemapComplex = { slug: string; name: string; complex_code: string | null; updated_at: string; closed: boolean };

/** 사이트맵에 실을 단지. 기준을 못 채운 장은 아예 싣지 않는다 — 페이지는 살아 있고 공고 지도가 앵커다. */
export const listSitemapComplexes = unstable_cache(
  async (limit: number): Promise<SitemapComplex[]> =>
    query<SitemapComplex>(
      `SELECT n.slug, c.name, c.complex_code,
              to_char(n.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
              ${CLOSED} AS closed
         FROM notice_complex c JOIN notice n ON n.id = c.notice_id
        WHERE n.canonical_id IS NULL AND ${COMPLEX_INDEXABLE}
        ORDER BY n.posted_at DESC, c.id LIMIT $1`,
      [limit],
    ),
  ["complex-sitemap-v1"],
  CACHE_OPTS,
);

export type SitemapNotice = { slug: string; updated_at: string; closed: boolean };

/** 사이트맵용 전 공고. 마감 여부로 priority를 가른다. */
export const listSitemapNotices = unstable_cache(
  async (limit: number): Promise<SitemapNotice[]> =>
    query<SitemapNotice>(
      `SELECT slug, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS updated_at,
              ${CLOSED} AS closed
       FROM notice WHERE canonical_id IS NULL ORDER BY posted_at DESC, id DESC LIMIT $1`,
      [limit],
    ),
  ["notice-sitemap-v2"],
  CACHE_OPTS,
);


// 자격진단 화면이 고를 수 있는 장기전세 기준 회차 수. 더 옛 회차는 표 양식이 달라 쓸모가 적다
const JANGGI_RULE_MAX = 6;

/* ── 자격진단 사양 (0020) ────────────────────────────────
   공고와 무관한 제도 규칙이라 공고 캐시 태그(CACHE_TAG_NOTICE)를 쓰지 않는다 — 따로 태그를 둔다.
   전엔 태그가 아예 없어 시간이 차기 전엔 revalidateTag로도 못 지웠다(2026-09-09, /api/revalidate 추가) */

export const getEligibilityRules = unstable_cache(
  async (): Promise<EligibilityRules> => {
    const [types, income, tiers, janggi] = await Promise.all([
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
      // 표를 읽어 둔 장기전세 공고문들 — 최근 회차가 기본이고, 화면에서 다른 회차로 바꿔 볼 수 있다.
      // 한 건이 5KB 남짓이라 몇 회차를 통째로 실어도 가볍다(실측 2026-09-15)
      query<JanggiRule>(
        `SELECT n.slug, ${titleCol("n.")}, n.posted_at, e.data FROM notice_eligibility e JOIN notice n ON n.id = e.notice_id
          WHERE n.housing_type = '장기전세' AND e.verified AND COALESCE(e.data->>'kind', 'janggi') = 'janggi'
          ORDER BY n.posted_at DESC, n.id DESC LIMIT ${JANGGI_RULE_MAX}`,
      ),
    ]);
    return { types, income, tiers, incomeYear: income[0]?.year ?? 0, janggi };
  },
  ["eligibility-rules"],
  { revalidate: REVALIDATE_SEC, tags: [CACHE_TAG_ELIGIBILITY] },
);

/* ── 진단 결과에 붙일 「지금 열린 공고」 ────────────────────
   진단은 브라우저에서 돌아 어느 유형이 통과인지 서버가 모른다. 그래서 유형별로 질의하지 않고
   **마감이 가까운 열린 공고를 한 줌 미리 실어** 보내고, 화면이 통과한 유형만 골라 그린다.
   열린 공고는 280건 남짓이라(실측 2026-09-22) 전량은 안 싣는다 — 마감 임박 순 앞머리면 족하다.
   칸도 목록(LIST_COLS)보다 좁게 든다. 여기 필요한 건 제목과 마감일과 어디냐뿐이다. */

export type OpenSoonNotice = {
  id: number;
  slug: string;
  title: string;
  agency: string;
  housing_type: string;
  sido: string | null;
  sigungu: string | null;
  apply_end_at: string | null;
  /** 같은 제목으로 열려 있는 공고 수. LH는 한 모집을 seq 여러 개로 올려 제목이 겹친다 */
  same_count: number;
};

/** 진단 화면이 싣는 공고 수. 통과 유형이 많아도 화면엔 몇 줄만 보이니 이만큼이면 넉넉하다 */
export const ELIG_OPEN_LIMIT = 60;

/**
 * **제목 단위로 접어서** 낸다. LH는 「대구죽전 행복주택 예비 입주자 모집」 하나를 seq 넷으로 올리는데
 * 넷 다 정본(canonical_id IS NULL)이라 접지 않으면 여섯 줄짜리 맛보기가 같은 제목으로 다 차 버린다
 * (실측 2026-09-22). 접은 건수는 `same_count`로 들고 나가 화면이 「외 N건」을 적는다.
 */
export const listOpenSoon = unstable_cache(
  async (limit: number = ELIG_OPEN_LIMIT): Promise<OpenSoonNotice[]> =>
    query<OpenSoonNotice>(
      `WITH o AS (
         SELECT id, slug, ${titleCol()}, agency, housing_type::text AS housing_type, sido, sigungu, apply_end_at
           FROM notice WHERE ${CANONICAL_ONLY} AND ${NOT_CLOSED}
       ), f AS (
         SELECT DISTINCT ON (title, agency)
                id, slug, title, agency, housing_type, sido, sigungu, apply_end_at,
                count(*) OVER (PARTITION BY title, agency)::int AS same_count
           FROM o
          ORDER BY title, agency, apply_end_at ASC NULLS LAST, id
       )
       SELECT * FROM f ORDER BY apply_end_at ASC NULLS LAST, id DESC LIMIT $1`,
      [limit],
    ),
  ["elig-open-soon-v2"],
  CACHE_OPTS,
);

/* ── 과거 경쟁률 (0014 notice_result) ────────────────────────
   「내 조건에 맞는 단지」에 지난 회차 경쟁률을 붙인다(사용자 요청 2026-09-14). 같은 housing_type이라도 청년 매입임대와
   장기미임대 매입임대는 신청자 풀이 달라 제목 계열(noticeFamily)로 한 번 더 가른다 — 계열이 다른 결과를 보이면 남의 경쟁률이다.
   산술이 맞은 줄(reconciled)만 쓴다. 단지 이름은 표기가 조금씩 달라(「고덕온빛채」/「고덕 온빛채」) 공백·괄호·구두점을 걷어 견준다. */

// 대괄호 표현 안에서 「]」는 맨 앞, 「-」는 맨 뒤여야 글자 그대로다(Postgres ARE)
// 괄호 주석(「꿈의숲 롯데캐슬(미아4)」·「푸르내(서울리츠1호)」)은 먼저 통째로 걷는다 — 회차마다 붙었다 떨어진다
const NAME_KEY = `regexp_replace(lower(regexp_replace(%s, '\([^)]*\)', '', 'g')), '[]_.,·・[[:space:]-]', '', 'g')`;

/** 결과 계열 열쇠. 같은 housing_type 안에서 신청자 풀이 다른 프로그램을 가른다. 화면 문자열이 아니라 비교 열쇠다 */
export function noticeFamily(title: string, housingType: string): string {
  const t = title.replace(/\s+/g, "");
  if (/청년매입임대|청년주택매입/.test(t)) return "청년매입임대";
  if (/신혼신생아|미리내집/.test(t)) return "신혼신생아";
  if (/장기미임대/.test(t)) return "장기미임대";
  if (/다자녀/.test(t)) return "다자녀";
  if (/자립준비청년/.test(t)) return "자립준비청년";
  if (/서울리츠/.test(t)) return `${housingType}서울리츠`;
  if (/잔여세대|잔여공가/.test(t)) return `${housingType}잔여`;
  return housingType;
}

export async function getPriorCompetition(n: Pick<Notice, "id" | "agency" | "housing_type" | "title" | "posted_at">): Promise<PriorCompetition | null> {
  // 1) 결과 표가 있는 같은 유형의 앞선 공고 — 최근 것부터 몇 건만 보고 계열이 같은 첫 공고를 고른다
  const cands = await query<{ id: number; slug: string; title: string; posted_at: string }>(
    `SELECT n.id, n.slug, ${titleCol("n.")}, n.posted_at::text AS posted_at
       FROM notice n
      WHERE n.agency = $1 AND n.housing_type::text = $2 AND n.posted_at < $3::date AND n.id <> $4
        AND EXISTS (SELECT 1 FROM notice_result r WHERE r.notice_id = n.id AND r.reconciled)
      ORDER BY n.posted_at DESC, n.id DESC LIMIT 12`,
    [n.agency, n.housing_type, n.posted_at, n.id],
  );
  const family = noticeFamily(n.title, n.housing_type);
  const prior = cands.find((c) => noticeFamily(c.title, n.housing_type) === family);
  if (!prior) return null;
  // 2) 그 공고의 줄 가운데 이 공고 단지와 이름이 맞는 것 + 전체 소계 합산. 쿼리 둘, 단지 수와 무관
  const [rows, sums] = await Promise.all([
    query<PriorResultRow>(
      `SELECT r.complex_name, r.supply_type, r.tenant_class, r.bracket, r.units, r.applicants, r.ratio::float AS ratio
         FROM notice_result r
        WHERE r.notice_id = $1 AND r.reconciled
          AND ${NAME_KEY.replace("%s", "r.complex_name")} IN (
                SELECT ${NAME_KEY.replace("%s", "c.name")} FROM notice_complex c WHERE c.notice_id = $2)
        ORDER BY r.row_no`,
      [prior.id, n.id],
    ),
    query<{ complexes: number; units: number | null; applicants: number | null }>(
      `SELECT count(DISTINCT complex_name)::int AS complexes, sum(units)::int AS units, sum(applicants)::int AS applicants
         FROM notice_result WHERE notice_id = $1 AND reconciled AND bracket = '소계'`,
      [prior.id],
    ),
  ]);
  const s = sums[0];
  const units = s?.units ?? 0;
  const applicants = s?.applicants ?? 0;
  return {
    notice: prior,
    rows,
    summary: { complexes: s?.complexes ?? 0, units, applicants, ratio: units > 0 ? Math.round((applicants / units) * 10) / 10 : null },
  };
}
