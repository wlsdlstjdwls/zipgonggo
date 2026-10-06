import type { Metadata } from "next";
import { EligibilityCheck } from "@/components/eligibility-check";
import { getEligibilityRules, listOpenSoon, listResidenceAreas, listTypeHubs } from "@/lib/queries";
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
  // 2026-09-21부터 noindex로 거둬 두었다가, 시드를 공고문과 대조해 고친 뒤 열었다(사용자 결정 2026-10-06).
  // 다시 거둘 땐 여기 robots와 sitemap.ts 한 줄을 같이 돌린다 — 주소는 지우지 않는다(CLAUDE.md 하지 말 것 5)
};

export default async function EligibilityPage() {
  // 진단은 브라우저에서 돈다 — 어느 유형이 통과인지 서버가 모르니 열린 공고를 미리 한 줌 실어 보내고
  // 화면이 통과한 유형만 골라 그린다(lib/queries listOpenSoon)
  const [rules, open, hubs, areas] = await Promise.all([
    getEligibilityRules(), listOpenSoon(), listTypeHubs(), listResidenceAreas(),
  ]);
  return (
    <div className="elig-stage">
      <header className="elig-head">
        <h1>자격진단</h1>
        {/* 넣은 값이 어디 남는지, 이 진단이 심사가 아니라는 말은 지면에 적지 않는다(사용자 결정 2026-09-22).
            개인정보 처리 안내는 푸터의 개인정보처리방침이 진다 */}
        <p>
          공공임대는 유형마다 나이와 혼인, 소득, 자산, 자동차 기준이 다릅니다.
          {/* 문장마다 줄을 가른다 — 폭에 따라 아무 데서나 접히면 두 문장이 한 줄에 뒤엉킨다(사용자 요청 2026-09-22) */}
          <br />
          내 조건을 한 번 넣으면 {rules.types.length}개 공급유형을 한꺼번에 견줘 볼 수 있습니다.
        </p>
      </header>
      <EligibilityCheck rules={rules} open={open} hubs={hubs} areas={areas} />
    </div>
  );
}
