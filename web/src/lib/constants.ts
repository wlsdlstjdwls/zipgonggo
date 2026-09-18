// 화면·SEO·페이징에서 반복되는 값의 단일 원천. 숫자를 바꿀 땐 여기만.

export const SITE_NAME = "집공고";
export const SITE_TITLE = `${SITE_NAME} — 공공임대 모집공고 지도`;
// 문의·권리침해 신고 접수 주소. 이용약관·개인정보처리방침·푸터가 함께 쓴다.
// 실제 수신되는 주소로 열고 여기만 바꾸면 전체에 반영된다.
export const CONTACT_EMAIL = "wlsdlstjdwls12@gmail.com";
export const SITE_DESCRIPTION = "LH, SH, 지방공사 공공임대 입주자모집공고를 지역별 단지별로 모아 보증금과 임대료, 마감일을 한눈에.";

// 저장(★) 목록 localStorage 키. 서버 저장 없음 — 사용자 식별이 생기면 옮긴다
export const SAVED_STORAGE_KEY = "zipgonggo.saved.v1";
// 「내 조건에 맞는 단지」 입력값 localStorage 키. 공고를 오가도 내 조건은 그대로다(사용자 요청 2026-09-14) —
// 공고마다 다른 항목(공급 구분·면적·계층·신청유형)은 읽을 때 그 공고에 있는 값인지 확인해 없으면 기본값으로 돌린다
export const FIT_STORAGE_KEY = "zipgonggo.fit.v1";
// 민간임대(청년안심주택) 공고의 「내 조건」 입력값. 묻는 항목이 공공 공고와 달라 키를 따로 둔다
export const FIT_MINGAN_STORAGE_KEY = "zipgonggo.fit-mingan.v1";
export const TOAST_MS = 2100;
// 저장 목록(/my)이 한 번에 불러오는 공고 수 상한. localStorage가 아무리 불어나도 질의는 여기서 끊는다 —
// 브라우저가 보내는 id 배열을 그대로 믿고 IN 절에 꽂으면 URL 길이와 질의 시간이 남의 손에 달린다
export const SAVED_MAX_IDS = 200;

// 방문 집계용 난수 식별자(localStorage). **브라우저가 만든다** — 서버가 심는 쿠키가 아니라
// 사이트 데이터를 지우면 다음 방문은 남남이 된다(개인정보처리방침 2항).
export const VISITOR_STORAGE_KEY = "zipgonggo.visitor.v1";
// 이 표식이 "1"인 브라우저는 집계에서 뺀다. 관리자 콘솔에 처음 들어오면 켜진다 —
// 운영자가 제 사이트를 돌아다닌 것까지 세면 초기 숫자가 통째로 거짓이 된다.
// **값이 없을 때만 콘솔이 "1"을 심는다.** 운영자가 방문 화면에서 끄면 "0"이 들어가고,
// 그 뒤로는 콘솔을 몇 번 더 열어도 다시 안 켜진다 — 안 그러면 끄는 버튼이 한 번도 안 먹는다
export const VISIT_OPT_OUT_KEY = "zipgonggo.notrack.v1";

// ISR·unstable_cache 갱신 주기. 파이프라인이 DB를 갱신해도 이 시간 안엔 반영된다
export const REVALIDATE_SEC = 3600;
export const CACHE_TAG_NOTICE = "notice";
// getEligibilityRules 전용 — 이전엔 태그가 없어 revalidateTag로 못 지웠다(2026-09-09, /api/revalidate 추가하며 같이 붙임)
export const CACHE_TAG_ELIGIBILITY = "eligibility";
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

// 목록 상태(부문·시도·유형·마감·정렬) 기억 localStorage 키. 서버 렌더(ISR)엔 절대 반영하지 않는다 —
// "/"의 캐시 한 장을 크롤러·공유 링크 수신자를 포함해 모두가 공유한다(6차 설계).
export const SCOPE_STORAGE_KEY = "zipgonggo.scope.v1";

