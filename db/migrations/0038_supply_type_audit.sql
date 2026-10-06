-- 0038 — 공급유형 사양에 공고문 대조(docs/eligibility-audit.md, 2026-10-06)로 드러난 칸 셋을 더한다.
--
-- income_pct_dual     맞벌이 기준 %. 신혼 계열 공고는 「외벌이 70% / 맞벌이 90%」처럼 두 줄인데
--                     income_pct 한 칸에 맞벌이 값이 들어가 외벌이 가구를 통과시켰다. income_pct는 외벌이(기본) 기준이 된다
-- income_small_bonus  1인 가구 +20%p, 2인 가구 +10%p 가산을 쓰는 유형. 행복주택, 매입임대, 국민임대 등은 쓰고
--                     장기전세, 미리내집, 민간 청년안심주택은 안 쓴다 — 유형마다 따로라 칸이 필요하다
-- basis               이 줄을 맞대 본 공고 slug. 「엑셀 한 장이 근거」에서 벗어나려는 칸이다
--
-- region_limit에 「모집지역」 값이 생긴다(모집하는 시군구나 권역에 주민등록이 있어야 하는 유형). text라 스키마 변경은 없다.
-- income_scope/asset_scope에 「세대주분기」가 생긴다(세대원이면 본인, 세대주면 세대 전체 — 행복주택 청년).

ALTER TABLE supply_type
  ADD COLUMN income_pct_dual    integer,
  ADD COLUMN income_small_bonus boolean NOT NULL DEFAULT false,
  ADD COLUMN basis              text;

COMMENT ON COLUMN supply_type.income_pct IS
  '도시근로자 가구원수별 월평균소득 대비 % — 외벌이(기본) 기준. 맞벌이 기준은 income_pct_dual';
COMMENT ON COLUMN supply_type.income_pct_dual IS '맞벌이(본인과 배우자 모두 소득) 기준 %. NULL이면 외벌이와 같다';
COMMENT ON COLUMN supply_type.income_small_bonus IS '1인 가구 +20%p, 2인 가구 +10%p 가산을 쓰는 유형';
COMMENT ON COLUMN supply_type.basis IS '이 사양을 대조한 공고 slug(쉼표로 여럿)';
