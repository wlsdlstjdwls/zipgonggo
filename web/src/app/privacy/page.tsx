import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal-doc";
import { PrivacyContent, PRIVACY_AMENDED_DATE, PRIVACY_TITLE } from "@/components/privacy-content";
import { SITE_NAME } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: PRIVACY_TITLE,
  description: `${SITE_NAME}가 다루는 정보 — 로그인하지 않으면 개인정보를 수집하지 않고, 카카오 로그인 시 받는 항목은 별명과 프로필 사진뿐입니다.`,
  alternates: { canonical: ROUTES.privacy },
};

export default function PrivacyPage() {
  return (
    // 머리에 적는 날짜는 지금 효력이 있는 판의 시행일 — 카카오 로그인 판(PRIVACY_AMENDED_DATE)
    <LegalDoc title={PRIVACY_TITLE} effectiveDate={PRIVACY_AMENDED_DATE}>
      <PrivacyContent />
    </LegalDoc>
  );
}
