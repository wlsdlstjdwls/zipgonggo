// notice 테이블 행 타입. 컬럼명은 db/schema.sql 그대로 — web과 pipeline은 스키마로만 통신한다.

export type NoticeStatus = "공고중" | "접수중" | "접수마감" | "정정공고중";
export type Sector = "공공임대" | "민간임대";
export type NoticeSort = "posted" | "deadline" | "rent";
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
  /** 이 공고의 정본 id. null이면 자기 자신이 정본이다(S2가 채운다) */
  canonical_id?: number | null;
  /** 정본의 slug. canonical_id가 있을 때만 온다 */
  canonical_slug?: string | null;
  source_url: string;
  /** 상세 위치 지도용. SH 목록엔 없다(null) */
  address: string | null;
  /** 기관 원본 목록에서의 순번(1이 맨 위). 같은 공고일 안 정렬·커서에 쓴다 */
  source_rank: number | null;
  /** 이 공고의 단지 중 한 곳이라도 실물 사진(전경·실내·투시도)을 가지고 있나(0023·0026).
   * 목록에서 「사진」 배지를 다는 근거다 — 사진이 있는 장은 열어 볼 값이 다르다(사용자 요청 2026-09-21).
   * 도면(평면도·층별 도면·배치도)만 있는 단지는 false — 배지가 사진을 약속하면 사진이어야 한다 */
  has_photo?: boolean;
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
  /** S5가 PNU와 공급유형으로 좁힌 마이홈 단지 코드(0032). 후보가 둘 이상이면 null — 남의 단지를 싣지 않는다 */
  complex_code: string | null;
  heating: string | null;
  total_household: number | null;
  min_down_payment: number | null;
  min_interim: number | null;
  min_balance: number | null;
  portal_url: string | null;
  contact: string | null;
  updated_at: string;
};

/** 보증금 비율 옵션 하나 (notice_supply.deposit_options, 0025). 민간임대 공고문의 「보증금 30% | 50% | 70%」 열.
 *  ratio가 없는 고정액 옵션(「9000만원」)은 label로만 구분한다. 금액은 원 */
export type DepositOption = { label: string; ratio: number | null; deposit: number | null; rent: number | null };

/** 공급현황 표 한 줄 (notice_supply). 단지 × 공급유형 × 공급대상 × 소득옵션.
 *  민간임대(youth_attach)는 income_option에 특별공급/일반공급, supply_type에 타입 코드(「26A-1」)가 든다 */
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
  /** 보증금 비율별 옵션. deposit·rent는 이 중 보증금이 가장 낮은 것. SH 공고는 null */
  deposit_options: DepositOption[] | null;
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

/** 공고가 공급하는 단지 (notice_complex, SH 첨부 공고문 표). 좌표는 S6 오프라인 조인 결과(geom) */
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
  /** SH주택정보 단지코드(0023). 사진·도면을 이걸로 찾는다. 신규 미준공 단지는 등록 전이라 NULL */
  sh_bizns_cd: string | null;
  /** 청년안심주택 포털 단지코드(0026). 민간임대 단지의 사진·평면도를 이걸로 찾는다.
   * 포털에서 내려간 옛 단지는 NULL — 공고는 살아 있어도 단지 자료는 사라진다 */
  youth_home_code: string | null;
  /** 좌표(WGS84). 행안부 요약DB 오프라인 조인이 못 맞춘 단지는 둘 다 NULL — 화면은 「지도 미표시」.
   * 지오코딩 API로 채우지 않는다(CLAUDE.md 하지 말 것 1) */
  lat: number | null;
  lng: number | null;
  /** 아래는 매입임대 별첨 주택목록(호실 단위)에서만 채워진다. 장기전세 위치 표는 NULL */
  unit_count: number | null;
  min_deposit: number | null;
  min_rent: number | null;
  area_min: number | null;
  area_max: number | null;
  /** 실물 사진(SH 전경·실내 | 청년안심 전경·투시도·편의시설)이 있나. 목록 배지의 근거 */
  has_photo?: boolean;
  /** 도면만 있나(평면도·층별 도면·배치도). 사진이 있으면 그쪽이 이긴다 — 배지는 한 칸뿐이다 */
  has_plan?: boolean;
};

