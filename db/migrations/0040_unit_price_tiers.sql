-- 0040 — 호실의 신청 계층별 금액.
--
-- SH 신혼·신생아 매입임대 「주택목록(상세)」은 한 호실에 금액이 두 벌이다(소득 50% 이하 / 70% 이하),
-- 청년 매입임대 「주택목록」은 네 벌이다(1순위 청년 / 1순위 대학생 / 2~3순위 청년 / 2~3순위 대학생).
-- deposit·rent에는 한 벌만 들어가므로 나머지를 버리면 다른 계층 신청자가 틀린 금액을 본다.
-- 전환 금액(deposit_jeonse·deposit_wolse)과는 뜻이 다르다 — 그건 같은 신청자가 계약 때 고르는 폭이다.
--
-- 모양: [{"label": "소득50% 이하 신청자 (수급계층 포함)", "deposit": 19530000, "rent": 254400}, ...]
-- 첫 원소가 deposit·rent와 같다. label은 주택목록 머리글 원문이다. 금액을 못 읽은 계층은 deposit·rent가 null.

ALTER TABLE unit ADD COLUMN price_tiers jsonb;

COMMENT ON COLUMN unit.price_tiers IS
  '신청 계층별 (label, deposit, rent). 첫 원소 = deposit·rent. SH 매입임대 주택목록(pipeline parsers/sh_house_list.py)만 채운다';
