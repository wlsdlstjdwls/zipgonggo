# Handoff: 집공고(zipgonggo) 화면 리디자인 — 모션 중심

## Overview
공공임대·공공지원민간임대 입주자모집공고를 **지도 + 목록으로 재구성**하는 pSEO 서비스 「집공고」의 화면 리디자인이다.
기존 구현(`web/src/app/page.tsx`, `web/src/app/notice/[slug]/page.tsx`, `web/src/app/globals.css`)의 라일락 파스텔 카드 UI를
**조용한 뉴트럴 스킨 + 마이크로 인터랙션이 정보 위계를 만드는 구조**로 바꿨다.

핵심 변경 4가지:
1. 홈이 목록이 아니라 **지도 + 결과 레일**이다. 행 호버 시 해당 지도 핀이 강조된다.
2. 공고 카드 그리드 → **행(row) 기반 목록**. D-day가 좌측 고정 칩, 금액이 우측 정렬 수치.
3. 상세는 **좌측 본문 + 우측 스티키 액션 패널**. 금액 표는 열린 공고 데이터에서 계산된다.
4. 상태 화면(로딩 스켈레톤 / 빈 상태 / 404)을 설계에 포함.

## About the Design Files
이 번들의 HTML은 **디자인 레퍼런스**다. 의도한 모양과 동작을 보여주는 프로토타입이며 production 코드로 그대로 복사할 것이 아니다.
대상 코드베이스는 **Next.js 15 App Router + ISR**(고정 선택, `CLAUDE.md` 참조)이므로,
이 문서의 값(색·타이포·간격·모션 곡선)을 **기존 `globals.css` 토큰 체계에 편입**시켜 React 서버/클라이언트 컴포넌트로 재구현한다.
`.dc.html` 파일 자체를 앱에 넣지 않는다.

## Fidelity
**High-fidelity.** 색·타이포·간격·모션 지속시간까지 확정값이다. 아래 토큰과 컴포넌트 스펙을 그대로 쓴다.
단, 데이터는 목업 8건이고 KPI/칩 숫자는 서비스 전체 집계값(182/176/6/11)을 하드코딩한 상태다 — 실제로는 `listFilterOptions()`·`listNoticesPage()` 결과를 쓴다.

---

## Design Tokens

CSS 커스텀 프로퍼티로 정의한다. 이름은 프로토타입 기준(`--mo-*` 접두어를 붙여 기존 `--brand-*`와 충돌을 피할 것).

| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#ffffff` | 페이지·패널 바탕 |
| `--sub` | `#f7f8fa` | 행 호버, 표 헤더, 푸터, 지도 컬럼 바탕 |
| `--line` | `#e9ebef` | 기본 구분선 1px |
| `--line2` | `#d8dbe2` | 강한 경계 (비활성 칩 테두리, 점선 박스) |
| `--ink` | `#0f1216` | 본문·제목, 활성 칩 배경, 주요 버튼 배경 |
| `--mut` | `#4f5661` | 보조 본문 (13–14px) |
| `--dim` | `#5f6672` | 8.5–11.5px 미세 텍스트 **(AA 통과값 — 더 밝게 바꾸지 말 것)** |
| `--acc` | `#3d5afe` | 액센트: 링크·화살표·강조 핀·주요 CTA |
| `--acc-soft` | `#eef1ff` | 액센트 틴트 (저장 상태, 활성 탭 배경) |
| `--hot` | `#c2340f` | D-4 이내 마감 **(AA 통과값)** |
| `--hot-soft` | `#fdeeeb` | 마감 임박 칩 배경 |
| `--warn` | `#a35c06` | D-5~7 |
| `--warn-soft` | `#fff5e6` | D-5~7 칩 배경 |

### 접근성 제약 (회귀 금지)
- `--dim` on `#fff` = **5.78:1**, on `--sub` = **5.44:1**
- `--hot` on `--hot-soft` = **4.91:1**
- 작은 텍스트에 `opacity`를 걸어 흐리게 만들지 않는다. 알파 합성이 대비를 깨뜨린다(과거 `opacity:.65`로 3.16:1까지 떨어진 사례). 흐리게 보이려면 `--dim`을 쓴다.

