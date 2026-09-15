-- 0027 — 청년안심주택 단지 사실 (관리비·운영사·시행사·입주예정일·지하철·연락처)
--
-- 왜 필요한가: **관리비**는 민간임대 공고문 첨부에 없다. 지면은 여태 「공고문에 실리지 않아 싣지 못합니다,
-- 관리사무소나 원문에서 확인하세요」라고 적고 있었는데, 청년안심주택 포털 「주택찾기」가 단지마다 그 값을 준다
-- (목록 행 `youthMaintenanceFee`·`coupleMaintenanceFee`, 맹그로브창천 110,000~140,000원).
--
-- **notice_complex에 컬럼으로 붙이지 않는다.** 그 표는 수집 때마다 통째로 지웠다 다시 넣어서,
-- 되돌리기 목록(`repo.replace_notice_complexes`)에 일일이 적어 두지 않으면 조용히 날아간다
-- (2026-09-14 SH 325단지, 2026-09-15 민간 445행 — 두 번 당했다). 단지 코드를 키로 따로 두면 그 사고가 구조적으로 안 난다.
-- 0026(이미지)과 같은 자리, 같은 키다.

CREATE TABLE youth_house (
  home_code    text        PRIMARY KEY,           -- 포털 단지코드. notice_complex.youth_home_code가 가리킨다
  name         text        NOT NULL,              -- 포털 표기(`홍대입구역 맹그로브창천`) — 역세권 접두사가 붙어 있다
  address      text,
  sigungu      text,
  -- 관리비(원/월). 포털이 청년·신혼부부 두 값을 주는데 사실상 주택형별 하한과 상한이다
  maint_low    integer,
  maint_high   integer,
  households   integer,                           -- 총 세대수(movinHoman)
  manager      text,                              -- 운영사(managerComp)
  developer    text,                              -- 시행사
  builder      text,                              -- 시공사
  movein       date,                              -- 입주(예정)일
  phone        text,
  homepage     text,
  subway       text,                              -- `홍대입구역 2호선, 경의중앙선, 공항철도`
  scale        text,                              -- `총 288 세대 (공공임대 92 세대, 공공지원민간임대 196 세대)`
  source_url   text        NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE youth_house IS
  '청년안심주택 포털 단지 사실. 공고문 첨부에 없는 값(관리비·운영사·입주예정일)을 지면에 싣는다';
COMMENT ON COLUMN youth_house.maint_low IS
  '월 관리비 하한(원). 포털의 청년 기준값. 실제 청구액이 아니라 (예상)관리비다 — 화면에 그렇게 적는다';
COMMENT ON COLUMN youth_house.maint_high IS
  '월 관리비 상한(원). 포털의 신혼부부 기준값. 하한과 같으면 화면은 한 값으로 적는다';
