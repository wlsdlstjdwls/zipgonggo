-- 0005 — fingerprint UNIQUE 해제
--
-- 같은 원공고의 2차 정정공고(21178)가 1차 정정(21169)과 지문이 같아 적재가 막혔다(2026-09-08).
-- 1차 정정은 API에서 사라졌지만 URL 유지 규칙으로 DB에 남는다. 지문은 "다른 소스에서 온 같은 공고 후보"를
-- 묶는 힌트일 뿐 식별자가 아니다. 식별자는 source_key.

ALTER TABLE notice DROP CONSTRAINT notice_fingerprint_key;
CREATE INDEX idx_notice_fingerprint ON notice (fingerprint);

COMMENT ON COLUMN notice.fingerprint IS
  'sha256(기관|공고명|게시일|주택일련번호|원공고키). 소스 간 같은 공고 후보를 묶는 힌트. UNIQUE 아님 — 정정공고 체인에서 겹친다';