### 타이포그래피
- 폰트: **Pretendard Variable** 단일 패밀리 (기존 프로젝트 결론 유지)
  `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css`
- 숫자는 전부 `font-variant-numeric: tabular-nums`

| 역할 | 크기/굵기 | letter-spacing |
|---|---|---|
| 워드마크 | 19px / 900 | −.05em |
| 화면 제목 (목록 히어로) | 38px / 900, line-height 1.1 | −.055em |
| 상세 제목 | 34px / 900, line-height 1.22 | −.05em |
| 상세 금액 점보 | 56px / 900 | −.06em |
| KPI 수치 | 32px / 900 | −.055em |
| 목록 행 제목 | 15–16px / 800, line-height 1.35 | −.03em |
| 행 금액 | 18px(지도) / 22px(목록) / 900 | −.045em |
| D-day 숫자 | 16px / 900 | −.05em |
| 칩·버튼 라벨 | 12.5–13.5px / 800 | — |
| 행 메타·날짜 | 11–11.5px / 600–700 | .02em |
| 섹션 라벨 (대문자성) | 10–10.5px / 800 | .14–.2em |

### 형태·간격
- radius: 칩/버튼 `11–13px`, D-day 칩 `14px`, 카드/패널 `14–16px`, 프레임 `18px`, 세그먼트 `999px`
- 프레임 그림자: `0 30px 70px -44px rgba(0,0,0,.85)` (다크 배경 위 부유)
- 지도 오버레이 그림자: `0 8px 20px -14px rgba(15,18,22,.5)`
- 행 패딩: 지도 화면 `16px 18px`, 목록 화면 `18px`
- 헤더 높이 `60px`, 칩 높이 `38px`, 주요 버튼 높이 `42–48px`
- 최대 폭 `1280px`, 반응 분기점 **container query `max-width: 900px`** 1단계

### 모션 (전부 확정값)
```css
--sp:   cubic-bezier(.25,1.02,.36,1);  /* 스프링 느낌, 오버슈트 최소 */
--ease: cubic-bezier(.25,.8,.25,1);    /* 표준 */
```
| 대상 | 스펙 |
|---|---|
| 행 호버 | `background 200ms ease`, `transform 300ms sp` → `translateX(3px)` |
| 행 화살표 | `opacity 200ms linear`, `transform 320ms sp`, `translateX(-5px) → 0` |
| 행 금액 색 | `color 240ms ease` → `--acc` |
| 버튼 호버/누름 | `translateY(-1.5px)` / `scale(.985)`, 220ms sp |
| 칩 호버/누름 | `translateY(-1.5px)` / `scale(.975)`, 240ms sp |
| 저장 팝 | keyframes `1 → 1.16 → .97 → 1`, 420ms sp |
| 정렬 인디케이터 | `transform 340ms sp` (`translateX(0 → 100%)`) |
| 행 등장 | keyframes `opacity 0→1`, `translateY(10px)→0`, 440ms sp, **stagger 40ms × index** |
| 화면 전환 | keyframes `opacity 0→1`, `translateY(8px)→0`, 380ms sp |
| 지도 핀 포커스 | `transform 280ms sp` → `scale(1.08)`, 배경 `--acc` |
| 스켈레톤 시머 | `background-position 200%→-200%`, 1.5s ease-in-out infinite |
| 토스트 | `transform 360ms sp`, `opacity 240ms ease`, `translateY(16px)→0` |

**중요 — 타이머 의존 금지.** 등장 모션은 JS 타이머로 `opacity`를 뒤집지 말고 **CSS 애니메이션**으로 구현한다.
목록이 바뀔 때 다시 재생하려면 내용이 같은 두 keyframes 이름(`mo-in-a` / `mo-in-b`)을 세대 카운터로 번갈아 지정한다.
백그라운드 탭에서 타이머가 스로틀되면 행이 `opacity:0`에 멈추는 실제 버그가 있었다.
`prefers-reduced-motion: reduce`에서는 모든 애니메이션/트랜지션을 `.01ms`로 무력화한다.

