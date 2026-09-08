// notice 조회. 컬럼명은 db/schema.sql 그대로.
// 발행 상태(publish) 필터는 S8이 생기기 전까지 걸지 않는다 — 지금은 전부 'parsed'.
import { query } from "./db";

export type NoticeStatus = "공고중" | "접수중" | "접수마감" | "정정공고중";

export type NoticeListItem = {
  id: number;
  slug: string;
  title: string;
  agency: string;
  housing_type: string;
  house_type: string | null;
  sido: string;
  sigungu: string | null;
  complex_name: string | null;
  supply_count: number | null;
  min_deposit: number | null;
  min_rent: number | null;
  posted_at: string;
  apply_start_at: string | null;
  apply_end_at: string | null;
  announce_at: string | null;
  status: NoticeStatus;
  source_status: string | null;
  amends_source_key: string | null;
};

export type Notice = NoticeListItem & {
  source_key: string | null;
  address: string | null;
  pnu: string | null;
  heating: string | null;
  total_household: number | null;
  min_down_payment: number | null;
  min_interim: number | null;
  min_balance: number | null;
  source_url: string;
  portal_url: string | null;
  contact: string | null;
  updated_at: string;
};

export type NoticeArea = { sido: string; sigungu: string | null; supply_count: number | null };

export type NoticeFilters = { sido?: string; type?: string };

const LIST_COLS = `
  id, slug, title, agency, housing_type::text AS housing_type, house_type, sido, sigungu, complex_name,
  supply_count, min_deposit, min_rent, posted_at, apply_start_at, apply_end_at, announce_at,
  status::text AS status, source_status, amends_source_key`;

// 마감 임박순: 아직 안 지난 마감일 오름차순 → 마감 지난 것 → 마감일 없는 것. 같으면 최신 공고 먼저.
export async function listNotices(f: NoticeFilters = {}, limit = 300): Promise<NoticeListItem[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.sido) {
    params.push(f.sido);
    where.push(`sido = $${params.length}`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`housing_type::text = $${params.length}`);
  }
  params.push(limit);
  return query<NoticeListItem>(
    `SELECT ${LIST_COLS} FROM notice
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY
       CASE WHEN apply_end_at IS NULL THEN 2 WHEN apply_end_at >= CURRENT_DATE THEN 0 ELSE 1 END,
       CASE WHEN apply_end_at >= CURRENT_DATE THEN apply_end_at END ASC,
       apply_end_at DESC NULLS LAST,
       posted_at DESC, id DESC
     LIMIT $${params.length}`,
    params,
  );
}

export type FilterOption = { value: string; count: number };

export async function listFilterOptions(): Promise<{ sido: FilterOption[]; type: FilterOption[] }> {
  const [sido, type] = await Promise.all([
    query<FilterOption>(`SELECT sido AS value, count(*)::int AS count FROM notice GROUP BY 1 ORDER BY 2 DESC, 1`),
    query<FilterOption>(
      `SELECT housing_type::text AS value, count(*)::int AS count FROM notice GROUP BY 1 ORDER BY 2 DESC, 1`,
    ),
  ]);
  return { sido, type };
}

export async function getNoticeBySlug(slug: string): Promise<Notice | null> {
  const rows = await query<Notice>(
    `SELECT ${LIST_COLS}, source_key, address, pnu, heating, total_household,
            min_down_payment, min_interim, min_balance, source_url, portal_url, contact,
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
      ? query<NoticeListItem>(`SELECT ${LIST_COLS} FROM notice WHERE amends_source_key = $1 ORDER BY posted_at DESC`, [
          n.source_key,
        ])
      : Promise.resolve([] as NoticeListItem[]),
  ]);
  return { original: original[0] ?? null, amendments };
}

export async function listSlugs(limit = 1000): Promise<string[]> {
  const rows = await query<{ slug: string }>(`SELECT slug FROM notice ORDER BY posted_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => r.slug);
}
