-- 0008 — notice_complex에 호실 집계 컬럼
--
-- SH 매입임대 공고문 「[별첨1] 주택목록」은 호실 단위(호·전용면적·보증금·임대료)로 온다.
-- 호실 표(unit)는 Phase 2에서 채우고, 지금은 단지(주택단지 코드) 단위로 묶어 개수·최소 금액·면적 범위만 둔다.
-- 보증금·임대료는 감추지 않는다(CLAUDE.md 하지 말 것 3).

ALTER TABLE notice_complex
  ADD COLUMN complex_code text,             -- 공고문 내 주택단지 코드 (0001J). 공고 안에서만 유일
  ADD COLUMN unit_count   integer,          -- 이 공고에서 공급하는 호실 수
  ADD COLUMN min_deposit  bigint,           -- 기준 임대보증금 최소(원)
  ADD COLUMN min_rent     bigint,           -- 기준 월임대료 최소(원)
  ADD COLUMN area_min     numeric(6,2),     -- 전용면적 최소(㎡)
  ADD COLUMN area_max     numeric(6,2);

COMMENT ON COLUMN notice_complex.unit_count IS 'SH 별첨 주택목록의 호실 수. 장기전세 「주택 위치 안내」 표에는 없어 NULL';