---

## Screens / Views

프로토타입은 상단 스위처로 4개 화면을 전환한다(스캐폴딩이며 제품에는 없음). 실제 라우팅은 `docs/url-structure.md` 규칙을 따른다.

### 1. 지도 탐색 — `/` (홈)
사용자가 "우리 동네에 나온 게 있나"를 판단하는 화면.

**레이아웃**
```
헤더 60px
KPI 스트립  grid 4열, 각 셀 padding 18px 20px, border-left 1px --line
필터 행     좌: 칩 4개 / 우: 정렬 세그먼트, padding 14px 18px, overflow-x auto
본문       grid: minmax(0,1.3fr) 1fr   ← 좌 목록, 우 지도 (지도 높이 560px, border-left 1px)
푸터       padding 20px 18px 26px, background --sub
```
- `@container (max-width:900px)`: 1열 스택, 지도 높이 300px·`order:0`(지도가 위로), KPI 2열

**KPI 4개** — 진입 시 카운트업(800ms, `1-(1-p)³`, 경과 시간 기준, 종료 시 실제 값으로 스냅)
`전체 공고 182건` / `서울 68건` / `7일 내 마감 11건`(`--hot`) / `중위 월임대료 19.4만 원`(`--acc`)

**필터 칩** — `전체 182` `공공임대 176` `민간임대 6` `마감 7일 내 11`
활성: 배경 `--ink`, 텍스트 `#fff`, 카운트 `rgba(255,255,255,.78)`
비활성: 배경 `#fff`, 테두리 `--line2`, 텍스트 `--mut`, 카운트 `--dim`

**정렬 세그먼트** — `마감 임박순` / `최신 공고순`. 흰 인디케이터가 `translateX`로 이동.

**결과 행 (grid `56px minmax(0,1fr) 132px auto`, gap 14px)**
1. D-day 칩 56×52, radius 14 — 숫자 `D-4` 16px/900, 하단 라벨 `마감`/`접수 시작` 8.5px/800 letter-spacing .08em. 색: `dday<=4` → hot, `<=7` → warn, 그 외 `--sub`/`--mut`
2. 본문 — 메타 `SH · 서울 송파 · 장기전세주택` 11px `--dim` / 제목 15px/800 1줄 ellipsis / 날짜 `접수 09.07–09.12` 11.5px `--dim`
3. 금액 — `2억 3,100만` 18px/900, 아래 `1,381호` 10.5px `--dim`. 900px 이하에서는 이 열을 숨기고 본문 블록 안에 금액을 노출
4. 액션 — `★/☆` 저장 34×34 radius 11, 화살표 `→`(호버 시 등장)

**행 호버 시**: 해당 공고의 지도 핀에 `.is-focus`(scale 1.08 + `--acc` 배경), 지도 좌하단 캡슐이 `이 화면 안 공고 24건` → `선택한 공고 2억 3,100만`으로 교체.

**지도 오버레이**: 좌상단 `서울 68` / `전체 유형` 칩(흰 배경 + `--line`), 좌하단 캡슐(라벨 10px `--dim` + 수치 24px/900).

**더 보기**: `--ink` 버튼 → 스켈레톤 3행 700ms → 3건 추가(스태거 재생). 라벨은 `더 보기 +3` → `불러오는 중…` → `모두 표시했습니다`.

### 2. 공고 목록 — `/` 목록 뷰 (필터/정렬 URL 파라미터 유지)
- 히어로: 라벨 `공공임대 176 · 공공지원민간임대 6`(10.5px/800 `--acc`) + 제목 `수백 페이지 표를 호실 단위로.` + 설명 14px `--mut`
- 필터 행이 **sticky**(`top:0`, `background:rgba(255,255,255,.93)`, `z-index:9`)
- 행 grid `56px minmax(0,1fr) 170px auto`, gap 18px, padding 18px — 금액 22px/900, 메타에 `공고일`, 날짜줄에 `접수 …· 발표 …` 추가
- 하단: `182건 중 5건 표시` + `더 보기 +3`

