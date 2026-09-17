-- 집공고 (zipgonggo) — 스키마
-- PostgreSQL 16 + PostGIS. Neon 기준.
--
-- 좌표 컬럼은 geography(Point, 4326)을 쓴다.
--   ST_DWithin이 미터 단위로 바로 동작해 "이 지점 반경 1km" 질의가 단순해지고,
--   국내 규모에서는 구면 계산 비용도 문제가 되지 않는다.
--   미터 정확도가 더 필요해지면 geometry(Point, 5179)(Korea 2000 / Unified CS)로 옮긴다.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ─────────────────────────────────────────────────────────────
-- 열거형
-- ─────────────────────────────────────────────────────────────

-- 공고 진행 상태. LH청약플러스 목록의 상태값을 그대로 따른다.
CREATE TYPE notice_status AS ENUM ('공고중', '접수중', '접수마감', '정정공고중');

-- 발행 상태. parsed/review는 색인 대상이 아니다.
CREATE TYPE publish_state AS ENUM ('parsed', 'review', 'published', 'closed', 'rejected');

-- 좌표 정확도. 호실 페이지는 building일 때만 색인한다.
CREATE TYPE geo_precision AS ENUM ('building', 'road', 'dong');

-- 공공임대 / 민간임대 (0004). 공공지원민간임대(청년안심주택 등)는 민간 사업자 공급이라 규율이 다르다
CREATE TYPE rental_sector AS ENUM ('공공임대', '민간임대');

-- 임대주택 유형. 기관별 표기를 이 코드로 정규화한다(S5).
-- 마이홈포털 API 공급유형 코드표(docs/api-spec/붙임1)와 1:1. '든든전세'만 HUG 자체 유형.
CREATE TYPE housing_type AS ENUM (
  '행복주택', '국민임대', '매입임대', '장기전세',
  '통합공공임대', '전세임대', '든든전세', '영구임대', '공공지원민간임대',
  '50년임대', '10년임대', '6년임대', '5년임대', '공공기숙사',
  '재개발임대', '청년안심주택'   -- SH 청약유형 (0006)
);

-- ─────────────────────────────────────────────────────────────
-- S1 · S2 — 공고
-- ─────────────────────────────────────────────────────────────

