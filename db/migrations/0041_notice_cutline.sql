-- 0041 — 회차 결과: 커트라인 (notice_cutline)
--
-- 경쟁률(notice_result)은 몇 명이 몰렸는지만 말한다. 신청자가 정말 궁금한 건 「내 점수로 붙었겠느냐」다.
-- SH는 당첨자 발표 글에 단지 × 면적 × 대상별 커트라인 표를 따로 올린다(장기전세, 국민임대, 재개발임대, 청년안심주택).
-- 서류심사대상자 발표 글에도 같은 꼴의 표가 있다 — stage로 가른다(final이 최종 당첨, document가 서류심사 대상).
--
-- 커트라인은 원문 글 그대로 싣는다(「1순위 22점 미성년자녀1명 전산추첨」). 순위와 점수만 뽑아 정렬, 비교에 쓴다.
-- 행은 notice_result처럼 「문서에서의 자리」(게시글, 줄 번호)가 정체성이다 — 같은 단지 같은 면적이 대상별로 여러 줄이다.

CREATE TABLE notice_cutline (
  id             bigserial PRIMARY KEY,
  notice_id      bigint  NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  post_seq       text    NOT NULL REFERENCES result_post(seq) ON DELETE CASCADE,
  row_no         integer NOT NULL,
  stage          text    NOT NULL CHECK (stage IN ('final', 'document')),

  complex_name   text    NOT NULL DEFAULT '',
  sigungu        text    NOT NULL DEFAULT '',
  supply_type    text    NOT NULL DEFAULT '',   -- 면적 "59" · "16A"
  bracket        text    NOT NULL DEFAULT '',   -- 구분 「우선」 「일반」 「예비자」. 그 칸이 없는 양식은 빈 값
  tenant_class   text    NOT NULL DEFAULT '',   -- 대상 「일반」 「주거약자」 「고령자」 「청년」 「신혼Ⅰ」

  winner_cut     text    NOT NULL DEFAULT '',   -- 당첨자(서류심사면 서류심사대상자) 커트라인 원문
  reserve_cut    text    NOT NULL DEFAULT '',   -- 예비자 커트라인 원문
  winner_rank    smallint,
  winner_score   smallint,
  reserve_rank   smallint,
  reserve_score  smallint,

  source_page    integer,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notice_cutline_row_key UNIQUE (post_seq, row_no)
);

COMMENT ON TABLE  notice_cutline IS '공고 회차의 커트라인 표 한 줄. i-sh 당첨자/서류심사대상자 발표 글 첨부(pipeline parsers/sh_cutline.py)';
COMMENT ON COLUMN notice_cutline.stage IS 'final = 최종 당첨자·예비자 커트라인, document = 서류심사대상자 커트라인';
COMMENT ON COLUMN notice_cutline.winner_score IS '커트라인 글의 「N점」. 점수 없는 글(전원, 추첨, 적격자 없음)은 NULL';

CREATE INDEX idx_notice_cutline_notice  ON notice_cutline (notice_id, stage);
CREATE INDEX idx_notice_cutline_complex ON notice_cutline (complex_name);
