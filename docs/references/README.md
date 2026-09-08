# 참고 화면

벤치마크(아영이네 행복주택, ayounghome.com) 스크린샷. **데이터를 가져오지 않는다** — 화면 구성만 참고한다.

| 파일 | 화면 | 날짜 |
|---|---|---|
| `공고지도1.png` | 홈. "2026년 공공임대 공고지도" 카드 그리드 | 2026-09-08 |
| `공고지도2.png` | 공고 1건의 지도 페이지. 좌측 필터+호실 목록, 우측 전체 마커 | 2026-09-08 |
| `공고지도3.png` `3_2.png` | 호실 상세 (매입임대 다세대). 호실 드롭다운, 제원, 금액 3행 표, 사진, 로드뷰, 첨부 링크 | 2026-09-08 |
| `공고지도3_3.png` | 단지 상세 (장기전세 아파트). 보증금, 우선/일반 배분, 공용·전용면적, 입주시작일, 조감도 | 2026-09-08 |
| `공고지도3_4.png` | 단지 상세의 형별 탭(43/49 예비입주자), 예비자모집호수, 평면도 | 2026-09-08 |

## 홈 (공고지도1)

**가져올 것**
- 카드 그리드. 카드 상단에 지역 배지(`서울`) + 큰 헤드라인(`20년 전세 1,381호` `강남 월 4만원`). 숫자가 먼저 보인다
- 칩 3개: 기관(`SH`) · 유형(`장기전세주택1`) · 공고일(`26년 08월 31일 공고분`)
  → 2026-09-08 카드 정보 축소: 지역 배지 · D-day · 헤드라인(금액) · 제목 · 칩 3개 · 버튼 2개만 남김. 별도 금액 2열·공공/민간 칩·발표일은 뺐다(탭·상세가 담당)
- 카드 하단 버튼 2개. 우리는 `상세` + `원문 ↗`
- 상단에 총 건수(`5769건`) — 규모를 바로 보여준다

**안 가져올 것**
- 유튜브 썸네일·유튜브 버튼 — 우리에겐 영상이 없다. 사진 대신 데이터 밀도로 간다(roadmap 리스크)
- 카카오톡 채널 배너, 대출 계산기 플로팅 버튼 — 「하지 말 것 3」 대출 유도 금지
- "아영이네가 선별한" 식 큐레이션 문구 — 우리는 전량 자동

**우리가 더 넣을 것**
- 공공임대 / 민간임대 탭 (사용자 요구)
- D-day 배지, 최소 보증금·월임대료 (벤치마크는 카드에 금액이 헤드라인 문구로만 있다)

## 공고 지도 페이지 (공고지도2)

**이게 Phase 2의 목표 화면이다.** 호실 단위 데이터가 있어야 성립한다.
- 좌측: 시도·자치구·전용면적·보증금 필터 + 검색 + `476 / 476개` 카운트 + 호실 목록(`주소 (동, 건물명) 호수`)
- 우측: 호실 전체 마커 지도. 클러스터 없이 개별 핀
- 상단: 공고 유형 breadcrumb(`2026년 공고지도 › SH › 장기미임대매입임대주택`)

**지금 상태와의 거리**
- 우리 공고 상세는 주소 1개(아파트형) 또는 시군구별 공급호수 표(매입임대). 호실 목록·마커 다중 표시는 S3·S4 첨부 파싱 뒤에
- 마커 좌표는 벤치마크가 어떻게 얻는지 알 수 없다. 우리는 행안부 요약DB 오프라인 조인(하지 말 것 1)

## 호실 상세 (공고지도3 · 3_2) — Phase 2 `/notice/{공고}/{호실}`

**가져올 것** — 우리 `unit` 테이블과 거의 1:1이다

| 벤치마크 항목 | 우리 컬럼 | 비고 |
|---|---|---|
| 호실 드롭다운 `A동 1204호` | `unit.building` `room` | 같은 공고 안 호실 간 이동 |
| 주소 · 단지명 · 동 · 호 | `road_address` `complex_name` `building` `room` | |
| 전용면적 37.14㎡ | `area_m2` | |
| 승강기유무 `전체동 설치` | `has_elevator` | 텍스트 → boolean |
| 지하철역 `장한평역 5호선, 632m, 10분` | `subway_station` `subway_walk_min` | **거리(m) 컬럼 없음** → 추가 검토 |
| 비고 `투룸` | `room_layout` `note` | |
| 금액 표 3행: 전세전환80% / 기본 / 월세전환60% | `deposit_jeonse`·`rent_jeonse` / `deposit`·`rent` / `deposit_wolse`·`rent_wolse` | 표 형태 그대로 |
| 첨부 PDF 링크(공고문·별첨) | `raw_snapshot` 메타 + **기관 링크만** | 파일 재배포 금지 |
| 로드뷰 | 네이버 지도 파노라마 | 좌표 확보 후 |
| 안내 문구 "참고용, 공식 공고문 확인" | 출처 배지 | url-structure 출처 배지 4종 |

**안 가져올 것**: 실내 사진·평면도 갤러리(자산 없음), "대출 고민되세요?" 버튼(하지 말 것 3).

## 단지 상세 (공고지도3_3 · 3_4) — `/complex/{단지}`

- 형별 탭(`43 예비입주자` / `49 예비입주자`) = 우리 `complex_type.style_name` 탭. 탭마다 보증금·공급호수·면적
- **스키마에 없는 항목**: 우선/일반 배분 호수, 예비자모집호수, 입주시작일, 공용면적(unit). Phase 2 파서가 실제로 뽑을 수 있을 때 컬럼 추가 (`docs/schema.md`에 후보로 기록)
- 조감도 갤러리는 자산 없음. 지도·대기현황(`waitlist`)으로 대체

