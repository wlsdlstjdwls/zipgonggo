# 인수인계

**새 세션은 [`CLAUDE.md`](../CLAUDE.md) 다음으로 이 파일을 본다.** 지금 코드가 어디까지 와 있고, 다음에 뭘 집어야 하고,
어떤 함정이 남아 있는지가 여기 있다. 설계 근거는 [`PLAN.html`](PLAN.html), 데이터 출처 판정은 [`data-sources.md`](data-sources.md).

작업이 한 덩이 끝날 때마다 이 문서를 고친다. 「지금 상태」와 「다음에 할 일」 두 절만 최신이면 된다.

---

## 지금 상태 (2026-09-09, 21차 세션)

브랜치 `main`. 단지 탐색기 지오코딩 오버레이(`.cx-load`)가 다 끝나도 안 사라지던 버그 수정. 커밋·푸시 완료.

### 21차 세션에서 손댄 것

- **"지도 로딩 끝나도 로딩화면이 안 사라진다"** — `globals.css`의 `.cx-load`가 `animation: cx-load-in 260ms both`
  로 등장하는데, `both`가 `opacity: 1`을 계속 붙들고 있었다. `.hide`가 `opacity: 0`을 트랜지션으로 걸어도
  트랜지션은 "진행 중"에만 우선순위를 갖고, 끝나면 여전히 살아있는 진입 애니메이션의 고정값(1)으로 되돌아간다 —
  잠깐 옅어지는 듯하다 도로 튀어 돌아오는 모양. 19차의 지도 페이드인 버그(ed18f40)와 같은 종류인데
  이번엔 반대 방향(사라져야 할 때 애니메이션이 안 놓아주는 쪽)이었다.
  `.cx-load.hide`에 `animation: none`을 추가해 애니메이션을 놓아주고 트랜지션 값이 그대로 남게 고쳤다.
  실제 브라우저로 재현·확인은 못 했다(이 세션엔 브라우저 도구가 없었다) — 배포 뒤 육안 확인 필요
- 같은 계열(진입 애니메이션 `both` + 이후 클래스로 같은 속성 토글)이 다른 곳에도 있는지 훑었다.
  `.map`·`.cx-map > .canvas` 등은 19차에서 이미 "등장만 하고 이후 토글 없음" 구조로 정리돼 있어 해당 없음.
  `.cx-load`만 유일하게 진입 애니메이션과 이후 hide 토글이 같은 속성(opacity)에서 겹쳐 있었다

### 20차 세션에서 손댄 것

**"DB 반영했는데 화면 반영 안 됨"의 근본 원인**: `listNoticesPage`·`getEligibilityRules` 등이
`unstable_cache(REVALIDATE_SEC=1시간)`로 감싸여 있어, 파이프라인이 DB를 갱신해도 최대 1시간은
옛 값을 계속 보여준다(19차까지는 dev에서 `.next/cache`를 수동으로 지워야 했던 그 문제의 production판).
`getEligibilityRules`는 태그조차 없어 `revalidateTag`로도 못 지웠다.

- `web/src/app/api/revalidate/route.ts` 추가 — `POST`, `x-revalidate-secret` 헤더(또는 `?secret=`)로
  인증. `revalidateTag(...)` + `revalidatePath("/", "layout")`을 같이 불러 태그 캐시와 이미 렌더된
  페이지(Full Route Cache) 둘 다 비운다. 시크릿 없거나(501) 틀리면(401) 아무것도 안 하고 거절한다
- `CACHE_TAG_ELIGIBILITY` 태그를 새로 만들어 `getEligibilityRules`에 붙였다(`lib/constants.ts`,`lib/queries.ts`)
- 파이프라인: `stages/common.py`에 `notify_web_revalidate()` 추가, `stage_main`이 성공(dry-run 아님)한
  뒤 자동으로 부른다. `WEB_REVALIDATE_URL`·`REVALIDATE_SECRET` 둘 다 없으면 조용히 건너뛴다(로컬 개발
  배려) — 실패해도 파이프라인은 안 막는다(최악의 경우 예전처럼 1시간 뒤 자연 반영)
- 새 키 `REVALIDATE_SECRET`(web·pipeline 공통)·`WEB_REVALIDATE_URL`(pipeline)을
  `vercel env add`로 Production/Preview/Development 세 곳에 다 등록해 뒀다. `.env.example` 양쪽,
  `docs/data-sources.md` 필요한 키 표에도 적었다
