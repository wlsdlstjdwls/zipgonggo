// 임대주택 사업 한눈에 — /program. 법정 유형(/type)과 그 아래 정부 사업(/program/{사업})을 한 판에 모은다.
//
// 「분류별로 관리」(사용자 요청 2026-10-06)의 입구. 행복주택, 재개발임대처럼 사업 이름이 곧 유형인 것은 유형 허브로,
// 든든전세, 미리내집처럼 유형 아래 갈래인 것은 사업 허브로 보낸다. 글은 두 카탈로그(housing-types, programs)에서 읽는다.
import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { LegalSection } from "@/components/legal-doc";
import { SITE_NAME } from "@/lib/constants";
import { num } from "@/lib/format";
import { HOUSING_TYPE_DOCS } from "@/lib/housing-types";
import { breadcrumb, ORG_ID, WEBSITE_ID } from "@/lib/jsonld";
import { PROGRAM_DOCS } from "@/lib/programs";
import { listProgramHubs, listTypeHubs } from "@/lib/queries";
import { programPath, ROUTES, typePath } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const preferredRegion = "iad1";

const TITLE = "임대 종류 한눈에 — 공공임대 유형과 정부 사업 정리";
const DESCRIPTION =
  "행복주택, 국민임대, 매입임대부터 든든전세, 미리내집, 장기미임대, 신혼신생아 매입임대까지. 정부 임대주택 사업을 유형별로 묶어 제도 설명과 모집공고를 모았다.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: ROUTES.program },
};

export default async function ProgramIndexPage() {
  const [typeHubs, programHubs] = await Promise.all([listTypeHubs(), listProgramHubs()]);
  const typeCount = (t: string) => typeHubs.find((h) => h.housing_type === t);
  const programCount = (p: string) => programHubs.find((h) => h.program === p);

  // 글이 있는 유형만, 공고 많은 순. 그 유형에 걸친 사업을 아래에 단다(미리내집처럼 둘에 걸치면 둘 다에)
  const types = Object.keys(HOUSING_TYPE_DOCS)
    .map((t) => ({ type: t, hub: typeCount(t), programs: Object.keys(PROGRAM_DOCS).filter((p) => PROGRAM_DOCS[p].types.includes(t)) }))
    .sort((a, b) => (b.hub?.total ?? 0) - (a.hub?.total ?? 0));

  const url = absoluteUrl(ROUTES.program);
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
      { name: "임대 종류", path: ROUTES.program },
    ]),
  ];

  return (
    <article className="stage legal">
      <JsonLd graph={graph} />
      <div className="crumb">
        <Link href={ROUTES.home} className="back">← 목록</Link>
      </div>
      <div className="legal-in">
        <h1>임대 종류 한눈에</h1>
        <p className="legal-eff">유형 {num(types.length, "개")} | 사업 {num(Object.keys(PROGRAM_DOCS).length, "개")} | {SITE_NAME}</p>
        <div className="legal-body">
          <p>
            공공임대는 법이 정한 <strong>유형</strong>(행복주택, 국민임대, 매입임대 …)이 큰 틀이고, 그 안에서 정부와 공사가
            대상을 좁혀 이름을 붙인 <strong>사업</strong>(든든전세, 미리내집, 청년 매입임대 …)이 따로 공고된다.
            같은 매입임대라도 사업이 다르면 자격과 금액이 전혀 다르다. 아래는 유형마다 그 안의 사업을 묶어 둔 것이다.
          </p>

          {types.map(({ type, hub, programs }) => (
            <LegalSection key={type} title={type}>
              <p>{HOUSING_TYPE_DOCS[type].lede}</p>
              <p>
                <Link href={typePath(type)}>{type} 제도와 전국 공고 보기 →</Link>
                {hub && <> 모은 공고 {num(hub.total, "건")} | 진행 중 {num(hub.open, "건")}</>}
              </p>
              {programs.length > 0 && (
                <ul>
                  {programs.map((p) => {
                    const c = programCount(p);
                    return (
                      <li key={p}>
                        <Link href={programPath(p)}><b>{p}</b></Link>
                        {c ? ` ${num(c.total, "건")}${c.open ? ` (진행 중 ${num(c.open, "건")})` : ""}` : ""} — {PROGRAM_DOCS[p].lede}
                      </li>
                    );
                  })}
                </ul>
              )}
            </LegalSection>
          ))}

          <p className="legal-eff">
            어느 공고가 어느 사업인지는 공고 제목으로 가렸다. 제목에 사업 이름이 없는 공고는 유형으로만 묶인다.
          </p>
        </div>
      </div>
    </article>
  );
}
