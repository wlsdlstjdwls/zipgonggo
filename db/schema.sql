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

-- 임대주택 유형. 기관별 표기를 이 코드로 정규화한다(S5).
CREATE TYPE housing_type AS ENUM (
  '행복주택', '국민임대', '매입임대', '장기전세',
  '통합공공임대', '전세임대', '든든전세', '영구임대', '공공지원민간임대'
);

-- ─────────────────────────────────────────────────────────────
-- S1 · S2 — 공고
-- ─────────────────────────────────────────────────────────────

CREATE TABLE notice (
  id              bigserial PRIMARY KEY,
  slug            text        NOT NULL UNIQUE,  -- URL 식별자. 예: sh-2026-02-maeip
  fingerprint     text        NOT NULL UNIQUE,  -- 기관+공고명+게시일 해시. 중복 수집 방지
  agency          text        NOT NULL,         -- LH · SH · GH · HUG
  title           text        NOT NULL,
  housing_type    housing_type NOT NULL,
  sido            text        NOT NULL,
  posted_at       date        NOT NULL,
  apply_start_at  date,
  apply_end_at    date,                         -- 마감일. D-day의 근거
  announce_at     date,                         -- 발표일. 서울주거포털에만 있는 필드
  status          notice_status NOT NULL,
  source_url      text        NOT NULL,         -- 기관 원문 링크. 첨부는 재배포하지 않는다
  publish         publish_state NOT NULL DEFAULT 'parsed',
  unit_count      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  notice IS '입주자모집공고 1건. S1에서 수집, S2에서 상태·마감 갱신';
COMMENT ON COLUMN notice.fingerprint IS '기관+공고명+게시일 해시. 같은 공고를 여러 소스에서 받아도 한 행으로 모은다';
COMMENT ON COLUMN notice.announce_at IS '당첨자 발표일. 서울주거포털 SH 목록에만 있고 LH 목록에는 없다';
COMMENT ON COLUMN notice.publish IS '마감돼도 삭제하지 않고 closed로 둔다. URL을 죽이지 않는다';

CREATE INDEX idx_notice_apply_end   ON notice (apply_end_at DESC NULLS LAST) WHERE publish = 'published';
CREATE INDEX idx_notice_sido_type   ON notice (sido, housing_type)           WHERE publish = 'published';
CREATE INDEX idx_notice_posted      ON notice (posted_at DESC);

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
  slug          text        NOT NULL UNIQUE,  -- 서도휴빌3차-11200
  complex_code  text        NOT NULL UNIQUE,  -- 기관 단지코드
  name          text        NOT NULL,
  agency        text        NOT NULL,
  housing_type  housing_type,
  road_address  text,
  jibun_address text,
  sido          text        NOT NULL,
  sigungu       text        NOT NULL,
  eupmyeondong  text,
  household_cnt integer,
  building_cnt  integer,
  completed_on  date,
  geom          geography(Point, 4326),
  geo_precision geo_precision,
  publish       publish_state NOT NULL DEFAULT 'parsed',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE complex IS '임대주택 단지. 공고와 독립적으로 존재하며 역대 공고 이력을 모은다';

CREATE INDEX idx_complex_region ON complex (sido, sigungu, eupmyeondong);
CREATE INDEX idx_complex_geom   ON complex USING GIST (geom);

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
  complex_id   bigint      NOT NULL REFERENCES complex(id) ON DELETE CASCADE,
  housing_type housing_type,
  area_group   text,                    -- 면적 구간
  waiting_no   integer,                 -- 현재 대기 번호
  surveyed_on  date        NOT NULL,    -- 기준일
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (complex_id, housing_type, area_group, surveyed_on)
);

COMMENT ON TABLE waitlist IS '"이 단지 지금 몇 번까지 빠졌나". 벤치마크에 없는 차별화 데이터';

CREATE INDEX idx_waitlist_complex ON waitlist (complex_id, surveyed_on DESC);

-- ─────────────────────────────────────────────────────────────
-- S6 — 주소·좌표 매칭 결과
-- ─────────────────────────────────────────────────────────────

CREATE TABLE address_match (
  id             bigserial PRIMARY KEY,
  normalized_addr text       NOT NULL UNIQUE,  -- S5가 정규화한 도로명주소
  geom           geography(Point, 4326) NOT NULL,
  precision      geo_precision NOT NULL,
  matched_by     text        NOT NULL,   -- road_addr · building_name · jibun · dong_center
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE address_match IS
  '요약DB 오프라인 조인에 성공한 좌표만 담는다. 요약DB 전국 원본(수백만 행)은 pipeline/data/에 두고 여기 넣지 않는다';

CREATE INDEX idx_address_match_geom ON address_match USING GIST (geom);

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
  source      text        NOT NULL,   -- myhome_api · lh_scrape · sh_scrape · youth_scrape
  ok          boolean     NOT NULL,
  item_count  integer     NOT NULL DEFAULT 0,
  message     text,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ingest_log IS '수집 실패가 기존 페이지를 내리지 않도록, 실패도 기록만 하고 넘어간다';

CREATE INDEX idx_ingest_recent ON ingest_log (stage, finished_at DESC);
