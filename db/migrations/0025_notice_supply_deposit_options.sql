-- 0025 — 민간임대 공급현황 줄의 보증금 비율 옵션
--
-- 서울시 청년안심주택(민간임대) 공고문은 주택형마다 임대보증금 비율 30%·50%·70%(사업자마다 40/45/50, 40/50/60 …)
-- 세 가지 (보증금, 월임대료) 짝을 준다. notice_supply의 deposit·rent 한 쌍에는 보증금이 가장 낮은 옵션(첫 열)을 넣고,
-- 나머지 옵션은 여기 jsonb로 둔다 — 열을 고정하면 비율 개수가 다른 사업자마다 마이그레이션이다.
-- 모양: [{"label": "30%", "ratio": 30, "deposit": 77900000, "rent": 750000}, …]  금액은 원.
-- 고정액 옵션(「보증금 9000만원」)은 ratio가 null이고 label만 있다. pipeline/parsers/youth_attach.py Option.as_json()이 원천.

ALTER TABLE notice_supply
  ADD COLUMN deposit_options jsonb;

COMMENT ON COLUMN notice_supply.deposit_options IS
  '보증금 비율별 (보증금, 월임대료) 옵션 목록. 민간임대(youth_attach) 공고문 표에서 채움. deposit·rent는 이 중 보증금이 가장 낮은 옵션';
