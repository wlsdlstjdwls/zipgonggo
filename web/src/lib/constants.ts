// 화면·SEO·페이징에서 반복되는 값의 단일 원천. 숫자를 바꿀 땐 여기만.

export const SITE_NAME = "집공고";
export const SITE_TITLE = `${SITE_NAME} — 공공임대 모집공고 지도`;
export const SITE_DESCRIPTION = "LH·SH·지방공사 공공임대 입주자모집공고를 지역·단지 단위로 모아 보증금·임대료·마감일을 한눈에.";

// 홈 히어로 — page.tsx와 loading.tsx가 같은 문구를 그린다(스트리밍 폴백이 본문과 어긋나면 안 됨)
export const HERO_TITLE = "임대주택 모집공고 지도";
export const HERO_LEAD = "LH·SH·지방공사 공고를 한곳에. 최신 공고순, 보증금·월임대료는 공고에 적힌 최소값입니다.";
export const HERO_STAT_LABELS = ["전체", "서울 SH", "민간임대"] as const;

// ISR·unstable_cache 갱신 주기. 파이프라인이 DB를 갱신해도 이 시간 안엔 반영된다
export const REVALIDATE_SEC = 3600;
export const CACHE_TAG_NOTICE = "notice";
// /api/notices 응답 캐시. s-maxage는 REVALIDATE_SEC와 맞춘다
export const API_CACHE_CONTROL = `public, s-maxage=${REVALIDATE_SEC}, stale-while-revalidate=600`;

// 목록 페이징
export const PAGE_SIZE = 24;
// 무한스크롤 sentinel이 뷰포트 아래 이만큼 접근하면 다음 페이지 요청 (smokespot admin/spots 패턴)
export const FEED_ROOT_MARGIN = "320px 0px";
// 추가 로드된 카드의 순차 페이드 지연(초). 한 배치(PAGE_SIZE) 안에서만 순환한다
export const FEED_FADE_STEP_SEC = 0.03;

// 스켈레톤 카드 수. 격번으로만 shimmer (fitin-app common_skeleton 원칙)
export const SKELETON_CARD_COUNT = 6;
export const SKELETON_DELAY_STEP_SEC = 0.12;

// D-day 배지 임계값(일). 마감 3일 이내 urgent, 7일 이내 soon
export const DDAY_URGENT_DAYS = 3;
export const DDAY_SOON_DAYS = 7;

// 시도 통계 칩에 쓰는 SH 지역
export const SH_SIDO = "서울특별시";

// 네이버 Web Dynamic Map SDK. 좌표가 없어 geocoder 서브모듈로 브라우저 실시간 변환(저장 안 함 — CLAUDE.md 하지 말 것 1)
export const NAVER_MAP_CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ?? "";
export const NAVER_MAP_SDK_URL = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_MAP_CLIENT_ID}&submodules=geocoder`;
export const NAVER_MAP_GEOCODER_TIMEOUT_MS = 8000;
export const NAVER_MAP_DEFAULT_ZOOM = 16;

// 사이트맵. url-structure.md: 진행중 0.9 / 마감 0.3, 파일당 40,000 URL 상한
export const SITEMAP_PRIORITY_OPEN = 0.9;
export const SITEMAP_PRIORITY_CLOSED = 0.3;
export const SITEMAP_MAX_URLS = 40_000;
