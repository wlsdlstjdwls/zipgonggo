-- 0004 — 공공임대 / 민간임대 구분
--
-- 공급유형(housing_type)만으로는 "공공기관이 공급하는가"를 화면에서 바로 못 가른다.
-- 공공지원민간임대(청년안심주택 등)는 민간 사업자 공급이라 자격·계약·임대료 규율이 다르다.
-- 사용자 요구(2026-09-08): 홈에서 공공/민간 탭으로 나눈다.

CREATE TYPE rental_sector AS ENUM ('공공임대', '민간임대');

ALTER TABLE notice
  ADD COLUMN sector rental_sector NOT NULL DEFAULT '공공임대';

COMMENT ON COLUMN notice.sector IS
  '공공임대 / 민간임대. S1이 housing_type으로 도출: 공공지원민간임대 → 민간임대, 그 외 공공임대. 청년안심주택 스크래퍼(youth_scrape)는 민간임대';

-- 기존 행 보정 (S1 재실행 전이라도 화면이 맞게 나오도록)
UPDATE notice SET sector = '민간임대' WHERE housing_type = '공공지원민간임대';

CREATE INDEX idx_notice_sector_end ON notice (sector, apply_end_at);
