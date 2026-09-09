# 인수인계

**새 세션은 [`CLAUDE.md`](../CLAUDE.md) 다음으로 이 파일을 본다.** 지금 코드가 어디까지 와 있고, 다음에 뭘 집어야 하고,
어떤 함정이 남아 있는지가 여기 있다. 설계 근거는 [`PLAN.html`](PLAN.html), 데이터 출처 판정은 [`data-sources.md`](data-sources.md).

작업이 한 덩이 끝날 때마다 이 문서를 고친다. 「지금 상태」와 「다음에 할 일」 두 절만 최신이면 된다.

---

## 지금 상태 (2026-09-09, 16차 세션)

브랜치 `main`, 마지막 커밋 `d80260b` 이후 UI 손질 한 덩이. 푸시 완료.

### 데이터 (Neon, us-east-1)

| 표 | 행 | 메모 |
|---|---|---|
| `notice` | 479 | LH·SH 목록 + i-sh 게시판 백필(2003년까지) |
| `notice_complex` | 1,072 | 좌표 906건(84%). 요약DB 오프라인 조인(S6) |
| `notice_supply` | 503 | SH 첨부 「공급현황」 표 |
| `unit` | 464 | 매입임대 별첨 주택목록. 공고 1건(sh-2026-309403-maeip)치뿐 |
| `complex` / `complex_type` | 0 | 마이홈 단지정보 API 미적재 |

### 화면 (web/)

- 목록: 왼쪽 필터 레일(보기·정렬·부문·지역·유형·접수), 무한 스크롤. 좁은 화면은 바텀시트
- 공고 상세: 공급 단지 탐색기(목록 + 지도) · 접수 일정 · 정정 이력 · 공고 정보 · 용어 설명
- 단지 상세: 요약 KPI · 공급 정보(제원 + 공급현황) · 보증금과 임대료 · 동호수별 정보 · 위치 · 용어 설명
  - 겹치는 값은 한 자리에서만 센다(2026-09-09): 공급 구분·유형은 태그 줄, 호수·전용면적·입주 시작은 요약 KPI,
    「공급 정보」 표에는 그 어디에도 없는 값만. 오른쪽 카드도 같은 규칙
  - 「동호수별 정보」 제목은 별첨에 동 표기가 있을 때만. 없으면 「호실별 정보」 — 125단지 중 36곳만 동이 있다(원문이 그렇다)
- 용어 설명은 기본이 접힌 상태다(2026-09-09). 본문 용어 링크(`.term`, 앞에 물음표 아이콘)를 누르면
  펴지면서 그 항목으로 부드럽게 내려간다. 위임 클릭은 `components/glossary-list.tsx`, `<Term>`은 서버 컴포넌트로 남는다
- 지도 핀 색: 신규 공급은 액센트 파랑, 재공급은 중성 회색. **신규가 섞인 공고에서만** 갈린다(`ComplexMap`의 `split`)
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

### 5. 안 한 요청 — 주변 역·생활 편의시설

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
