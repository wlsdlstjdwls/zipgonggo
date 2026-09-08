-- 0007 — 공고별 공급 단지 목록 (notice_complex)
--
-- SH 공고는 목록에 주소가 없고 첨부 공고문의 「주택 위치 안내」 표에만 단지명·도로명주소가 있다.
-- S3(첨부 텍스트 파서)가 그 표를 여기 넣는다. 마이홈 API 공고는 complex(hsmpSn 키)로 가지만
-- SH 단지엔 단지코드가 없어 공고 종속 표로 따로 둔다. 좌표 컬럼은 없다 — 좌표는 S6 요약DB 조인(도로명주소 키)에서.
-- 2026-09-08 서울시 공공저작물 사전 협의 완료(사용자 확인) 후 착수.

CREATE TABLE notice_complex (
  id            bigserial PRIMARY KEY,
  notice_id     bigint  NOT NULL REFERENCES notice(id) ON DELETE CASCADE,
  name          text    NOT NULL,                  -- 단지명 (공고문 표기 그대로, [신규] 표시는 뗌)
  sido          text    NOT NULL,                  -- 소재지에서 도출. 기본 서울특별시, 의정부 등 시외 단지는 경기도
  sigungu       text    NOT NULL,                  -- 자치구·시. 소재지 첫 토큰
  road_address  text    NOT NULL,                  -- 시군구부터 시작하는 도로명주소. 시외면 시도 포함
  zone          text,                              -- 지구명(세곡지구·마곡지구). 병합셀이라 아직 안 채움
  is_new        boolean NOT NULL DEFAULT false,    -- 금회 신규공급 ([신규])
  source_page   integer,                           -- 첨부 공고문 쪽번호. 검수용
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, name, road_address)
);

COMMENT ON TABLE notice_complex IS '공고 1건이 공급하는 단지 목록. SH 첨부 공고문 「주택 위치 안내」 표(S3). 좌표 없음 — S6이 road_address로 조인';

CREATE INDEX idx_notice_complex_notice ON notice_complex (notice_id, sigungu, name);
