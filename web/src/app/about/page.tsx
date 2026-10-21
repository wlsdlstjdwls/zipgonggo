// 소개 — /about. docs/url-structure.md 「소개」.
//
// 애드센스 1차 탈락(2026-10-12, 「가치가 별로 없는 콘텐츠」) 뒤에 세웠다. 누가 왜 운영하는지, 데이터가 어디서 오고
// 얼마나 자주 갱신되는지, 기관 원문을 옮기는 것 말고 **우리가 직접 계산하는 값**이 무엇인지를 밝힌다.
// 숫자는 DB에서 읽는다. 갱신 주기는 .github/workflows(collect 매시, patrol 하루 한 번)와 맞출 것.
import type { Metadata } from "next";
import Link from "next/link";
import { HubLede, HubStats } from "@/components/hub-blocks";
import { JsonLd } from "@/components/json-ld";
import { LegalSection } from "@/components/legal-doc";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/constants";
import { num } from "@/lib/format";
import { GUIDE_DOCS } from "@/lib/guides";
import { breadcrumb, ORG_ID, WEBSITE_ID } from "@/lib/jsonld";
import { getSiteStats } from "@/lib/queries";
import { guidePath, ROUTES } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(86400)와 같은 값을 유지할 것
export const revalidate = 86400;
export const preferredRegion = "iad1";

const TITLE = `${SITE_NAME} 소개 — 누가, 어떤 데이터로, 무엇을 계산하나`;
const DESCRIPTION =
  "집공고는 LH, SH, 지방공사, 서울시의 공공임대 입주자모집공고를 매시 모아 단지와 주택형 단위로 다시 보여 주는 개인 운영 서비스다. 데이터 출처와 갱신 주기, 직접 계산하는 값과 그 한계.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.about },
};

