-- 0031 — complex_type 자연키 재정의 + 면적 범위 두 칸 (S5 적재 직전)
--
-- `complex_type`은 2026-09-08 스키마 설계 때 「단지 × 형」을 행 단위로 잡고
-- UNIQUE (complex_id, housing_type, style_name)을 걸어 뒀다. S5를 쓰기 전에
-- 단지정보 API(15110581)를 78개 시군구 전량으로 실측하니 **그 키가 실제 데이터와 안 맞는다.**
--
-- 28,623행 중 같은 (hsmpSn, 공급유형, styleNm) 키가 둘 이상인 묶음이 3,470.
-- 매입임대를 뺀 아파트형 3,432행에서만 봐도 608 키가 겹치고, 그 안에서
--   전용면적이 갈리는 키 555 · 기본 금액이 갈리는 키 178 · 공용면적이 갈리는 키 605.
--
-- 겹치는 이유는 두 가지가 섞여 있다.
--   (1) **같은 형인데 동·라인마다 실측 면적이 조금씩 다르다.** 울산구영1 51형은
--       전용 51.79 / 51.84 / 51.92㎡ 세 행인데 보증금·임대료는 24,255,000 / 192,000으로 같다.
--       이건 한 줄로 합쳐 「전용 51.79~51.92㎡」로 적는 게 맞다 — 세 줄로 늘어놓으면 같은 말을 세 번 한다.
--   (2) **같은 형인데 금액이 다르다.** 이건 실제로 다른 공급 조건이라 줄을 나눠야 한다.
--
-- 그래서 자연키에 **기본 보증금·월임대료를 넣고**, 합쳐진 줄의 면적은 범위로 든다.
-- 이 표는 아직 0행이라(S5 미착수) 옮길 데이터가 없다.

ALTER TABLE complex_type
  DROP CONSTRAINT IF EXISTS complex_type_complex_id_housing_type_style_name_key;

ALTER TABLE complex_type
  ADD COLUMN IF NOT EXISTS exclusive_area_max numeric(7,2),
  ADD COLUMN IF NOT EXISTS common_area_max    numeric(7,2),
  ADD COLUMN IF NOT EXISTS row_count          integer NOT NULL DEFAULT 1;

-- 금액까지 키에 넣는다. NULLS NOT DISTINCT — 금액이 안 오는 행(매입임대 일부)도 한 줄로 모인다
ALTER TABLE complex_type
  ADD CONSTRAINT complex_type_identity
  UNIQUE NULLS NOT DISTINCT (complex_id, housing_type, style_name, base_deposit, base_rent);

COMMENT ON COLUMN complex_type.exclusive_area IS
  '공급 전용면적 ㎡ (API suplyPrvuseAr). 같은 형의 여러 행을 합친 줄이면 **하한**이고 상한은 exclusive_area_max';
COMMENT ON COLUMN complex_type.exclusive_area_max IS
  '합쳐진 행들의 전용면적 상한. 하한과 같으면 NULL — 화면이 범위 표기를 켤지 고르는 기준';
COMMENT ON COLUMN complex_type.common_area_max IS
  '합쳐진 행들의 공용면적 상한. 하한과 같으면 NULL';
COMMENT ON COLUMN complex_type.row_count IS
  '이 줄로 합쳐진 API 행 수. 1이면 원문 그대로 한 행';
