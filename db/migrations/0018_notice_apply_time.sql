-- 접수 시작·마감 시각. 공고문에는 「2026. 9. 28.(월) 10:00 ~ 2026. 9. 30.(수) 17:00」처럼 시각까지 적혀 있는데
-- 날짜만 담아 화면에서 시간이 보이지 않았다(사용자 지적 2026-09-09).
-- 흐름도에 시각이 없는 양식(장기전세·행복주택 일부)도 있어 NULL을 그대로 둔다 — 없는 시각을 지어내지 않는다.
-- 출처는 apply_start_at·apply_end_at과 같다(schedule_source).
ALTER TABLE notice ADD COLUMN IF NOT EXISTS apply_start_tm time;
ALTER TABLE notice ADD COLUMN IF NOT EXISTS apply_end_tm   time;

COMMENT ON COLUMN notice.apply_start_tm IS '접수 시작 시각. SH 첨부 공고문 일정 흐름도에서 읽는다. 없으면 NULL';
COMMENT ON COLUMN notice.apply_end_tm   IS '접수 마감 시각. 마감일 당일 몇 시까지인지 — D-day만큼 급한 값이다';

-- schedule_steps(jsonb) 한 칸에도 start_time·end_time("HH:MM")이 붙는다. 스키마는 그대로(jsonb).
COMMENT ON COLUMN notice.schedule_steps IS
  '흐름도의 접수·발표 외 단계. [{label, start, end, start_time, end_time}] 순서대로. 시각은 공고문에 있을 때만';
