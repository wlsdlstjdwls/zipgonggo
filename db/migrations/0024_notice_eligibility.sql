-- 0024 — 공고문에서 읽은 신청자격 묶음 (SH 장기전세 6~8쪽·30~32쪽)
--
-- 기존 eligibility(0001)는 순위 한 줄 = 행 하나인 납작한 표라 장기전세의 실제 구조 —
-- 신청면적 × 순위 × 출생자녀 가산 × 맞벌이 소득 매트릭스, 동일순위 선정 순서, 가감점 배점표 — 를 담을 수 없다.
-- 공고 1건에 묶음 하나를 jsonb로 둔다. 양식마다 표 모양이 달라 열을 고정하면 다음 양식에서 또 마이그레이션이다.
-- 모양은 pipeline/parsers/sh_eligibility.py Eligibility.as_json()과 web/types/eligibility.ts NoticeEligibilityData가 같이 든다.
--
-- verified: 소득표(가구원수별 월평균소득)의 읽힌 칸이 income_standard 100% 기준액 × %와 전부 맞았는지.
-- Synap 미리보기는 글자를 떨어뜨리므로(「839428」 ← 8,394,285) 검산 없이 금액을 내보내지 않는다.
-- false여도 소득표 말고 다른 부분(순위표·배점표)은 보여준다 — 그쪽은 글자가 빠져도 뜻이 남는 문장이다.

CREATE TABLE notice_eligibility (
  notice_id     bigint      PRIMARY KEY REFERENCES notice(id) ON DELETE CASCADE,
  source        text        NOT NULL,                 -- sh_attach
  source_pages  integer[]   NOT NULL DEFAULT '{}',    -- 공고문 쪽 번호(화면의 「공고문 n쪽」 출처 표기)
  data          jsonb       NOT NULL,
  verified      boolean     NOT NULL DEFAULT false,
  parsed_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  notice_eligibility IS '공고문의 신청자격 묶음(소득기준·신청순위·가산·자산·선정순서·배점표). 공고당 1행, jsonb';
COMMENT ON COLUMN notice_eligibility.verified IS '소득표 검산 통과 여부. false면 화면은 소득표 금액을 내보내지 않는다';