### 3. 공고 상세 — `/notice/{slug}`
```
브레드크럼  padding 13px 18px, "← 지도" 칩 + "공고 · 서울특별시 송파구 · 장기전세주택"
본문 grid  minmax(0,1fr) 336px
```
좌측:
- 태그 3개 — `D-4 마감`(tone 색), `장기전세주택`(`--acc-soft`/`--acc`), `SH 서울주택도시공사`(`--sub`/`--mut`), 높이 28px radius 9
- 제목 34px/900, 최대 24em
- 금액 블록 — 라벨 `보증금` 10.5px/800 `--dim` + 값 56px/900 + `부터` 15px/800 `--mut`
- **접수 일정** — `repeat(auto-fit, minmax(160px,1fr))` 카드 4개(공고일/접수 시작/접수 마감/당첨자 발표). 활성(접수 마감)만 `--acc-soft` 배경 + `--acc` 테두리. 날짜는 `white-space:nowrap`(과거 두 줄로 쪼개진 버그)
- **보증금·임대료 표** — 3열 `1.3fr 1fr 1fr`, 헤더 `--sub`. 행은 **열린 공고 데이터에서 계산**: `기본 (공고 최소값)` = `min_deposit`/`min_rent`, 월임대료가 없는 전세형만 `납부 구성 · 계약금 (10%)`, `납부 구성 · 잔금 (90%)` 추가. 하드코딩 금지
- **위치** — 지도 300px radius 16, 아래 근사치 안내 + 주소

우측 스티키 패널: D-day 카드(tone 배경, 숫자 40px/900, `2026.09.12 (토) 마감`) → `기관 원문 공고 보기 ↗`(`--acc`) → `☆ 마감 알림 저장` → 공고 제원 6행(라벨 `--dim` 12px / 값 `--ink` 12.5px, 행마다 하단 1px `--line`) → `갱신 2026-09-08 07:12`

### 4. 상태 화면
- **로딩**: 목록 행 골격 3개 — D-day 자리 56×52, 제목 70%, 메타 150px, 금액 96px. 시머 1.5s
- **빈 상태**: 점선 `--line2` 박스, 48×48 `--acc-soft` 아이콘 자리, 제목 19px/900, 설명 13px `--mut`, `필터 초기화` 버튼(누르면 목록 화면으로 이동 + 필터 리셋)
- **404**: `--sub` 박스, `404` 52px/900 `--acc`, 제목·설명, `공고 목록으로`. 문안에 **"마감된 공고도 삭제하지 않습니다"** 유지(`CLAUDE.md` 하지 말 것 6)

---

## Interactions & Behavior

| 트리거 | 동작 |
|---|---|
| 행 hover | 행 `translateX(3px)` + `--sub` 배경, 화살표 등장, 금액 `--acc`, **지도 핀 포커스**, 지도 캡슐 값 교체 |
| 행 click | 상세 화면으로 이동(프로토타입은 `openId` 상태, 실제로는 `/notice/{slug}` 라우팅) |
| 칩 click | 필터 적용 + `shown` 초기화 + 등장 모션 재생 |
| 정렬 click | `deadline`(D-day 오름차순) ↔ `posted`(공고일 내림차순), 인디케이터 이동 + 재정렬 |
| ★ click | `preventDefault` + `stopPropagation`(행 이동 방지), 저장 토글, 팝 애니메이션, 토스트 `저장했습니다 · 마감 하루 전 알림` / `저장을 해제했습니다` (2.1s 후 사라짐) |
| 더 보기 click | 스켈레톤 3행 700ms → 3건 append. 로딩 중 재호출 차단 |
| 빈 상태 `필터 초기화` | 목록 화면 + 필터 전체 해제 |

기존 구현의 무한 스크롤(`notice-feed.tsx`, IntersectionObserver + rootMargin 320px)은 유지하고, 버튼은 폴백으로 둔다.

## State Management
프로토타입 상태(그대로 옮길 필요는 없고 URL 파라미터로 승격할 것을 구분):

