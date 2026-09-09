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

  UNIQUE (post_seq, complex_name, supply_type, tenant_class, bracket)
);

COMMENT ON TABLE  notice_result IS '공고 회차의 결과 표 한 줄. i-sh 결과 글 첨부(sh_competition 파서)';
COMMENT ON COLUMN notice_result.reconciled IS 'false면 원문 텍스트가 상해 못 믿는 줄. 집계·화면에서 뺀다';

CREATE INDEX idx_notice_result_notice  ON notice_result (notice_id, tenant_class, bracket);
CREATE INDEX idx_notice_result_complex ON notice_result (complex_name, tenant_class) WHERE reconciled;
