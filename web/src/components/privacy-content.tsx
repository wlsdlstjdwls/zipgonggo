import Link from "next/link";
import { LegalSection } from "@/components/legal-doc";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";

export const PRIVACY_TITLE = "개인정보처리방침";
export const PRIVACY_EFFECTIVE_DATE = "2026-09-09";

// 개인정보처리방침 본문 — /privacy 페이지가 쓴다.
// 집공고는 로그인도 회원도 없다. 실제로 서버에 남기는 개인정보가 없다는 사실을 그대로 적는다.
export function PrivacyContent() {
  return (
    <>
      <LegalSection title="1. 개인정보를 수집하지 않습니다">
        <p>
          {SITE_NAME}는 회원가입과 로그인을 두지 않으며, 이름이나 이메일, 전화번호 등{" "}
          <strong>개인을 알아볼 수 있는 정보를 수집하거나 서버에 저장하지 않습니다.</strong> 광고나
          행태정보 추적 스크립트도 넣지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="2. 브라우저에만 남는 값">
        <p>
          아래 값은 이용자 브라우저의 localStorage에만 저장되며 서버로 전송되지 않습니다. 브라우저
          설정에서 사이트 데이터를 지우면 즉시 사라집니다.
        </p>
        <ul>
          <li>저장(★)한 공고 목록</li>
          <li>마지막으로 보던 지역과 공급유형, 정렬, 마감 포함 여부</li>
          <li>목록 보기 모드(카드, 목록, 간략)</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. 접속 기록">
        <p>
          서비스는 클라우드 호스팅 위에서 동작합니다. 호스팅 사업자가 서비스 운영과 보안을 위해 접속
          로그(IP 주소, 요청 경로, 브라우저 종류)를 자체 정책에 따라 일시 보관할 수 있습니다.
          운영자는 이 로그를 개인 식별 목적으로 조회하거나 다른 정보와 결합하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="4. 위치 정보">
        <p>
          서비스는 이용자의 현재 위치를 요청하지 않습니다. 지도에 찍히는 좌표는 공고문에 적힌{" "}
          <strong>건물 주소</strong>를 좌표로 바꾼 값이며, 이용자의 위치와는 무관합니다.
        </p>
      </LegalSection>

      <LegalSection title="5. 외부 서비스">
        <p>화면을 그리는 데 아래 외부 서비스를 씁니다. 개인정보는 전달되지 않습니다.</p>
        <ul>
          <li>
            <strong>네이버 클라우드 플랫폼</strong> (지도 표시, 로드뷰, 주소를 좌표로 바꾸는 호출) —
            공고문에 적힌 건물 주소가 전달됩니다.
          </li>
          <li><strong>Vercel</strong> — 웹 서비스 호스팅</li>
          <li><strong>Neon</strong> — 공고 데이터베이스 호스팅</li>
          <li><strong>jsDelivr</strong> — 글꼴(Pretendard) 배포</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. 쿠키">
        <p>
          서비스는 로그인이 없어 인증 쿠키를 쓰지 않습니다. 위 2항의 localStorage 값 외에 이용자를
          추적하는 쿠키를 심지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="7. 만 14세 미만 아동">
        <p>
          서비스는 만 14세 미만 아동을 포함해 누구의 개인정보도 수집하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="8. 문의">
        <p>
          개인정보 관련 문의와 요청은 <strong>{CONTACT_EMAIL}</strong>로 접수할 수 있습니다.
          개인정보분쟁조정위원회(1833-6972)와 한국인터넷진흥원 개인정보침해신고센터(118)에도 도움을
          요청할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="9. 고지">
        <p>
          이 방침은 {PRIVACY_EFFECTIVE_DATE}부터 적용됩니다. 내용을 바꾸면 시행 7일 전 서비스 안에
          공지합니다. <Link href={ROUTES.terms}>이용약관 보기</Link>
        </p>
      </LegalSection>
    </>
  );
}
