import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "집공고 — 공공임대 모집공고 지도", template: "%s | 집공고" },
  description: "LH·SH·지방공사 공공임대 입주자모집공고를 지역·단지 단위로 모아 보증금·임대료·마감일을 한눈에.",
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
            <Link href="/" className="logo"><i aria-hidden="true" />집공고</Link>
            <nav>
              <Link href="/">공고</Link>
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
