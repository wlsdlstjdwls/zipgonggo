// 숫자로 보기 — /stats. 기관, 유형, 지역별 공급 호수와 경쟁률 지면으로 가는 입구(사용자 요청 2026-10-12).
//
// 「데이터랩」이라는 이름은 쓰지 않는다(사용자 요청). 숫자는 전부 렌더 때 DB에서 읽고 블록마다 무엇을 셌는지 적는다 —
// 안내 글(/guide)과 같은 규칙이다.
//
// **창은 최근 STATS_WINDOW_DAYS일이다.** 기관마다 모은 기간이 달라 연도별로 합치면 수집 시점이 만든 가짜 추이가 그려진다
// (lib/queries.ts getSupplyStats 머리글).
import type { Metadata } from "next";
import Link from "next/link";
import { Caption } from "@/components/guide-blocks";
import { HubChips, HubLede, HubStats, StatBars } from "@/components/hub-blocks";
import { JsonLd } from "@/components/json-ld";
import { LegalSection } from "@/components/legal-doc";
import { AREA_MIN_COUNT } from "@/lib/constants";
import { dateK, num } from "@/lib/format";
import { housingTypeDoc } from "@/lib/housing-types";
import { breadcrumb, ORG_ID, WEBSITE_ID } from "@/lib/jsonld";
import { COMPETITION_MIN_ROUNDS, getSupplyStats, listCompetitionTypes, listFilterOptions, STATS_WINDOW_DAYS, type SupplyGroup } from "@/lib/queries";
import { areaPath, ROUTES, statsTypePath, typePath } from "@/lib/routes";
import { sidoShort } from "@/lib/sido";
import { absoluteUrl } from "@/lib/site-url";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

const TITLE = "공공임대 공급과 경쟁률 — 기관별, 유형별, 지역별 공급 호수";
const DESCRIPTION =
  `최근 ${STATS_WINDOW_DAYS}일 동안 나온 공공임대와 민간임대 모집공고의 공급 호수를 LH, SH, 서울시와 지방 공사별로, 유형별로, 시도별로 견준다. SH 결과 공고에서 읽은 지난 회차 경쟁률도 함께.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.stats },
};

function units(g: SupplyGroup): string {
  return g.units > 0 ? num(g.units, "호") : "호수 미상";
}

export default async function StatsPage() {
  const [s, compTypes, options] = await Promise.all([getSupplyStats(), listCompetitionTypes(), listFilterOptions(undefined)]);
  // /area/{시도}는 공고가 기준 이상인 시도만 선다 — 미달 시도는 /로 301이라 거기로 링크하지 않는다
  const sidoOk = new Set(options.sido.filter((o) => o.count >= AREA_MIN_COUNT).map((o) => o.value));

  const url = absoluteUrl(ROUTES.stats);
  const crumbId = `${url}#breadcrumb`;
  const graph = [
    {
      "@type": "CollectionPage",
      "@id": `${url}#page`,
      name: TITLE,
      description: DESCRIPTION,
      inLanguage: "ko-KR",
      url,
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORG_ID },
      breadcrumb: { "@id": crumbId },
    },
    breadcrumb(crumbId, [
      { name: "공고 목록", path: ROUTES.home },
      { name: "공급과 경쟁률", path: ROUTES.stats },
    ]),
  ];

  return (
    <article className="stage legal">
      <JsonLd graph={graph} />
      <div className="crumb">
        <Link href={ROUTES.home} className="back">← 목록</Link>
      </div>
      <div className="legal-in">
        <h1>공공임대 공급과 경쟁률</h1>
        <HubStats items={[
          { label: `최근 ${STATS_WINDOW_DAYS}일 공고`, value: num(s.notices, "건") },
          { label: "공급 호수", value: num(s.units, "호"), hot: true },
          { label: "기관", value: num(s.byAgency.length, "곳") },
        ]} />
        <div className="legal-body">
          <HubLede>
            {dateK(s.since)}부터 오늘까지 나온 모집공고가 몇 호를 내놨는지 기관, 유형, 지역으로 나눠 본다.
            공고 하나만 보면 많은지 적은지 알 수 없다. 옆에 놓아 봐야 보인다.
          </HubLede>

          {compTypes.length > 0 && (
            <LegalSection title="지난 회차 경쟁률">
              <p>
                결과 공고(모집 호수와 신청자 수)를 {num(COMPETITION_MIN_ROUNDS, "회차")} 이상 읽은 유형만 따로 연다.
                계층별, 자치구별, 단지별로 얼마나 몰렸는지 볼 수 있다.
              </p>
              <HubChips items={compTypes.map((c) => ({ href: statsTypePath(c.housing_type), label: `${c.agency} ${c.housing_type} 경쟁률`, count: null }))} />
            </LegalSection>
          )}

          <LegalSection title="기관별 공급 호수">
            <StatBars items={s.byAgency.map((g) => ({
              label: g.key, sub: g.sector === "민간임대" ? "민간임대" : undefined, value: g.units, text: units(g),
            }))} />
            <Caption>
              공고에 적힌 공급 호수를 더했다. 「서울시」는 서울주거포털의 청년안심주택과 민간임대 공고다. 지방 공사는 마이홈포털에 올라온 공고만 모은다.
            </Caption>
          </LegalSection>

          <LegalSection title="유형별 공급 호수">
            <StatBars items={s.byType.map((g) => ({
              label: g.key, value: g.units, text: units(g), href: housingTypeDoc(g.key) ? typePath(g.key) : null,
            }))} />
          </LegalSection>

          <LegalSection title="시도별 공급 호수">
            <StatBars items={s.bySido.map((g) => ({
              label: sidoShort(g.key), value: g.units, text: units(g), href: sidoOk.has(g.key) ? areaPath(g.key) : null,
            }))} />
            <Caption>
              매입임대와 전세임대처럼 여러 지역에 걸친 공고는 공고의 대표 시도 하나로 셌다.
            </Caption>
          </LegalSection>

          <p className="legal-eff">
            {s.unknown > 0 && <>공고 {num(s.notices, "건")} 가운데 {num(s.unknown, "건")}은 공고문에 호수가 없거나 아직 못 읽어 호수 합계에서 빠졌다. </>}
            최근 {STATS_WINDOW_DAYS}일로 자른 것은 기관마다 모으기 시작한 때가 달라서다 — 마이홈포털은 지금 게시 중인 공고만 주므로
            LH 공고는 대부분 2026년 8월 이후 것이다. 기간을 더 늘리면 수집 시점 차이가 공급 추이처럼 보인다.
          </p>
        </div>
      </div>
    </article>
  );
}
