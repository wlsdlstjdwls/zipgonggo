-- 0006 — SH 청약유형 흡수
--
-- 서울주거포털 공공임대 목록의 청약유형(2026-09-08 실측 15종) 중 기존 enum에 없는 실제 공급 제도 2종을 추가한다.
-- 도시형생활주택·두레주택·수요자맞춤형은 SH 매입임대의 하위 상품이라 '매입임대'로 정규화하고 원문은 raw에 남긴다.
-- 장기안심주택(보증금 지원)·상가임대·용지분양은 주택 공급이 아니라 적재하지 않는다.

ALTER TYPE housing_type ADD VALUE IF NOT EXISTS '재개발임대';
ALTER TYPE housing_type ADD VALUE IF NOT EXISTS '청년안심주택';
