-- 0016 — notice_result에 주소와 줄 번호. 자연키를 버리고 「문서에서의 자리」를 정체성으로 삼는다.
--
-- 0015로 구분(재공급/신규공급)까지 키에 넣고도 845줄 중 26줄이 사라졌다. 매입임대 목록에는
-- 같은 자치구 안에 이름이 같은 건물이 있다(금천구 「2동」). 단지명·주택형·순위로는 못 가른다.
-- 표에 있는 주소지가 진짜 식별자지만, 주소 표기가 흔들려도 줄이 사라지면 안 되므로
-- 정체성은 (게시글, 줄 번호)로 두고 주소는 값으로 싣는다. 주소는 좌표 조인에도 쓴다.

ALTER TABLE notice_result ADD COLUMN address text NOT NULL DEFAULT '';
ALTER TABLE notice_result ADD COLUMN row_no integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN notice_result.address IS '표의 소재지. 매입임대 양식에만 있다. 도로명주소 좌표 조인(S6)의 키가 된다';
COMMENT ON COLUMN notice_result.row_no IS '결과 글 안에서의 줄 번호(1부터). 표에 같은 이름이 두 번 나와도 줄이 사라지지 않게 하는 정체성';

-- 이미 들어간 줄은 row_no가 0이라 그대로는 UNIQUE를 못 건다. 적재 순서(id)로 번호를 매겨 둔다.
-- 다시 파싱하면 스테이지가 게시글 단위로 지우고 새로 넣으므로 번호는 저절로 맞춰진다.
UPDATE notice_result r SET row_no = n.rn
FROM (SELECT id, row_number() OVER (PARTITION BY post_seq ORDER BY id) rn FROM notice_result) n
WHERE r.id = n.id;

ALTER TABLE notice_result DROP CONSTRAINT notice_result_row_key;
ALTER TABLE notice_result ADD CONSTRAINT notice_result_row_key UNIQUE (post_seq, row_no);

CREATE INDEX idx_notice_result_address ON notice_result (address) WHERE address <> '';
