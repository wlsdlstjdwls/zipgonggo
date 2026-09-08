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
