// 검색 결과 — /search?q=…
//
// **색인하지 않는다.** 찾는 말마다 URL이 하나씩 생기는데 그 지면의 내용은 다른 데 이미 있는 것의 모음이다 —
// 얇은 페이지를 발행하지 않는다는 규칙(CLAUDE.md 4)에 정면으로 걸린다. follow는 남긴다: 크롤러가
// 여기 실린 공고·단지 링크를 따라가는 건 오히려 이롭다.
//
// 헤더 드롭다운과 같은 조회를 쓰되 갈래마다 더 많이 싣는다. /api/search를 거치지 않고 직접 읽는다 —
// 서버에서 제 DB를 부르는 자리에 제 HTTP 라우트를 한 번 더 타는 건 왕복만 늘린다.
import type { Metadata } from "next";
import Link from "next/link";
import { NoticeRow } from "@/components/notice-row";
import { SITE_NAME } from "@/lib/constants";
import { count } from "@/lib/format";
import { listAreaTypePairs, listFilterOptions, listTypeHubs, searchComplexes, searchNotices } from "@/lib/queries";
import { matchShortcuts, SEARCH_MIN_LEN, SEARCH_PAGE_LIMIT, searchTerm } from "@/lib/search";
import { noticeComplexPath, ROUTES } from "@/lib/routes";
import { regionShort } from "@/lib/sido";
import { firstParam } from "@/lib/notice-filters";

// DB(us-east-1)와 리전을 맞춘다 — layout.tsx와 같은 값 유지
export const preferredRegion = "iad1";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = firstParam((await searchParams).q) ?? "";
  return {
    title: q ? `「${q}」 검색 결과` : "검색",
    description: `${SITE_NAME}에서 공고와 단지, 지역을 찾습니다.`,
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const raw = firstParam((await searchParams).q) ?? "";
  const term = searchTerm(raw);

  if (!term) {
    return (
      <article className="stage legal">
        <div className="legal-in">
          <h1>검색</h1>
          <p className="legal-eff">{SITE_NAME}</p>
          <div className="legal-body">
            <p>
              {raw.trim()
                ? `찾을 말이 너무 짧다. ${SEARCH_MIN_LEN}글자 이상 쳐 보세요.`
                : "단지 이름, 공고 제목, 지역 이름으로 찾습니다. 헤더 위쪽 칸에 쳐 보세요."}
            </p>
            <p><Link href={ROUTES.home}>← 전체 공고 목록</Link></p>
          </div>
        </div>
      </article>
    );
  }

  const [notices, complexes, options, pairs, hubs] = await Promise.all([
    searchNotices(term, SEARCH_PAGE_LIMIT),
    searchComplexes(term, SEARCH_PAGE_LIMIT),
    listFilterOptions(undefined),
    listAreaTypePairs(),
    listTypeHubs(),
  ]);
  const shortcuts = matchShortcuts(raw, { sido: options.sido, pairs, hubs }, 12);
  const found = shortcuts.length + notices.length + complexes.length;

  return (
    <article className="stage legal">
      <div className="crumb">
        <Link href={ROUTES.home} className="back">← 목록</Link>
      </div>
      <div className="legal-in">
        <h1>「{raw.trim()}」 검색 결과</h1>
        <p className="legal-eff">
          {found > 0 ? `공고 ${count(notices.length)} | 단지 ${count(complexes.length, "곳")}` : "걸리는 것이 없다"} | {SITE_NAME}
        </p>
        <div className="legal-body">
          {found === 0 && (
            <p>
              「{raw.trim()}」에 걸리는 공고나 단지가 없다. 띄어쓰기를 빼고 이름 일부만 쳐 보거나,{" "}
              <Link href={ROUTES.home}>전체 목록</Link>에서 지역과 유형으로 좁혀 보세요.
            </p>
          )}

          {shortcuts.length > 0 && (
            <section className="legal-sec">
              <h2>바로 가기</h2>
              <ul className="ss-list">
                {shortcuts.map((s) => (
                  <li key={s.key}>
                    <Link href={s.href}>
                      <b>{s.label}</b>
                      <span>{s.sub}</span>
                      <em>{count(s.count)}</em>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {notices.length > 0 && (
            <section className="legal-sec">
              <h2>공고 {count(notices.length)}</h2>
              <ul className="rows v-card">
                {notices.map((n) => <NoticeRow key={n.id} n={n} />)}
              </ul>
              {notices.length === SEARCH_PAGE_LIMIT && <p>많이 걸려 {SEARCH_PAGE_LIMIT}건까지만 싣는다. 말을 더 붙여 좁혀 보세요.</p>}
            </section>
          )}

          {complexes.length > 0 && (
            <section className="legal-sec">
              <h2>단지 {count(complexes.length, "곳")}</h2>
              <ul className="ss-list">
                {complexes.map((c) => (
                  <li key={c.id}>
                    <Link href={noticeComplexPath(c.notice_slug, c)}>
                      <b>{c.name}</b>
                      <span>{c.road_address || regionShort(c)}</span>
                      <em>{c.closed ? "마감 공고" : "진행 중"}</em>
                    </Link>
                  </li>
                ))}
              </ul>
              <p>단지 지면은 그 단지를 공급한 공고에 매달려 있다 — 가장 최근 공고 하나로 보낸다.</p>
            </section>
          )}
        </div>
      </div>
    </article>
  );
}
