import type { MetadataRoute } from "next";
import { AREA_MIN_COUNT, SITEMAP_MAX_URLS, SITEMAP_PRIORITY_CLOSED, SITEMAP_PRIORITY_OPEN } from "@/lib/constants";
import { listFilterOptions, listSitemapComplexes, listSitemapNotices } from "@/lib/queries";
import { areaPath, noticeComplexPath, noticePath, ROUTES } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// 색인 대상 URL의 단일 원천. 홈 + 정책 문서 + 지역(/area) + 공고 상세 + 기준을 채운 단지.
// 합이 40,000에 가까워지면 타입별로 generateSitemaps로 쪼갠다(docs/url-structure.md: 파일당 40,000 URL).
// 단지는 「고유 필드 8개 이상 + 건물 좌표」를 채운 장만 싣는다 — 못 채운 장은 페이지도 noindex다.
// lastModified는 DB updated_at — 매 생성마다 new Date()를 박으면 구글이 lastmod를 무시한다.
// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [notices, options, complexes] = await Promise.all([
    listSitemapNotices(SITEMAP_MAX_URLS),
    listFilterOptions(undefined),
    listSitemapComplexes(SITEMAP_MAX_URLS),
  ]);
  const latest = notices[0] ? new Date(notices[0].updated_at) : new Date();
  return [
    { url: absoluteUrl(ROUTES.home), lastModified: latest, changeFrequency: "hourly", priority: 1 },
    // 자격진단 — 공고와 무관하게 늘 쓰이는 도구 페이지라 홈 다음으로 높게 둔다
    { url: absoluteUrl(ROUTES.eligibility), lastModified: latest, changeFrequency: "monthly", priority: 0.8 },
    // 정책 문서 — 내용이 거의 안 바뀌지만 색인은 시켜 둔다(신뢰 신호)
    { url: absoluteUrl(ROUTES.terms), lastModified: latest, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl(ROUTES.privacy), lastModified: latest, changeFrequency: "yearly", priority: 0.2 },
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
    // 단지는 제 공고보다 한 단 낮게 — 공고 지도가 먼저 읽히는 게 맞다
    ...complexes.map((c) => ({
      url: absoluteUrl(noticeComplexPath(c.slug, c)),
      lastModified: new Date(c.updated_at),
      changeFrequency: (c.closed ? "monthly" : "weekly") as "monthly" | "weekly",
      priority: c.closed ? SITEMAP_PRIORITY_CLOSED : SITEMAP_PRIORITY_OPEN - 0.2,
    })),
  ];
}
