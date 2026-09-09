import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { FilterRail } from "@/components/filter-rail";
import { NoticeExplorer } from "@/components/notice-explorer";
import { AREA_MIN_COUNT, PAGE_SIZE } from "@/lib/constants";
import { listFilterOptions, listNoticesPage } from "@/lib/queries";
import { areaPath, ROUTES } from "@/lib/routes";

// 스코프 착지 페이지 — 시도 경로 한 장. 유형·마감·정렬·부문은 URL이 아니라 클라이언트 상태다(2026-09-09).
// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const dynamicParams = true;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

type Params = { params: Promise<{ sido: string }> };

/** 3건 이상인 시도만 빌드 시 생성 — 얇은 페이지 방지 규칙(CLAUDE.md 4). */
export async function generateStaticParams() {
  const options = await listFilterOptions(undefined);
  return options.sido.filter((o) => o.count >= AREA_MIN_COUNT).map((o) => ({ sido: o.value }));
}

async function loadSido(params: Params["params"]): Promise<string> {
  const { sido } = await params;
  return decodeURIComponent(sido);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const sido = await loadSido(params);
  // 필터는 더 이상 URL에 없다(2026-09-09) — 시도 한 장뿐이라 noindex 분기가 필요 없다
  return {
    title: `${sido} 공공임대/민간임대 입주자모집공고`,
    description: `${sido} 지역 LH, SH, 지방공사 공공임대와 공공지원민간임대 입주자모집공고. 마감 임박순과 최신 공고순, 보증금과 월임대료, 접수일정.`,
    alternates: { canonical: areaPath(sido) },
  };
}

export default async function AreaPage({ params }: Params) {
  const sido = await loadSido(params);

  // options는 이 시도가 발행 대상인지 확인하는 용도다(칩·셀렉트 수량은 레이아웃 → ListStateProvider가 담당).
  // 먼저 기다렸다가 목록을 쏘면 왕복이 직렬로 쌓인다 — 둘 다 한 번에 쏜다.
  const [options, page] = await Promise.all([
    listFilterOptions(undefined),
    listNoticesPage({ sido }, null, PAGE_SIZE),
  ]);
  const match = options.sido.find((o) => o.value === sido);
  if (!match) notFound();
  if (match.count < AREA_MIN_COUNT) permanentRedirect(ROUTES.home);

  return (
    <div className="stage list-stage">
      <FilterRail />
      <div className="list-col">
        <NoticeExplorer initial={page} title={`${sido} 입주자모집공고`} />
      </div>
    </div>
  );
}
