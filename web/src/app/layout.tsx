import type { Metadata } from "next";
import { Suspense } from "react";
import { CalcButton, CalcProvider } from "@/components/calc-context";
import { CalcDock } from "@/components/calc-dock";
import { HomeLink } from "@/components/home-link";
import { SaveProvider } from "@/components/save-context";
import { ListStateProvider } from "@/components/list-state";
import { BOOT_SCOPE_JS, CONTACT_EMAIL, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";
import Link from "next/link";
import { listFacets } from "@/lib/queries";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

// DB를 Neon us-east-1(버지니아)로 옮겼다 — Hobby 플랜은 함수 리전이 iad1 고정이라 preferredRegion을 못 바꾼다(2026-09-09 실측).
// 지금은 no-op이지만 Pro로 올리면 이 값이 실제로 먹으니 DB 리전과 맞춰 둔다.
export const preferredRegion = "iad1";

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
  // 무필터 수량 — 스코프 바가 매 페이지에 상시 노출되므로 여기서 한 번만 조회한다(unstable_cache 캐시, 6차 설계).
  // 필터가 걸리면 ListStateProvider가 /api/facets로 다시 받아 갈아끼운다.
  const facets = await listFacets({});
  return (
    // 부트 스크립트가 하이드레이션 전에 data-booting을 걸어 서버 HTML과 어긋난다 — 의도된 차이라 경고를 끈다
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* Pretendard 단일 패밀리 — fitin-app이 라틴/한글 2폰트 조합을 버리고 정착한 결론 */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
        {/* 저장된 필터가 있으면 하이드레이션 전에 목록을 가려 둔다 — 무필터 목록이 보였다 갈리는 걸 막는다(사용자 지적 2026-09-09) */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCOPE_JS }} />
      </head>
      <body>
        <SaveProvider>
          {/* 계산기는 화면 오른쪽 아래 떠 있던 버튼에서 헤더 메뉴로 올렸다(사용자 요청 2026-09-09).
              패널은 body로 포털되지만 여는 버튼과 씨앗값이 서로 다른 트리라 Provider가 감싼다 */}
          <CalcProvider>
          <header className="site-header">
            <div className="bar">
              <div className="left">
                <HomeLink />
                {/* 자격진단은 공고 목록과 나란한 한 갈래다 — 헤더에서 바로 닿게 둔다 */}
                <nav className="site-nav" aria-label="주요 메뉴">
                  <Link href={ROUTES.eligibility}>자격진단</Link>
                </nav>
              </div>
              <CalcButton />
            </div>
          </header>
          {/* 목록 상태(부문·유형·마감·정렬)는 URL이 아니라 이 Provider가 들고 있다 — 스코프 바·필터 바·목록이 함께 구독한다 */}
          <Suspense fallback={null}>
            {/* 필터는 목록 페이지 안의 왼쪽 레일이 담당한다 — 헤더 아래 전폭 스코프 바는 걷어냈다(2026-09-09) */}
            <ListStateProvider initialFacets={facets}>
              <main className="shell">{children}</main>
            </ListStateProvider>
          </Suspense>
          <footer className="site-footer">
            <div className="bar">
              <p>출처: 국토교통부 마이홈포털 공공주택 모집공고 조회 서비스(공공데이터포털), 서울주거포털 SH 공고 목록. 공고 원문은 각 기관 링크에서 확인하세요.</p>
              {/* 개인정보처리방침은 다른 링크보다 굵게 — 개인정보보호법 시행령이 "글자 크기나 색상으로 구분해
                  쉽게 확인할 수 있게" 하라고 정한다 */}
              <nav className="foot-legal" aria-label="약관과 방침">
                <Link href={ROUTES.terms}>이용약관</Link>
                <span aria-hidden="true" />
                <Link href={ROUTES.privacy} className="strong">개인정보처리방침</Link>
                <span aria-hidden="true" />
                <a href={`mailto:${CONTACT_EMAIL}`}>문의와 권리침해 신고</a>
              </nav>
              <p className="foot-copy">© 2026 {SITE_NAME}. All rights reserved.</p>
            </div>
          </footer>
          <CalcDock />
          </CalcProvider>
        </SaveProvider>
      </body>
    </html>
  );
}
