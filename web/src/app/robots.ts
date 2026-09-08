import type { MetadataRoute } from "next";
import { ROUTES } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// 필터 결과(/?sector=…)는 페이지 메타의 noindex로 막는다 — robots에서 쿼리 패턴을 막으면 크롤러가 링크를 못 따라간다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [`${ROUTES.api}/`] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