| 상태 | 초기값 | 비고 |
|---|---|---|
| `sector` | `"전체"` | **URL `?sector=`** (기존 구현과 동일) |
| `urgentOnly` | `false` | URL 파라미터로 승격 권장 (`?closing=7d`) |
| `sort` | `"deadline"` | **URL `?sort=deadline`** (기본 `posted`는 URL에 안 씀) |
| `shown` | `5` | 커서 페이지네이션으로 대체 (`nextCursor`) |
| `loading` | `false` | fetch 중 |
| `gen` | `0` | 등장 애니메이션 재생용 세대 카운터 |
| `saved` | `{}` | 저장 목록 — 서버 저장 시 사용자 식별 필요 |
| `popped` | `null` | 팝 애니메이션 대상 id, 460ms 후 해제 |
| `focus` | `null` | 호버 중인 공고(지도 캡슐용) |
| `openId` | `1` | 상세 대상 → 실제로는 라우트 파라미터 |
| `counts` | 0에서 카운트업 | 표시 전용 |
| `toast` | `null` | 2.1s 자동 소멸 |

데이터 소스는 기존 그대로: `listNoticesPage()`, `listFilterOptions()`, `getNoticeBySlug()`, `getNoticeAreas()`, `getAmendChain()` (`web/src/lib/queries.ts`).

## Assets
- 이미지 없음. 사진·아이콘 에셋을 새로 만들지 않았다. 아이콘은 CSS 도형(사각형/원/화살표 글리프)으로 처리했고, 실제 구현에서는 코드베이스의 아이콘 세트를 쓴다.
- 지도: **프로토타입은 Leaflet + OpenStreetMap 타일**을 썼다(샌드박스에서 네이버 SDK 키를 쓸 수 없어서).
  **실제 구현은 네이버 Web Dynamic Map을 유지한다**(`CLAUDE.md` 고정 선택). 기존 `web/src/components/naver-map.tsx`를 계속 쓰고, 아래 동작만 이식한다:
  - 핀 라벨은 금액 + D-day 2줄, 흰 배경 + 1px 테두리 + `translate(-50%,-100%)`
  - 라벨이 겹치면 뒤 핀은 13px 점으로 축소하고 대표 핀에 `+N` 배지를 붙인다(디클러터). 실제로는 네이버 지도의 마커 클러스터러 또는 서버측 그리드 집계로 대체 가능
  - 컨테이너 크기가 확정된 뒤에만 fit/센터링한다. 여백은 고정 px이 아니라 컨테이너 비례(`min(100, w*.18)`, `min(126, h*.22)`)로 잡는다 — 300px 높이 지도에서 고정 여백이 뷰포트를 다 먹는 버그가 있었다
  - 좌표는 지오코딩 결과를 저장하지 않는다(`CLAUDE.md` 하지 말 것 1)

## Files
| 파일 | 내용 |
|---|---|
| `candidate-h-motion.dc.html` | **채택안.** 4개 화면 + 모든 인터랙션. 상단 스위처로 화면 전환 |
| `zip-map.js` | 프로토타입용 지도 웹컴포넌트(Leaflet). 핀 디클러터·컨테이너 비례 여백·초기화 재시도 로직 참고용 |
| `candidate-f-terminal.dc.html` | 데이터 터미널 방향(참고) |
| `candidate-d-mapapp.dc.html` | 지도 전면 앱 방향(참고) |

`.dc.html`은 브라우저에서 바로 열린다. 상단 다크 스트립(화면 스위처·힌트 문구)은 프로토타입 스캐폴딩이므로 구현하지 않는다.

## 원래 구현에서 의도적으로 버린 것
- 라일락 파스텔 카드(`.card`, `.card-hero`, 그라데이션 헤더) — 행 기반 목록으로 대체
- 히어로 밴드 `.hero`의 라일락 면 + 통계 캡슐 — KPI 스트립으로 대체
- 카드 내 `📍` 이모지 지역 배지 — 텍스트 메타로 대체
- 접수기간 경과율 진행 바 — 기준이 읽히지 않아 제거(사용자 결정). 날짜만 표시
- 마감 카운트다운 타이머(시:분:초) — 제거(사용자 결정)
