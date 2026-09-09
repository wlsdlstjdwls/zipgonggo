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
  /** 기관 원본 목록에서의 순번(1이 맨 위). 같은 공고일 안 정렬·커서에 쓴다 */
  source_rank: number | null;
};

export type Notice = NoticeListItem & {
  source_key: string | null;
  /** 공고 내 최대 보증금·월임대료(원). SH 첨부 공급현황 표(0009). API 공고는 NULL */
  max_deposit: number | null;
  max_rent: number | null;
  /** 접수 일정 출처. 'attachment'면 SH 첨부 공고문에서 읽은 값 */
  schedule_source: string | null;
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

/** 공급현황 표 한 줄 (notice_supply). 단지 × 공급유형 × 공급대상 × 소득옵션 */
export type NoticeSupply = {
  id: number;
  complex_name: string;
  supply_type: string;
  accessible: boolean;
  tenant_class: string;
  income_option: string | null;
  is_new: boolean;
  units_total: number | null;
  units_priority: number | null;
  units_general: number | null;
  units_reserve: number | null;
  deposit: number | null;
  down_payment: number | null;
  balance: number | null;
  rent: number | null;
  area_exclusive: number | null;
  area_common: number | null;
  area_etc: number | null;
  area_total: number | null;
  move_in_from: string | null;
  source_page: number | null;
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
  /** 공고문 안에서만 유일한 단지 코드(0001J). 단지 상세 URL의 뒷자리 */
  complex_code: string | null;
  /** 첨부 공고문 쪽번호. 출처 표기용 */
  source_page: number | null;
  /** 난방방식(개별난방·지역난방). SH 「단지별 주소」 표에만 있다 */
  heating: string | null;
  /** 아래는 매입임대 별첨 주택목록(호실 단위)에서만 채워진다. 장기전세 위치 표는 NULL */
  unit_count: number | null;
  min_deposit: number | null;
  min_rent: number | null;
  area_min: number | null;
  area_max: number | null;
};

// closed: 마감 공고 포함 여부. 기본(undefined)은 감춘다 — 백필로 2004년치까지 들어와 목록이 마감으로 덮인다(사용자 요청 2026-09-09)
export type NoticeFilters = { sido?: string; type?: string; sector?: Sector; sort?: NoticeSort; closing?: NoticeClosing; closed?: boolean };

/** 홈 KPI 스트립. 전부 서비스 전체 집계(필터 무관) */
export type HomeStats = { total: number; seoul: number; closing7: number; medianRent: number | null };

export type NoticePage = { items: NoticeListItem[]; nextCursor: string | null; total: number };

export type FilterOption = { value: string; count: number };
