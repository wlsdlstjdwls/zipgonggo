import Link from "next/link";
import { LegalSection } from "@/components/legal-doc";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";

export const TERMS_TITLE = "이용약관";
export const TERMS_EFFECTIVE_DATE = "2026-09-09";

// 이용약관 본문 — /terms 페이지가 쓴다. 문구에 가운뎃점을 쓰지 않는다(CLAUDE.md 표기 규칙).
export function TermsContent() {
  return (
    <>
      <LegalSection title="제1조 (목적)">
        <p>
          이 약관은 {SITE_NAME}(zipgonggo.com, 이하 &ldquo;서비스&rdquo;)의 이용 조건과 운영자와 이용자의
          권리와 의무를 정합니다. 서비스는 개인이 운영하는 공공임대 입주자모집공고 정보 제공
          서비스입니다.
        </p>
      </LegalSection>

      <LegalSection title="제2조 (서비스 내용)">
        <ul>
          <li>LH, SH, 지방공사 등이 공개한 입주자모집공고를 모아 목록과 지도로 제공</li>
          <li>공고 첨부 문서에서 읽은 사실 데이터(단지명, 주소, 보증금, 임대료, 면적, 호수, 접수 일정) 재구성</li>
          <li>보증금과 월임대료 상호전환 계산기, 대출이자 계산기 등 계산 도구</li>
          <li>관심 공고 저장(브라우저에만 저장됩니다)</li>
        </ul>
        <p>
          서비스는 무료이며, 운영자는 서비스의 전부 또는 일부를 변경하거나 중단할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제3조 (계정)">
        <p>
          서비스는 회원가입과 로그인을 두지 않습니다. 저장한 공고와 화면 설정은 이용자 브라우저에만
          남으며, 운영자는 이를 수집하거나 열람하지 않습니다. 자세한 내용은{" "}
          <Link href={ROUTES.privacy}>개인정보처리방침</Link>을 확인하세요.
        </p>
      </LegalSection>

      <LegalSection title="제4조 (정보의 성격과 면책)">
        <ul>
          <li>
            서비스가 보여 주는 모든 값은 <strong>기관이 공개한 공고를 옮겨 정리한 참고 자료</strong>입니다.
            자격 요건, 보증금과 임대료, 접수 일정, 공급 호수의 최종 기준은 언제나 각 기관의 공식
            공고문입니다.
          </li>
          <li>
            공고문은 첨부 파일(PDF, HWP)의 표에서 자동으로 읽습니다. 표 구조나 표기가 바뀌면 값이
            빠지거나 잘못 읽힐 수 있습니다. 금액과 호수는 공고 안 최소값을 대표로 보여 주는 자리가
            있으므로, 신청 전에는 반드시 원문 표를 확인하세요.
          </li>
          <li>
            지도 위치는 도로명주소를 좌표로 바꾼 근사치입니다. 건물 출입구나 동 단위 위치와 다를 수
            있습니다.
          </li>
          <li>
            정보의 오류나 누락, 지연, 서비스 중단으로 발생한 청약 누락이나 손해에 대해 운영자는 고의
            또는 중대한 과실이 없는 한 책임지지 않습니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="제5조 (금융 상품 안내를 하지 않습니다)">
        <p>
          서비스는 대출 중개나 금융 상품 권유, 알선을 하지 않습니다. 제공하는 계산기는 이용자가 넣은
          숫자로 산수를 하는 도구일 뿐이며, 특정 상품이나 금융기관을 안내하지 않습니다. 실제 한도와
          금리, 상환 조건은 금융기관에서 확인하세요.
        </p>
      </LegalSection>

      <LegalSection title="제6조 (금지행위)">
        <ul>
          <li>자동화 수단으로 서비스를 과도하게 조회하거나 데이터를 대량 수집하는 행위</li>
          <li>서비스 운영을 방해하거나 서버에 부하를 주는 행위</li>
          <li>서비스가 제공하는 정보를 공식 공고인 것처럼 꾸며 제3자에게 제공하는 행위</li>
        </ul>
      </LegalSection>

      <LegalSection title="제7조 (지식재산권과 데이터 출처)">
        <ul>
          <li>
            공고 원문과 첨부 파일의 저작권은 각 공급기관에 있습니다. 서비스는{" "}
            <strong>원문 파일을 재배포하지 않으며</strong>, 사실 데이터만 재구성해 싣고 원문은 기관
            링크로 연결합니다.
          </li>
          <li>
            공고 목록과 상세: 국토교통부 마이홈포털 공공주택 모집공고 조회 서비스(공공데이터포털),
            서울주거포털 SH 공고 목록. SH 자료는 서울특별시 공공저작물 관리책임관과 사전 협의한
            범위에서 사실 데이터만 씁니다.
          </li>
          <li>지도: © NAVER Corp. (네이버 지도 API)</li>
          <li>글꼴: Pretendard (SIL Open Font License 1.1)</li>
          <li>
            서비스가 직접 만든 화면 구성과 정리 결과물의 권리는 운영자에게 있습니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="제8조 (권리침해 신고)">
        <p>
          게시된 내용으로 권리를 침해당했거나 잘못된 정보를 발견하면 <strong>{CONTACT_EMAIL}</strong>로
          알려주세요. 확인 후 지체 없이 수정하거나 삭제하고 결과를 회신합니다.
        </p>
      </LegalSection>

      <LegalSection title="제9조 (약관 변경과 분쟁)">
        <p>
          약관을 바꾸면 시행 7일 전(이용자에게 불리한 변경은 30일 전)에 서비스 안에 공지합니다. 이
          약관은 대한민국 법을 따르며, 분쟁은 먼저 {CONTACT_EMAIL}을 통한 협의로 해결합니다.
        </p>
      </LegalSection>

      <LegalSection title="부칙">
        <p>이 약관은 {TERMS_EFFECTIVE_DATE}부터 시행합니다.</p>
      </LegalSection>
    </>
  );
}
