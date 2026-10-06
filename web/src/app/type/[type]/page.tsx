// 유형 허브 — /type/{유형}. docs/url-structure.md의 마지막 축.
//
// 이 페이지의 고유 콘텐츠는 **직접 쓴 제도 설명**(lib/housing-types)이다. 목록만 있는 페이지였다면
// 홈에 유형 필터를 건 것과 다를 바 없어 얇은 페이지가 된다 — 설명이 있어야 이 URL이 제 값을 한다.
// 그래서 설명을 안 써 둔 유형은 DB에 공고가 있어도 404다.
//
// 자격 요약은 시드(supply_type)에서 가져온다. 해마다 바뀌는 한도를 글에 박지 않기 위해서다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HubAreaBars, HubChips, HubFaq, HubIncome, HubLede, HubParas, HubStats, RuleTileGroup } from "@/components/hub-blocks";
import { JsonLd } from "@/components/json-ld";
import { LegalSection } from "@/components/legal-doc";
import { NoticeRow } from "@/components/notice-row";
import { SITE_NAME } from "@/lib/constants";
import { num } from "@/lib/format";
import { HOUSING_TYPE_DOCS, housingTypeDoc } from "@/lib/housing-types";
import { breadcrumb, ORG_ID, WEBSITE_ID } from "@/lib/jsonld";
import { AREA_TYPE_MIN_COUNT, getEligibilityRules, listAreaTypePairs, listLandingNotices, listTypeHubs } from "@/lib/queries";
import { areaTypePath, ROUTES, typePath } from "@/lib/routes";
import { sidoShort } from "@/lib/sido";
import { absoluteUrl } from "@/lib/site-url";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const dynamicParams = true;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

/** 허브가 싣는 공고 수. 전량을 싣지 않는다 — 목록 전체는 홈이 맡고 여기는 착지 페이지다 */
const HUB_NOTICE_LIMIT = 12;

type Params = { params: Promise<{ type: string }> };

export function generateStaticParams() {
  return Object.keys(HOUSING_TYPE_DOCS).map((type) => ({ type }));
}

async function loadType(params: Params["params"]): Promise<string> {
  const { type } = await params;
  return decodeURIComponent(type);
}

function hubDescription(type: string, lede: string, open: number): string {
  return `${type} ${lede} 전국 진행 중인 입주자모집공고 ${num(open, "건")}. 신청자격과 소득기준, 보증금과 월임대료를 공고별로.`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const type = await loadType(params);
  const doc = housingTypeDoc(type);
  if (!doc) return { title: "찾을 수 없는 유형", robots: { index: false, follow: false } };
  const hubs = await listTypeHubs();
  const open = hubs.find((h) => h.housing_type === type)?.open ?? 0;
  return {
    title: `${type}란 — 신청자격과 전국 모집공고`,
    description: hubDescription(type, doc.lede, open),
    alternates: { canonical: typePath(type) },
  };
}

export default async function TypeHubPage({ params }: Params) {
  const type = await loadType(params);
  const doc = housingTypeDoc(type);
  if (!doc) notFound();

  const [hubs, notices, pairs, rules] = await Promise.all([
    listTypeHubs(),
    listLandingNotices({ type }, HUB_NOTICE_LIMIT),
    listAreaTypePairs(),
    getEligibilityRules(),
  ]);
  const hub = hubs.find((h) => h.housing_type === type);
  const seeds = rules.types.filter((t) => t.housing_type === type);
  const areas = pairs.filter((p) => p.housing_type === type && p.count >= AREA_TYPE_MIN_COUNT);
  const others = hubs.filter((h) => h.housing_type !== type && housingTypeDoc(h.housing_type));

  const url = absoluteUrl(typePath(type));
  const crumbId = `${url}#breadcrumb`;
  const graph = [
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: `${type}란 — 신청자격과 전국 모집공고`,
      description: hubDescription(type, doc.lede, hub?.open ?? 0),
      articleBody: doc.body.join("\n\n"),
      inLanguage: "ko-KR",
      url,
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORG_ID },
      author: { "@id": ORG_ID },
      breadcrumb: { "@id": crumbId },
    },
    {
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: doc.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
    breadcrumb(crumbId, [
      { name: "공고 목록", path: ROUTES.home },
      { name: type, path: typePath(type) },
    ]),
  ];

  return (
    <article className="stage legal">
      <JsonLd graph={graph} />
      <div className="crumb">
        <Link href={ROUTES.home} className="back">← 목록</Link>
      </div>
      <div className="legal-in">
        <h1>{type}</h1>
        {/* 숫자는 글 한 줄이 아니라 타일로(사용자 지적 2026-10-06: 「글만 있으니 읽기 어렵네」) */}
        {hub ? (
          <HubStats items={[
            { label: "진행 중", value: num(hub.open, "건"), hot: hub.open > 0 },
            { label: "모은 공고", value: num(hub.total, "건") },
            { label: "시도", value: num(hub.sidos, "곳") },
          ]} />
        ) : (
          <p className="legal-eff">공고 준비 중 | {SITE_NAME}</p>
        )}
        <div className="legal-body">
          <HubLede>{doc.lede}</HubLede>

          <LegalSection title={`${type}는 어떤 제도인가`}>
            <HubParas paras={doc.body} />
          </LegalSection>

          {seeds.length > 0 && (
            <LegalSection title="신청 자격">
              <p>
                아래는 제도 일반 기준이다. <strong>같은 유형이라도 공고마다 우선공급 몫과 배점이 다르므로</strong> 마지막 판단은
                각 공고의 신청자격 절이 한다. 금액 기준은 {rules.incomeYear}년 자료다.
              </p>
              <RuleTileGroup types={seeds} income={rules.income} />
              <HubIncome types={seeds} income={rules.income} year={rules.incomeYear} />
            </LegalSection>
          )}

          <LegalSection title="지금 나와 있는 공고">
            {notices.length > 0 ? (
              <ul className="rows v-card">
                {notices.map((n) => <NoticeRow key={n.id} n={n} />)}
              </ul>
            ) : (
              <p>지금은 수집된 {type} 공고가 없다. 새 공고가 올라오면 이 자리에 실린다.</p>
            )}
            <p><Link href={ROUTES.home}>전체 공고 목록에서 {type}만 보기 →</Link></p>
          </LegalSection>

          {areas.length > 0 && (
            <LegalSection title="지역으로 좁혀 보기">
              <p>공고가 {AREA_TYPE_MIN_COUNT}건 이상 쌓인 지역만 따로 발행한다.</p>
              <HubAreaBars items={areas.map((p) => ({ href: areaTypePath(p, type), label: `${sidoShort(p.sido)} ${p.sigungu}`, count: p.count }))} />
            </LegalSection>
          )}

          <LegalSection title="자주 묻는 것">
            <HubFaq items={doc.faq} />
          </LegalSection>

          {others.length > 0 && (
            <LegalSection title="다른 유형">
              <HubChips items={others.map((h) => ({ href: typePath(h.housing_type), label: h.housing_type, count: h.total }))} />
            </LegalSection>
          )}

          <p className="legal-eff">
            제도 설명은 공고문과 관계 법령을 읽기 쉽게 줄인 것이지 법령 해석이 아니다. 신청 전에 반드시 해당 공고문 원문을 확인한다.
          </p>
        </div>
      </div>
    </article>
  );
}
