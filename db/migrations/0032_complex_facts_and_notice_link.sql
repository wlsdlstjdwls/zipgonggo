-- 0032 — 단지 제원 네 칸(complex) + 공고→단지 연결(notice.complex_code)
--
-- ## 왜 제원을 complex로 올리나
--
-- 난방·구조·승강기·주차는 원래 `complex_type`에만 있었다. API(15110581) 행이 「단지 × 형」이라
-- 그 행에 실려 오기 때문이다. 그런데 78개 시군구 전량(28,623행)을 받아 재 보니
-- **아파트형 946개 단지 가운데 이 네 값이 단지 안에서 갈리는 단지가 하나도 없다**
-- (heatMthdDetailNm 0 · buldStleNm 0 · elvtrInstlAtNm 0 · parkngCo 0).
-- 형마다 같은 값을 N벌 들고 있을 이유가 없고, 지면이 「이 단지는 복도식」이라 적으려면
-- 형 줄 아무거나 하나를 골라 읽어야 해서 읽는 쪽이 매번 고민하게 된다.
--
-- 세대수(hshldCo)만은 68개 단지에서 갈린다 — 유형 블록마다 387/388처럼 하나씩 다르게 적혀 온다.
-- 그건 이미 `complex.household_cnt`에 있고 S5가 최대값을 넣는다.
--
-- 승강기를 boolean이 아니라 **text**로 두는 이유: 원문 값이 「전체동 설치」·「일부동 설치」·「미설치」 셋이다.
-- boolean으로 접으면 「일부동 설치」가 「있음」이 되어 지면이 거짓말한다(13개 단지).
-- `complex_type.has_elevator`(boolean)는 그대로 두되 S5는 채우지 않는다.
--
-- ## 왜 공고에 단지 코드를 박나
--
-- 공고와 단지를 잇는 열쇠는 `notice.pnu`(19자리 필지고유번호)뿐인데 **PNU는 단지를 유일하게 가리키지 않는다.**
-- 실측: PNU 5,900개 중 745개(12.6%)에 단지가 둘 이상 달려 있다. 같은 필지에 1·2단지가 서 있거나,
-- 같은 단지가 재공급 회차마다 다른 hsmpSn으로 또 등록돼 있다(부산만덕5 2블록은 한 PNU에 30개).
--
-- 그래서 「어느 단지인가」를 web이 조회할 때마다 추측하게 두지 않는다. S5가 PNU + 공고 공급유형으로
-- 한 번 좁히고(실측 278건 중 231건이 정확히 1곳으로 좁혀진다) 그 결과만 여기 박는다.
-- 좁혀지지 않는 9건은 **비워 둔다** — 아무거나 고르면 지면이 남의 단지 임대료를 싣는다.
--
-- 이 칸은 `notice`의 다른 칸과 달리 S1(목록 수집)이 건드리지 않는다. S1의 UPSERT 컬럼 목록에
-- 없으므로 매시 수집이 덮어쓰지 않는다 — 넣을 때 그 점을 확인했다(repo.NOTICE_COLS).

ALTER TABLE complex
  ADD COLUMN IF NOT EXISTS heating        text,
  ADD COLUMN IF NOT EXISTS building_style text,
  ADD COLUMN IF NOT EXISTS elevator       text,
  ADD COLUMN IF NOT EXISTS parking_cnt    integer;

COMMENT ON COLUMN complex.heating        IS '난방방식 (API heatMthdDetailNm). 단지 안에서 갈리지 않는다(실측)';
COMMENT ON COLUMN complex.building_style IS '복도식 · 계단식 · 혼합식 (API buldStleNm)';
COMMENT ON COLUMN complex.elevator       IS '전체동 설치 · 일부동 설치 · 미설치 (API elvtrInstlAtNm). boolean으로 접지 않는다';
COMMENT ON COLUMN complex.parking_cnt    IS '주차 대수 (API parkngCo). 0은 「없음」이 아니라 「안 들어옴」인 단지가 많아 0은 NULL로 넣는다';

ALTER TABLE notice
  ADD COLUMN IF NOT EXISTS complex_code text;

COMMENT ON COLUMN notice.complex_code IS
  'S5가 PNU+공급유형으로 좁힌 마이홈 단지(hsmpSn). 후보가 둘 이상이면 NULL — 지면이 남의 단지를 싣지 않게';

CREATE INDEX IF NOT EXISTS idx_notice_complex_code ON notice (complex_code) WHERE complex_code IS NOT NULL;
