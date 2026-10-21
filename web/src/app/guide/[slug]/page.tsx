// 안내 글 — /guide/{글}. docs/url-structure.md 「안내 글」.
//
// 글은 lib/guides.ts, 숫자는 components/guide-blocks.tsx가 렌더 때 DB에서 읽는다.
// 글이 없는 식별자는 404다(설명 없는 껍데기를 발행하지 않는다 — 유형/사업 허브와 같은 원칙).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GuideBlockView } from "@/components/guide-blocks";
import { HubChips, HubFaq, HubLede, HubParas } from "@/components/hub-blocks";
import { JsonLd } from "@/components/json-ld";
import { LegalSection } from "@/components/legal-doc";
import { SITE_NAME } from "@/lib/constants";
import { GUIDE_DOCS, guideDoc } from "@/lib/guides";
import { breadcrumb, ORG_ID, WEBSITE_ID } from "@/lib/jsonld";
import { PROGRAM_DOCS } from "@/lib/programs";
import { guidePath, programPath, ROUTES, typePath } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(86400)와 같은 값을 유지할 것
export const revalidate = 86400;
export const dynamicParams = true;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return Object.keys(GUIDE_DOCS).map((slug) => ({ slug }));
}

async function loadSlug(params: Params["params"]): Promise<string> {
  const { slug } = await params;
  return decodeURIComponent(slug);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const slug = await loadSlug(params);
  const doc = guideDoc(slug);
  if (!doc) return { title: "찾을 수 없는 글", robots: { index: false, follow: false } };
  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: guidePath(slug) },
    openGraph: {
      type: "article",
      title: doc.title,
      description: doc.description,
      publishedTime: doc.published,
      modifiedTime: doc.updated ?? doc.published,
    },
  };
}

export default async function GuidePage({ params }: Params) {
  const slug = await loadSlug(params);
  const doc = guideDoc(slug);
  if (!doc) notFound();

  const url = absoluteUrl(guidePath(slug));
  const crumbId = `${url}#breadcrumb`;
  const graph = [
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: doc.title,
      description: doc.description,
      articleBody: [doc.lede, ...doc.sections.flatMap((s) => s.paras)].join("\n\n"),
      datePublished: doc.published,
      dateModified: doc.updated ?? doc.published,
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
      mainEntity: doc.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
    breadcrumb(crumbId, [
      { name: "공고 목록", path: ROUTES.home },
      { name: "안내 글", path: ROUTES.guide },
      { name: doc.title, path: guidePath(slug) },
    ]),
  ];

  const relTypes = doc.related.types ?? [];
  const relPrograms = (doc.related.programs ?? []).filter((p) => PROGRAM_DOCS[p]);
  const relGuides = (doc.related.guides ?? []).filter((g) => GUIDE_DOCS[g]);

  return (
    <article className="stage legal">
      <JsonLd graph={graph} />
      <div className="crumb">
        <Link href={ROUTES.guide} className="back">← 안내 글</Link>
      </div>
      <div className="legal-in">
        <h1>{doc.title}</h1>
        <p className="legal-eff">
          {doc.updated ? `고침 ${doc.updated}` : `쓴 날 ${doc.published}`} | {SITE_NAME} | 표의 숫자는 매시 갱신되는 데이터에서 읽는다
        </p>
        <div className="legal-body">
          <HubLede>{doc.lede}</HubLede>

          {doc.sections.map((s) => (
            <LegalSection key={s.h} title={s.h}>
              <HubParas paras={s.paras} />
              {s.block && <div className="g-block"><GuideBlockView block={s.block} /></div>}
              {s.note && <p className="g-note">{s.note}</p>}
            </LegalSection>
          ))}

          {doc.tool && (
            <p className="g-tool">
              {doc.tool === "eligibility" ? (
                <Link href={ROUTES.eligibility} className="btn">내 조건으로 자격진단 하기 →</Link>
              ) : (
                <>공고 화면 오른쪽 아래 <b>계산기</b>에서 보증금과 월임대료를 직접 바꿔 볼 수 있다.</>
              )}
            </p>
          )}

          <LegalSection title="자주 묻는 것">
            <HubFaq items={doc.faq} />
          </LegalSection>

          {(relTypes.length > 0 || relPrograms.length > 0) && (
            <LegalSection title="이 글과 이어지는 임대 종류">
              <HubChips items={[
                ...relTypes.map((t) => ({ href: typePath(t), label: t })),
                ...relPrograms.map((p) => ({ href: programPath(p), label: p })),
              ]} />
            </LegalSection>
          )}

          {relGuides.length > 0 && (
            <LegalSection title="함께 읽을 글">
              <ul className="g-list">
                {relGuides.map((g) => (
                  <li key={g}>
                    <Link href={guidePath(g)}>{GUIDE_DOCS[g].title}</Link>
                    <span>{GUIDE_DOCS[g].lede}</span>
                  </li>
                ))}
              </ul>
            </LegalSection>
          )}

          <p className="legal-eff">
            제도 설명은 공고문과 기관 안내를 읽기 쉽게 줄인 것이지 법령 해석이 아니다. 신청 전에 반드시 해당 공고문 원문을 확인한다.
            잘못된 내용을 발견하면 <Link href={ROUTES.about}>소개</Link>의 연락처로 알려 주면 고친다.
          </p>
        </div>
      </div>
    </article>
  );
}