export default async function AboutPage() {
  const s = await getSiteStats();
  const url = absoluteUrl(ROUTES.about);
  const crumbId = `${url}#breadcrumb`;
  const graph = [
    {
      "@type": "AboutPage",
      "@id": `${url}#page`,
      name: TITLE,
      description: DESCRIPTION,
      inLanguage: "ko-KR",
      url,
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": ORG_ID },
      breadcrumb: { "@id": crumbId },
    },
    breadcrumb(crumbId, [
      { name: "공고 목록", path: ROUTES.home },
      { name: "소개", path: ROUTES.about },
    ]),
  ];

  return (
    <article className="stage legal">
      <JsonLd graph={graph} />
      <div className="crumb">
        <Link href={ROUTES.home} className="back">← 목록</Link>
      </div>
      <div className="legal-in">
        <h1>{SITE_NAME} 소개</h1>
        <HubStats items={[
          { label: "진행 중 공고", value: num(s.open, "건"), hot: s.open > 0 },
          { label: "모은 공고", value: num(s.notices, "건") },
          { label: "단지와 주택", value: num(s.complexes, "곳") },
          { label: "대기현황 단지", value: num(s.waitlist, "곳") },
        ]} />
        <p className="legal-eff">{s.oldest}년 공고부터 | 마지막 갱신 {s.updated}</p>
        <div className="legal-body">
          <HubLede>
            {SITE_NAME}은 공공임대 입주자모집공고를 한곳에 모아, 공고문 수십 쪽에 흩어진 금액과 자격, 일정, 단지 정보를 단지와 주택형 단위로
            다시 보여 주는 서비스다. 개인이 운영하고, 이용료를 받지 않는다.
          </HubLede>

          <LegalSection title="왜 만들었나">
            <p>
              공공임대 공고는 LH, SH, 지방공사, 서울시가 저마다의 사이트에 올린다. 같은 공고가 여러 곳에 다른 제목으로 올라오고, 정작 필요한
              보증금과 월임대료, 소득 기준 금액은 HWP나 PDF 첨부의 별표 안에 있다. 한 단지를 고르려면 공고문을 내려받아 표를 찾고, 다른
              사이트에서 예비입주자 대기현황을 따로 찾아야 했다.
            </p>
            <p>
              {SITE_NAME}은 이 일을 대신한다. 공고를 모아 중복을 하나로 묶고, 첨부 공고문의 표를 읽어 단지와 주택형별 금액으로 펼치고, 대기현황과
              지난 경쟁률을 같은 화면에 붙인다. 마감된 공고도 지우지 않는다. 같은 단지는 해마다 다시 공고가 나기 때문에 지난 공고가 다음 회차의
              가장 좋은 참고가 된다.
            </p>
          </LegalSection>

          <LegalSection title="데이터는 어디서 오나">
            <ul>
              <li><strong>국토교통부 마이홈포털 공공주택 모집공고 조회</strong>(공공데이터포털) — 전국 공고 목록과 일정, 기본 금액</li>
              <li><strong>마이홈포털 공공임대주택 단지정보</strong> — 단지 제원과 주택형별 면적, 기본 보증금과 월임대료, 전환보증금 한도</li>
              <li><strong>마이홈포털 예비입주자 대기현황</strong> — 추첨 단위별 대기 인원과 퇴거 건수</li>
              <li><strong>서울주거포털과 SH 게시판</strong> — SH 공고와 첨부 공고문, 접수 결과 공고(경쟁률)</li>
              <li><strong>서울시 청년안심주택 게시판</strong> — 민간임대와 청년안심주택 공고, 첨부 공고문</li>
              <li><strong>행정안전부 도로명주소 위치정보 요약DB</strong> — 단지 주소를 지도 좌표로 바꾸는 데 쓴다. 지도 서비스의 좌표를 저장하지 않는다</li>
            </ul>
            <p>
              공고 목록은 <strong>매시</strong> 다시 읽고, 대기현황과 단지 정보, SH 결과 공고는 <strong>하루 한 번</strong> 갱신한다. 요청 간격을
              지키고 각 사이트의 robots.txt를 따른다. 공고문 원본 파일은 다시 배포하지 않고, 모든 공고 화면에 기관 원문 링크를 단다.
            </p>
          </LegalSection>

          <LegalSection title="직접 계산하는 값">
            <p>기관 원문을 옮기는 것 말고 {SITE_NAME}이 직접 계산해 싣는 값이 있다. 계산 방법을 밝혀 둔다.</p>
            <ul>
              <li>
                <strong>소득 기준 금액</strong> — 공고문은 「도시근로자 월평균소득 100%」처럼 비율만 적는다. 국토교통부가 고시한 가구원수별
                기준 금액에 비율을 곱해 원 단위로 바꾸고, 1인 가구 가산과 맞벌이 기준을 반영한다.
              </li>
              <li>
                <strong>자격진단</strong> — 32개 공급유형의 나이, 혼인, 무주택, 소득, 자산, 자동차, 거주지 기준을 공고문과 대조해 규칙으로 만들었다.
                입력한 조건은 브라우저에만 남고, 직접 켜지 않는 한 서버로 보내지 않는다.
              </li>
              <li>
                <strong>예비입주 대기 집계</strong> — 마이홈포털 대기현황을 단지와 유형, 시도별로 더하고 대기가 0명인 추첨 단위의 비율을 낸다.
              </li>
              <li>
                <strong>보증금 상호전환</strong> — 공고문 별표의 사례에서 전환 이율과 한도를 거꾸로 계산해, 보증금을 바꿨을 때의 월임대료를 낸다.
              </li>
              <li>
                <strong>경쟁률</strong> — SH 결과 공고의 표를 줄 단위로 읽고, 공급호수와 신청자 수가 산술로 맞는 줄만 싣는다.
              </li>
            </ul>
            <p>
              이 계산을 바탕으로 한 글은 <Link href={ROUTES.guide}>안내 글</Link>에 모았다. 예를 들어{" "}
              <Link href={guidePath("소득기준-실제-금액")}>{GUIDE_DOCS["소득기준-실제-금액"].title}</Link>,{" "}
              <Link href={guidePath("예비입주자-대기-인원-읽는-법")}>{GUIDE_DOCS["예비입주자-대기-인원-읽는-법"].title}</Link>.
            </p>
          </LegalSection>

          <LegalSection title="한계와 책임">
            <p>
              {SITE_NAME}은 기관이 아니고, 어느 기관과도 제휴하지 않는다. 첨부 공고문의 표를 기계로 읽기 때문에 원문 조판이 특이하면 값이 빠지거나
              틀릴 수 있다. 확실하지 않은 값은 비워 두고 원문을 가리킨다. <strong>신청 전에는 반드시 기관 원문 공고문을 확인한다.</strong>
            </p>
            <p>
              대출이나 금융 상품을 권하거나 중개하지 않는다. 보증금과 월임대료는 감추지 않고 공고에 나온 그대로 싣는다.
            </p>
          </LegalSection>

          <LegalSection title="연락">
            <p>
              잘못된 정보, 빠진 공고, 권리 침해 신고는 <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>로 보내 주면 확인해서 고친다.
              개인정보 처리는 <Link href={ROUTES.privacy}>개인정보처리방침</Link>, 이용 조건은 <Link href={ROUTES.terms}>이용약관</Link>에 있다.
            </p>
          </LegalSection>
        </div>
      </div>
    </article>
  );
}
