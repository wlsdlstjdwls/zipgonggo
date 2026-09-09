import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { KpiStrip } from "@/components/kpi-strip";
import { NoticeExplorer } from "@/components/notice-explorer";
import { LIST_HERO_LEAD, LIST_HERO_TITLE, PAGE_SIZE } from "@/lib/constants";
import { feedParams, hasFilter, parseNoticeFilters } from "@/lib/notice-filters";
import { getHomeStats, listFilterOptions, listNoticesPage } from "@/lib/queries";
import { ROUTES } from "@/lib/routes";
import type { Sector } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const HOME_TITLE = "공공임대/민간임대 입주자모집공고 목록";
const HOME_DESCRIPTION = "LH, SH, 지방공사 공공임대와 공공지원민간임대 입주자모집공고를 한곳에. 마감 임박순과 최신 공고순, 시도별 공급유형별 보증금, 월임대료, 접수일정. 공고별 공급 단지는 지도로.";

// 필터 결과(?sector=&sido=&type=&sort=&closing=)는 noindex, canonical은 파라미터 없는 "/" — docs/url-structure.md
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const f = parseNoticeFilters((k) => sp[k]);
  return {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    alternates: { canonical: ROUTES.home },
    robots: hasFilter(f) ? { index: false, follow: true } : undefined,
  };
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const f = parseNoticeFilters((k) => sp[k]);
  const [page, options, stats] = await Promise.all([listNoticesPage(f, null, PAGE_SIZE), listFilterOptions(f.sector), getHomeStats()]);
  const params = feedParams(f);
  const countOf = (s: Sector) => options.sector.find((o) => o.value === s)?.count ?? 0;

  const body = page.items.length === 0 ? (
    <EmptyState
      lead={f.sector === "민간임대"
        ? "민간임대는 청년안심주택 등 수집을 준비 중입니다. 지역이나 유형을 넓혀 보세요."
        : "지역이나 유형을 넓히거나, 마감 임박 필터를 풀어 보세요."}
    />
  ) : (
    <NoticeExplorer key={params} initial={page} params={params} />
  );

  // 홈은 목록만 — 지도는 공고 상세의 공급 단지 탐색기에 있다(사용자 결정 2026-09-08)
  return (
    <div className="stage">
      <div className="list-hero">
        <p className="eyebrow">공공임대 {countOf("공공임대")} | 공공지원민간임대 {countOf("민간임대")}</p>
        <h1>{LIST_HERO_TITLE}</h1>
        <p>{LIST_HERO_LEAD}</p>
      </div>
      <KpiStrip stats={stats} />
      <FilterBar f={f} options={{ type: options.type }} closing7={stats.closing7} sticky />
      {body}
    </div>
  );
}
