// 검색 결과 — /search?q=…
//
// **색인하지 않는다.** 찾는 말마다 URL이 하나씩 생기는데 그 지면의 내용은 다른 데 이미 있는 것의 모음이다 —
// 얇은 페이지를 발행하지 않는다는 규칙(CLAUDE.md 4)에 정면으로 걸린다. follow는 남긴다: 크롤러가
// 여기 실린 공고·단지 링크를 따라가는 건 오히려 이롭다.
//
// 골격은 약관 지면(좁은 한 단)이 아니라 **목록 지면과 같은 전폭**이다(사용자 지적 2026-09-18:
// "화면 넓은데 왜 2열로만"). legal-in은 max-width 720px이라 288px 카드가 두 장밖에 못 들어갔다.
//
// 진행 중과 마감을 갈라 싣는다. 마감분은 「마감된 공고 보기」를 펴야 나온다 —
// <details>로 두는 건 자바스크립트 없이 즉시 열리기 때문이다(왕복이 없다).
import type { Metadata } from "next";
import Link from "next/link";
import { NoticeRow } from "@/components/notice-row";
import { SITE_NAME } from "@/lib/constants";
import { count } from "@/lib/format";
import { listShortcutSource, searchComplexes, searchNotices } from "@/lib/queries";
import { matchShortcuts, SEARCH_MIN_LEN, SEARCH_PAGE_LIMIT, searchTerm } from "@/lib/search";
import { noticeComplexPath, ROUTES } from "@/lib/routes";
import { regionShort } from "@/lib/sido";
import { firstParam } from "@/lib/notice-filters";
import type { SearchComplexHit, SearchNoticeHit } from "@/types/notice";

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

function Crumb() {
  return (
    <div className="crumb">
      <Link href={ROUTES.home} className="back">← 목록</Link>
    </div>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const raw = firstParam((await searchParams).q) ?? "";
  const q = raw.trim();
  const term = searchTerm(raw);

  if (!term) {
    return (
      <article className="stage srch">
        <Crumb />
        <div className="list-top"><h1>검색</h1></div>
        <p className="srch-note">
          {q
            ? `찾을 말이 너무 짧습니다. ${SEARCH_MIN_LEN}글자 이상 쳐 보세요.`
            : "단지 이름, 공고 제목, 지역 이름으로 찾습니다. 헤더 위쪽 칸에 쳐 보세요."}
        </p>
      </article>
    );
  }

  const [hits, complexHits, src] = await Promise.all([
    searchNotices(term, SEARCH_PAGE_LIMIT),
    searchComplexes(term, SEARCH_PAGE_LIMIT),
    listShortcutSource(),
  ]);
  const shortcuts = matchShortcuts(raw, src, 12);

  const open = hits.filter((n) => !n.closed);
  const closed = hits.filter((n) => n.closed);
  const cxOpen = complexHits.filter((c) => !c.closed);
  const cxClosed = complexHits.filter((c) => c.closed);
  const found = shortcuts.length + hits.length + complexHits.length;

  return (
    <article className="stage srch">
      <Crumb />
      <div className="list-top">
        <h1>「{q}」 검색 결과</h1>
        {found > 0 && <span>공고 {count(hits.length)} | 단지 {count(complexHits.length, "곳")}</span>}
      </div>

      {found === 0 && (
        <p className="srch-note">
          「{q}」에 걸리는 공고나 단지가 없습니다. 띄어쓰기를 빼고 이름 일부만 쳐 보거나,{" "}
          <Link href={ROUTES.home}>전체 목록</Link>에서 지역과 유형으로 좁혀 보세요.
        </p>
      )}

      {shortcuts.length > 0 && (
        <section className="srch-sec">
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

      {hits.length > 0 && (
        <section className="srch-sec">
          <h2>공고{open.length > 0 && <em>{count(open.length)}</em>}</h2>
          {open.length > 0 ? (
            <ul className="rows v-card">
              {open.map((n) => <NoticeRow key={n.id} n={n} />)}
            </ul>
          ) : (
            <p className="srch-note">지금 접수 중인 공고는 없습니다. 아래에서 마감된 공고를 볼 수 있습니다.</p>
          )}
          {open.length === SEARCH_PAGE_LIMIT && (
            <p className="srch-note">많이 걸려 {SEARCH_PAGE_LIMIT}건까지만 싣습니다. 말을 더 붙여 좁혀 보세요.</p>
          )}
          {closed.length > 0 && <ClosedNotices rows={closed} />}
        </section>
      )}

      {complexHits.length > 0 && (
        <section className="srch-sec">
          <h2>단지{cxOpen.length > 0 && <em>{count(cxOpen.length, "곳")}</em>}</h2>
          {cxOpen.length > 0 ? (
            <ComplexList rows={cxOpen} />
          ) : (
            <p className="srch-note">접수 중인 공고에 걸린 단지는 없습니다.</p>
          )}
          {cxClosed.length > 0 && (
            <details className="more">
              <summary>마감 공고의 단지 {count(cxClosed.length, "곳")} 보기</summary>
              <ComplexList rows={cxClosed} />
            </details>
          )}
          <p className="srch-note">단지 지면은 그 단지를 공급한 공고에 매달려 있습니다 — 가장 최근 공고 하나로 보냅니다.</p>
        </section>
      )}
    </article>
  );
}

/** 마감분은 접어 둔다. 지우지 않는 건 규칙이고(CLAUDE.md 5), 기본으로 펴 두지 않는 건
 *  지금 신청할 수 있는 공고를 찾으러 온 사람이 대부분이라서다. */
function ClosedNotices({ rows }: { rows: SearchNoticeHit[] }) {
  return (
    <details className="more">
      <summary>마감된 공고 {count(rows.length)} 보기</summary>
      <ul className="rows v-card">
        {rows.map((n) => <NoticeRow key={n.id} n={n} />)}
      </ul>
    </details>
  );
}

function ComplexList({ rows }: { rows: SearchComplexHit[] }) {
  return (
    <ul className="ss-list">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={noticeComplexPath(c.notice_slug, c)}>
            <b>{c.name}</b>
            <span>{c.road_address || regionShort(c)}</span>
            <em>{c.closed ? "마감 공고" : "진행 중"}</em>
          </Link>
        </li>
      ))}
    </ul>
  );
}
