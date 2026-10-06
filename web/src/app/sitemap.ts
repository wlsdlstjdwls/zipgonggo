import type { MetadataRoute } from "next";
import { AREA_MIN_COUNT, SITEMAP_MAX_URLS, SITEMAP_PRIORITY_CLOSED, SITEMAP_PRIORITY_OPEN } from "@/lib/constants";
import { AREA_TYPE_MIN_COUNT, listAreaTypePairs, listFilterOptions, listProgramHubs, listSitemapComplexes, listSitemapNotices, listTypeHubs } from "@/lib/queries";
import { areaPath, areaTypePath, noticeComplexPath, noticePath, programPath, ROUTES, typePath } from "@/lib/routes";
import { PROGRAM_MIN_COUNT, programDoc } from "@/lib/programs";
import { housingTypeDoc } from "@/lib/housing-types";
import { absoluteUrl } from "@/lib/site-url";

// 색인 대상 URL의 단일 원천. 홈 + 정책 문서 + 지역(/area) + 공고 상세 + 기준을 채운 단지.
// 합이 40,000에 가까워지면 타입별로 generateSitemaps로 쪼갠다(docs/url-structure.md: 파일당 40,000 URL).
// 단지는 「고유 필드 8개 이상 + 건물 좌표」를 채운 장만 싣는다 — 못 채운 장은 페이지도 noindex다.
// lastModified는 DB updated_at — 매 생성마다 new Date()를 박으면 구글이 lastmod를 무시한다.
// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [notices, options, complexes, hubs, pairs, programs] = await Promise.all([
    listSitemapNotices(SITEMAP_MAX_URLS),
    listFilterOptions(undefined),
    listSitemapComplexes(SITEMAP_MAX_URLS),
    listTypeHubs(),
    listAreaTypePairs(),
    listProgramHubs(),
  ]);
  const latest = notices[0] ? new Date(notices[0].updated_at) : new Date();
  return [
    { url: absoluteUrl(ROUTES.home), lastModified: latest, changeFrequency: "hourly", priority: 1 },
    // 자격진단 — 2026-10-06에 열었다. 규칙(시드)이 바뀌어야 내용이 바뀌는 지면이라 주 단위로 둔다
    { url: absoluteUrl(ROUTES.eligibility), lastModified: latest, changeFrequency: "weekly", priority: 0.7 },
    // 정책 문서 — 내용이 거의 안 바뀌지만 색인은 시켜 둔다(신뢰 신호)
    { url: absoluteUrl(ROUTES.terms), lastModified: latest, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl(ROUTES.privacy), lastModified: latest, changeFrequency: "yearly", priority: 0.2 },
    // 유형 허브 — 직접 쓴 제도 설명이 있는 유형만. 페이지 자체가 그 기준으로 404를 낸다
    ...hubs.filter((h) => housingTypeDoc(h.housing_type)).map((h) => ({
      url: absoluteUrl(typePath(h.housing_type)),
      lastModified: latest,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    // 사업 목록과 사업 허브 — 글이 있고 공고 3건 이상인 사업만. 미달은 페이지도 noindex다
    { url: absoluteUrl(ROUTES.program), lastModified: latest, changeFrequency: "weekly" as const, priority: 0.6 },
    ...programs.filter((p) => programDoc(p.program) && p.total >= PROGRAM_MIN_COUNT).map((p) => ({
      url: absoluteUrl(programPath(p.program)),
      lastModified: latest,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    // 지역×유형 — 5건 이상만(얇은 페이지 방지). 미달 쌍은 페이지도 noindex다
    ...pairs.filter((p) => p.count >= AREA_TYPE_MIN_COUNT).map((p) => ({
      url: absoluteUrl(areaTypePath(p, p.housing_type)),
      lastModified: latest,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
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
