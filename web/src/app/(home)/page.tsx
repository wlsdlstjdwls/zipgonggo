import type { Metadata } from "next";
import { FilterBar } from "@/components/filter-bar";
import { KpiStrip } from "@/components/kpi-strip";
import { NoticeExplorer } from "@/components/notice-explorer";
import { LIST_HERO_LEAD, LIST_HERO_TITLE, PAGE_SIZE } from "@/lib/constants";
import { getHomeStats, listFilterOptions, listNoticesPage } from "@/lib/queries";
import { ROUTES } from "@/lib/routes";
import type { Sector } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

const HOME_TITLE = "공공임대/민간임대 입주자모집공고 목록";
const HOME_DESCRIPTION = "LH, SH, 지방공사 공공임대와 공공지원민간임대 입주자모집공고를 한곳에. 마감 임박순과 최신 공고순, 시도별 공급유형별 보증금, 월임대료, 접수일정. 공고별 공급 단지는 지도로.";

// 필터는 더 이상 URL에 없다(2026-09-09) — 홈은 파라미터 없는 한 장뿐이라 noindex 분기도 필요 없다.
export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: { canonical: ROUTES.home },
};

export default async function HomePage() {
  // 서버는 필터 없는 첫 페이지만 만든다 — 필터가 걸리면 NoticeExplorer가 /api/notices로 갈아끼운다
  const [page, options, stats] = await Promise.all([listNoticesPage({}, null, PAGE_SIZE), listFilterOptions(undefined), getHomeStats()]);
  const countOf = (s: Sector) => options.sector.find((o) => o.value === s)?.count ?? 0;

  // 홈은 목록만 — 지도는 공고 상세의 공급 단지 탐색기에 있다(사용자 결정 2026-09-08)
  return (
    <div className="stage">
      <div className="list-hero">
        <p className="eyebrow">공공임대 {countOf("공공임대")} | 공공지원민간임대 {countOf("민간임대")}</p>
        <h1>{LIST_HERO_TITLE}</h1>
        <p>{LIST_HERO_LEAD}</p>
      </div>
      <KpiStrip stats={stats} />
      <FilterBar options={{ type: options.type }} closing7={stats.closing7} sticky />
      <NoticeExplorer initial={page} />
    </div>
  );
}
