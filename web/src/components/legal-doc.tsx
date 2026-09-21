// 이용약관/개인정보처리방침 같은 정책 문서의 공용 골격.
// 본문 폭을 좁게 잡고 조항 단위로 끊는다 — 화면에서 읽히라고 만든 문서지 PDF 대용이 아니다.
import { BackLink } from "./back-link";
import { SITE_NAME } from "@/lib/constants";

export function LegalDoc({ title, effectiveDate, children }: {
  title: string;
  effectiveDate: string;
  children: React.ReactNode;
}) {
  return (
    <article className="stage legal">
      <div className="crumb">
        {/* 온 길로 돌아간다. 로그인 화면에서 약관을 열었으면 로그인 화면으로 */}
        <BackLink />
      </div>
      <div className="legal-in">
        <h1>{title}</h1>
        <p className="legal-eff">시행일 {effectiveDate} | {SITE_NAME}</p>
        <div className="legal-body">{children}</div>
      </div>
    </article>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="legal-sec">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
