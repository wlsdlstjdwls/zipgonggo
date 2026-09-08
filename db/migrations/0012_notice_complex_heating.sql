-- 0012 — 단지 난방방식 (SH 「단지별 주소」 표의 마지막 열)
-- 표에는 있는데 안 읽고 버리던 값. 단지 상세에 노출한다.
ALTER TABLE notice_complex ADD COLUMN heating text;
COMMENT ON COLUMN notice_complex.heating IS '난방방식(개별난방·지역난방·중앙난방). SH 「단지별 주소」 표. 다른 양식에는 없어 NULL';
