-- 0039 — 공고가 속한 정부 사업 이름(든든전세, 미리내집, 장기미임대 …).
--
-- housing_type은 법정 유형이라 「매입임대」 하나에 청년, 신혼신생아, 든든전세, 장기미임대가 다 들어 있다.
-- 사람들은 사업 이름으로 찾는데 그 말이 공고 제목에만 있었다. 판정은 pipeline/programs.py 한 곳이 하고
-- upsert_notice가 적재할 때마다 다시 매긴다 — web은 읽기만 한다(/program/{사업}, docs/url-structure.md).
--
-- 배열인 이유: 「미리내집(신혼신생아 매입임대주택2)」처럼 한 공고가 사업 둘에 걸린다.
-- 값은 화면 이름 그대로이고 URL 식별자이기도 하다 — 바꾸면 URL이 바뀐다.

ALTER TABLE notice ADD COLUMN programs text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN notice.programs IS
  '정부 사업 이름(한글, /program/{사업}의 식별자). pipeline programs.classify(title, housing_type)가 매긴다. 빈 배열이면 특정 사업 아님';

CREATE INDEX idx_notice_programs ON notice USING gin (programs);
