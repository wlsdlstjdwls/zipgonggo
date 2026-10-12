// 유형별 경쟁률 — /stats/{유형}. SH 결과 공고(notice_result)를 회차, 계층, 자치구, 단지로 묶는다(사용자 요청 2026-10-12).
//
// 결과 표를 COMPETITION_MIN_ROUNDS회차 이상 읽은 유형만 선다. 그 아래는 404 — 한두 회차를 「이 유형의 경쟁률」이라 부르면
// 일반화가 된다. 표본이 작다는 사실(몇 회차, 몇 줄에서 셌는지)은 지면에 그대로 적는다.
// 경쟁률은 줄 비율의 평균이 아니라 신청자 합계 ÷ 모집 호수 합계다. 산술이 안 맞은 줄(reconciled=false)은 빼고 몇 줄 뺐는지 밝힌다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Caption, Table } from "@/components/guide-blocks";
import { HubLede, HubStats, StatBars } from "@/components/hub-blocks";
import { JsonLd } from "@/components/json-ld";
import { LegalSection } from "@/components/legal-doc";
import { dateK, num } from "@/lib/format";
import { housingTypeDoc } from "@/lib/housing-types";
import { breadcrumb, ORG_ID, WEBSITE_ID } from "@/lib/jsonld";
import { getTypeCompetition, listCompetitionTypes, type CompetitionCell } from "@/lib/queries";
import { noticePath, ROUTES, statsTypePath, typePath } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const dynamicParams = true;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

type Params = { params: Promise<{ type: string }> };

export async function generateStaticParams() {
  return (await listCompetitionTypes()).map((t) => ({ type: t.housing_type }));
}

async function loadType(params: Params["params"]): Promise<string> {
  const { type } = await params;
  return decodeURIComponent(type);
}

/** 결과 표 줄의 5분의 1 넘게 산술이 안 맞은 회차 — 읽은 단지만 센 값이라 회차 전체로 읽히면 안 된다 */
const partial = (r: { rows_all: number; rows_bad: number }) => r.rows_all > 0 && r.rows_bad / r.rows_all > 0.2;

const ratioText = (r: number | null | undefined) => (r == null ? "—" : `${r} : 1`);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const type = await loadType(params);
  const c = await getTypeCompetition(type);
  if (!c) return { title: "찾을 수 없는 지면", robots: { index: false, follow: false } };
  return {
    title: `${c.agency} ${type} 경쟁률 — 지난 ${c.rounds.length}회차 계층별, 자치구별, 단지별`,
    description: `${c.agency} ${type} 결과 공고 ${c.rounds.length}회차에서 읽은 경쟁률. 단지 ${num(c.total.complexes, "곳")}, 모집 ${num(c.total.units, "호")}에 ${num(c.total.applicants, "명")} 신청, 평균 ${ratioText(c.total.ratio)}. 계층별과 자치구별, 가장 몰린 단지와 한산했던 단지.`,
    alternates: { canonical: statsTypePath(type) },
  };
}

function cellRow(c: CompetitionCell): string[] {
  return [num(c.units, "호"), num(c.applicants, "명"), ratioText(c.ratio)];
}

