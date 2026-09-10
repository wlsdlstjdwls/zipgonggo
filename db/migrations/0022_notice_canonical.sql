-- 같은 공고가 여러 URL로 갈라지는 걸 막는다.
--
-- 기관 seq로만 slug을 만들다 보니 한 공고가 세 번까지 들어왔다(실측 2026-09-10):
--   sh-2026-309403-maeip  포털 목록이 준 seq
--   sh-2026-310046-maeip  포털이 정정공고로 어긋나게 준 seq
--   sh-2026-310107-maeip  「(수정)」 붙은 정정공고 본체
-- 셋 다 「2026년 2차 장기미임대 매입임대주택 입주자모집공고(2026. 8. 28.)」다.
--
-- URL은 지우지 않는다(CLAUDE.md 하지 말 것 6). 정본을 하나 정해 두고 나머지는
-- 목록에서 빼고 rel=canonical로 정본을 가리킨다. 상세 페이지는 그대로 열린다.

ALTER TABLE notice ADD COLUMN canonical_id bigint REFERENCES notice(id) ON DELETE SET NULL;

COMMENT ON COLUMN notice.canonical_id IS
  '이 공고의 정본. NULL이면 자기 자신이 정본이다. S2가 채운다 — 정정공고 체인의 마지막 글이 정본';

-- 정본만 훑는 목록 질의를 받쳐 준다. 정본은 NULL이라 부분 인덱스가 그대로 목록 인덱스가 된다
CREATE INDEX idx_notice_canonical ON notice (canonical_id) WHERE canonical_id IS NOT NULL;