CREATE TABLE notice (
  id              bigserial PRIMARY KEY,
  slug            text        NOT NULL UNIQUE,  -- URL 식별자. 예: sh-2026-02-maeip
  fingerprint     text        NOT NULL,         -- sha256(기관|공고명|게시일|주택일련번호|원공고키). 소스 간 같은 공고 후보 힌트. UNIQUE 아님 (0005)
  source          text        NOT NULL,         -- myhome_api · myhome_file · lh_scrape · sh_scrape · youth_scrape
  source_key      text        UNIQUE,           -- 출처 내 고유키. 마이홈 API는 'pblancId:houseSn'
  amends_source_key text,                       -- 정정공고가 대체하는 원 공고의 source_key (API beforePblancId)
  canonical_id    bigint REFERENCES notice(id) ON DELETE SET NULL,  -- 이 공고의 정본. NULL이면 자기 자신 (0022, S2가 채운다)
  agency          text        NOT NULL,         -- LH · SH · GH · HUG
  title           text        NOT NULL,
  housing_type    housing_type NOT NULL,        -- 공급유형 (API suplyTyNm)
  sector          rental_sector NOT NULL DEFAULT '공공임대',  -- S1 도출: 공공지원민간임대 → 민간임대 (0004)
  house_type      text,                         -- 주택유형: 아파트·다가구주택·오피스텔… (API houseTyNm)
  sido            text        NOT NULL,
  sigungu         text,                         -- 매입임대 공고는 비어 온다
  complex_name    text,                         -- 단지형 공고만 (API hsmpNm)
  address         text,                         -- 공고 대표 주소, 도로명 우선 (API fullAdres). 매입임대는 빈값
  pnu             char(19),                     -- 필지고유번호. 좌표 조인 보조키
  heating         text,
  total_household integer,                      -- 단지 총세대수 (API totHshldCo)
  supply_count    integer,                      -- 이번 공고 공급호수 (API sumSuplyCo). unit_count는 파서가 센 값
  min_deposit     bigint,                       -- 최소 임대보증금(원). 범위의 하한이지 호실 금액이 아니다
  min_rent        bigint,                       -- 최소 월임대료(원)
  min_down_payment bigint,                      -- 최소 계약금
  min_interim     bigint,                       -- 최소 중도금
  min_balance     bigint,                       -- 최소 잔금
  posted_at       date        NOT NULL,         -- 공고일 (API rcritPblancDe)
  apply_start_at  date,                         -- API beginDe
  apply_end_at    date,                         -- 마감일. D-day의 근거 (API endDe)
  apply_start_tm  time,                         -- 접수 시작 시각(SH 첨부 흐름도). 없으면 NULL
  apply_end_tm    time,                         -- 접수 마감 시각. 마감일 당일 몇 시까지인지
  announce_at     date,                         -- 당첨자 발표일 (API przwnerPresnatnDe, SH 목록 발표일)
  status          notice_status NOT NULL,       -- 일정 기준으로 파이프라인이 도출
  source_status   text,                         -- 출처 원문 상태값: 일반공고·정정공고·접수중…
  source_url      text        NOT NULL,         -- 기관 원문 링크. 첨부는 재배포하지 않는다
  portal_url      text,                         -- 마이홈포털 상세 (API pcUrl)
  contact         text,                         -- 문의처 (API refrnc)
  publish         publish_state NOT NULL DEFAULT 'parsed',
  unit_count      integer     NOT NULL DEFAULT 0,
  raw             jsonb,                        -- 출처 응답 원문 1건. 재파싱·필드 추가 시 재수집 불필요
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  notice IS '입주자모집공고 1건. S1에서 수집, S2에서 상태·마감 갱신';
COMMENT ON COLUMN notice.fingerprint IS 'sha256(기관|공고명|게시일|주택일련번호|원공고키). 소스 간 같은 공고 후보를 묶는 힌트. UNIQUE 아님 — 정정공고 체인(2차 정정)에서 겹친다';
COMMENT ON COLUMN notice.announce_at IS '당첨자 발표일. 마이홈 API przwnerPresnatnDe 또는 서울주거포털 발표일. LH청약플러스 목록에는 없다';
COMMENT ON COLUMN notice.raw IS '출처 응답 원문. 마이홈 API는 {"items": [...]} — 시군구별로 쪼개진 행을 전부 담는다. 1건 약 1KB';
COMMENT ON COLUMN notice.min_deposit IS 'API rentGtn. 공고 내 최소값. 호실별 금액은 unit.deposit';
COMMENT ON COLUMN notice.publish IS '마감돼도 삭제하지 않고 closed로 둔다. URL을 죽이지 않는다';

-- publish='published' 조건 없음(0013) — web/lib/queries.ts가 publish 필터를 안 걸어 부분 인덱스가 죽어 있었다.
-- S8이 발행 게이팅을 도입하면 그때 다시 좁힌다.
CREATE INDEX idx_notice_apply_end   ON notice (apply_end_at DESC NULLS LAST);
CREATE INDEX idx_notice_sido_type   ON notice (sido, housing_type);
CREATE INDEX idx_notice_posted      ON notice (posted_at DESC);
CREATE INDEX idx_notice_pnu         ON notice (pnu) WHERE pnu IS NOT NULL;
CREATE INDEX idx_notice_sector_end  ON notice (sector, apply_end_at);
CREATE INDEX idx_notice_fingerprint ON notice (fingerprint);
CREATE INDEX idx_notice_canonical ON notice (canonical_id) WHERE canonical_id IS NOT NULL;

-- 공고 상태 변경 이력. "정정됨" 배지와 변경 타임라인의 근거
CREATE TABLE notice_event (
  id          bigserial PRIMARY KEY,
  notice_id   bigint      NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  event_type  text        NOT NULL,   -- created · status_changed · amended · attachment_replaced
  before_val  jsonb,
  after_val   jsonb,
  detected_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notice_event IS 'S2의 스냅샷 diff 결과. 신규/정정공고중/접수마감 전환을 기록';

CREATE INDEX idx_notice_event_notice ON notice_event (notice_id, detected_at DESC);

-- 공고의 시군구별 공급 내역. 마이홈 API가 매입임대·전세임대 공고를 시군구별 행으로 쪼개 준다 (0002)
CREATE TABLE notice_area (
  id           bigserial PRIMARY KEY,
  notice_id    bigint  NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  sido         text    NOT NULL,
  sigungu      text,                 -- 빈값이면 시도 전체 또는 미지정 행
  supply_count integer,              -- 해당 시군구 공급호수 (API sumSuplyCo)
  UNIQUE NULLS NOT DISTINCT (notice_id, sido, sigungu)
);

COMMENT ON TABLE notice_area IS '공고 1건의 시군구별 공급호수. API가 쪼개 준 행을 합산해 넣는다. notice.supply_count는 이 표의 합';

CREATE INDEX idx_notice_area_region ON notice_area (sido, sigungu);

-- ─────────────────────────────────────────────────────────────
-- S3 — 첨부 원본 스냅샷
-- ─────────────────────────────────────────────────────────────

CREATE TABLE raw_snapshot (
  id           bigserial PRIMARY KEY,
  notice_id    bigint      NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  file_name    text        NOT NULL,
  file_ext     text        NOT NULL,   -- pdf · hwp · hwpx · xlsx · csv
  file_hash    text        NOT NULL,   -- 정정공고로 파일이 교체되면 해시가 바뀐다
  local_path   text        NOT NULL,   -- pipeline/data/attachments/... (DB에는 경로만)
  has_text_layer boolean,              -- PDF만. false면 표 추출 불가 → 검수 큐
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, file_hash)
);

COMMENT ON TABLE  raw_snapshot IS '공고 첨부파일 메타. 파일 자체는 파이프라인 로컬에 두고 재배포하지 않는다';
COMMENT ON COLUMN raw_snapshot.file_hash IS '해시 변경 = 정정공고. notice_event.attachment_replaced를 발생시킨다';

-- ─────────────────────────────────────────────────────────────
-- 단지 (마이홈포털·LH 단지정보 API)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE complex (
  id            bigserial PRIMARY KEY,
  slug          text        NOT NULL UNIQUE,  -- 서도휴빌3차-30699540
  complex_code  text        NOT NULL UNIQUE,  -- 마이홈포털 단지 식별자 hsmpSn. 단지정보·대기현황 API 공통 키
  lh_code       text,                         -- LH 파일데이터 15080989 단지코드 (있을 때만)
  name          text        NOT NULL,         -- 매입임대는 '서울특별시 종로구'처럼 지역명이 온다
  agency        text        NOT NULL,         -- API insttNm 그대로: LH서울 · SH …
  housing_type  housing_type,
  road_address  text,                         -- API rnAdres
  jibun_address text,
  pnu           char(19),
  sido          text        NOT NULL,
  sido_code     text,                         -- 광역시도 코드 (API brtcCode)
  sigungu       text        NOT NULL,
  sigungu_code  text,                         -- 시군구 코드 (API signguCode)
  eupmyeondong  text,                         -- S5/S6이 주소에서 도출
  household_cnt integer,
  building_cnt  integer,                      -- LH 파일데이터 15080989에서만
  completed_on  date,
  geom          geography(Point, 4326),
  geo_precision geo_precision,
  publish       publish_state NOT NULL DEFAULT 'parsed',
  raw           jsonb,                        -- 단지정보 API 첫 행 원문
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  complex IS '임대주택 단지. 공고와 독립적으로 존재하며 역대 공고 이력을 모은다';
COMMENT ON COLUMN complex.complex_code IS '마이홈 hsmpSn. 단지정보 API(HWSPR04) 행은 단지×형이라 첫 행에서 단지 속성만 뽑아 넣고 형은 complex_type으로';

CREATE INDEX idx_complex_region ON complex (sido, sigungu, eupmyeondong);
CREATE INDEX idx_complex_geom   ON complex USING GIST (geom);
CREATE INDEX idx_complex_pnu    ON complex (pnu) WHERE pnu IS NOT NULL;

-- 단지 × 형(면적 타입). 단지정보 API HWSPR04의 실제 행 단위
CREATE TABLE complex_type (
  id              bigserial PRIMARY KEY,
  complex_id      bigint      NOT NULL REFERENCES complex(id) ON DELETE CASCADE,
  style_name      text        NOT NULL,        -- 형명 (API styleNm). '36' '39' '59A' …
  housing_type    housing_type,                -- 같은 단지에 공급유형이 섞일 수 있어 형 단위에 둔다
  house_type      text,                        -- API houseTyNm. 매입임대는 빈값
  exclusive_area  numeric(7,2),                -- 공급 전용면적 ㎡ (API suplyPrvuseAr). 합쳐진 줄이면 하한 (0031)
  exclusive_area_max numeric(7,2),             -- 합쳐진 행들의 전용면적 상한. 하한과 같으면 NULL (0031)
  common_area     numeric(7,2),                -- 공급 공용면적 ㎡ (API suplyCmnuseAr). 합쳐진 줄이면 하한
  common_area_max numeric(7,2),                -- 공용면적 상한. 하한과 같으면 NULL (0031)
  heating         text,                        -- API heatMthdDetailNm
  building_style  text,                        -- API buldStleNm
  has_elevator    boolean,                     -- API elvtrInstlAtNm
  parking_cnt     integer,                     -- API parkngCo
  base_deposit    bigint,                      -- 기본 임대보증금(원) (API bassRentGtn)
  base_rent       bigint,                      -- 기본 월임대료(원) (API bassMtRntchrg)
  conversion_deposit_limit bigint,             -- 기본 전환보증금 한도 (API bassCnvrsGtnLmt)
  row_count       integer     NOT NULL DEFAULT 1,  -- 이 줄로 합쳐진 API 행 수 (0031)
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- 금액까지 자연키에 넣는다(0031). 같은 형이 동·라인마다 면적만 조금 다른 행으로 여러 번 오는데
  -- 금액이 같으면 한 줄로 합쳐 면적을 범위로 적고, 금액이 다르면 실제로 다른 공급 조건이라 줄을 나눈다
  CONSTRAINT complex_type_identity
    UNIQUE NULLS NOT DISTINCT (complex_id, housing_type, style_name, base_deposit, base_rent)
);

COMMENT ON TABLE complex_type IS '단지 안의 면적 타입. 호실(unit)이 없어도 단지 페이지에 형별 보증금·임대료 표를 만든다';

CREATE INDEX idx_complex_type_complex ON complex_type (complex_id);

-- ─────────────────────────────────────────────────────────────
-- S4 — 호실
-- ─────────────────────────────────────────────────────────────

CREATE TABLE unit (
  id              bigserial PRIMARY KEY,
  notice_id       bigint      NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  complex_id      bigint      REFERENCES complex(id) ON DELETE SET NULL,
  unit_key        text        NOT NULL,   -- 공고 내 호실 식별자. URL의 마지막 세그먼트

  road_address    text        NOT NULL,
  jibun_address   text,
  complex_name    text,
  building        text,                   -- 동
  room            text,                   -- 호
  floor           integer,

  sido            text        NOT NULL,
  sigungu         text        NOT NULL,
  eupmyeondong    text,

  area_m2         numeric(7,2) NOT NULL,  -- 전용면적
  deposit         bigint      NOT NULL,   -- 기본 보증금(원)
  rent            bigint      NOT NULL,   -- 기본 월임대료(원)
  deposit_jeonse  bigint,                 -- 전세전환 보증금
  rent_jeonse     bigint,
  deposit_wolse   bigint,                 -- 월세전환 보증금
  rent_wolse      bigint,

  room_layout     text,                   -- 투룸 등
  has_elevator    boolean,
  subway_station  text,
  subway_walk_min integer,
  note            text,

  geom            geography(Point, 4326),
  geo_precision   geo_precision,

  publish         publish_state NOT NULL DEFAULT 'parsed',
  field_count     integer     NOT NULL DEFAULT 0,  -- 채워진 고유 필드 수. 8 이상이어야 색인
  source_id       bigint      REFERENCES raw_snapshot(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (notice_id, unit_key),

  -- 얇은 페이지 방지: 색인 대상은 고유 필드 8개 이상 + 건물 단위 좌표 (docs/url-structure.md)
  CONSTRAINT unit_publishable CHECK (
    publish <> 'published' OR (field_count >= 8 AND geo_precision = 'building')
  )
);

COMMENT ON TABLE  unit IS '공고 안의 개별 호실. pSEO 페이지의 최소 단위';
COMMENT ON COLUMN unit.field_count IS 'S8이 계산해 채운다. 8 미만이면 published로 전환되지 않는다';
COMMENT ON COLUMN unit.geom IS 'S6의 오프라인 주소-좌표 조인 결과. 지오코딩 API 응답을 넣지 않는다';

CREATE INDEX idx_unit_notice   ON unit (notice_id);
CREATE INDEX idx_unit_region   ON unit (sido, sigungu, eupmyeondong) WHERE publish = 'published';
CREATE INDEX idx_unit_deposit  ON unit (deposit)                     WHERE publish = 'published';
CREATE INDEX idx_unit_area     ON unit (area_m2)                     WHERE publish = 'published';
CREATE INDEX idx_unit_geom     ON unit USING GIST (geom);

-- ─────────────────────────────────────────────────────────────
-- S4b — 자격요건
-- ─────────────────────────────────────────────────────────────

CREATE TABLE eligibility (
  id             bigserial PRIMARY KEY,
  notice_id      bigint      NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  rank_order     integer,                 -- 1순위 · 2순위
  target         text,                    -- 청년 · 신혼부부 · 고령자 · 일반
  income_pct     integer,                 -- 도시근로자 월평균소득 대비 %
  asset_limit    bigint,                  -- 총자산 기준(원)
  car_limit      bigint,                  -- 자동차가액 기준(원)
  summary        text        NOT NULL,    -- 서술형 요약
  reviewed       boolean     NOT NULL DEFAULT false,  -- S4b는 검수 큐 필수 경유
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  eligibility IS '공고문의 자격·소득·자산 기준. 호실 주소보다 검색 수요가 크다';
COMMENT ON COLUMN eligibility.reviewed IS 'false면 발행하지 않는다. 자격요건 오류는 사용자에게 실질적 피해를 준다';

CREATE INDEX idx_eligibility_notice ON eligibility (notice_id, rank_order);

-- ─────────────────────────────────────────────────────────────
-- 예비입주자 대기현황 (마이홈포털 API 15108378)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE waitlist (
  id           bigserial PRIMARY KEY,
  complex_code text        NOT NULL,      -- 마이홈 hsmpSn. 단지정보를 아직 못 받았어도 적재한다
  complex_id   bigint      REFERENCES complex(id) ON DELETE SET NULL,  -- S5가 complex_code로 뒤에 연결
  agency       text,                      -- 임대사업자명 (API rtsInsttNm)
  complex_name text,
  road_address text,                      -- API rnAdres. 단지 미수집 시 좌표 조인 입력
  sido         text,
  sigungu      text,
  housing_type housing_type,              -- 공급유형 (API suplyTyNm)
  house_type   text,                      -- API houseTyNm
  style_name   text        NOT NULL DEFAULT '',  -- 형명 (API styleNm)
  draw_unit    text        NOT NULL DEFAULT '',  -- 추첨단위 (API drwtUnit)
  waiting_cnt  integer,                   -- 입주대기자 수 (API waitCo). 대기 번호가 아니다
  vacated_cnt  integer,                   -- 퇴거 건수 (API trmnatCo)
  surveyed_on  date        NOT NULL,      -- 수집일 기준. API에 기준일 필드가 없어 수집일을 쓴다
  raw          jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (complex_code, housing_type, style_name, draw_unit, surveyed_on)
);

COMMENT ON TABLE  waitlist IS '"이 단지 형별로 몇 명이 기다리고 얼마나 빠지나". 벤치마크에 없는 차별화 데이터';
COMMENT ON COLUMN waitlist.waiting_cnt IS 'API waitCo = 입주대기자 수. 대기순번이 아니므로 화면에서 "N명 대기"로 쓴다';

CREATE INDEX idx_waitlist_complex ON waitlist (complex_code, surveyed_on DESC);

-- ─────────────────────────────────────────────────────────────
-- S6 — 주소·좌표 매칭 결과
-- ─────────────────────────────────────────────────────────────

CREATE TABLE address_match (
  id             bigserial PRIMARY KEY,
  normalized_addr text       NOT NULL UNIQUE,  -- S5가 정규화한 도로명주소
  pnu            char(19),               -- 도로명 매칭 실패 시 필지 단위 보조키
  geom           geography(Point, 4326) NOT NULL,
  precision      geo_precision NOT NULL,
  matched_by     text        NOT NULL,   -- road_addr · building_name · pnu · jibun · dong_center
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE address_match IS
  '요약DB 오프라인 조인에 성공한 좌표만 담는다. 요약DB 전국 원본(수백만 행)은 pipeline/data/에 두고 여기 넣지 않는다';

CREATE INDEX idx_address_match_geom ON address_match USING GIST (geom);
CREATE INDEX idx_address_match_pnu  ON address_match (pnu) WHERE pnu IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- S7 — 검수 큐
-- ─────────────────────────────────────────────────────────────

CREATE TABLE review_queue (
  id            bigserial PRIMARY KEY,
  entity_type   text        NOT NULL,   -- unit · eligibility · notice
  entity_id     bigint      NOT NULL,
  reason        text        NOT NULL,   -- column_mismatch · deposit_out_of_range · area_out_of_range
                                        -- · geo_precision_low · unit_count_delta · eligibility_always
  payload       jsonb,
  resolved      boolean     NOT NULL DEFAULT false,
  resolution    text,                   -- approved · rejected
  reject_reason text,                   -- 파서 개선에 환류
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

COMMENT ON TABLE  review_queue IS '자동 발행 차단분. 승인 전까지 published로 넘어가지 않는다';
COMMENT ON COLUMN review_queue.reject_reason IS '반려 사유는 파서 개선 입력으로 되돌린다';

CREATE INDEX idx_review_pending ON review_queue (entity_type, created_at) WHERE resolved = false;

-- ─────────────────────────────────────────────────────────────
-- 수집 이력
-- ─────────────────────────────────────────────────────────────

CREATE TABLE ingest_log (
  id          bigserial PRIMARY KEY,
  stage       text        NOT NULL,   -- S1 ~ S8
  source      text        NOT NULL,   -- myhome_api · myhome_file · lh_scrape · sh_scrape · youth_scrape
  ok          boolean     NOT NULL,
  item_count  integer     NOT NULL DEFAULT 0,
  message     text,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ingest_log IS '수집 실패가 기존 페이지를 내리지 않도록, 실패도 기록만 하고 넘어간다';

CREATE INDEX idx_ingest_recent ON ingest_log (stage, finished_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 0007 — 공고별 공급 단지 (SH 첨부 공고문 「주택 위치 안내」 표)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE notice_complex (
  id            bigserial PRIMARY KEY,
  notice_id     bigint  NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  name          text    NOT NULL,                  -- 단지명 (공고문 표기 그대로, [신규] 표시는 뗌)
  sido          text    NOT NULL,                  -- 소재지에서 도출. 기본 서울특별시, 의정부 등 시외 단지는 경기도
  sigungu       text    NOT NULL,                  -- 자치구·시. 소재지 첫 토큰
  road_address  text    NOT NULL,                  -- 시군구부터 시작하는 도로명주소. 시외면 시도 포함
  zone          text,                              -- 지구명(세곡지구·마곡지구). 세로 병합 칸을 좌표로 복원해 채운다(sh_complex.py)
  is_new        boolean NOT NULL DEFAULT false,    -- 금회 신규공급 ([신규])
  source_page   integer,                           -- 첨부 공고문 쪽번호. 검수용
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, name, road_address)
);

COMMENT ON TABLE notice_complex IS '공고 1건이 공급하는 단지 목록. SH 첨부 공고문 「주택 위치 안내」 표(S3). 좌표 없음 — S6이 road_address로 조인';

CREATE INDEX idx_notice_complex_notice ON notice_complex (notice_id, sigungu, name);

-- 0008 — notice_complex 호실 집계 컬럼 (SH 별첨 주택목록)
ALTER TABLE notice_complex
  ADD COLUMN complex_code text,             -- 공고문 내 주택단지 코드 (0001J). 공고 안에서만 유일
  ADD COLUMN unit_count   integer,          -- 이 공고에서 공급하는 호실 수
  ADD COLUMN min_deposit  bigint,           -- 기준 임대보증금 최소(원)
  ADD COLUMN min_rent     bigint,           -- 기준 월임대료 최소(원)
  ADD COLUMN area_min     numeric(6,2),     -- 전용면적 최소(㎡)
  ADD COLUMN area_max     numeric(6,2);

COMMENT ON COLUMN notice_complex.unit_count IS 'SH 별첨 주택목록의 호실 수. 장기전세 「주택 위치 안내」 표에는 없어 NULL';

-- 0009 — notice 금액 상한·일정 출처 (SH 첨부 공고문 공급현황·일정 흐름도, S3)
ALTER TABLE notice
  ADD COLUMN max_deposit bigint,     -- 최대 임대보증금(원). 공고 내 최대값
  ADD COLUMN max_rent    bigint,     -- 최대 월임대료(원)
  ADD COLUMN schedule_source text;   -- 접수 일정 출처: 'api'(마이홈) · 'attachment'(SH 첨부 파싱) · NULL(없음)

COMMENT ON COLUMN notice.max_deposit IS '공고 내 최대 임대보증금(원). SH 첨부 공급현황 표(S3)에서 채움. 마이홈 API에는 없어 NULL';
COMMENT ON COLUMN notice.max_rent IS '공고 내 최대 월임대료(원). SH 첨부 표에서 채움';
COMMENT ON COLUMN notice.schedule_source IS '접수 일정 출처. attachment면 SH 첨부 공고문 일정 흐름도에서 좌표 기반으로 읽은 값';

-- 0010 — 원본 목록 순번 (같은 공고일 안에서 기관 목록 순서 유지)
ALTER TABLE notice ADD COLUMN source_rank integer;
COMMENT ON COLUMN notice.source_rank IS '수집 시 원본 목록에서의 순번(1이 맨 위). 같은 posted_at 안 정렬 기준';
CREATE INDEX idx_notice_posted_rank ON notice (posted_at DESC, source_rank, id DESC);

-- 0011 — 공고별 공급현황 줄 (SH 첨부 공고문 「공급현황」 표, S3)
--
-- 단지 목록(notice_complex)보다 한 단계 잘다: 단지 × 공급유형(㎡) × 공급대상(계층) × 소득옵션.
-- 여기에만 있는 사실 — 공가 호수, 예비입주자 모집 호수, 우선/일반 배분, 계약면적 3종, 계층별 보증금·월임대료, 입주시작 예정.
-- 2026년 2차 행복주택 기준 단지 62곳 / 공급 82건 / 금액 줄 106건. 「단지별 주소」 표만 읽던 때는 62곳뿐이었다.

CREATE TABLE notice_supply (
  id           bigserial PRIMARY KEY,
  notice_id    bigint NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  complex_id   bigint REFERENCES notice_complex(id) ON DELETE SET NULL,  -- 단지명으로 이어 붙인다. 못 붙으면 NULL
  complex_name text NOT NULL,                 -- 표에 적힌 단지명(공고문 표기 그대로)

  supply_type  text    NOT NULL,              -- 공급유형 "39" · "29S". 숫자는 전용면적 반올림, S는 주거약자용
  accessible   boolean NOT NULL DEFAULT false,-- 주거약자용(S형)
  tenant_class text    NOT NULL,              -- 공급대상 계층: 신혼부부 · 청년 · 고령자 · 대학생 · 주거급여수급자
  income_option text,                         -- 청년만: 소득있음 · 소득없음
  is_new       boolean NOT NULL DEFAULT false,-- [신규 공급] 구간. 재공급이면 false

  units_total     integer,                    -- 공급호수 합계(재공급은 A+B)
  units_priority  integer,                    -- 우선공급
  units_general   integer,                    -- 일반공급
  units_reserve   integer,                    -- 금회 공급할 예비입주자(B). 신규 공급 표에는 없어 NULL

  deposit      bigint,                        -- 임대보증금 계(원)
  down_payment bigint,                        -- 계약금 20%(원)
  balance      bigint,                        -- 잔금 80%(원)
  rent         bigint,                        -- 월임대료(원)
  deposit_options jsonb,                      -- 보증금 비율별 (보증금, 월임대료) 옵션(0025). 민간임대 공고문 표. deposit·rent는 보증금 최저 옵션

  area_exclusive numeric(7,2),                -- 주거전용
  area_common    numeric(7,2),                -- 주거공용
  area_etc       numeric(7,2),                -- 기타공용
  area_total     numeric(7,2),                -- 세대별 계약면적 합계

  move_in_from text,                          -- 입주시작(예정) 원문 표기 "’27.4". 신규 공급만
  source_page  integer,                       -- 첨부 공고문 쪽번호. 검수용
  created_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (notice_id, complex_name, supply_type, tenant_class, income_option)
);

COMMENT ON TABLE  notice_supply IS '공고 1건의 공급현황 표 한 줄. SH 첨부 공고문 「공급현황」(S3). 단지 × 공급유형 × 공급대상';
COMMENT ON COLUMN notice_supply.units_reserve IS '재공급 표의 「금회 공급할 예비입주자(B)」. 공가가 없어도 대기자를 뽑는 단지가 있다';
COMMENT ON COLUMN notice_supply.units_priority IS '재공급 표에서는 공가(A) 중 우선공급분. 신규 공급 표에서는 공급호수 중 우선공급분';

CREATE INDEX idx_notice_supply_notice  ON notice_supply (notice_id, complex_name, supply_type);
CREATE INDEX idx_notice_supply_complex ON notice_supply (complex_id) WHERE complex_id IS NOT NULL;

-- 0012 — 단지 난방방식 (SH 「단지별 주소」 표의 마지막 열)
-- 표에는 있는데 안 읽고 버리던 값. 단지 상세에 노출한다.
ALTER TABLE notice_complex ADD COLUMN heating text;
COMMENT ON COLUMN notice_complex.heating IS '난방방식(개별난방·지역난방·중앙난방). SH 「단지별 주소」 표. 다른 양식에는 없어 NULL';

-- 0014 — 회차 결과: 경쟁률·합격선 (result_post · notice_result)
--
-- i-sh 게시판에는 모집공고와 별개로 결과 글이 올라온다. ish_title이 「공고가 아니다」라며
-- 버리던 글들인데, 첨부에 계층별·단지별 경쟁률과 합격선이 들어 있다. 과거 실적은 우리가
-- SH 원문에서 직접 뽑는다 — 제3자 집계를 옮겨오지 않는다.
--
-- 실측 2026-09-09: 게시판을 `isRecrnoti=Y`(모집공고만)로 받으면 결과 글이 449건 중 19건뿐이다.
-- 필터를 풀면 6개월치 400건에 111건 — 아카이브 전체로는 수천 건이다.

-- 결과 글 원장. 원 공고를 못 찾은 글도 남겨 백필을 다시 돌릴 수 있게 한다.
CREATE TABLE result_post (
  seq         text PRIMARY KEY,                 -- i-sh 게시글 seq
  agency      text    NOT NULL DEFAULT 'SH',
  title       text    NOT NULL,
  posted_at   date    NOT NULL,                 -- 결과 글 등록일
  result_kind text    NOT NULL,                 -- competition(경쟁률) · winner(당첨자 발표)
  notice_date date,                             -- 제목이 인용한 원 공고일. 원 공고를 잇는 열쇠
  reserve_round integer,                        -- 예비 N차 발표. 본 발표는 NULL
  notice_id   bigint  REFERENCES notice(id) ON DELETE SET NULL,
  row_count   integer NOT NULL DEFAULT 0,       -- 파싱해 넣은 줄 수
  parsed_at   timestamptz,                      -- NULL이면 아직 첨부를 안 읽었다
  note        text,                             -- 못 붙인 이유·파서 실패 사유
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  result_post IS 'i-sh 게시판 결과 글 원장. 원 공고를 못 찾아도 남긴다 — 나중에 공고가 들어오면 다시 잇는다';
COMMENT ON COLUMN result_post.notice_date IS '제목이 인용한 원 공고일 「(2025.04.25.공고)」. 제목 문자열을 맞추는 것보다 튼튼하다';

CREATE INDEX idx_result_post_pending ON result_post (notice_date) WHERE notice_id IS NULL;
CREATE INDEX idx_result_post_unparsed ON result_post (posted_at DESC) WHERE parsed_at IS NULL;

-- 결과 표 한 줄. 단지 × 공급유형 × 계층 × 구분(우선·일반·순위).
CREATE TABLE notice_result (
  id            bigserial PRIMARY KEY,
  notice_id     bigint  NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  post_seq      text    NOT NULL REFERENCES result_post(seq) ON DELETE CASCADE,
  result_kind   text    NOT NULL,

  -- 빈 문자열을 쓴다. NULL은 UNIQUE에서 서로 다른 값으로 쳐서 같은 줄이 여러 번 들어온다
  complex_name  text    NOT NULL DEFAULT '',
  sigungu       text    NOT NULL DEFAULT '',    -- 단지명만 있는 양식은 빈 값 — notice_complex로 채울 수 있다
  supply_kind   text    NOT NULL DEFAULT '',    -- 재공급 · 신규공급. 매입임대 양식에만 있다 (0015)
  address       text    NOT NULL DEFAULT '',    -- 표의 소재지. 매입임대 양식에만 있다. 좌표 조인 키 (0016)
  row_no        integer NOT NULL DEFAULT 0,     -- 결과 글 안에서의 줄 번호(1부터) (0016)
  supply_type   text    NOT NULL DEFAULT '',    -- 면적 표기 "29S" · "20A" · "41C"
  tenant_class  text    NOT NULL DEFAULT '',    -- 계층 "청년" · "신혼부부" · "고령자"
  bracket       text    NOT NULL,               -- 우선 · 일반 · 1순위 … · 소계

  units         integer,                        -- 모집호수
  applicants    integer,                        -- 신청자수
  ratio         numeric(9,1),                   -- 경쟁률

  -- Synap 텍스트 레이어가 글자를 흘린다. 산술(계 = 인터넷 + 방문, 경쟁률 = 계 ÷ 모집)이
  -- 맞아떨어진 줄만 reconciled. 화면은 reconciled인 줄만 쓴다 — 조용히 틀린 숫자를 싣지 않는다.
  reconciled    boolean NOT NULL DEFAULT true,
  repaired      boolean NOT NULL DEFAULT false, -- 인쇄된 값이 아니라 성한 칸에서 산술로 채운 값
  source_page   integer,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- 정체성은 「문서에서의 자리」다. 같은 자치구에 이름이 같은 건물이 있어(금천구 「2동」)
  -- 단지명·주택형·순위로는 못 가른다 — 자연키로 잡으면 줄이 조용히 사라진다 (0016)
  CONSTRAINT notice_result_row_key UNIQUE (post_seq, row_no)
);

COMMENT ON TABLE  notice_result IS '공고 회차의 결과 표 한 줄. i-sh 결과 글 첨부(sh_competition 파서)';
COMMENT ON COLUMN notice_result.reconciled IS 'false면 원문 텍스트가 상해 못 믿는 줄. 집계·화면에서 뺀다';

CREATE INDEX idx_notice_result_notice  ON notice_result (notice_id, tenant_class, bracket);
CREATE INDEX idx_notice_result_complex ON notice_result (complex_name, tenant_class) WHERE reconciled;

-- 0014 — 회차 결과: 경쟁률·합격선 (result_post · notice_result)
--
-- i-sh 게시판에는 모집공고와 별개로 결과 글이 올라온다. ish_title이 「공고가 아니다」라며
-- 버리던 글들인데, 첨부에 계층별·단지별 경쟁률과 합격선이 들어 있다. 과거 실적은 우리가
-- SH 원문에서 직접 뽑는다 — 제3자 집계를 옮겨오지 않는다.
--
-- 실측 2026-09-09: 게시판을 `isRecrnoti=Y`(모집공고만)로 받으면 결과 글이 449건 중 19건뿐이다.
-- 필터를 풀면 6개월치 400건에 111건 — 아카이브 전체로는 수천 건이다.

-- 결과 글 원장. 원 공고를 못 찾은 글도 남겨 백필을 다시 돌릴 수 있게 한다.
CREATE TABLE result_post (
  seq         text PRIMARY KEY,                 -- i-sh 게시글 seq
  agency      text    NOT NULL DEFAULT 'SH',
  title       text    NOT NULL,
  posted_at   date    NOT NULL,                 -- 결과 글 등록일
  result_kind text    NOT NULL,                 -- competition(경쟁률) · winner(당첨자 발표)
  notice_date date,                             -- 제목이 인용한 원 공고일. 원 공고를 잇는 열쇠
  reserve_round integer,                        -- 예비 N차 발표. 본 발표는 NULL
  notice_id   bigint  REFERENCES notice(id) ON DELETE SET NULL,
  row_count   integer NOT NULL DEFAULT 0,       -- 파싱해 넣은 줄 수
  parsed_at   timestamptz,                      -- NULL이면 아직 첨부를 안 읽었다
  note        text,                             -- 못 붙인 이유·파서 실패 사유
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  result_post IS 'i-sh 게시판 결과 글 원장. 원 공고를 못 찾아도 남긴다 — 나중에 공고가 들어오면 다시 잇는다';
COMMENT ON COLUMN result_post.notice_date IS '제목이 인용한 원 공고일 「(2025.04.25.공고)」. 제목 문자열을 맞추는 것보다 튼튼하다';

CREATE INDEX idx_result_post_pending ON result_post (notice_date) WHERE notice_id IS NULL;
CREATE INDEX idx_result_post_unparsed ON result_post (posted_at DESC) WHERE parsed_at IS NULL;

-- 결과 표 한 줄. 단지 × 공급유형 × 계층 × 구분(우선·일반·순위).
CREATE TABLE notice_result (
  id            bigserial PRIMARY KEY,
  notice_id     bigint  NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  post_seq      text    NOT NULL REFERENCES result_post(seq) ON DELETE CASCADE,
  result_kind   text    NOT NULL,

  -- 빈 문자열을 쓴다. NULL은 UNIQUE에서 서로 다른 값으로 쳐서 같은 줄이 여러 번 들어온다
  complex_name  text    NOT NULL DEFAULT '',
  sigungu       text    NOT NULL DEFAULT '',    -- 단지명만 있는 양식은 빈 값 — notice_complex로 채울 수 있다
  supply_kind   text    NOT NULL DEFAULT '',    -- 재공급 · 신규공급. 매입임대 양식에만 있다 (0015)
  address       text    NOT NULL DEFAULT '',    -- 표의 소재지. 매입임대 양식에만 있다. 좌표 조인 키 (0016)
  row_no        integer NOT NULL DEFAULT 0,     -- 결과 글 안에서의 줄 번호(1부터) (0016)
  supply_type   text    NOT NULL DEFAULT '',    -- 면적 표기 "29S" · "20A" · "41C"
  tenant_class  text    NOT NULL DEFAULT '',    -- 계층 "청년" · "신혼부부" · "고령자"
  bracket       text    NOT NULL,               -- 우선 · 일반 · 1순위 … · 소계

  units         integer,                        -- 모집호수
  applicants    integer,                        -- 신청자수
  ratio         numeric(9,1),                   -- 경쟁률

  -- Synap 텍스트 레이어가 글자를 흘린다. 산술(계 = 인터넷 + 방문, 경쟁률 = 계 ÷ 모집)이
  -- 맞아떨어진 줄만 reconciled. 화면은 reconciled인 줄만 쓴다 — 조용히 틀린 숫자를 싣지 않는다.
  reconciled    boolean NOT NULL DEFAULT true,
  repaired      boolean NOT NULL DEFAULT false, -- 인쇄된 값이 아니라 성한 칸에서 산술로 채운 값
  source_page   integer,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- 정체성은 「문서에서의 자리」다. 같은 자치구에 이름이 같은 건물이 있어(금천구 「2동」)
  -- 단지명·주택형·순위로는 못 가른다 — 자연키로 잡으면 줄이 조용히 사라진다 (0016)
  CONSTRAINT notice_result_row_key UNIQUE (post_seq, row_no)
);

COMMENT ON TABLE  notice_result IS '공고 회차의 결과 표 한 줄. i-sh 결과 글 첨부(sh_competition 파서)';
COMMENT ON COLUMN notice_result.reconciled IS 'false면 원문 텍스트가 상해 못 믿는 줄. 집계·화면에서 뺀다';

CREATE INDEX idx_notice_result_notice  ON notice_result (notice_id, tenant_class, bracket);
CREATE INDEX idx_notice_result_complex ON notice_result (complex_name, tenant_class) WHERE reconciled;
CREATE INDEX idx_notice_result_address ON notice_result (address) WHERE address <> '';

-- 0017 — 공고 일정 흐름도의 나머지 단계 (SH 첨부 「입주자 모집 절차 및 일정」, S3)
-- 접수·발표 말고 「서류심사 대상자 발표」·「서류 제출」·「계약 체결」도 싣는다. 단계 구성이 유형마다 달라
-- 고정 칸 대신 순서 있는 JSON 배열: [{"label","start","end"}] — end가 null이면 하루짜리.
ALTER TABLE notice ADD COLUMN schedule_steps jsonb;
COMMENT ON COLUMN notice.schedule_steps IS
  'SH 첨부 일정 흐름도에서 읽은 접수·발표 외 단계. [{label,start,end}] 순서 배열. end가 null이면 하루';

-- 0024 — 공고문에서 읽은 신청자격 묶음 (SH 장기전세 6~8쪽·30~32쪽)
-- 순위 한 줄 = 행 하나인 eligibility로는 신청면적 × 순위 × 출생자녀 가산 × 맞벌이 매트릭스, 동일순위 선정 순서,
-- 가감점 배점표를 담을 수 없어 공고 1건에 묶음 하나를 jsonb로 둔다. 모양은 pipeline sh_eligibility.Eligibility.as_json()과
-- web/types/eligibility.ts NoticeEligibilityData가 같이 든다. verified는 소득표 검산(100% 기준액 × %) 통과 여부.
CREATE TABLE notice_eligibility (
  notice_id     bigint      PRIMARY KEY REFERENCES notice(id) ON DELETE CASCADE,
  source        text        NOT NULL,                 -- sh_attach
  source_pages  integer[]   NOT NULL DEFAULT '{}',    -- 공고문 쪽 번호(화면의 「공고문 n쪽」 출처 표기)
  data          jsonb       NOT NULL,
  verified      boolean     NOT NULL DEFAULT false,
  parsed_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  notice_eligibility IS '공고문의 신청자격 묶음(소득기준·신청순위·가산·자산·선정순서·배점표). 공고당 1행, jsonb';
COMMENT ON COLUMN notice_eligibility.verified IS '소득표 검산 통과 여부. false면 화면은 소득표 금액을 내보내지 않는다';

-- 0025 — 보증금 비율별 옵션 (민간임대 첨부 표)
-- 같은 호실이 보증금 비율에 따라 여러 (보증금, 월임대료) 짝을 갖는다. 고정 칸으로는 못 담아 배열로 둔다.
ALTER TABLE notice_supply
  ADD COLUMN deposit_options jsonb;
COMMENT ON COLUMN notice_supply.deposit_options IS
  '보증금 비율별 (보증금, 월임대료) 옵션 목록. 민간임대(youth_attach) 공고문 표에서 채움. deposit·rent는 이 중 보증금이 가장 낮은 옵션';

-- 0026 — 청년안심주택 포털 단지 이미지 + 단지 연결 코드
ALTER TABLE notice_complex ADD COLUMN youth_home_code text;
COMMENT ON COLUMN notice_complex.youth_home_code IS
  '청년안심주택 포털 단지코드(homeCode). 단지명·주소로 대조해 붙인다. 포털에서 내려간 옛 단지는 NULL';
CREATE INDEX idx_notice_complex_youth_home ON notice_complex (youth_home_code) WHERE youth_home_code IS NOT NULL;

CREATE TABLE youth_house_image (
  id          bigserial   PRIMARY KEY,
  home_code   text        NOT NULL,
  kind        text        NOT NULL,              -- 평면도 · 전경 · 투시도 · 편의시설
  sply_ty     text        NOT NULL DEFAULT '',   -- 주택형. 포털 평면도는 주택형을 안 밝혀 대개 빈 문자열
  label       text,                              -- 화면 표기. 편의시설 사진은 포털이 캡션을 짝지어 주지 않아 NULL
  source_url  text        NOT NULL,              -- 포털 원본 URL. 재수집·출처 표시용
  file_name   text        NOT NULL,              -- 우리가 저장한 파일명. 지면은 이걸로 찾는다
  bytes       integer,
  sort_no     integer     NOT NULL DEFAULT 0,
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (home_code, source_url)
);
COMMENT ON TABLE youth_house_image IS
  '청년안심주택 포털 단지 이미지. 공고가 아니라 단지(homeCode)에 붙는다 — 한 단지가 여러 공고에 되풀이 나온다';
COMMENT ON COLUMN youth_house_image.kind IS
  '평면도·전경·투시도·편의시설. 포털 상세의 article 구역과 img alt로 가른다';
COMMENT ON COLUMN youth_house_image.file_name IS
  '저장 파일명. 지금은 로컬 PoC라 web/public/youth-house/{home_code}/{file_name}에 둔다. 발행 때 스토리지로 옮긴다';
CREATE INDEX idx_youth_house_image_lookup ON youth_house_image (home_code, kind, sply_ty, sort_no);

-- 0027 — 청년안심주택 포털 단지 사실 (공고문에 없는 관리비·운영사·입주예정일)
CREATE TABLE youth_house (
  home_code    text        PRIMARY KEY,           -- 포털 단지코드. notice_complex.youth_home_code가 가리킨다
  name         text        NOT NULL,              -- 포털 표기(`홍대입구역 맹그로브창천`) — 역세권 접두사가 붙어 있다
  address      text,
  sigungu      text,
  maint_low    integer,
  maint_high   integer,
  households   integer,                           -- 총 세대수(movinHoman)
  manager      text,                              -- 운영사(managerComp)
  developer    text,                              -- 시행사
  builder      text,                              -- 시공사
  movein       date,                              -- 입주(예정)일
  phone        text,
  homepage     text,
  subway       text,                              -- `홍대입구역 2호선, 경의중앙선, 공항철도`
  scale        text,                              -- `총 288 세대 (공공임대 92 세대, 공공지원민간임대 196 세대)`
  source_url   text        NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE youth_house IS
  '청년안심주택 포털 단지 사실. 공고문 첨부에 없는 값(관리비·운영사·입주예정일)을 지면에 싣는다';
COMMENT ON COLUMN youth_house.maint_low IS
  '월 관리비 하한(원). 포털의 청년 기준값. 실제 청구액이 아니라 (예상)관리비다 — 화면에 그렇게 적는다';
COMMENT ON COLUMN youth_house.maint_high IS
  '월 관리비 상한(원). 포털의 신혼부부 기준값. 하한과 같으면 화면은 한 값으로 적는다';

-- 0028 — IndexNow 제출 이력(공고). updated_at은 내용과 무관하게 움직여 신호로 못 쓴다 — 지면 내용 해시를 본다
ALTER TABLE notice ADD COLUMN indexnow_at   timestamptz;
ALTER TABLE notice ADD COLUMN indexnow_hash text;
COMMENT ON COLUMN notice.indexnow_at IS
  'IndexNow에 이 공고 URL을 마지막으로 제출한 시각. NULL이면 아직 한 번도 안 알렸다';
COMMENT ON COLUMN notice.indexnow_hash IS
  '마지막 제출 때의 지면 내용 해시. 이 값이 그대로면 다시 쏘지 않는다(updated_at은 내용과 무관하게 움직인다)';
CREATE INDEX notice_indexnow_pending_idx
  ON notice (indexnow_at NULLS FIRST, posted_at DESC)
  WHERE canonical_id IS NULL;

-- 0029 — 방문 집계. web이 직접 쓰는 유일한 표(CLAUDE.md의 예외)
CREATE TABLE page_view (
  id            bigserial   PRIMARY KEY,
  visitor_id    uuid        NOT NULL,          -- 브라우저가 만든 난수. 사람 식별자가 아니다
  path          text        NOT NULL,          -- 경로만. 쿼리스트링은 떼고 받는다
  referrer_host text,                          -- 유입 도메인. NULL이면 직접 유입
  entry         boolean     NOT NULL DEFAULT false,  -- 이 방문의 첫 조회. 유입 집계는 이 행만 센다
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE  page_view IS '방문 집계. web이 직접 쓰는 유일한 표(/api/track). 12개월 뒤 지운다';
COMMENT ON COLUMN page_view.visitor_id IS 'localStorage의 난수 UUID. 브라우저 데이터를 지우면 새 값이 된다';
COMMENT ON COLUMN page_view.entry IS
  '페이지를 새로 연 첫 조회. 클라이언트 라우팅으로 옮겨 다닐 때는 document.referrer가 안 바뀌어 유입 출처가 거짓이 된다';
CREATE INDEX page_view_recent  ON page_view (created_at DESC);
CREATE INDEX page_view_path    ON page_view (path, created_at DESC);
CREATE INDEX page_view_visitor ON page_view (visitor_id, created_at DESC);
CREATE INDEX page_view_entry   ON page_view (created_at DESC) WHERE entry;

-- 0030 — 공고 아닌 URL의 IndexNow 제출 이력.
-- 단지·유형 허브·지역은 붙일 행이 없거나(허브·지역) 수집마다 replace되는 표라(단지) URL 자체를 열쇠로 쓴다.
-- 발행 대상은 배포된 sitemap.xml에서 읽는다 — 판정식이 web에 하나뿐이라 베껴 쓰면 두 벌이 된다.
CREATE TABLE indexnow_url (
  url          text PRIMARY KEY,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE indexnow_url IS
  '공고 상세가 아닌 발행 URL(단지/유형/지역/정책문서)의 IndexNow 제출 이력. 있으면 이미 알린 것이다';
COMMENT ON COLUMN indexnow_url.submitted_at IS
  '처음 제출한 시각. 갱신하지 않는다 — 이 표는 재발행 신호가 아니라 「알렸다」는 사실만 든다';
