import type { Metadata } from "next";
import { EligibilityCheck } from "@/components/eligibility-check";
import { getEligibilityRules, listOpenSoon, listTypeHubs } from "@/lib/queries";
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
  // 아직 안 열었다(사용자 결정 2026-09-21). 화면으로 가는 메뉴를 운영자에게만 보이면서
  // 색인만 열려 있으면 검색으로 먼저 닿는다 — 사이트맵과 함께 거둔다.
  // **지우지는 않는다**(CLAUDE.md 하지 말 것 5) — 열 때 이 두 줄과 sitemap.ts 한 줄을 돌린다
  robots: { index: false, follow: true },
};

export default async function EligibilityPage() {
  // 진단은 브라우저에서 돈다 — 어느 유형이 통과인지 서버가 모르니 열린 공고를 미리 한 줌 실어 보내고
  // 화면이 통과한 유형만 골라 그린다(lib/queries listOpenSoon)
  const [rules, open, hubs] = await Promise.all([getEligibilityRules(), listOpenSoon(), listTypeHubs()]);
  return (
    <div className="elig-stage">
      <header className="elig-head">
        <h1>자격진단</h1>
        <p>
          공공임대는 유형마다 나이와 혼인, 소득, 자산, 자동차 기준이 다릅니다. 내 조건을 한 번 넣으면
          {" "}{rules.types.length}개 공급유형을 한꺼번에 견줘 볼 수 있습니다. 넣은 값은 이 브라우저에 남아
          공고 지면의 「내 조건」에도 그대로 쓰이며, 내 계정에서 저장을 켜지 않는 한 서버로 보내지 않습니다.
        </p>
      </header>
      <EligibilityCheck rules={rules} open={open} hubs={hubs} />
    </div>
  );
}
