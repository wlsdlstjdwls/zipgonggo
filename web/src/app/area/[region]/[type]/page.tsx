// 지역×유형 — /area/{시군구}/{유형}. docs/url-structure.md.
//
// 같은 이름의 시군구가 여러 시도에 있으면 세그먼트 앞에 시도 통칭이 붙는다(「울산 북구」). 붙는 기준과 붙이는 쪽은
// lib/routes의 areaTypeSegment 하나뿐이고, 여기서는 그 규칙을 거꾸로 풀 뿐이다.
//
// 발행(색인) 기준은 5건(CLAUDE.md 4). 미달 쌍도 주소로 들어오면 페이지는 열린다 — URL을 죽이지 않는다(CLAUDE.md 5) —
// 대신 noindex를 달고 canonical을 상위 시도 페이지로 돌린다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { LegalSection } from "@/components/legal-doc";
import { NoticeRow } from "@/components/notice-row";
import { AREA_MIN_COUNT } from "@/lib/constants";
import { num } from "@/lib/format";
import { housingTypeDoc } from "@/lib/housing-types";
import { areaGraph } from "@/lib/jsonld";
import { AREA_TYPE_MIN_COUNT, listAreaTypePairs, listLandingNotices, type AreaTypePair } from "@/lib/queries";
import { areaPath, areaTypePath, ROUTES, typePath } from "@/lib/routes";
import { sidoShort } from "@/lib/sido";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const dynamicParams = true;
// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

/** 이 착지 페이지가 싣는 공고 수. 넘치면 시도 페이지가 받는다 */
const AREA_TYPE_LIMIT = 30;

type Params = { params: Promise<{ region: string; type: string }> };

export async function generateStaticParams() {
  const pairs = await listAreaTypePairs();
  return pairs
    .filter((p) => p.count >= AREA_TYPE_MIN_COUNT)
    .map((p) => ({ region: segmentOf(p), type: p.housing_type }));
}

function segmentOf(p: AreaTypePair): string {
  return p.ambiguous ? `${sidoShort(p.sido)} ${p.sigungu}` : p.sigungu;
}

type Found = { pair: AreaTypePair; published: boolean };

/** 주소 한 쌍 → 실제 (시도, 시군구, 유형). 세그먼트가 「울산 북구」면 앞 토막이 시도 통칭이다 */
async function load(params: Params["params"]): Promise<Found | null> {
  const { region, type: rawType } = await params;
  const seg = decodeURIComponent(region);
  const type = decodeURIComponent(rawType);
  const pairs = await listAreaTypePairs();
  const hit = pairs.find((p) => p.housing_type === type && segmentOf(p) === seg);
  if (!hit) return null;
  return { pair: hit, published: hit.count >= AREA_TYPE_MIN_COUNT };
}

function describe(p: AreaTypePair): string {
  return `${sidoShort(p.sido)} ${p.sigungu} ${p.housing_type} 입주자모집공고 ${num(p.count, "건")}. 보증금과 월임대료, 접수일정과 마감일을 공고별로.`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const f = await load(params);
  if (!f) return { title: "찾을 수 없는 지역", robots: { index: false, follow: false } };
  const { pair, published } = f;
  const title = `${sidoShort(pair.sido)} ${pair.sigungu} ${pair.housing_type} 모집공고`;
  return {
    title,
    description: describe(pair),
    // 미달 쌍은 제 주소를 정본으로 삼지 않는다 — 상위 시도 페이지가 그 공고들을 모두 안고 있다
    alternates: { canonical: published ? areaTypePath(pair, pair.housing_type) : areaPath(pair.sido) },
    ...(published ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function AreaTypePage({ params }: Params) {
  const f = await load(params);
  if (!f) notFound();
  const { pair, published } = f;
  const [notices, pairs] = await Promise.all([
    listLandingNotices({ type: pair.housing_type, sido: pair.sido, sigungu: pair.sigungu }, AREA_TYPE_LIMIT),
    listAreaTypePairs(),
  ]);
  // 같은 시군구의 다른 유형 — 옆으로 건너가는 길
  const siblings = pairs.filter(
    (p) => p.sido === pair.sido && p.sigungu === pair.sigungu && p.housing_type !== pair.housing_type && p.count >= AREA_TYPE_MIN_COUNT,
  );
  const doc = housingTypeDoc(pair.housing_type);
  const short = sidoShort(pair.sido);
  const heading = `${short} ${pair.sigungu} ${pair.housing_type}`;

  return (
    <article className="stage legal">
      <JsonLd
        graph={areaGraph(heading, pair.count, areaTypePath(pair, pair.housing_type), [
          { name: "공고 목록", path: ROUTES.home },
          { name: short, path: areaPath(pair.sido) },
          { name: heading, path: areaTypePath(pair, pair.housing_type) },
        ], describe(pair))}
      />
      <div className="crumb">
        <Link href={areaPath(pair.sido)} className="back">← {short} 전체</Link>
      </div>
      <div className="legal-in">
        <h1>{heading} 모집공고</h1>
        <p className="legal-eff">
          모아 둔 공고 {num(pair.count, "건")} | <Link href={typePath(pair.housing_type)}>{pair.housing_type}가 어떤 제도인지</Link>
        </p>
        <div className="legal-body">
          {doc && <p>{doc.lede}</p>}
          {!published && (
            <p>
              이 지역의 {pair.housing_type} 공고는 아직 {num(AREA_TYPE_MIN_COUNT, "건")}에 못 미친다. 전체 목록은{" "}
              <Link href={areaPath(pair.sido)}>{short} 공고</Link>에 있다.
            </p>
          )}

          <LegalSection title="공고">
            {notices.length > 0 ? (
              <ul className="rows v-card">
                {notices.map((n) => <NoticeRow key={n.id} n={n} />)}
              </ul>
            ) : (
              <p>지금은 실린 공고가 없다.</p>
            )}
          </LegalSection>

          {siblings.length > 0 && (
            <LegalSection title={`${short} ${pair.sigungu}의 다른 유형`}>
              <ul>
                {siblings.map((p) => (
                  <li key={p.housing_type}>
                    <Link href={areaTypePath(p, p.housing_type)}>{p.housing_type}</Link> {num(p.count, "건")}
                  </li>
                ))}
              </ul>
            </LegalSection>
          )}

          <LegalSection title="더 넓게 보기">
            <ul>
              <li><Link href={areaPath(pair.sido)}>{short} 전체 공고</Link> (공고 {AREA_MIN_COUNT}건 이상인 시도만 발행한다)</li>
              <li><Link href={typePath(pair.housing_type)}>{pair.housing_type} 전국 현황과 신청자격</Link></li>
            </ul>
          </LegalSection>
        </div>
      </div>
    </article>
  );
}
