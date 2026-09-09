-- 0021 — 첨부 별첨 주택목록의 호실을 unit에 적재할 수 있게 한다
--
-- parsers/sh_units.py는 매입임대 「[별첨1] 주택목록」에서 이미 호실 단위로 읽고 있었다 —
-- 동·호·전용면적·구조(원룸/투룸)·승강기·기준/전세전환/월세전환 금액까지. 그런데 S3은 단지 집계(notice_complex)만
-- 넣고 호실 행은 버렸다(실측 2026-09-09: unit 0건). 단지 상세에서 "동호수별로 보고 싶다"는 요청(2026-09-09)의 재료가 여기 있다.
--
-- unit은 원래 마이홈 단지(complex)에 매달리도록 설계됐는데, 지금 채워지는 건 공고 안의 단지(notice_complex)다.
-- 그래서 연결 컬럼을 하나 더 두고, 별첨에서 안 읽히는 값(면적·월임대료)은 NULL을 허용한다.

ALTER TABLE unit
  ADD COLUMN notice_complex_id bigint REFERENCES notice_complex(id) ON DELETE CASCADE,
  ADD COLUMN elevator     text,      -- 원문 표기: 전체동 설치 · 일부 설치 · 미설치
  ADD COLUMN seq          integer,   -- 별첨 연번. 원문 대조용
  ADD COLUMN source_page  integer;

COMMENT ON COLUMN unit.notice_complex_id IS
  '공고 안 단지(notice_complex). 마이홈 단지(complex_id)와 별개 — 매입임대 별첨은 공고 안에서만 유일한 코드(0001J)를 쓴다';
COMMENT ON COLUMN unit.elevator IS '승강기 원문 표기. has_elevator는 「미설치」만 false로 접은 값';

-- 별첨에 값이 없는 칸이 있다(면적 소수점 유실, 장기전세형은 월임대료 자체가 없음).
-- 0을 채워 넣느니 NULL로 둔다 — 화면이 「원문 확인」으로 갈린다.
ALTER TABLE unit
  ALTER COLUMN area_m2 DROP NOT NULL,
  ALTER COLUMN deposit DROP NOT NULL,
  ALTER COLUMN rent    DROP NOT NULL;

CREATE INDEX idx_unit_notice_complex ON unit (notice_complex_id, building NULLS FIRST, room);
