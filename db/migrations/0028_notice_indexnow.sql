-- 0028 — IndexNow 제출 이력 (notice.indexnow_at · indexnow_hash)
--
-- 왜 필요한가: IndexNow(빙·네이버·얀덱스·Seznam이 함께 받는다. 구글은 참여하지 않는다)는 사이트맵과 달리
-- **우리가 먼저 「이 URL이 방금 바뀌었다」고 밀어 넣는** 방식이다. 공고는 접수 기간이 2주 안팎이라
-- 크롤러가 제 주기로 올 때까지 기다리면 그 공고는 이미 마감이다.
--
-- **왜 updated_at을 신호로 못 쓰나 — 이게 이 마이그레이션의 존재 이유다.**
-- `repo.UPSERT_SQL`이 `updated_at = now()`를 **조건 없이** 건다. 값이 한 글자도 안 바뀌어도 수집이
-- 한 번 돌면 그 행의 updated_at이 새로 찍힌다. 그걸 기준으로 쏘면 매시 같은 20건을 다시 던지게 되고,
-- 같은 URL 반복 제출은 IndexNow가 명시적으로 하지 말라는 짓이다.
--
-- 그래서 **내용 해시**를 쓴다. 발행기가 지면에 실제로 나가는 값들(제목·상태·일정·호수·금액·유형·기관과
-- 자식 표의 행 수)로 md5를 만들어 여기 적어 둔다. 해시가 그대로면 안 쏜다.
-- 자식 표 행 수를 넣는 이유: S1이 목록만 넣고 **S3가 첨부를 파싱해 공급현황·단지·자격을 채운다.**
-- 그때 notice 컬럼은 거의 안 움직이는데 지면은 껍데기에서 알맹이로 바뀐다 — 그건 다시 알려야 한다.
--
-- **notice에 컬럼으로 붙여도 되는 이유**: notice는 source_key upsert라 행이 지워졌다 다시 들어오지 않는다.
-- notice_complex처럼 통째로 replace되는 표였다면 0026·0027처럼 별도 표로 뺐어야 한다
-- (2026-09-14 SH 325단지, 2026-09-15 민간 445행 — 두 번 당했다).

ALTER TABLE notice ADD COLUMN IF NOT EXISTS indexnow_at   timestamptz;
ALTER TABLE notice ADD COLUMN IF NOT EXISTS indexnow_hash text;

COMMENT ON COLUMN notice.indexnow_at IS
  'IndexNow에 이 공고 URL을 마지막으로 제출한 시각. NULL이면 아직 한 번도 안 알렸다';
COMMENT ON COLUMN notice.indexnow_hash IS
  '마지막 제출 때의 지면 내용 해시. 이 값이 그대로면 다시 쏘지 않는다(updated_at은 내용과 무관하게 움직인다)';

-- 제출 대상 고르기 전용. 정본(canonical_id IS NULL)만 쏘므로 부분 인덱스로 좁힌다.
-- 아직 안 알린 행(NULL)이 앞에 오도록 NULLS FIRST
CREATE INDEX IF NOT EXISTS notice_indexnow_pending_idx
  ON notice (indexnow_at NULLS FIRST, posted_at DESC)
  WHERE canonical_id IS NULL;
