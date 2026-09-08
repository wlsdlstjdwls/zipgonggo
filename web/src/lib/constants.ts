// 화면·SEO·페이징에서 반복되는 값의 단일 원천. 숫자를 바꿀 땐 여기만.

export const SITE_NAME = "집공고";
export const SITE_TITLE = `${SITE_NAME} — 공공임대 모집공고 지도`;
export const SITE_DESCRIPTION = "LH, SH, 지방공사 공공임대 입주자모집공고를 지역별 단지별로 모아 보증금과 임대료, 마감일을 한눈에.";

// 홈 KPI 스트립 라벨 — page.tsx와 loading.tsx가 같은 순서로 그린다(스트리밍 폴백이 본문과 어긋나면 안 됨)
export const KPI_LABELS = ["전체 공고", "서울", "7일 내 마감", "중위 월임대료"] as const;
// 목록 뷰(?view=list) 히어로
export const LIST_HERO_TITLE = "수백 페이지 표를 호실 단위로.";
export const LIST_HERO_LEAD = "LH, SH, 지방공사 공고를 한곳에 모읍니다. 보증금과 월임대료는 공고에 적힌 최소값입니다.";
// KPI 카운트업 길이(ms). 경과 시간 기준 보간, 끝에서 실제 값으로 스냅
export const KPI_COUNT_MS = 800;
// 저장(★) 목록 localStorage 키. 서버 저장 없음 — 사용자 식별이 생기면 옮긴다
export const SAVED_STORAGE_KEY = "zipgonggo.saved.v1";
export const TOAST_MS = 2100;

// ISR·unstable_cache 갱신 주기. 파이프라인이 DB를 갱신해도 이 시간 안엔 반영된다
export const REVALIDATE_SEC = 3600;
export const CACHE_TAG_NOTICE = "notice";
// /api/notices 응답 캐시. s-maxage는 REVALIDATE_SEC와 맞춘다
export const API_CACHE_CONTROL = `public, s-maxage=${REVALIDATE_SEC}, stale-while-revalidate=600`;

// 목록 페이징
export const PAGE_SIZE = 24;
// 무한스크롤 sentinel이 뷰포트 아래 이만큼 접근하면 다음 페이지 요청 (smokespot admin/spots 패턴)
export const FEED_ROOT_MARGIN = "320px 0px";
// 행 등장 스태거(ms). 한 배치(PAGE_SIZE) 안에서만 순환한다
export const ROW_STAGGER_MS = 40;

// 스켈레톤 행 수 (design/README.md: 목록 골격 3행)
export const SKELETON_ROW_COUNT = 3;

// D-day 칩 임계값(일). 마감 4일 이내 hot, 7일 이내 warn (design/README.md 확정값)
export const DDAY_URGENT_DAYS = 4;
export const DDAY_SOON_DAYS = 7;

// 시도 통계 칩에 쓰는 SH 지역
export const SH_SIDO = "서울특별시";

// 스코프(부문+시도) 세션 기억 localStorage 키. 서버 렌더(ISR)엔 절대 반영하지 않는다 —
// "/"의 캐시 한 장을 크롤러·공유 링크 수신자를 포함해 모두가 공유한다(6차 설계).
export const SCOPE_STORAGE_KEY = "zipgonggo.scope.v1";
// 스코프 바의 기본 선택 "표시"용(강제 이동 아님). SH 데이터가 압도적이라 서울을 기본 후보로 보여준다.
export const DEFAULT_SCOPE_SIDO = SH_SIDO;
// /area/{시도} 발행 최소 공고 수 — 얇은 페이지 방지 규칙(CLAUDE.md 4: 지역은 3건 이상)
export const AREA_MIN_COUNT = 3;

// 네이버 Web Dynamic Map SDK. 좌표가 없어 geocoder 서브모듈로 브라우저 실시간 변환(저장 안 함 — CLAUDE.md 하지 말 것 1)
export const NAVER_MAP_CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ?? "";
export const NAVER_MAP_SDK_URL = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_MAP_CLIENT_ID}&submodules=geocoder,panorama`;
export const NAVER_MAP_GEOCODER_TIMEOUT_MS = 8000;
export const NAVER_MAP_DEFAULT_ZOOM = 16;

// 사이트맵. url-structure.md: 진행중 0.9 / 마감 0.3, 파일당 40,000 URL 상한
export const SITEMAP_PRIORITY_OPEN = 0.9;
export const SITEMAP_PRIORITY_CLOSED = 0.3;
export const SITEMAP_MAX_URLS = 40_000;
