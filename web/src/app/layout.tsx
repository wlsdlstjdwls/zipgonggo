import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand-mark";
import { SaveProvider } from "@/components/save-context";
import { ScopeBar } from "@/components/scope-bar";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/constants";
import { listFilterOptions } from "@/lib/queries";
import { ROUTES } from "@/lib/routes";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  // 아이콘·OG 이미지는 app/ 파일 규약(icon.svg·favicon.ico·apple-icon.png·opengraph-image.png)이 자동으로 link/meta를 단다.
  // 여기서는 파일이 못 채우는 값만 — 공유 카드의 사이트명·타입·로케일.
  openGraph: { type: "website", siteName: SITE_NAME, locale: "ko_KR", title: SITE_TITLE, description: SITE_DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 시도·부문 분포 — 스코프 바가 매 페이지에 상시 노출되므로 여기서 한 번만 조회한다(unstable_cache 캐시, 6차 설계)
  const options = await listFilterOptions(undefined);
  return (
    <html lang="ko">
      <head>
        {/* Pretendard 단일 패밀리 — fitin-app이 라틴/한글 2폰트 조합을 버리고 정착한 결론 */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>
        <SaveProvider>
          <header className="site-header">
            <div className="bar">
              <div className="left">
                <Link href={ROUTES.home} className="logo"><BrandMark size={22} />{SITE_NAME}</Link>
              </div>
            </div>
          </header>
          {/* usePathname·useSearchParams를 쓰는 클라이언트 조각이라 Suspense로 감싸 나머지 트리의 정적 렌더를 지킨다 */}
          <Suspense fallback={null}>
            <ScopeBar sidoOptions={options.sido} sectorOptions={options.sector} />
          </Suspense>
          <main className="shell">{children}</main>
          <footer className="site-footer">
            <div className="bar">
              <p>출처: 국토교통부 마이홈포털 공공주택 모집공고 조회 서비스(공공데이터포털), 서울주거포털 SH 공고 목록. 공고 원문은 각 기관 링크에서 확인하세요.</p>
              <p>보증금과 임대료는 공고에 기재된 최소값입니다. 호실별 금액은 기관 원문을 따릅니다.</p>
            </div>
          </footer>
        </SaveProvider>
      </body>
    </html>
  );
}
