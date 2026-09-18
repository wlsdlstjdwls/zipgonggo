import Link from "next/link";
import { LegalSection } from "@/components/legal-doc";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";

export const PRIVACY_TITLE = "개인정보처리방침";
// 방문 통계(3항)를 담은 방침이 서는 날. 집계 코드도 이 날부터 기록한다
// (lib/analytics.ts ANALYTICS_START). **둘은 같은 날이어야 한다.**
// 서비스를 열며 방침을 처음 세우는 자리라 같은 날 시행한다(사용자 결정 2026-09-17).
// 10항의 「7일 전 공지」는 앞으로의 변경에 거는 약속이다 — 다음부터는 이 날짜를 7일 뒤로 잡는다.
export const PRIVACY_EFFECTIVE_DATE = "2026-09-17";

// 개인정보처리방침 본문 — /privacy 페이지가 쓴다.
// 집공고는 로그인도 회원도 없다. 서버에 남는 것은 방문 통계 넉 줄뿐이라 그 사실을 그대로 적는다.
export function PrivacyContent() {
  return (
    <>
      <LegalSection title="1. 개인정보를 수집하지 않습니다">
        <p>
          {SITE_NAME}는 회원가입과 로그인을 두지 않으며, 이름이나 이메일, 전화번호 등{" "}
          <strong>개인을 알아볼 수 있는 정보를 수집하거나 서버에 저장하지 않습니다.</strong> 구글
          애널리틱스 같은 외부 행태정보 추적 도구도 넣지 않습니다. 다만 어떤 지면이 얼마나 읽히는지
          알기 위해 아래 3항의 방문 통계를 저희 서버에서 직접, 최소한으로 집계합니다.
        </p>
      </LegalSection>

      <LegalSection title="2. 브라우저에만 남는 값">
        <p>
          아래 값은 이용자 브라우저의 localStorage에 저장됩니다. 브라우저 설정에서 사이트 데이터를
          지우면 즉시 사라집니다.
        </p>
        <ul>
          <li>관심 공고(★) 목록 — 서버로 보내지 않습니다</li>
          <li>마지막으로 보던 지역과 공급유형, 정렬, 마감 포함 여부 — 서버로 보내지 않습니다</li>
          <li>목록 보기 모드(카드, 목록, 간략) — 서버로 보내지 않습니다</li>
          <li>
            <strong>방문자 식별자</strong> — 브라우저가 만든 무작위 값입니다. 3항의 방문 통계에서
            같은 브라우저의 조회를 한 번으로 세는 데만 쓰이며, 이름이나 계정과 이어지지 않습니다.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. 방문 통계">
        <p>
          어떤 공고와 지역이 얼마나 읽히는지 알기 위해 지면 조회를 집계합니다. 한 번 조회할 때
          남기는 값은 아래 넷뿐이며, <strong>IP 주소와 브라우저 종류는 저장하지 않습니다.</strong>
        </p>
        <ul>
          <li>2항의 무작위 방문자 식별자</li>
          <li>본 지면의 경로 (예: /area/서울특별시). 검색어 등 물음표 뒤의 값은 떼고 저장합니다</li>
          <li>
            들어온 곳의 도메인 (예: search.naver.com). 주소 전체가 아니라 도메인만 남깁니다.
            운영자가 SNS에 올린 링크에 출처 표식(utm_source)이 붙어 있으면 그 서비스의 도메인을 적습니다
          </li>
          <li>조회한 시각</li>
        </ul>
        <p>
          기록은 <strong>12개월이 지나면 지웁니다.</strong> 통계는 운영자만 보며, 광고 맞춤이나
          외부 제공에 쓰지 않습니다. 브라우저의 사이트 데이터를 지우면 다음 방문부터는 이전 기록과
          이어지지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="4. 접속 기록">
        <p>
          서비스는 클라우드 호스팅 위에서 동작합니다. 호스팅 사업자가 서비스 운영과 보안을 위해 접속
          로그(IP 주소, 요청 경로, 브라우저 종류)를 자체 정책에 따라 일시 보관할 수 있습니다.
          운영자는 이 로그를 개인 식별 목적으로 조회하거나 다른 정보와 결합하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection title="5. 위치 정보">
        <p>
          서비스는 이용자의 현재 위치를 요청하지 않습니다. 지도에 찍히는 좌표는 공고문에 적힌{" "}
          <strong>건물 주소</strong>를 좌표로 바꾼 값이며, 이용자의 위치와는 무관합니다.
        </p>
      </LegalSection>

      <LegalSection title="6. 외부 서비스">
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

      <LegalSection title="7. 쿠키">
        <p>
          이용자에게는 쿠키를 심지 않습니다. 이용자를 추적하는 쿠키도, 광고 식별 쿠키도 없습니다.
          운영자 전용 관리 화면에만 로그인 쿠키가 쓰이며, 이는 운영자 본인의 브라우저에만 저장됩니다.
        </p>
      </LegalSection>

      <LegalSection title="8. 만 14세 미만 아동">
        <p>
          서비스는 만 14세 미만 아동을 포함해 누구에게도 이름·연락처 같은 개인정보를 요구하지 않습니다.
          3항의 방문 통계 역시 나이를 묻지 않으며 사람을 알아보는 데 쓸 수 없습니다.
        </p>
      </LegalSection>

      <LegalSection title="9. 문의">
        <p>
          개인정보 관련 문의와 요청은 <strong>{CONTACT_EMAIL}</strong>로 접수할 수 있습니다.
          개인정보분쟁조정위원회(1833-6972)와 한국인터넷진흥원 개인정보침해신고센터(118)에도 도움을
          요청할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="10. 고지">
        <p>
          이 방침은 {PRIVACY_EFFECTIVE_DATE}부터 적용됩니다. 앞으로 내용을 바꿀 때는 시행 7일 전에
          서비스 안에 공지합니다. <Link href={ROUTES.terms}>이용약관 보기</Link>
        </p>
      </LegalSection>
    </>
  );
}
