import type { MetadataRoute } from "next";
import { AREA_MIN_COUNT, SITEMAP_MAX_URLS, SITEMAP_PRIORITY_CLOSED, SITEMAP_PRIORITY_OPEN } from "@/lib/constants";
import { listFilterOptions, listSitemapNotices } from "@/lib/queries";
import { areaPath, noticePath, ROUTES } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// 색인 대상 URL의 단일 원천. 홈 + 지역(/area) + 공고 상세.
// 단지 페이지가 생기면 타입별로 generateSitemaps로 쪼갠다(docs/url-structure.md: 파일당 40,000 URL).
// lastModified는 DB updated_at — 매 생성마다 new Date()를 박으면 구글이 lastmod를 무시한다.
// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [notices, options] = await Promise.all([listSitemapNotices(SITEMAP_MAX_URLS), listFilterOptions(undefined)]);
  const latest = notices[0] ? new Date(notices[0].updated_at) : new Date();
  return [
    { url: absoluteUrl(ROUTES.home), lastModified: latest, changeFrequency: "hourly", priority: 1 },
    ...options.sido.filter((o) => o.count >= AREA_MIN_COUNT).map((o) => ({
      url: absoluteUrl(areaPath(o.value)),
      lastModified: latest,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...notices.map((n) => ({
      url: absoluteUrl(noticePath(n.slug)),
      lastModified: new Date(n.updated_at),
      changeFrequency: (n.closed ? "monthly" : "daily") as "monthly" | "daily",
      priority: n.closed ? SITEMAP_PRIORITY_CLOSED : SITEMAP_PRIORITY_OPEN,
    })),
  ];
}