/** 하이드레이션 전에 <html>에 data-booting을 거는 한 줄짜리 스크립트(layout.tsx의 <head>).
 *  저장된 필터가 있는 재방문에서 서버가 그린 무필터 목록이 잠깐 보였다 갈리는 걸 막는다(사용자 지적 2026-09-09).
 *  표식은 NoticeExplorer가 첫 조회를 마치면 뗀다. 여기 3초 안전장치가 있어 조회가 실패해도 화면이 잠기지 않는다. */
export const BOOT_SCOPE_JS = `try{
var p=location.pathname;
if(p==="/"||p.indexOf("/area/")===0){
  var s=JSON.parse(localStorage.getItem(${JSON.stringify(SCOPE_STORAGE_KEY)})||"{}");
  if(s&&(s.sector||s.sido||s.type||s.closing||s.sort||s.closed)){
    document.documentElement.setAttribute("data-booting","");
    setTimeout(function(){document.documentElement.removeAttribute("data-booting")},3000);
  }
}}catch(e){}`;
// 목록 보기 모드(카드/목록/간략). 조회 조건과 섞이지 않게 키를 따로 둔다
export const VIEW_STORAGE_KEY = "zipgonggo.view.v1";
// /area/{시도} 발행 최소 공고 수 — 얇은 페이지 방지 규칙(CLAUDE.md 4: 지역은 3건 이상)
export const AREA_MIN_COUNT = 3;

// 네이버 Web Dynamic Map SDK. 좌표가 없어 geocoder 서브모듈로 브라우저 실시간 변환(저장 안 함 — CLAUDE.md 하지 말 것 1)
export const NAVER_MAP_CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ?? "";
export const NAVER_MAP_SDK_URL = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NAVER_MAP_CLIENT_ID}&submodules=geocoder,panorama`;
export const NAVER_MAP_GEOCODER_TIMEOUT_MS = 8000;
// 공고 상세 「위치」 지도의 기본 줌 — 한 단계 더 확대했다(2026-09-09).
export const NAVER_MAP_DEFAULT_ZOOM = 18;
// 단지 상세는 이전 배율 그대로 — 공고 상세만 확대해 달라는 요청이라 되돌렸다(2026-09-09)
export const NAVER_MAP_COMPLEX_ZOOM = 16;

// 사이트맵. url-structure.md: 진행중 0.9 / 마감 0.3, 파일당 40,000 URL 상한
export const SITEMAP_PRIORITY_OPEN = 0.9;
export const SITEMAP_PRIORITY_CLOSED = 0.3;
export const SITEMAP_MAX_URLS = 40_000;

// RSS 피드(/rss.xml)에 싣는 글 수. 진행 중 공고 최신순만 — 마감분은 사이트맵이 맡는다.
// 네이버 서치어드바이저는 RSS를 「최근 것」으로 읽어 신규 수집을 앞당긴다. 길게 실으면 그 신호가 흐려진다
export const RSS_MAX_ITEMS = 50;

// 검색엔진 사이트 소유확인 코드. 구글 서치콘솔·네이버 서치어드바이저가 발급하는 문자열을
// <meta>로 심어야 사이트맵 제출 화면이 열린다.
//
// **값을 여기 그대로 적어 둔다 — 비밀이 아니다.** 어차피 모든 페이지 HTML에 평문으로 나가는 값이고,
// env로만 두면 재배포 환경이 바뀔 때 조용히 빠져 소유확인이 풀린다(그러면 색인 요청도 같이 막힌다).
// env가 있으면 env가 이긴다 — 속성을 새로 파거나 도메인을 옮길 때 배포만으로 갈아끼우는 길을 남겨 둔다.
// 둘 다 비면 <meta> 자체를 안 그린다(빈 content는 「태그는 있는데 값이 다르다」로 확인이 실패한다).
const GOOGLE_SITE_VERIFICATION_DEFAULT = "4YwNAZM8ctR9A74l-us2VDNj3-WGmoL7tz0bjQcj16Y";
const NAVER_SITE_VERIFICATION_DEFAULT = "9caffcdfcc6a4c64e9b80c272295345edcf2d871";
export const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION || GOOGLE_SITE_VERIFICATION_DEFAULT;
export const NAVER_SITE_VERIFICATION = process.env.NAVER_SITE_VERIFICATION || NAVER_SITE_VERIFICATION_DEFAULT;
