-- 0009 — notice 금액 상한 (SH 첨부 공고문 공급현황 표에서 채움)
-- min_deposit/min_rent 는 하한, 여기 max_* 는 상한. 화면은 "2.6억~11.7억"처럼 범위로 보여준다.
ALTER TABLE notice
  ADD COLUMN max_deposit bigint,     -- 최대 임대보증금(원). 공고 내 최대값
  ADD COLUMN max_rent    bigint,     -- 최대 월임대료(원)
  ADD COLUMN schedule_source text;   -- 접수 일정 출처: 'api'(마이홈) · 'attachment'(SH 첨부 공고문 파싱) · NULL(없음)

COMMENT ON COLUMN notice.max_deposit IS '공고 내 최대 임대보증금(원). SH 첨부 공급현황 표(S3)에서 채움. 마이홈 API에는 없어 NULL';
COMMENT ON COLUMN notice.max_rent IS '공고 내 최대 월임대료(원). SH 첨부 표에서 채움';
COMMENT ON COLUMN notice.schedule_source IS '접수 일정 출처. attachment면 SH 첨부 공고문 일정 흐름도에서 좌표 기반으로 읽은 값';
