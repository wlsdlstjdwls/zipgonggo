// 사업 허브 — /program/{사업}. docs/url-structure.md 「사업 허브」.
//
// 유형 허브(/type)의 한 칸 아래다. 「매입임대」 하나에 든든전세, 청년, 신혼신생아가 다 들어 있어
// 사람들이 실제로 찾는 사업 이름으로 한 번 더 모은다. 어느 공고가 어느 사업인지는 pipeline이 notice.programs에 매겨 두고
// 여기는 읽기만 한다. 고유 콘텐츠는 직접 쓴 설명(lib/programs)이고, 글이 없는 사업은 404다.
//
// 공고가 PROGRAM_MIN_COUNT(3)건 미만이면 noindex — 얇은 페이지 방지(CLAUDE.md 4). URL은 살려 둔다(CLAUDE.md 5).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HubChips, HubFaq, HubIncome, HubLede, HubParas, HubStats, RuleTileGroup } from "@/components/hub-blocks";
import { JsonLd } from "@/components/json-ld";
import { LegalSection } from "@/components/legal-doc";
import { NoticeRow } from "@/components/notice-row";
import { SITE_NAME } from "@/lib/constants";
import { num } from "@/lib/format";
import { housingTypeDoc } from "@/lib/housing-types";
import { breadcrumb, ORG_ID, WEBSITE_ID } from "@/lib/jsonld";
import { PROGRAM_DOCS, PROGRAM_MIN_COUNT, programDoc } from "@/lib/programs";
import { getEligibilityRules, listLandingNotices, listProgramHubs } from "@/lib/queries";
import { programPath, ROUTES, typePath } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const dynamicParams = true;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

/** 진행 중을 먼저, 그다음 지난 공고. 지난 회차도 이 사업의 기록이라 같이 싣는다(사용자 요청 2026-10-06) */
const PROGRAM_NOTICE_LIMIT = 30;

type Params = { params: Promise<{ program: string }> };

export function generateStaticParams() {
  return Object.keys(PROGRAM_DOCS).map((program) => ({ program }));
}

/** 끝 글자에 받침이 있나 — 「미리내집은」 「든든전세는」, 「미리내집이란」 「든든전세란」 */
function batchim(word: string): boolean {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
}
const topic = (w: string) => `${w}${batchim(w) ? "은" : "는"}`;
const whatIs = (w: string) => `${w}${batchim(w) ? "이란" : "란"}`;

async function loadProgram(params: Params["params"]): Promise<string> {
  const { program } = await params;
  return decodeURIComponent(program);
}

function hubDescription(program: string, lede: string, open: number): string {
  return `${program} ${lede} 진행 중인 모집공고 ${num(open, "건")}과 지난 공고, 신청자격을 한곳에.`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const program = await loadProgram(params);
  const doc = programDoc(program);
  if (!doc) return { title: "찾을 수 없는 사업", robots: { index: false, follow: false } };
  const hub = (await listProgramHubs()).find((h) => h.program === program);
  const thin = (hub?.total ?? 0) < PROGRAM_MIN_COUNT;
  return {
    title: `${whatIs(program)} — 신청자격과 모집공고`,
    description: hubDescription(program, doc.lede, hub?.open ?? 0),
    alternates: { canonical: programPath(program) },
    ...(thin && { robots: { index: false, follow: true } }),
  };
}

export default async function ProgramHubPage({ params }: Params) {
  const program = await loadProgram(params);
  const doc = programDoc(program);
  if (!doc) notFound();

  const [hubs, notices, rules] = await Promise.all([
    listProgramHubs(),
    listLandingNotices({ program }, PROGRAM_NOTICE_LIMIT),
    getEligibilityRules(),
  ]);
  const hub = hubs.find((h) => h.program === program);
  const seeds = doc.seeds
    .map((code) => rules.types.find((t) => t.code === code))
    .filter((t): t is NonNullable<typeof t> => t != null);
  const others = Object.keys(PROGRAM_DOCS).filter((p) => p !== program);
  const count = (p: string) => hubs.find((h) => h.program === p)?.total ?? 0;

  const url = absoluteUrl(programPath(program));
  const crumbId = `${url}#breadcrumb`;
  const graph = [
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: `${whatIs(program)} — 신청자격과 모집공고`,
      description: hubDescription(program, doc.lede, hub?.open ?? 0),
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
      { name: "임대 종류", path: ROUTES.program },
      { name: program, path: programPath(program) },
    ]),
  ];

  return (
    <article className="stage legal">
      <JsonLd graph={graph} />
      <div className="crumb">
        <Link href={ROUTES.program} className="back">← 임대 종류 전체</Link>
      </div>
      <div className="legal-in">
        <h1>{program}</h1>
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
          <p>
            법정 유형으로는{" "}
            {doc.types.map((t, i) => (
              <span key={t}>
                {i > 0 && ", "}
                {housingTypeDoc(t) ? <Link href={typePath(t)}>{t}</Link> : t}
              </span>
            ))}
            에 속한다.
          </p>

          <LegalSection title={`${topic(program)} 어떤 사업인가`}>
            <HubParas paras={doc.body} />
          </LegalSection>

          {seeds.length > 0 && (
            <LegalSection title="신청 자격">
              <p>
                아래는 제도 일반 기준이다. <strong>같은 사업이라도 공고마다 우선공급 몫과 배점이 다르므로</strong> 마지막 판단은
                각 공고의 신청자격 절이 한다. 금액 기준은 {rules.incomeYear}년 자료다.
              </p>
              <RuleTileGroup types={seeds} income={rules.income} />
              <HubIncome types={seeds} income={rules.income} year={rules.incomeYear} />
              <p><Link href={ROUTES.eligibility}>내 조건으로 자격 따져 보기 →</Link></p>
            </LegalSection>
          )}

          <LegalSection title="모집공고">
            {notices.length > 0 ? (
              <>
                <p>진행 중인 공고를 먼저, 그다음 지난 공고를 최근 것부터 싣는다.</p>
                <ul className="rows v-card">
                  {notices.map((n) => <NoticeRow key={n.id} n={n} />)}
                </ul>
              </>
            ) : (
              <p>지금은 수집된 {program} 공고가 없다. 새 공고가 올라오면 이 자리에 실린다.</p>
            )}
          </LegalSection>

          <LegalSection title="자주 묻는 것">
            <HubFaq items={doc.faq} />
          </LegalSection>

          <LegalSection title="다른 사업">
            <HubChips items={others.map((p) => ({ href: programPath(p), label: p, count: count(p) }))} />
          </LegalSection>

          <p className="legal-eff">
            제도 설명은 공고문과 기관 안내를 읽기 쉽게 줄인 것이지 법령 해석이 아니다. 어느 공고가 이 사업인지는 공고 제목으로 가렸다.
            신청 전에 반드시 해당 공고문 원문을 확인한다.
          </p>
        </div>
      </div>
    </article>
  );
}
