import type { MetadataRoute } from "next";
import { SITEMAP_MAX_URLS, SITEMAP_PRIORITY_CLOSED, SITEMAP_PRIORITY_OPEN } from "@/lib/constants";
import { listSitemapNotices } from "@/lib/queries";
import { noticePath, ROUTES } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// 색인 대상 URL의 단일 원천. 지금은 홈 + 공고 상세뿐이라 파일 1개.
// 단지·지역 페이지가 생기면 타입별로 generateSitemaps로 쪼갠다(docs/url-structure.md: 파일당 40,000 URL).
// lastModified는 DB updated_at — 매 생성마다 new Date()를 박으면 구글이 lastmod를 무시한다.
// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const notices = await listSitemapNotices(SITEMAP_MAX_URLS);
  const latest = notices[0] ? new Date(notices[0].updated_at) : new Date();
  return [
    { url: absoluteUrl(ROUTES.home), lastModified: latest, changeFrequency: "hourly", priority: 1 },
    ...notices.map((n) => ({
      url: absoluteUrl(noticePath(n.slug)),
      lastModified: new Date(n.updated_at),
      changeFrequency: (n.closed ? "monthly" : "daily") as "monthly" | "daily",
      priority: n.closed ? SITEMAP_PRIORITY_CLOSED : SITEMAP_PRIORITY_OPEN,
    })),
  ];
}
