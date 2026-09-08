-- 0002 — 공고의 시군구별 공급 내역
--
-- 마이홈 모집공고 API(HWSPR02)는 매입임대·전세임대 공고를 시군구별 행으로 쪼개 준다.
-- pblancId:houseSn이 같고 signguNm·sumSuplyCo만 다른 행이 한 공고에 최대 15개(2026-09-08 실측: 25개 공고 = 205행).
-- notice는 공고당 1행으로 합치고, 시군구별 공급호수는 여기에 둔다. 지역 페이지의 "이 구에 N호" 근거.

CREATE TABLE notice_area (
  id           bigserial PRIMARY KEY,
  notice_id    bigint  NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  sido         text    NOT NULL,
  sigungu      text,                 -- 빈값이면 시도 전체 또는 미지정 행
  supply_count integer,              -- 해당 시군구 공급호수 (API sumSuplyCo)
  UNIQUE NULLS NOT DISTINCT (notice_id, sido, sigungu)
);

COMMENT ON TABLE notice_area IS '공고 1건의 시군구별 공급호수. API가 쪼개 준 행을 합산해 넣는다. notice.supply_count는 이 표의 합';

CREATE INDEX idx_notice_area_region ON notice_area (sido, sigungu);

COMMENT ON COLUMN notice.raw IS '출처 응답 원문. 마이홈 API는 {"items": [...]} — 시군구별로 쪼개진 행을 전부 담는다';
COMMENT ON COLUMN notice.fingerprint IS 'sha256(기관|공고명|게시일|주택일련번호). 같은 공고를 여러 소스에서 받아도 한 행으로 모은다. 주택일련번호가 없는 소스는 빈 문자열';
