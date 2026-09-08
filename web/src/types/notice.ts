// notice 테이블 행 타입. 컬럼명은 db/schema.sql 그대로 — web과 pipeline은 스키마로만 통신한다.

export type NoticeStatus = "공고중" | "접수중" | "접수마감" | "정정공고중";
export type Sector = "공공임대" | "민간임대";
export type NoticeSort = "posted" | "deadline";

export const SECTORS: readonly Sector[] = ["공공임대", "민간임대"];

export function isSector(v: unknown): v is Sector {
  return typeof v === "string" && (SECTORS as readonly string[]).includes(v);
}

export type NoticeListItem = {
  id: number;
  slug: string;
  title: string;
  agency: string;
  housing_type: string;
  sector: Sector;
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
  source_url: string;
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
  portal_url: string | null;
  contact: string | null;
  updated_at: string;
};

export type NoticeArea = { sido: string; sigungu: string | null; supply_count: number | null };

export type NoticeFilters = { sido?: string; type?: string; sector?: Sector; sort?: NoticeSort };

export type NoticePage = { items: NoticeListItem[]; nextCursor: string | null; total: number };

export type FilterOption = { value: string; count: number };
