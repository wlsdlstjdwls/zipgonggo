-- 0010 — 원본 목록에서의 순번. 같은 공고일 안에서 기관 목록 순서를 그대로 보여주려고 쓴다(사용자 요청 2026-09-08).
-- 마이홈 API 응답 순서, SH 서울주거포털 목록 순서. 1이 목록 맨 위.
ALTER TABLE notice ADD COLUMN source_rank integer;

COMMENT ON COLUMN notice.source_rank IS '수집 시 원본 목록에서의 순번(1이 맨 위). 같은 posted_at 안 정렬 기준';

CREATE INDEX idx_notice_posted_rank ON notice (posted_at DESC, source_rank, id DESC);
