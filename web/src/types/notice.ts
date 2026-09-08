// notice 테이블 행 타입. 컬럼명은 db/schema.sql 그대로 — web과 pipeline은 스키마로만 통신한다.

export type NoticeStatus = "공고중" | "접수중" | "접수마감" | "정정공고중";
export type Sector = "공공임대" | "민간임대";
export type NoticeSort = "posted" | "deadline";
/** 마감 임박 필터. "7d" = 오늘부터 7일 안에 접수 마감 */
export type NoticeClosing = "7d";

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
  /** 상세 위치 지도용. SH 목록엔 없다(null) */
  address: string | null;
};

export type Notice = NoticeListItem & {
  source_key: string | null;
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

/** 공고가 공급하는 단지 (notice_complex, SH 첨부 공고문 표). 좌표 없음 — S6 이후 */
export type NoticeComplex = {
  id: number;
  name: string;
  sido: string;
  sigungu: string;
  road_address: string;
  is_new: boolean;
  /** 아래는 매입임대 별첨 주택목록(호실 단위)에서만 채워진다. 장기전세 위치 표는 NULL */
  unit_count: number | null;
  min_deposit: number | null;
  min_rent: number | null;
  area_min: number | null;
  area_max: number | null;
};

export type NoticeFilters = { sido?: string; type?: string; sector?: Sector; sort?: NoticeSort; closing?: NoticeClosing };

/** 홈 KPI 스트립. 전부 서비스 전체 집계(필터 무관) */
export type HomeStats = { total: number; seoul: number; closing7: number; medianRent: number | null };

export type NoticePage = { items: NoticeListItem[]; nextCursor: string | null; total: number };

export type FilterOption = { value: string; count: number };
