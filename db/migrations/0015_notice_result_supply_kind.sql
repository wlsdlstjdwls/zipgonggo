-- 0015 — notice_result에 공급 구분(재공급·신규공급)
--
-- 매입임대 경쟁률 표에는 「구분」 열이 있고, 같은 단지·주택형·순위가 재공급과 신규공급으로 두 번 나온다.
-- 0014의 UNIQUE에 그 구분이 없어 845줄 중 34줄이 조용히 사라졌다(실측 seq=307073).
-- 신규공급 대 재공급 비중은 그 자체로 읽을거리이기도 하다.

ALTER TABLE notice_result ADD COLUMN supply_kind text NOT NULL DEFAULT '';
COMMENT ON COLUMN notice_result.supply_kind IS '재공급 · 신규공급. 매입임대 양식에만 있다. 다른 양식은 빈 값';

-- 0014가 만든 UNIQUE는 이름을 Postgres가 잘라 지어서 환경마다 다를 수 있다. 이름으로 찾지 않고 컬럼으로 찾는다.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'notice_result'::regclass AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (post_seq, complex_name, supply_type, tenant_class, bracket)';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE notice_result DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE notice_result ADD CONSTRAINT notice_result_row_key
  UNIQUE (post_seq, complex_name, supply_kind, supply_type, tenant_class, bracket);
