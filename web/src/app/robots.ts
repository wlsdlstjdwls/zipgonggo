import type { MetadataRoute } from "next";
import { ROUTES } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// 필터 결과(/?sector=…)는 페이지 메타의 noindex로 막는다 — robots에서 쿼리 패턴을 막으면 크롤러가 링크를 못 따라간다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [`${ROUTES.api}/`] }],
    // 사이트맵과 RSS 둘 다 알린다 — 네이버는 RSS를 「방금 올라온 것」으로 읽어 신규 수집이 빠르다
    sitemap: [absoluteUrl("/sitemap.xml"), absoluteUrl(ROUTES.rss)],
  };
}