/** 청년안심주택 포털 단지 사실(youth_house, 0027). 공고문 첨부에 없는 값만 모은 것 —
 *  특히 **관리비**. 이미지와 같은 키(homeCode)라 공고를 다시 수집해도 안 날아간다 */
export type YouthHouse = {
  home_code: string;
  /** 포털 표기. 역세권 접두사가 붙어 있다(`홍대입구역 맹그로브창천`) */
  name: string;
  /** 월 (예상)관리비 하한·상한(원). 실제 청구액이 아니다 — 화면에 그렇게 적는다 */
  maint_low: number | null;
  maint_high: number | null;
  households: number | null;
  /** 운영사 · 시행사 · 시공사 */
  manager: string | null;
  developer: string | null;
  builder: string | null;
  /** 입주(예정)일 */
  movein: string | null;
  phone: string | null;
  homepage: string | null;
  /** `홍대입구역 2호선, 경의중앙선, 공항철도` */
  subway: string | null;
  /** `총 288 세대 (공공임대 92 세대, 공공지원민간임대 196 세대)` */
  scale: string | null;
  source_url: string;
};

/** 단지 이미지의 출처. 공공임대는 SH주택정보(0023), 민간임대는 청년안심주택 포털(0026) */
export type ImageSource = "sh" | "youth";

/** 단지 이미지 한 장. 공고가 아니라 단지에 붙는다 — 한 단지가 여러 공고에 되풀이 나온다 */
export type ComplexImage = {
  /** 출처. 파일이 놓인 자리가 이 값으로 갈린다 */
  source: ImageSource;
  /** 단지 키. sh는 bizns_cd, youth는 home_code. 파일 경로의 가운데 칸이다 */
  code: string;
  /** 평면도 · 전경 · 배치도 · 실내(SH) | 평면도 · 전경 · 투시도 · 편의시설(청년안심) */
  kind: string;
  /** 주택형(59A·84B…). 단지 전체 이미지와 청년안심 평면도는 빈 문자열 */
  sply_ty: string;
  /** 화면 표기(거실·주방·안방…). 평면도는 대개 비어 있다 */
  label: string | null;
  /** 원본 URL. 출처 표기에 쓴다 */
  source_url: string;
  /** 저장 파일명. 지면은 {출처 기준 경로}/{code}/{file_name}로 읽는다 */
  file_name: string;
};

// closed: 마감 공고 포함 여부. 기본(undefined)은 감춘다 — 백필로 2004년치까지 들어와 목록이 마감으로 덮인다(사용자 요청 2026-09-09)
export type NoticeFilters = {
  sido?: string;
  /** 시군구. sido가 함께 걸려야 뜻이 선다 — 「강서구」는 서울과 부산에 둘 다 있다 */
  sigungu?: string;
  type?: string;
  sector?: Sector;
  /** 공급기관 원문(notice.agency): SH · LH · 서울시 · 지방 개발공사. 목록에서 SH만, LH만 보려는 요청(2026-09-21) */
  agency?: string;
  sort?: NoticeSort;
  closing?: NoticeClosing;
  closed?: boolean;
  /** 보증금 상한(원). 이 값 이하인 공고만. 금액을 못 읽은 공고(min_deposit IS NULL)는 빠진다 */
  maxDeposit?: number;
  /** 월임대료 상한(원). 전세형(min_rent = 0)은 언제나 통과한다 */
  maxRent?: number;
};

/** 예산 칩의 눈금(원). 목록·시트가 같은 값을 쓴다. 0은 「제한 없음」이 아니라 「전세형만」이라 넣지 않는다 */
export const DEPOSIT_STEPS: readonly number[] = [10_000_000, 30_000_000, 50_000_000, 100_000_000, 200_000_000];
export const RENT_STEPS: readonly number[] = [100_000, 200_000, 300_000, 500_000, 800_000];

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
export type Facets = { sector: FilterOption[]; agency: FilterOption[]; sido: FilterOption[]; type: FilterOption[]; closing7: number; total: number };

/** 과거 결과 표 한 줄(notice_result, 0014). 단지 × 공급유형 × 계층 × 구분(우선·일반·n순위·소계). 산술이 맞은(reconciled) 줄만 온다 */
export type PriorResultRow = {
  complex_name: string;
  supply_type: string;
  tenant_class: string;
  bracket: string;
  units: number | null;
  applicants: number | null;
  ratio: number | null;
};

