import type { Metadata } from "next";
import { FilterRail } from "@/components/filter-rail";
import { JsonLd } from "@/components/json-ld";
import { NoticeExplorer } from "@/components/notice-explorer";
import { AREA_MIN_COUNT, PAGE_SIZE } from "@/lib/constants";
import { areaGraph } from "@/lib/jsonld";
import { listFilterOptions, listNoticesPage } from "@/lib/queries";
import { areaPath, ROUTES } from "@/lib/routes";
import { sidoShort } from "@/lib/sido";

// 스코프 착지 페이지 — 시도 경로 한 장. 유형·마감·정렬·부문은 URL이 아니라 클라이언트 상태다(2026-09-09).
// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const dynamicParams = true;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

// 세그먼트 이름은 region — 이 자리엔 시도가 오지만, 한 단 아래 [type]에서는 같은 자리에 시군구가 온다
// (/area/{시도}와 /area/{시군구}/{유형}, docs/url-structure.md). Next는 같은 깊이의 이름이 하나여야 한다
type Params = { params: Promise<{ region: string }> };

/** 3건 이상인 시도만 빌드 시 생성 — 얇은 페이지 방지 규칙(CLAUDE.md 4). */
export async function generateStaticParams() {
  const options = await listFilterOptions(undefined);
  return options.sido.filter((o) => o.count >= AREA_MIN_COUNT).map((o) => ({ region: o.value }));
}

async function loadSido(params: Params["params"]): Promise<string> {
  const { region } = await params;
  return decodeURIComponent(region);
}

/** meta description과 JSON-LD가 같은 문장을 쓴다 */
function areaDescription(sido: string): string {
  return `${sido} 지역 LH, SH, 지방공사 공공임대와 공공지원민간임대 입주자모집공고. 마감 임박순과 최신 공고순, 보증금과 월임대료, 접수일정.`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const sido = await loadSido(params);
  // 필터는 더 이상 URL에 없다(2026-09-09) — 시도 한 장뿐이라 noindex 분기가 필요 없다
  return {
    title: `${sido} 공공임대/민간임대 입주자모집공고`,
    description: areaDescription(sido),
    alternates: { canonical: areaPath(sido) },
  };
}

export default async function AreaPage({ params }: Params) {
  const sido = await loadSido(params);

  // 발행 대상인지(그리고 얇지 않은지)는 (sido)/layout.tsx가 이미 걸렀다 — 여기서 다시 보지 않는다.
  // 그 판정을 layout으로 올린 이유는 404 응답 코드다(layout.tsx 머리글).
  const page = await listNoticesPage({ sido }, null, PAGE_SIZE);

  return (
    <div className="stage list-stage">
      {/* docs/url-structure.md: 지역 착지는 CollectionPage */}
      <JsonLd
        graph={areaGraph(sido, page.total, areaPath(sido), [
          { name: "공고 목록", path: ROUTES.home },
          { name: sidoShort(sido), path: areaPath(sido) },
        ], areaDescription(sido))}
      />
      <FilterRail />
      <div className="list-col">
        <NoticeExplorer initial={page} title={`${sido} 입주자모집공고`} />
      </div>
    </div>
  );
}
