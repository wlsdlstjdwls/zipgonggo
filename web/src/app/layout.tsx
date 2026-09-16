import type { Metadata } from "next";
import { Suspense } from "react";
import { CalcButton, CalcProvider } from "@/components/calc-context";
import { CalcDock } from "@/components/calc-dock";
import { HomeLink } from "@/components/home-link";
import { SaveProvider } from "@/components/save-context";
import { VisitTracker } from "@/components/visit-tracker";
import { ListStateProvider } from "@/components/list-state";
import {
  AREA_MIN_COUNT, BOOT_SCOPE_JS, CONTACT_EMAIL, GOOGLE_SITE_VERIFICATION, NAVER_SITE_VERIFICATION,
  SITE_DESCRIPTION, SITE_NAME, SITE_TITLE,
} from "@/lib/constants";
import { areaPath, ROUTES, typePath } from "@/lib/routes";
import Link from "next/link";
import { listFacets, listFilterOptions, listTypeHubs } from "@/lib/queries";
import { sidoShort } from "@/lib/sido";
import { housingTypeDoc } from "@/lib/housing-types";
import { SITE_URL } from "@/lib/site-url";
import "./globals.css";

// DB를 Neon us-east-1(버지니아)로 옮겼다. **플랜이 Pro라 이 값은 실제로 먹는다**(2026-09-16 확인) —
// 09-09에 「Hobby라 iad1 고정이라 no-op」이라고 적어 둔 건 더는 사실이 아니다.
// DB를 읽는 라우트는 iad1에 둔다. 한국 사이트로 나가는 라우트만 icn1로 따로 뗀다.
export const preferredRegion = "iad1";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  // 아이콘·OG 이미지는 app/ 파일 규약(icon.svg·favicon.ico·apple-icon.png·opengraph-image.png)이 자동으로 link/meta를 단다.
  // 여기서는 파일이 못 채우는 값만 — 공유 카드의 사이트명·타입·로케일.
  openGraph: { type: "website", siteName: SITE_NAME, locale: "ko_KR", title: SITE_TITLE, description: SITE_DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  // 구글 서치콘솔·네이버 서치어드바이저 소유확인. 값이 없으면 키 자체를 빼야 한다 —
  // content가 빈 <meta>가 나가면 확인이 "태그는 있는데 값이 다르다"로 실패한다.
  verification: {
    ...(GOOGLE_SITE_VERIFICATION ? { google: GOOGLE_SITE_VERIFICATION } : {}),
    ...(NAVER_SITE_VERIFICATION ? { other: { "naver-site-verification": NAVER_SITE_VERIFICATION } } : {}),
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 무필터 수량 — 스코프 바가 매 페이지에 상시 노출되므로 여기서 한 번만 조회한다(unstable_cache 캐시, 6차 설계).
  // 필터가 걸리면 ListStateProvider가 /api/facets로 다시 받아 갈아끼운다.
  // 푸터 지역 링크 — 사이트맵과 **같은 원천·같은 기준**(listFilterOptions + AREA_MIN_COUNT)이어야 한다.
  // 사이트맵에만 있고 링크가 없으면 /area/{시도}는 고아 페이지가 된다(2026-09-15 점검: 홈 HTML에 /area 링크 0개).
  const [facets, options, hubs] = await Promise.all([listFacets({}), listFilterOptions(undefined), listTypeHubs()]);
  const areas = options.sido.filter((o) => o.count >= AREA_MIN_COUNT);
  // 유형 허브(/type)로 가는 유일한 내부 링크. 설명을 써 둔 유형만 발행하므로 그 기준을 그대로 쓴다
  const types = hubs.filter((h) => housingTypeDoc(h.housing_type));
  return (
    // 부트 스크립트가 하이드레이션 전에 data-booting을 걸어 서버 HTML과 어긋난다 — 의도된 차이라 경고를 끈다
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* RSS 자동발견. metadata.alternates에 두면 안 된다 — 자식 페이지가 canonical을 넣으며
            alternates를 통째로 덮어써서 조용히 사라진다(2026-09-15 실측). <head>에 직접 박는다 */}
        <link rel="alternate" type="application/rss+xml" title={`${SITE_NAME} — 입주자모집공고`} href={ROUTES.rss} />
        {/* Pretendard 단일 패밀리 — fitin-app이 라틴/한글 2폰트 조합을 버리고 정착한 결론 */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
        {/* 구글 애드센스 로더. 사이트 검토 크롤러가 원본 HTML에서 이 태그를 찾으므로
            next/script 클라이언트 주입이 아니라 <head>에 그대로 출력한다.
            개발 중에는 넣지 않는다 — localhost는 승인된 사이트가 아니라 광고 요청이 403으로 떨어지고,
            콘솔이 그 빨간 줄로 덮여 진짜 오류가 묻힌다(사용자 지적 2026-09-14) */}
        {process.env.NODE_ENV === "production" && (
          <script
            async
            src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3393846164946829"
            crossOrigin="anonymous"
          />
        )}
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
          {/* 목록 상태(부문·유형·마감·정렬)는 URL이 아니라 이 Provider가 들고 있다 — 스코프 바·필터 바·목록이 함께 구독한다.
              **여기를 <Suspense>로 감싸지 말 것**(2026-09-16 제거). 경계가 children 위에 있으면 아래 어느 페이지가
              notFound()를 불러도 응답이 200으로 남아 모든 동적 경로가 soft 404가 된다 —
              화면은 not-found.tsx가 그려져서 눈으로는 안 보인다. 자세한 건 notice/[slug]/(detail)/layout.tsx 머리글.
              예전엔 useSearchParams 때문에 경계가 필요했지만 지금 src에 그 훅을 쓰는 자리가 없다(usePathname은 경계가 필요 없다). */}
          <ListStateProvider initialFacets={facets}>
            <main className="shell">{children}</main>
          </ListStateProvider>
          <footer className="site-footer">
            <div className="bar">
              {/* 지역별 착지 페이지로 가는 유일한 내부 링크. 크롤러가 공고 상세까지 닿는 길이 여기서 갈라진다 —
                  목록은 무한스크롤이라 홈 HTML에는 첫 24건만 있다(2026-09-15 점검). 지우지 말 것 */}
              {areas.length > 0 && (
                <nav className="foot-area" aria-label="지역별 모집공고">
                  <b>지역별 모집공고</b>
                  <ul>
                    {areas.map((o) => (
                      <li key={o.value}>
                        <Link href={areaPath(o.value)}>
                          {sidoShort(o.value)} <em>{o.count}</em>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
              {types.length > 0 && (
                <nav className="foot-area" aria-label="유형별 안내">
                  <b>유형별 안내</b>
                  <ul>
                    {types.map((h) => (
                      <li key={h.housing_type}>
                        <Link href={typePath(h.housing_type)}>
                          {h.housing_type} <em>{h.total}</em>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
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
          {/* 방문 집계 한 줄(/api/track). 화면에는 아무것도 안 그린다 —
              봇·자동화 브라우저·운영자는 여기서 걸러 안 쏜다 */}
          <Suspense fallback={null}>
            <VisitTracker />
          </Suspense>
          </CalcProvider>
        </SaveProvider>
      </body>
    </html>
  );
}