- **동작 확인**: dev 서버 대상으로 인증 실패(401)·성공(200, `{"revalidated":[...]}）·시크릿 미설정(501)
  세 경로 전부 curl로 확인했고, 파이프라인 쪽 `notify_web_revalidate()`도 미설정 시 조용히 건너뛰기·
  성공·실패(경고만, 예외 안 던짐) 세 경로를 직접 호출해 확인했다. **아직 프로덕션에 배포되지 않아서
  `https://zipgonggo.com/api/revalidate`는 이 커밋이 배포되기 전까진 404다** — 배포되면 다음 파이프라인
  실행부터 자동으로 걸린다

### 19차 세션에서 손댄 것

- 공고 상세 「위치」 지도 기본 줌을 16 → 17로. 단지 상세는 이전 배율(16)을 유지해 달라는 요청이라
  `NaverMap`에 `zoom` prop을 추가해 갈랐다(`NAVER_MAP_DEFAULT_ZOOM` / `NAVER_MAP_COMPLEX_ZOOM`, `lib/constants.ts`)
- **17차의 지도 페이드인이 버그였다** — "로딩 다 끝났는데 지도가 안 보인다"는 지적. `mapReady`/`state==="ready"`
  같은 JS 상태로 opacity를 열고 닫았는데, 그 상태 갱신이 어긋나는 경로가 있으면 지도가 영영 투명하게 남는
  구조였다(정확한 어긋남 지점은 못 짚었다 — 재현 환경이 없어 코드만으로 판단). CSS 애니메이션(`animation: map-in`,
  `@keyframes map-in`)으로 갈아서 마운트하면 JS 상태와 무관하게 무조건 끝나게 고쳤다 — 이 파일 맨 위
  "등장은 JS 타이머가 아니라 CSS 애니메이션" 원칙(globals.css 108행 주석)을 처음부터 따랐어야 했다.
  `.map.ready`/`.cx-map > .canvas.ready` 클래스는 없앴다 — 아래 17차 항목의 방식은 폐기됐다

### 18차 세션에서 손댄 것

- **예비신혼부부**가 혼인 상태에 없었다 — `Marital`을 `"미혼" | "예비신혼부부" | "기혼"` 3값으로 늘렸다.
  `checkMarital`(`lib/eligibility.ts`)에서 예비신혼부부는 혼인가구 요건을 통과하고, 혼인기간 조건은
  "혼인 예정이라 해당 없음"으로 곧장 통과시킨다(아직 혼인신고 전이라 `marriedYears` 비교가 의미 없다).
  이전엔 에러 메시지만 "예비신혼과 한부모 포함"이라 말하고 실제로 고를 방법이 없었다(말과 코드가 어긋난 버그)
- 거주지 셀렉트가 OS 기본 `<select>`였다 — 다른 화면과 같은 톤(`components/select.tsx`의 `Select`)으로 바꿨다.
  서울/연접지역 구분은 `Select`가 그룹 헤더를 못 그려서(다른 화면도 안 씀, 확장은 위험도 대비 이득이 적어 보류)
  연접지역 항목 라벨 뒤에 "(연접지역)"을 붙이는 걸로 갈음했다
- 결과 카드에 "신청 가능"/"신청불가" 배지를 명시로 붙였다(카드 테두리 색만으론 안 읽힌다는 지적).
  목록도 1열 스택에서 `repeat(auto-fit, minmax(260px,1fr))` 2열 그리드로 — 좁아지면 자동으로 1열로 접힌다
- 자격진단 머리글 문구를 "-다"체 단정문에서 "-습니다"체로 눅였다(사이트 대부분의 안내문과 같은 톤으로 맞췄다)
- **가운뎃점(·) 전수 제거** — CLAUDE.md 표기 규칙을 코드와 DB 양쪽에서 다시 훑었다:
  - `lib/glossary.ts`의 용어 정의 2건(화면에 노출되는 문자열), `app/notice/[slug]/[complex]/page.tsx`의 안내문 1건
  - `db/seeds/eligibility.json`의 `note` 필드 4건 → 고치고 `python -m zipgonggo_pipeline.stages.s0_eligibility`로
    DB(`supply_type.note`)까지 재적재했다. **주의**: `getEligibilityRules`가 `unstable_cache`(1시간)로 감싸여 있어
    DB만 고치면 dev/배포 양쪽에 안 보인다 — dev는 `.next/cache`를 지우고 재시작해야 반영된다(함정 §7에 추가)
  - `notice.title`의 26건은 그대로 뒀다 — 기관 원문 그대로 싣는 값이라 CLAUDE.md가 명시한 예외

### 17차 세션에서 손댄 것

- 지도 첫 등장이 "빡" 하고 뜨던 걸 페이드로 편다: `ComplexMap`(`.cx-map > .canvas`)·`NaverMap`(`.map`) 둘 다
  준비 전엔 투명, `mapReady`/`state==="ready"`가 되면 420ms로 밝아진다. 지오코딩 오버레이(`.cx-load`)도
  조건부 언마운트 대신 `.hide` 클래스로 옅어지게 바꿨다 — 지도가 오버레이 뒤에서 갑자기 드러나지 않는다
- 목록에서 항목을 고르면 마커가 살짝 커지며 나타난다(`.zg-sel`, scale 1.12, 호버 확대와 같은 배율)
- `ComplexExplorer`의 필터 셀렉트(`.cx-tools`/`.cx-cond`)가 열릴 때 목록(`.cx-list`, position:relative)
  뒤로 가려 보이던 문제 — 셀렉트 줄에 `position:relative; z-index:3`을 명시해 고쳤다.
  `FilterRail`의 `.rail-in`(sticky)도 카드 보기(`.rows.v-card .row`, 역시 position:relative)에 가려질 수 있어
  같이 `z-index:5`를 명시했다(재현 확인은 못 했지만 같은 부류의 버그라 선제 수정)
- `ComplexExplorer` 목록 행 레이아웃을 가로 2단(이름 | 칩들)에서 세로 3줄(이름·주소·칩들)로 바꿨다 —
  「신규」 배지·자치구 칩·금액이 이름 폭을 갉아먹어 단지명·주소가 과하게 `…`로 잘리던 문제(사용자 지적).
  잘린 글자의 툴팁(`Trunc`, `[data-tip]`)은 이미 있었다 — 새로 만들 것 없이 그대로 씀
  - 겸사겸사 발견한 버그: 지도 위 선택 카드(`.cx-card-t`)의 단지명에 `className="cx-card-n"`을 줬는데
    CSS는 `.cx-card-t b`만 스타일링해 볼드·말줄임이 안 먹고 있었다. CSS를 `.cx-card-n` 쪽으로 맞췄다
- `input[type=number]`의 위아래 스피너 전체 제거(전역, `calc-dock`·`complex-explorer` 전용면적 입력·
  `eligibility-check` 전부 적용됨)
- 용어 링크(`.term`) 뒤의 물음표 원(`::after`) 아이콘 제거 — 점선 밑줄만 남긴다("깨지는 느낌" 지적)

### 이번에 코드가 아니라고 확인한 것 (DB/외부 사이트 문제)

- **SH 원문 링크**(`sh-2026-309403-maeip`, 2026년 2차 장기미임대)가 안 열리는 문제 — `source_url` 자체는
  다른 SH 공고와 같은 패턴으로 정상 생성됐다. 문제는 i-sh.co.kr `view.do`가 NetFunnel 대기열 + 폼 POST
  기반이라 **GET 직링크가 산발적으로 게시판 목록 화면만 돌려준다**(WebFetch로 확인: `sh-2026-301759`는 상세가
  뜨는데 `sh-2026-309403`는 목록만 뜬다). 기존에 알던 함정(아래 「함정 §4」)과 같은 뿌리. 코드로 못 고친다 —
  대신 카드에 이미 있는 **포털 링크**(`housing.seoul.go.kr`)가 정상 작동해 대체 경로로 쓸 수 있다
- **"\*명칭없음" 목록 항목**(같은 공고, 2건) — 정상이다. SH 원문 별첨 표에 건물명 칸이 비어 있는 행을
  그대로 옮긴 값(`notice_complex.name = '*명칭없음'` / `'* 명칭없음'`)이다. 지어내지 않고 원문 그대로 실은 것
- **공급대상(신혼부부·청년 등) 필터가 안 보이는 문제** — 이 공고는 `notice_supply`(공급현황 표) 행이 **0건**이라
  `tenant_classes`가 항상 빈 배열이라서다(`ComplexExplorer`는 `classes.length > 1`일 때만 필터를 그린다 —
  옳은 동작). 이 공고의 첨부 「공급현황」 표를 아직 파싱하지 못했다는 뜻 — 아래 「다음에 할 일」에 추가

### 데이터 (Neon, us-east-1)

| 표 | 행 | 메모 |
|---|---|---|
| `notice` | 479 | LH·SH 목록 + i-sh 게시판 백필(2003년까지) |
| `notice_complex` | 1,072 | 좌표 906건(84%). 요약DB 오프라인 조인(S6) |
| `notice_supply` | 503 | SH 첨부 「공급현황」 표 |
| `unit` | 464 | 매입임대 별첨 주택목록. 공고 1건(sh-2026-309403-maeip)치뿐. 동 표기 295행(2026-09-09 파서 수정 후 재적재) |
| `complex` / `complex_type` | 0 | 마이홈 단지정보 API 미적재 |

### 화면 (web/)

- 목록: 왼쪽 필터 레일(보기·정렬·부문·지역·유형·접수), 무한 스크롤. 좁은 화면은 바텀시트
- 공고 상세: 공급 단지 탐색기(목록 + 지도) · 접수 일정 · 정정 이력 · 공고 정보 · 용어 설명
  - 접수 일정 칸은 날짜와 시각을 두 조각으로 그린다(`Stamped`) — 한 문자열이면 「2026.09.30 (수) 17:00」이 칸을 넘긴다
- 상세 머리바(`DetailHeadBar`, 머리글이 헤더에 가리면 뜨는 바): 왼쪽은 헤더와 같은 구성(로고→홈 + 자격진단),
  세로선 뒤부터가 "지금 어디"(뒤로가기 + 제목), 오른쪽은 상태 + 원문 + 계산기.
  좁아지는 순서는 자격진단(900) → 부제·원문·워드마크·계산기 라벨(640) → 상태(480)
- 단지 상세: 요약 KPI · 공급 정보(제원 + 공급현황) · 보증금과 임대료 · 동호수별 정보 · 위치 · 용어 설명
  - 겹치는 값은 한 자리에서만 센다(2026-09-09): 공급 구분·유형은 태그 줄, 호수·전용면적·입주 시작은 요약 KPI,
    「공급 정보」 표에는 그 어디에도 없는 값만. 오른쪽 카드도 같은 규칙
  - 「동호수별 정보」 제목은 별첨에 동 표기가 있을 때만. 없으면 「호실별 정보」
  - 호실 표에서 건물을 가르는 값은 **동 1순위, 주소 2순위**다. 동이 없어도 주소가 갈리면 주소 칸을 세운다
    (구일주택 0071J처럼 같은 「404호」가 건물마다 있다). 둘 다 하나면 한 건물이라 호만으로 유일하다
- 용어 설명은 기본이 접힌 상태다(2026-09-09). 본문 용어 링크(`.term`, 뒤에 작은 물음표)를 누르면
  펴지면서 그 항목으로 부드럽게 내려간다. 위임 클릭은 `components/glossary-list.tsx`, `<Term>`은 서버 컴포넌트로 남는다
  - `<TermText>`가 문자열 안의 사전 표제어를 링크로 바꾼다. `Spec`/`Kpi` 라벨은 자동, 줄여 쓴 라벨은 `term` prop으로
    표제어를 알려 준다(「현재 공가」→공가, 「예비자」→예비입주자)
  - **목록과 링크는 브라우저에서 맞춘다** — `GlossaryList`가 마운트 때 `a.term`을 훑어 목록을 다시 짠다.
    페이지가 넘기는 `terms`는 서버 렌더(SEO·JS 없는 환경)용 밑그림일 뿐이다. 손으로 맞춘 목록은 반드시 어긋난다
    (설명은 있는데 링크가 없거나, 링크가 목록에 없는 항목을 가리켰다). 밑그림도 44쪽 전수 검사로 맞춰 뒀다
- 지도 핀 색: 기본은 액센트 파랑(재공급 포함, 예전 그대로), **신규가 섞인 공고에서만** 신규 핀이 주황 `#ea580c`로 갈린다
  (`ComplexMap`의 `split`). 목록의 「신규」 칩도 같은 주황 — 목록과 지도가 다른 색으로 같은 말을 하지 않게
- 목록 첫 화면: 저장된 필터가 있는 재방문이면 `layout.tsx`의 부트 스크립트가 `<html data-booting>`을 걸어
  `.list-stage`를 가린다. `NoticeExplorer`가 첫 조회를 마치면 뗀다(스크립트에 3초 안전장치). 무필터 목록이
  보였다 갈리던 문제(2026-09-09)
- 자격진단 `/eligibility`, 약관·방침
- 계산기(상호전환·대출이자)는 헤더 버튼 → `CalcProvider` / `CalcButton` / `CalcSeed`

### 파이프라인 (pipeline/)

동작 중인 스테이지: `s0_eligibility` · `s1_collect` · `s1_sh` · `s1_ish_board` · `s3_sh_complex` · `s3_ish_results` · `s6_geocode`

---

## 다음에 할 일 (우선순위)

### 1. 지도를 DB 좌표로 갈아 끼우기 — 15차부터 밀린 것

`notice_complex.geom`이 906건 차 있는데 `web/src/components/complex-explorer.tsx`는 아직 마운트 때마다
브라우저에서 네이버 geocoder를 돌린다(공고당 ~140회). 서버가 좌표를 내려주면 「주소를 좌표로 바꾸는 중」
오버레이가 통째로 사라지고 첫 화면이 즉시 완성된다.

- `getNoticeComplexes`에 `ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng` 추가
- `NoticeComplex` 타입에 `lat`/`lng` 추가, `ComplexExplorer`의 `geocodeAll` 경로는 좌표 없는 행에만 남긴다(또는 완전 제거)
- 좌표 없는 166건은 지금처럼 「지도 미표시」

### 2. 장기전세 공사 건설형 재공급 — 지구 묶음 펴기

제51차(sh-2026-309467-janggi) 단지 **138곳 중 22곳만** 데이터가 있다. 나머지는 공고문 15~17쪽
「공사 건설형 재공급」 표인데, 단지명 칸이 지구 단위로 묶여 있다:

```
상암2지구
-상암월드컵파크9~12단지     ← 한 줄이 4개 단지를 덮는다
```

`_name_blocks`(sh_supply_lines)가 `names_hint`와 이름이 안 맞아 블록을 못 닫고 **0줄**을 낸다.

**호수는 지구 합계라 단지별로 못 나눈다. 그러나 전세금·계약면적·난방방식은 구성 단지 전부에 같이 적용된다.**
번호 범위(`9~12`)와 쉼표 목록(`1,2,3,5` — 쉼표가 다른 줄로 떨어져 온다)을 펴서
`notice_complex.name`(「상암월드컵파크 9단지」)·`zone`(「우면2지구」)과 대조하면 116곳이 채워진다.
`units_total`은 그때 `NULL`로 두고 화면에 「지구 합계 N호」로 따로 쓴다.

- 손댈 파일: `pipeline/src/zipgonggo_pipeline/parsers/sh_jeonse_supply.py`
- 고정 자산: `pipeline/tests/fixtures/ish_309467/p15.xml`, `p16.xml`, `p17.xml`

### 3. `sh_units` 정확도 — 단지코드 열이 샌다

`엘클루`(코드 `0034K`)에 172호가 붙었는데 같은 호(`0704`, `0503`, `0603` …)가 3번씩 나온다.
주소도 3종(`성동구 자동차시장1길 104-75` / 공백 깨진 변형 2종)이다. 앞뒤 단지의 행이 이 코드로 넘어온 듯하다.
`unit_key` 중복은 연번을 붙여 피했지만(464건 전부 적재됨) **원인은 안 고쳤다.**

- 손댈 파일: `pipeline/src/zipgonggo_pipeline/parsers/sh_units.py` `parse_unit_row`
- 검산: 공고문 별첨 헤더의 「133단지 476호」와 대조

### 4. i-sh `view.do`가 본문 없이 온다

`https://www.i-sh.co.kr/main/lay2/program/S1T294C295/www/brd/m_241/view.do?seq=309403`을 GET하면
166KB가 오는데 본문·첨부 마크업이 없다(`find_attachments` 0건). 세션이나 POST 경로가 필요해 보인다.
지금은 `s3_sh_complex --cached`로 우회 중이라 **새 공고는 수집이 막혀 있다.**

### 5. `sh-2026-309403-maeip`(2026년 2차 장기미임대) 공급현황 미파싱

`notice_supply` 행이 0건이라 단지 상세의 「공급 정보」 표도, 공고 상세 탐색기의 「공급대상」 필터(신혼부부·청년 등)도
비어 있다. 위 「함정 §4」(i-sh `view.do`가 본문 없이 옴)와 얽힌 공고라 `--cached` 첨부부터 확인.

### 6. 안 한 요청 — 주변 역·생활 편의시설

`data-sources.md` [4b절](data-sources.md#4b-주변-시설--역병원영화관-후보-미착수)에 후보와 설계 메모.
데이터셋 판정이 전부 **미확인**이라 CLAUDE.md 「작업 전 확인」에 따라 열람이 먼저다.
카카오 로컬·네이버 지역검색은 좌표 저장 금지 규율(하지 말 것 1)에 걸려 쓰지 않는다.

---

## 함정 (겪은 것만)

### dev 서버

- 사용자가 **3100 포트에 `npm run dev`를 켜 둔 채** 작업한다. `next build`를 돌리면 `.next`를 덮어 500이 난다.
  검증은 `npx tsc --noEmit`으로 한다
- 파일을 **삭제**하면 dev의 모듈 그래프가 상해 전 페이지가 500이 된다(`Failed to read source code from …`).
  touch로는 안 풀린다 — dev를 내리고 `.next/server .next/static .next/cache`를 지운 뒤 다시 띄운다
- 마이그레이션 뒤 `column does not exist`는 스키마가 아니라 오래 켜 둔 dev의 옛 커넥션 탓이다
- `unstable_cache`(예: `getEligibilityRules`, 1시간)로 감싼 쿼리는 **DB를 고쳐도 dev가 계속 옛 값을 보여준다.**
  dev 재시작만으론 안 풀린다(파일시스템에 캐시가 남는다) — `.next/cache`를 지우고 나서 재시작해야 반영된다(2026-09-09).
  프로덕션은 `.next/cache`를 못 지우니 20차에서 `POST /api/revalidate`(`x-revalidate-secret` 헤더)를
  만들었다 — DB를 고친 뒤(수동이든 파이프라인이든) 이걸 부르면 즉시 반영된다. 값은 `docs/data-sources.md`

### 파이프라인

- `s3_sh_complex`가 `no_attachment`로 건너뛰면 **`--cached`를 먼저 쓴다.** `pipeline/data/ish/{seq}/`에
  받아 둔 쪽 XML을 네트워크 없이 다시 읽는다. 파서를 고친 뒤 되돌려 넣을 때의 기본 경로다
- `replace_notice_complexes`는 DELETE + INSERT다. **좌표는 임시표로 업어 넘긴다**(2026-09-09 추가) —
  안 그러면 S3 재실행 한 번에 좌표 262건이 날아간다. 주소가 바뀐 행은 못 업어 오므로 S6을 다시 돌린다
- 별첨 금액 6칸이 한 칸으로 붙어 오면 자릿수가 이어져 `bigint out of range`가 난다. 상한 1,000억으로 잘라 버린다
- 파이프라인 실행은 `cd pipeline && PYTHONPATH=src python -m zipgonggo_pipeline.stages.<이름>`.
  접속 문자열은 `pipeline/.env`, 마이그레이션은 `python db/migrate.py`

### DB

- `unit.unit_key`는 공고 안에서만 유일하면 된다. 같은 단지 다른 동에 같은 호가 있어
  「코드-동-호」로 잡고, 그래도 겹치면 별첨 연번을 붙인다
- `notice_supply` 유일키는 (공고, 단지명, 유형, 계층, 소득옵션)이다. **같은 면적의 일반/주거약자 두 줄이
  겹치므로 주거약자에는 유형 코드에 `S`를 붙인다**(「59」·「59S」)

---

## 표기·태도 (CLAUDE.md 보충)

- 값이 없으면 감추지 말고 **「준비 중」**이라고 쓴다(`components/pending.tsx`, `Kpi`의 `off`).
  왜 비었는지 말해 주지 않는 빈칸을 만들지 않는다
- 접수 날짜를 못 읽은 공고는 **「원문 확인」**(`lib/format.ts` `NO_DATE`).
  기관 목록의 「모집중」을 날짜 자리에 대신 쓰지 않는다
- 공고문 용어는 `lib/glossary.ts`에 뜻을 두고 `<Term>`으로 걸어 페이지 밑 「용어 설명」으로 잇는다.
  새 용어를 화면에 쓰면 사전에도 넣는다
- 틀린 값을 싣느니 비워 둔다. 파서에 검문(`_plausible` 류)을 두고 통과한 줄만 적재한다
