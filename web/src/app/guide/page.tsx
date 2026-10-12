// 안내 글 목록 — /guide. 글은 lib/guides.ts 순서대로.
import type { Metadata } from "next";
import Link from "next/link";
import { HubLede } from "@/components/hub-blocks";
import { JsonLd } from "@/components/json-ld";
import { SITE_NAME } from "@/lib/constants";
import { num } from "@/lib/format";
import { GUIDE_DOCS } from "@/lib/guides";
import { breadcrumb, ORG_ID, WEBSITE_ID } from "@/lib/jsonld";
import { guidePath, ROUTES } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

const TITLE = "공공임대 안내 글 — 소득 기준, 예비입주 대기, 전환보증금 읽는 법";
const DESCRIPTION =
  "공공임대 모집공고에 나오는 숫자를 읽는 법. 소득 기준의 실제 금액, 예비입주자 대기 인원과 퇴거, 보증금 전환, 경쟁률, 접수 일정을 집공고가 모은 데이터로 정리했다.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.guide },
};

export default function GuideIndexPage() {
  const entries = Object.entries(GUIDE_DOCS);
  const url = absoluteUrl(ROUTES.guide);
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
      hasPart: entries.map(([slug, d]) => ({ "@type": "Article", headline: d.title, url: absoluteUrl(guidePath(slug)) })),
    },
    breadcrumb(crumbId, [
      { name: "공고 목록", path: ROUTES.home },
      { name: "안내 글", path: ROUTES.guide },
    ]),
  ];

  return (
    <article className="stage legal">
      <JsonLd graph={graph} />
      <div className="crumb">
        <Link href={ROUTES.home} className="back">← 목록</Link>
      </div>
      <div className="legal-in">
        <h1>안내 글</h1>
        <p className="legal-eff">글 {num(entries.length, "편")} | {SITE_NAME}</p>
        <div className="legal-body">
          <HubLede>
            공고문에 나오는 숫자를 어떻게 읽어야 하는지 정리했다. 글 속 표는 집공고가 매시 모으는 공고와 대기현황, 단지 정보에서 그때그때 계산한다.
          </HubLede>
          <ul className="g-list big">
            {entries.map(([slug, d]) => (
              <li key={slug}>
                <Link href={guidePath(slug)}>{d.title}</Link>
                <span>{d.description}</span>
              </li>
            ))}
          </ul>
          <p className="legal-eff">
            유형마다의 제도 설명은 <Link href={ROUTES.program}>임대 종류</Link>에, 내 조건으로 넣을 수 있는 유형은{" "}
            <Link href={ROUTES.eligibility}>자격진단</Link>에 있다.
          </p>
        </div>
      </div>
    </article>
  );
}