export default async function StatsTypePage({ params }: Params) {
  const type = await loadType(params);
  const c = await getTypeCompetition(type);
  if (!c) notFound();

  const title = `${c.agency} ${type} 경쟁률`;
  const url = absoluteUrl(statsTypePath(type));
  const crumbId = `${url}#breadcrumb`;
  const graph = [
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: title,
      inLanguage: "ko-KR",
      url,
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORG_ID },
      author: { "@id": ORG_ID },
      breadcrumb: { "@id": crumbId },
    },
    breadcrumb(crumbId, [
      { name: "공고 목록", path: ROUTES.home },
      { name: "숫자로 보기", path: ROUTES.stats },
      { name: title, path: statsTypePath(type) },
    ]),
  ];

  // 계층 × 우선/일반/소계를 한 줄로 편다
  const classes = [...new Set(c.byClass.map((r) => r.key))];
  const classRows = classes
    .map((k) => {
      const at = (b: string) => c.byClass.find((r) => r.key === k && r.bracket === b);
      return { k, sum: at("소계"), pri: at("우선"), gen: at("일반") };
    })
    .filter((r) => r.sum)
    .sort((a, b) => (b.sum!.units ?? 0) - (a.sum!.units ?? 0));
  const hasSplit = c.byClass.some((r) => r.bracket === "우선" || r.bracket === "일반");
  const first = c.rounds[c.rounds.length - 1];
  const last = c.rounds[0];

  return (
    <article className="stage legal">
      <JsonLd graph={graph} />
      <div className="crumb">
        <Link href={ROUTES.stats} className="back">← 숫자로 보기</Link>
      </div>
      <div className="legal-in">
        <h1>{title}</h1>
        <HubStats items={[
          { label: "평균 경쟁률", value: ratioText(c.total.ratio), hot: true },
          { label: "회차", value: num(c.rounds.length, "회") },
          { label: "모집 호수", value: num(c.total.units, "호") },
          { label: "신청", value: num(c.total.applicants, "명") },
        ]} />
        <div className="legal-body">
          <HubLede>
            {dateK(first.posted_at)} 공고부터 {dateK(last.posted_at)} 공고까지 {c.agency}가 낸 {type} 결과 공고 {num(c.rounds.length, "회차")}를 읽었다.
            단지 {num(c.total.complexes, "곳")}에 모집 {num(c.total.units, "호")}, 신청 {num(c.total.applicants, "명")}이다.
            지난 결과는 이번 결과를 보장하지 않는다. 어디가 덜 몰리는지 감을 잡는 데 쓴다.
          </HubLede>

          <LegalSection title="회차별">
            <Table
              head={["공고", "공고일", "단지", "모집", "신청", "경쟁률"]}
              num={[2, 3, 4, 5]}
              rows={c.rounds.map((r) => [
                <Link key="n" href={noticePath(r.slug)}>{r.title}</Link>,
                dateK(r.posted_at), partial(r) ? `${num(r.complexes, "곳")} (일부)` : num(r.complexes, "곳"),
                num(r.units, "호"), num(r.applicants, "명"), ratioText(r.ratio),
              ])}
            />
            {c.rounds.some(partial) && (
              <Caption>「일부」는 결과 표 글자가 깨져 산술이 안 맞는 줄이 많아 읽은 단지만 센 회차다. 그 회차의 실제 모집 호수는 더 많다.</Caption>
            )}
          </LegalSection>

          {classRows.length > 0 && (
            <LegalSection title={hasSplit ? "계층별" : "구분별"}>
              {/* 행복주택은 계층마다 우선/일반 띠가 있고, 장기전세 같은 양식은 구분(예비자, 일반, 우선, 주거약자)이 곧 한 줄이다 */}
              {hasSplit
                ? <p>같은 단지라도 청년, 신혼부부, 고령자 몫이 따로 뽑힌다. 우선공급은 해당 구에 살거나 일하는 사람이 먼저 다투는 몫이다.</p>
                : <p>공고가 나누어 뽑는 구분별로 더했다. 예비자는 입주자가 나갈 때를 기다리는 예비입주자 몫이다.</p>}
              <Table
                head={hasSplit ? ["계층", "모집", "신청", "경쟁률", "우선공급", "일반공급"] : ["구분", "모집", "신청", "경쟁률"]}
                num={hasSplit ? [1, 2, 3, 4, 5] : [1, 2, 3]}
                rows={classRows.map((r) => [
                  r.k, ...cellRow(r.sum!), ...(hasSplit ? [ratioText(r.pri?.ratio), ratioText(r.gen?.ratio)] : []),
                ])}
              />
              <Caption>모집 10호 미만인 {hasSplit ? "계층" : "구분"}은 뺐다.</Caption>
            </LegalSection>
          )}

          {c.byGu.length > 0 && (
            <LegalSection title="자치구별">
              <StatBars items={c.byGu.map((g) => ({
                label: g.key, value: g.ratio, text: ratioText(g.ratio), sub: num(g.units, "호"),
              }))} />
              <Caption>경쟁률 높은 순. 모집 10호 미만인 구는 뺐다. 결과 표에 구가 없는 줄은 같은 공고의 단지 목록에서 이름으로 찾아 붙였다.</Caption>
            </LegalSection>
          )}

          {c.hottest.length > 0 && (
            <LegalSection title="가장 몰린 단지">
              <ComplexTable rows={c.hottest} />
            </LegalSection>
          )}

          {c.calmest.length > 0 && (
            <LegalSection title="가장 한산했던 단지">
              <ComplexTable rows={c.calmest} />
              <Caption>회차마다 따로 셌다. 모집 3호 미만인 단지는 한두 명으로 경쟁률이 크게 흔들려 뺐다.</Caption>
            </LegalSection>
          )}

          <p className="legal-eff">
            출처: {c.agency} 접수 결과 공고(i-sh.co.kr) 첨부. 모집 호수와 신청자 수가 산술로 맞는 줄만 셌다
            {c.skipped > 0 && <> — 읽은 {num(c.all, "줄")} 가운데 글자가 깨져 맞지 않는 {num(c.skipped, "줄")}은 뺐다</>}.
            {housingTypeDoc(type) && <> 제도 설명과 지금 나와 있는 공고는 <Link href={typePath(type)}>{type} 안내</Link>에서.</>}
          </p>
        </div>
      </div>
    </article>
  );
}

function ComplexTable({ rows }: { rows: { name: string; sigungu: string; slug: string; posted_at: string; units: number; applicants: number; ratio: number }[] }) {
  return (
    <Table
      head={["단지", "구", "공고", "모집", "신청", "경쟁률"]}
      num={[3, 4, 5]}
      rows={rows.map((r) => [
        r.name, r.sigungu || "—", <Link key="n" href={noticePath(r.slug)}>{dateK(r.posted_at)}</Link>,
        num(r.units, "호"), num(r.applicants, "명"), ratioText(r.ratio),
      ])}
    />
  );
}
