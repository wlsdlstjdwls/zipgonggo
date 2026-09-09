import type { Metadata } from "next";
import { EligibilityCheck } from "@/components/eligibility-check";
import { getEligibilityRules } from "@/lib/queries";
import { ROUTES } from "@/lib/routes";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const preferredRegion = "iad1";

const TITLE = "공공임대 자격진단 — 내 조건으로 신청 가능한 공급유형";
const DESCRIPTION =
  "나이와 혼인 상태, 가구원 수, 소득, 자산, 자동차가액, 계층을 넣으면 행복주택, 청년안심주택, 매입임대, 국민임대, 장기전세, 전세임대 등 32개 공급유형 중 신청할 수 있는 유형을 가려 줍니다. 도시근로자 월평균소득 기준액도 함께 봅니다.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.eligibility },
  openGraph: { title: TITLE, description: DESCRIPTION, url: ROUTES.eligibility },
};

export default async function EligibilityPage() {
  const rules = await getEligibilityRules();
  return (
    <div className="elig-stage">
      <header className="elig-head">
        <h1>자격진단</h1>
        <p>
          공공임대는 유형마다 나이와 혼인, 소득, 자산, 자동차 기준이 다르다. 내 조건을 한 번 넣으면
          {" "}{rules.types.length}개 공급유형을 한꺼번에 대 본다. 입력값은 어디로도 보내지 않는다.
        </p>
      </header>
      <EligibilityCheck rules={rules} />
    </div>
  );
}
