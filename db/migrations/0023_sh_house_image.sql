-- 0023 — SH 단지 이미지 (평면도·전경·배치도·실내)
--
-- 공고문 PDF 안에는 도면이 없다(제51차 64쪽 전수 확인, 0장). 공고문은 「전자팸플릿·SH주택정보 참조」로
-- 넘기고, 그 SH주택정보(i-sh.co.kr/houseinfo)가 단지·주택형 단위 이미지를 준다.
-- 수집은 pipeline/scripts/collect_sh_house_assets.py, 경로 실측은 sources/sh_houseinfo.py 머리글.
--
-- 이미지는 **단지**에 붙지 공고에 붙지 않는다. 같은 단지가 여러 공고에 되풀이 나오므로
-- (제51차·제8차에 마곡엠밸리가 같이 나온다) SH 단지코드(biznsCd)를 키로 따로 둔다.
-- notice_complex는 그 코드를 가리키기만 한다.

ALTER TABLE notice_complex ADD COLUMN sh_bizns_cd text;

COMMENT ON COLUMN notice_complex.sh_bizns_cd IS
  'SH주택정보 단지코드. 공고문 단지명·주소로 대조해 붙인다. 신규 미준공 단지는 등록 전이라 NULL';

CREATE INDEX idx_notice_complex_sh_bizns ON notice_complex (sh_bizns_cd) WHERE sh_bizns_cd IS NOT NULL;

CREATE TABLE sh_house_image (
  id          bigserial   PRIMARY KEY,
  bizns_cd    text        NOT NULL,
  kind        text        NOT NULL,              -- 평면도 · 전경 · 배치도 · 실내
  sply_ty     text        NOT NULL DEFAULT '',   -- 주택형(평면도·일부 실내). 단지 전체 이미지는 빈 문자열
  label       text,                              -- 화면 표기(거실·주방·안방 …). 평면도는 대개 비어 있다
  source_url  text        NOT NULL,              -- SH 원본 URL. 재수집·출처 표시용
  file_name   text        NOT NULL,              -- 우리가 저장한 파일명. 지면은 이걸로 찾는다
  bytes       integer,
  sort_no     integer     NOT NULL DEFAULT 0,
  collected_at timestamptz NOT NULL DEFAULT now(),
  -- 같은 원본을 두 번 넣지 않는다. SH가 파일을 갈면 URL이 바뀌어 새 행이 된다
  UNIQUE (bizns_cd, source_url)
);

COMMENT ON TABLE sh_house_image IS
  'SH주택정보 단지 이미지. 공고가 아니라 단지(biznsCd)에 붙는다 — 한 단지가 여러 공고에 되풀이 나온다';
COMMENT ON COLUMN sh_house_image.sply_ty IS
  '주택형. 평면도는 이 값으로 공급 표의 주택형과 잇는다. 실내 사진도 주택형별로 나뉘어 오는 단지가 있다';
COMMENT ON COLUMN sh_house_image.file_name IS
  '저장 파일명. 지금은 로컬 PoC라 web/public/sh-house/{bizns_cd}/{file_name}에 둔다. 발행 때 스토리지로 옮긴다';

-- 단지 상세는 한 단지의 이미지를 종류·주택형 순으로 통째로 읽는다
CREATE INDEX idx_sh_house_image_lookup ON sh_house_image (bizns_cd, kind, sply_ty, sort_no);
