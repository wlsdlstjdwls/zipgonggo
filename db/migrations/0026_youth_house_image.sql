-- 0026 — 청년안심주택 단지 이미지 (평면도·전경·투시도·편의시설)
--
-- 민간임대(공공지원민간임대) 공고문 PDF 안에는 도면이 없다. 첨부 452건 전수 확인 결과 그림이 한 장이라도 든 PDF는
-- 121건뿐이고, 평면도 크기(200x150pt 초과) 그림은 50건에 대개 한 장씩인데 까 보면 위치 약도·로고·표를 통째로 앉힌
-- 그림·A4 스캔쪽이다(2026-09-15 실측). 추출할 도면이 애초에 없다.
--
-- 대신 서울시 청년안심주택 포털의 「주택찾기」가 단지 단위 사진과 평면도를 준다 — SH주택정보의 민간판이다.
-- 경로 실측은 `sources/youth_house.py` 머리글, 수집은 `scripts/collect_youth_house_assets.py`.
--
-- 0023(SH)과 같은 모양으로 둔다. 이미지는 **단지**에 붙지 공고에 붙지 않는다 — 같은 단지가 최초모집·추가모집으로
-- 여러 공고에 되풀이 나온다(퀸즈W 청량리역은 벌써 3건). 포털 단지코드(homeCode)를 키로 삼고
-- notice_complex는 그 코드를 가리키기만 한다.

ALTER TABLE notice_complex ADD COLUMN youth_home_code text;

COMMENT ON COLUMN notice_complex.youth_home_code IS
  '청년안심주택 포털 단지코드(homeCode). 단지명·주소로 대조해 붙인다. 포털에서 내려간 옛 단지는 NULL';

CREATE INDEX idx_notice_complex_youth_home ON notice_complex (youth_home_code) WHERE youth_home_code IS NOT NULL;

CREATE TABLE youth_house_image (
  id          bigserial   PRIMARY KEY,
  home_code   text        NOT NULL,
  kind        text        NOT NULL,              -- 평면도 · 전경 · 투시도 · 편의시설
  sply_ty     text        NOT NULL DEFAULT '',   -- 주택형. 포털 평면도는 주택형을 안 밝혀 대개 빈 문자열
  label       text,                              -- 화면 표기. 편의시설 사진은 포털이 캡션을 짝지어 주지 않아 NULL
  source_url  text        NOT NULL,              -- 포털 원본 URL. 재수집·출처 표시용
  file_name   text        NOT NULL,              -- 우리가 저장한 파일명. 지면은 이걸로 찾는다
  bytes       integer,
  sort_no     integer     NOT NULL DEFAULT 0,
  collected_at timestamptz NOT NULL DEFAULT now(),
  -- 같은 원본을 두 번 넣지 않는다. 포털이 파일을 갈면 fileSn이 바뀌어 새 행이 된다
  UNIQUE (home_code, source_url)
);

COMMENT ON TABLE youth_house_image IS
  '청년안심주택 포털 단지 이미지. 공고가 아니라 단지(homeCode)에 붙는다 — 한 단지가 여러 공고에 되풀이 나온다';
COMMENT ON COLUMN youth_house_image.kind IS
  '평면도·전경·투시도·편의시설. 포털 상세의 article 구역과 img alt로 가른다';
COMMENT ON COLUMN youth_house_image.file_name IS
  '저장 파일명. 지금은 로컬 PoC라 web/public/youth-house/{home_code}/{file_name}에 둔다. 발행 때 스토리지로 옮긴다';

-- 단지 상세는 한 단지의 이미지를 종류·주택형 순으로 통째로 읽는다
CREATE INDEX idx_youth_house_image_lookup ON youth_house_image (home_code, kind, sply_ty, sort_no);
