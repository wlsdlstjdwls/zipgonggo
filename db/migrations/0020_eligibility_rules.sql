-- 0020 — 공급유형 자격·배점 사양 (「내집마련.xlsx」 → db/seeds/eligibility.json)
--
-- 기존 eligibility 테이블은 **공고 1건의** 자격 문구를 담는 자리다(notice_id FK).
-- 여기 넣는 건 공고와 무관한 제도 자체의 규칙 — 33개 공급유형의 나이·혼인·소득·자산·자동차 기준과 순위 배점.
-- 「내 조건으로 신청 가능한 유형」을 계산하려면 공고를 안 보고도 답할 수 있어야 해서 따로 둔다.
--
-- 값의 출처는 사용자가 만든 자격진단 엑셀 한 벌이다. 원본 파일은 커밋하지 않고(용량·저작),
-- 파이프라인이 뽑아낸 db/seeds/eligibility.json을 정본으로 두고 거기서 적재한다.

-- 소득·자산 "무관"은 엑셀에서 999 · 999999로 적혀 있다. DB에는 NULL로 눕힌다 — 비교를 안 한다는 뜻이다.
CREATE TABLE supply_type (
  code            text PRIMARY KEY,          -- happy_youth · buy_new1 …
  category        text        NOT NULL,      -- 행복주택 · 매입임대 · 청년안심주택(공공) …
  name            text        NOT NULL,      -- 청년 · 신혼Ⅰ · 일반 …
  housing_type    housing_type,              -- notice.housing_type와 잇는 고리. 못 잇는 유형은 NULL
  sort_order      integer     NOT NULL,

  -- 신청자격
  age_min         integer     NOT NULL DEFAULT 0,
  age_max         integer     NOT NULL DEFAULT 999,
  age_exempt      text[]      NOT NULL DEFAULT '{}',   -- 이 계층이면 나이 제한을 넘겨도 된다
  marital         text        NOT NULL,      -- 미혼 · 혼인 · 무관
  marital_max_yr  integer     NOT NULL DEFAULT 0,      -- 혼인 n년 이내
  newborn_exempt  boolean     NOT NULL DEFAULT false,  -- 신생아가 있으면 혼인기간을 안 본다
  required_class  text[]      NOT NULL DEFAULT '{}',   -- 하나라도 해당해야 신청 가능한 계층
  homeless_scope  text        NOT NULL,      -- 무주택 판정 범위: 본인 · 세대원
  income_scope    text        NOT NULL,      -- 소득 합산 범위: 본인 · 세대 · 본인+부모 · 청년특공_분기 · 무관
  income_pct      integer,                   -- 도시근로자 월평균소득 대비 %. NULL이면 안 본다
  asset_scope     text        NOT NULL,
  asset_limit_man integer,                   -- 총자산 상한(만원). NULL이면 안 본다
  car_limit_man   integer,                   -- 자동차가액 상한(만원)
  region_limit    text        NOT NULL,      -- 전국 · 서울
  birth_bonus     boolean     NOT NULL DEFAULT false,  -- 출산 자녀 가산 있음
  note            text,

  -- 순위·배점 (「순위가점DB」 시트 원문). 배점 칸은 "24↑3/12↑2/6↑1" 같은 사람 말이라
  -- 계산기를 붙일 때 파서를 만든다. 지금은 화면에 그대로 보여 주는 값이라 jsonb로 통째 둔다.
  ranking_method  text,                      -- 우선→배점→추첨 · 추첨 · 선착순 …
  ranks           text[]      NOT NULL DEFAULT '{}',   -- 1순위 … 4순위 조건
  general_ranks   text[]      NOT NULL DEFAULT '{}',   -- 행복주택 일반공급 순위(거주지 기준)
  score           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE supply_type IS
  '공급유형별 신청자격·배점 사양. 공고와 무관한 제도 규칙이라 eligibility(공고별 자격 문구)와 다른 테이블이다';
COMMENT ON COLUMN supply_type.income_pct IS
  '도시근로자 가구원수별 월평균소득 대비 %. 실제 금액은 income_standard와 곱해서 얻는다';

CREATE INDEX idx_supply_type_order ON supply_type (sort_order);

-- 도시근로자 가구원수별 월평균소득 기준액
CREATE TABLE income_standard (
  year         integer NOT NULL,     -- 기준연도(고시연도). 2025년 값을 2026년에 적용한다
  household    integer NOT NULL,     -- 가구원수 1~7
  pct          integer NOT NULL,     -- 50 · 70 · 90 · 100 · 110 · 120 · 130 · 200
  monthly_won  bigint  NOT NULL,
  PRIMARY KEY (year, household, pct)
);

COMMENT ON TABLE income_standard IS '도시근로자 월평균소득 기준액. supply_type.income_pct와 곱해 자격 한도를 만든다';

-- 지역 등급 — 서울 / 연접지역 / 기타. 청년안심주택·행복주택 일반공급 순위가 이걸 쓴다
CREATE TABLE region_tier (
  name  text PRIMARY KEY,   -- 강남구 · 의정부시 · 인천광역시
  kind  text NOT NULL,      -- sigungu · sido
  tier  text NOT NULL       -- 서울 · 연접 · 기타
);

COMMENT ON TABLE region_tier IS '거주지 순위 판정용 지역 등급. 시도 단위(인천광역시)와 시군구 단위가 섞여 있어 kind로 가른다';
