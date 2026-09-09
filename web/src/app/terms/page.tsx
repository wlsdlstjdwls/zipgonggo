import type { Metadata } from "next";
import { LegalDoc } from "@/components/legal-doc";
import { TermsContent, TERMS_EFFECTIVE_DATE, TERMS_TITLE } from "@/components/terms-content";
import { SITE_NAME } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: TERMS_TITLE,
  description: `${SITE_NAME} 서비스 이용약관 — 서비스 내용, 정보의 성격과 면책, 데이터 출처와 저작권 표시, 권리침해 신고.`,
  alternates: { canonical: ROUTES.terms },
};

export default function TermsPage() {
  return (
    <LegalDoc title={TERMS_TITLE} effectiveDate={TERMS_EFFECTIVE_DATE}>
      <TermsContent />
    </LegalDoc>
  );
}