## SH가 벤치마크의 주력이다

스크린샷의 카드 전부 SH. 마이홈포털 API에는 SH·GH가 없으므로(data-sources.md) **서울주거포털 스크래퍼가 다음 우선순위**다.

## 디자인 토큰 출처 (2026-09-08)

사용자 프로젝트 3개(fitin-app · fitin-bo · smokespot)를 대조해 `web/src/app/globals.css`를 정했다.

| 가져온 것 | 출처 |
|---|---|
| 라일락 팔레트·텍스트 대비값(`#6E698A` `#645F80`은 AA 통과값, 밝게 바꾸지 말 것) | smokespot `design/README.md`, `globals.css` |
| 카드 18px · 버튼 14px · 칩 pill · 히어로 밴드 28px · 브레이크포인트 768 한 단계 | smokespot |
| 상태색 success/warning/error/info 값 | fitin-app `primitives.scss` = fitin-bo `common_Tokens_Foundation.css` |
| 그림자 스케일, 모션 ease | fitin 공통 |
| 무한스크롤 sentinel(IntersectionObserver, rootMargin) | smokespot `admin/spots/page.tsx` |
| 스켈레톤 "일부만 shimmer" 원칙, 페이지 숨김 시 정지 | fitin-app `common_skeleton.tsx` |
| `fade-in` `slide-up-fade` 키프레임, `--ease-out-emph` | smokespot `globals.css` |
| **Pretendard 단일 패밀리** | fitin-app이 라틴/한글 2폰트(Space Grotesk+Gothic A1)를 버리고 정착한 결론. smokespot의 Archivo+Gothic A1은 안 따름 |
| 브랜드 색 SSOT: `--brand-*` 블록만 바꾸면 전 화면 반영 | fitin-app `--Fitin_point_*` 관습 |

## 코드 패턴 출처 (2026-09-08, 2차 대조)

같은 세 프로젝트를 **코드 구조** 축으로 다시 봤다. 스택이 같은 smokespot(Next App Router)을 주로 따르고, fitin은 원칙만 가져왔다.

| 축 | fitin-app / fitin-bo | smokespot | 집공고 채택 |
|---|---|---|---|
| 공통 유틸 배치 | `common/common_formatting/*` 기능별 파일 분할(날짜·숫자·문자열) | `lib/*.ts` 평면, 파일 = 관심사 1개 | smokespot 방식. `web/src/lib/{format,sido,routes,notice-filters,agency,site-url}` |
| 상수 중앙화 | `common_constants/` 카테고리 디렉터리 | `lib/constants.ts` 단일 파일 + 각 값에 근거 주석 | `lib/constants.ts` 단일 파일. 값마다 왜 그 숫자인지 주석 |
| 타입 배치 | `common_API/*/common_api_types.ts` API별 | `types/*.ts` 도메인별 | `types/notice.ts`. 쿼리 파일에서 분리 |
| 경로 빌더 | — | `lib/routes.ts` `ROUTES` + `xxxUrl()` | `lib/routes.ts` `noticePath` `homePath` `apiNoticesPath` |
| 사이트 오리진 | — | `lib/site-url.ts` 프로덕션 도메인 하드코딩(env 사고 방지) | 그대로. `VERCEL_ENV=production`이면 `zipgonggo.com` 고정 |
| sitemap/robots | — | `app/sitemap.ts` + `lib/sitemap-entries.ts`, lastmod는 DB 시각 | `app/sitemap.ts` 직접(타입 1개라 분리 안 함). lastmod = `notice.updated_at` |
| 시도 통칭 | — | `lib/sido.ts` 테이블 + `sidoShort()` | 그대로. 정규식 폴백 유지 |
| UI 프리미티브 | 컴포넌트마다 `.config.ts` 분리 | 작은 함수 컴포넌트, 옵션 최소 | `StatusBadge` `ExternalLink` `Spec/SpecList` `Hero` — 각 1파일, props 3개 이하 |
| 로딩/스켈레톤 | `common_skeleton` "일부만 shimmer" | — | `SkeletonCards` 헬퍼로 격번 shimmer 규칙 1곳 |
| 안 따른 것 | `common_` 접두사 명명, 디렉터리 깊이 3단계 | i18n 경로(`localePath`), JSON-LD 빌더 | 단일 언어라 불필요. JSON-LD는 단지/지역 페이지 때 smokespot `lib/json-ld.ts` 패턴으로 |
| 지도 마커·선택 (3차, 2026-09-08) | — | `components/naver-map.tsx`: 핀 SVG path, 선택 시 width:0 기준 말풍선(이름 길이와 무관하게 정렬), id별 마커 재사용 + signature로 바뀐 것만 setIcon, 콜백 ref, zoomControl:false | `components/complex-explorer.tsx`. 핀은 100개 넘게 찍혀 CSS filter·등장 애니메이션은 뺐다(렌더 부담). 선택 이동은 morph/panTo 대신 setZoom+setCenter(애니메이션 겹침으로 타일 깨짐 실측) |
| 좌 목록 / 우 지도 | — | `(tabs)/map` 데스크톱 레일 + `SpotList` onSelect | 공고지도2.png 벤치마크대로 좌 검색·자치구·건수·목록, 우 sticky 지도. 목록 스크롤은 smooth 대신 즉시(비활성 탭에서 smooth가 멈춤) |

pipeline 쪽은 레퍼런스가 없어(세 프로젝트 모두 Python 없음) 자체 기준: 소스 HTTP(`sources/http.py`) · 어휘(`housing.py`) · 값 정규화(`normalize.py`) · DB 쓰기(`repo.py`) · 스테이지 뼈대(`stages/common.py`)로 나눴다. 스테이지끼리는 import하지 않는다.
