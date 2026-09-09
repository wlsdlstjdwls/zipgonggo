-- 0019 — 단지 좌표 (S6 오프라인 주소-좌표 조인)
--
-- 지금까지 지도는 브라우저에서 네이버 geocoder로 주소를 매번 변환해 찍었다(web/src/components/naver-map.tsx).
-- 행안부 도로명주소 위치정보 요약DB(공공저작물 제1유형)를 받아 두면 그럴 필요가 없다 —
-- pipeline/data/juso/entrance.sqlite와 오프라인 조인해 **맞은 좌표만** 여기에 넣는다(CLAUDE.md 하지 말 것 1·2).

ALTER TABLE notice_complex
  ADD COLUMN geom           geography(Point, 4326),
  ADD COLUMN geo_precision  geo_precision,
  ADD COLUMN geo_matched_by text,          -- road_addr · road_main · dong_center
  ADD COLUMN geo_matched_at timestamptz;

COMMENT ON COLUMN notice_complex.geom IS
  '행안부 요약DB 오프라인 조인 결과. 지오코딩 API 응답을 넣지 않는다(CLAUDE.md 하지 말 것 1)';
COMMENT ON COLUMN notice_complex.geo_precision IS
  'building이면 도로명+본번+부번까지 맞은 출입구 좌표. road는 본번만, dong은 읍면동 평균 — 색인 대상이 아니다';

CREATE INDEX idx_notice_complex_geom ON notice_complex USING GIST (geom);

-- complex(마이홈 단지)에도 같은 출처 표시를 붙인다. geom·geo_precision은 0001부터 있다
ALTER TABLE complex
  ADD COLUMN geo_matched_by text,
  ADD COLUMN geo_matched_at timestamptz;
