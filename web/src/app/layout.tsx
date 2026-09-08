import type { Metadata } from "next";
import Link from "next/link";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard 단일 패밀리 — fitin-app이 라틴/한글 2폰트 조합을 버리고 정착한 결론 */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>
        <header className="site-header">
          <div className="container">
            <Link href={ROUTES.home} className="logo"><i aria-hidden="true" />{SITE_NAME}</Link>
            <nav>
              <Link href={ROUTES.home}>공고</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">
          <div className="container">
            <p>출처: 국토교통부 마이홈포털 공공주택 모집공고 조회 서비스(공공데이터포털) · 서울주거포털 SH 공고 목록. 공고 원문은 각 기관 링크에서 확인하세요.</p>
            <p>보증금·임대료는 공고에 기재된 최소값입니다. 호실별 금액은 기관 원문을 따릅니다.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
