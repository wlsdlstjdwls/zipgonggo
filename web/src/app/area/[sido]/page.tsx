import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { NoticeExplorer } from "@/components/notice-explorer";
import { AREA_MIN_COUNT, PAGE_SIZE } from "@/lib/constants";
import { feedParams, parseNoticeFilters } from "@/lib/notice-filters";
import { getHomeStats, listFilterOptions, listNoticesPage } from "@/lib/queries";
import { areaPath, ROUTES } from "@/lib/routes";
import type { NoticeFilters, Sector } from "@/types/notice";

// 스코프 착지 페이지 — 시도 경로 + 유형/마감/정렬 쿼리. docs/url-structure.md 6차 설계.
// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const dynamicParams = true;

type Params = { params: Promise<{ sido: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 3건 이상인 시도만 빌드 시 생성 — 얇은 페이지 방지 규칙(CLAUDE.md 4). */
export async function generateStaticParams() {
  const options = await listFilterOptions(undefined);
  return options.sido.filter((o) => o.count >= AREA_MIN_COUNT).map((o) => ({ sido: o.value }));
}

async function loadSido(params: Params["params"]): Promise<string> {
  const { sido } = await params;
  return decodeURIComponent(sido);
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const sido = await loadSido(params);
  const sp = await searchParams;
  const f = { ...parseNoticeFilters((k) => sp[k]), sido };
  const hasExtraFilter = Boolean(f.sector || f.type || f.closing || (f.sort && f.sort !== "posted"));
  return {
    title: `${sido} 공공임대/민간임대 입주자모집공고`,
    description: `${sido} 지역 LH, SH, 지방공사 공공임대와 공공지원민간임대 입주자모집공고. 마감 임박순과 최신 공고순, 보증금과 월임대료, 접수일정.`,
    alternates: { canonical: areaPath(sido) },
    robots: hasExtraFilter ? { index: false, follow: true } : undefined,
  };
}

export default async function AreaPage({ params, searchParams }: Params) {
  const sido = await loadSido(params);
  const sp = await searchParams;
  const parsed = parseNoticeFilters((k) => sp[k]);
  const f: NoticeFilters = { ...parsed, sido };

  const sidoOptions = await listFilterOptions(undefined);
  const match = sidoOptions.sido.find((o) => o.value === sido);
  if (!match) notFound();
  if (match.count < AREA_MIN_COUNT) permanentRedirect(ROUTES.home);

  // closing7은 홈과 같은 site-wide 집계를 재사용한다(sido로 좁힌 전용 쿼리를 따로 쏘지 않는다) —
  // Neon(ap-southeast-1)은 새 커넥션 하나 트는 데 ~550ms라, 병렬 쿼리를 늘릴수록 새 커넥션이 열릴 확률이 커진다.
  // getHomeStats는 캐시 키가 인자 없이 고정이라 사이트 어디서든 이미 데워져 있을 가능성이 높다.
  const [page, options, stats] = await Promise.all([
    listNoticesPage(f, null, PAGE_SIZE),
    listFilterOptions(f.sector),
    getHomeStats(),
  ]);
  const params_ = feedParams(f);
  const countOf = (s: Sector) => sidoOptions.sector.find((o) => o.value === s)?.count ?? 0;

  const body = page.items.length === 0 ? (
    <EmptyState
      lead={f.sector === "민간임대"
        ? "민간임대는 청년안심주택 등 수집을 준비 중입니다. 유형을 넓혀 보세요."
        : "유형을 넓히거나, 마감 임박 필터를 풀어 보세요."}
      resetHref={areaPath(sido)}
    />
  ) : (
    <NoticeExplorer key={params_} initial={page} params={params_} />
  );

  return (
    <div className="stage">
      <div className="list-hero">
        <p className="eyebrow">전국 공공임대 {countOf("공공임대")} | 공공지원민간임대 {countOf("민간임대")} 중 {sido}</p>
        <h1>{sido} 입주자모집공고 {match.count}건</h1>
        <p>LH, SH, 지방공사 공고를 모읍니다. 보증금과 월임대료는 공고에 적힌 최소값입니다.</p>
      </div>
      <FilterBar f={f} options={{ type: options.type }} closing7={stats.closing7} basePath={{ sido }} sticky />
      {body}
    </div>
  );
}
