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

/** notice.schedule_steps 한 칸. end가 null이면 하루짜리 단계.
 * *_time은 공고문에 시각이 적혀 있을 때만 "HH:MM"으로 온다 — 없으면 날짜만 보여 준다 */
export type ScheduleStep = { label: string; start: string; end: string | null; start_time?: string | null; end_time?: string | null };

export type Notice = NoticeListItem & {
  source_key: string | null;
  /** 공고 내 최대 보증금·월임대료(원). SH 첨부 공급현황 표(0009). API 공고는 NULL */
  max_deposit: number | null;
  max_rent: number | null;
  /** 접수 일정 출처. 'attachment'면 SH 첨부 공고문에서 읽은 값 */
  schedule_source: string | null;
  /** 접수 시작·마감 시각("10:00"). 흐름도에 시각이 있는 공고에만 있다(사용자 지적 2026-09-09) */
  apply_start_tm: string | null;
  apply_end_tm: string | null;
  /** 흐름도의 접수·발표 외 단계(서류심사 대상자 발표, 서류 제출, 계약 체결). 순서대로 온다(0017) */
  schedule_steps: ScheduleStep[] | null;
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

/** 공고 안의 호실 한 칸 (unit). SH 매입임대 「[별첨1] 주택목록」에서만 나온다(0021).
 *  동·호가 여기 있어야 단지 상세에서 동호수별로 갈라 볼 수 있다(사용자 요청 2026-09-09) */
export type NoticeUnit = {
  id: number;
  unit_key: string;
  /** 동. 표에 없는 다세대주택은 null */
  building: string | null;
  /** 호실의 도로명주소(시군구부터). 동 표기가 없는 단지에서 건물을 가르는 유일한 값이다 */
  road_address: string | null;
  /** 호 "0203" */
  room: string;
  floor: number | null;
  area_m2: number | null;
  /** 구조: 개방형원룸 · 분리형원룸 · 투룸 · 쓰리룸 */
  room_layout: string | null;
  /** 승강기 원문 표기: 전체동 설치 · 일부 설치 · 설치 · 미설치 */
  elevator: string | null;
  deposit: number | null;
  rent: number | null;
  /** 전세전환(보증금 최대) */
  deposit_jeonse: number | null;
  rent_jeonse: number | null;
  /** 월세전환(보증금 최소) */
  deposit_wolse: number | null;
  rent_wolse: number | null;
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
  /** 이 단지 공급현황에 적힌 공급대상(청년·신혼부부·고령자…). 없으면 빈 배열 — 탐색기 필터가 쓴다 */
  tenant_classes: string[];
  /** 아래는 매입임대 별첨 주택목록(호실 단위)에서만 채워진다. 장기전세 위치 표는 NULL */
  unit_count: number | null;
  min_deposit: number | null;
  min_rent: number | null;
  area_min: number | null;
  area_max: number | null;
};

// closed: 마감 공고 포함 여부. 기본(undefined)은 감춘다 — 백필로 2004년치까지 들어와 목록이 마감으로 덮인다(사용자 요청 2026-09-09)
export type NoticeFilters = { sido?: string; type?: string; sector?: Sector; sort?: NoticeSort; closing?: NoticeClosing; closed?: boolean };

/** 목록 보기 모드. 필터가 아니라 화면 취향이라 조회 조건에 섞지 않는다(사용자 요청 2026-09-09) */
export type NoticeView = "card" | "list" | "compact";
export const NOTICE_VIEWS: readonly NoticeView[] = ["card", "list", "compact"];
export function isNoticeView(v: unknown): v is NoticeView {
  return typeof v === "string" && (NOTICE_VIEWS as readonly string[]).includes(v);
}

export type NoticePage = { items: NoticeListItem[]; nextCursor: string | null; total: number };

export type FilterOption = { value: string; count: number };

/** 스코프 바·필터 바의 수량. 지금 걸린 다른 필터를 반영해 센다(자기 축은 빼고) — 지역을 바꾸면 유형 수량도 따라 바뀐다.
 * total은 부문 칩 「전체」의 수, closing7은 「마감 7일 내」 칩의 수다. */
export type Facets = { sector: FilterOption[]; sido: FilterOption[]; type: FilterOption[]; closing7: number; total: number };
