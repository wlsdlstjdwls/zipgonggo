import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal-doc";
import { PrivacyContent, PRIVACY_EFFECTIVE_DATE, PRIVACY_TITLE } from "@/components/privacy-content";
import { SITE_NAME } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: PRIVACY_TITLE,
  description: `${SITE_NAME}가 다루는 정보 — 개인정보를 수집하지 않으며, 저장(★) 목록과 화면 설정은 브라우저에만 남습니다.`,
  alternates: { canonical: ROUTES.privacy },
};

export default function PrivacyPage() {
  return (
    <LegalDoc title={PRIVACY_TITLE} effectiveDate={PRIVACY_EFFECTIVE_DATE}>
      <PrivacyContent />
    </LegalDoc>
  );
}