/** 「내 조건에 맞는 단지」가 쓰는 직전 같은 계열 공고의 경쟁률. 없으면 null(결과 글이 아직 없거나 표 양식을 못 읽은 계열) */
export type PriorCompetition = {
  notice: { id: number; slug: string; title: string; posted_at: string };
  /** 이 공고 단지와 이름이 맞는 줄만. 단지 이름은 공백·괄호·구두점을 걷어 견준다 */
  rows: PriorResultRow[];
  /** 그 공고 전체 — 소계 줄 합산. 단지가 안 겹쳐도 「지난 회차는 평균 n:1」은 말할 수 있다 */
  summary: { complexes: number; units: number; applicants: number; ratio: number | null };
};

/** 마이홈 단지정보(15110581)로 채운 단지 원장 한 행 + 그 단지의 형·대기 줄(S5, 0031·0032).
 *  공고문 첨부를 못 여는 LH 공고(robots.txt가 첨부 경로를 막는다)에 실을 수 있는 유일한 단지 사실이다. */
export type ComplexFacts = {
  complex_code: string;
  name: string;
  agency: string;
  road_address: string | null;
  /** 준공일. 없는 단지가 있다(매입임대·신축) */
  completed_on: string | null;
  household_cnt: number | null;
  /** 주차 대수. 0은 「없음」이 아니라 「안 들어옴」이라 파이프라인이 NULL로 넣는다 */
  parking_cnt: number | null;
  /** 복도식 · 계단식 · 혼합식 */
  building_style: string | null;
  /** 전체동 설치 · 일부동 설치 · 미설치. boolean으로 접지 않는다 */
  elevator: string | null;
  heating: string | null;
  types: ComplexTypeRow[];
  waitlist: WaitRow[];
  /** 대기현황을 받아 온 날. API에 기준일 필드가 없어 수집일이다 */
  surveyed_on: string | null;
};

/** 단지 안의 면적 타입 한 줄. 면적이 범위인 건 같은 형이 동마다 조금씩 다르기 때문이다 */
export type ComplexTypeRow = {
  style_name: string;
  exclusive_area: number | null;
  exclusive_area_max: number | null;
  common_area: number | null;
  common_area_max: number | null;
  /** 단지의 기본 보증금·월임대료. 이번 공고의 금액이 아니라 제도상 기본값이다 */
  base_deposit: number | null;
  base_rent: number | null;
  conversion_deposit_limit: number | null;
};

/** 형별 예비 입주 대기. waiting_cnt는 대기 순번이 아니라 **기다리는 사람 수**다 */
export type WaitRow = {
  style_name: string;
  draw_unit: string;
  waiting_cnt: number | null;
  vacated_cnt: number | null;
};

/* ── 검색 (0033) ─────────────────────────────────────────
   자유 입력 한 칸이 세 갈래를 한꺼번에 받는다 — 이미 발행해 둔 착지 지면(바로 가기), 공고, 단지. */

/** 착지 지면으로 바로 보내는 줄. 지역·유형·지역×유형이 같은 모양으로 온다 */
export type SearchShortcut = {
  /** 목록 key 겸 중복 제거용. "sido:서울특별시" · "type:장기전세" · "pair:시도|시군구|유형" */
  key: string;
  label: string;
  /** 어떤 갈래인지 한 마디 — 「지역 전체」 「유형 안내」 「지역과 유형」 */
  sub: string;
  href: string;
  count: number;
};

/** 검색에 걸린 단지 한 곳. 같은 이름이 여러 공고에 나오면 가장 최근 공고 하나로 접는다 */
export type SearchComplexHit = {
  id: number;
  name: string;
  complex_code: string | null;
  sido: string;
  sigungu: string;
  road_address: string;
  notice_slug: string;
  notice_title: string;
  posted_at: string;
  closed: boolean;
};

/** 검색에 걸린 공고. 목록 행에 쓰는 값 그대로에 마감 여부만 붙는다 —
 *  화면이 진행 중과 마감을 두 덩이로 갈라 싣는다(마감분은 「마감된 공고 보기」 안에). */
export type SearchNoticeHit = NoticeListItem & { closed: boolean };

export type SearchResult = {
  /** 사용자가 친 말 그대로. 지면 제목과 입력칸 되채우기에 쓴다 */
  q: string;
  shortcuts: SearchShortcut[];
  notices: SearchNoticeHit[];
  complexes: SearchComplexHit[];
};
