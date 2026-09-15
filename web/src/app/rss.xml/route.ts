// RSS 2.0 피드 — /rss.xml
//
// 왜 사이트맵이 있는데 또 만드나: **네이버 서치어드바이저가 RSS 제출을 따로 받는다.**
// 사이트맵은 "이 URL들이 존재한다", RSS는 "방금 이게 새로 올라왔다"라서 네이버 쪽 신규 수집이 눈에 띄게 빠르다.
// 공고는 매시 들어오고 접수 기간이 2주 안팎이라 늦게 잡히면 그 공고는 이미 마감이다.
//
// 싣는 것은 **진행 중 공고 최신순 50건뿐**이다. 마감 공고까지 넣으면 피드가 아니라 아카이브가 된다
// (URL은 살려 두지만 — CLAUDE.md 하지 말 것 5 — 그건 사이트맵이 할 일이다).
import { REVALIDATE_SEC, RSS_MAX_ITEMS, SITE_DESCRIPTION, SITE_NAME } from "@/lib/constants";
import { dateK, won } from "@/lib/format";
import { listNoticesPage } from "@/lib/queries";
import { noticePath, ROUTES } from "@/lib/routes";
import { regionLabel } from "@/lib/sido";
import { absoluteUrl } from "@/lib/site-url";
import type { NoticeListItem } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;
export const preferredRegion = "iad1";

/** XML 특수문자. 공고 제목에 `&`와 홑따옴표가 실제로 들어온다(「e·seo(이서)」·「'26년」) — 안 막으면 피드가 통째로 깨진다 */
function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** "YYYY-MM-DD" → RFC 822. 날짜만 있는 값이라 한국 시간 자정으로 읽는다 — UTC로 읽으면 하루 어긋난다 */
function rfc822(ymd: string): string {
  return new Date(`${ymd}T00:00:00+09:00`).toUTCString();
}

function itemDescription(n: NoticeListItem): string {
  const period = n.apply_start_at || n.apply_end_at ? `접수 ${dateK(n.apply_start_at)}~${dateK(n.apply_end_at)}. ` : "";
  const money = n.min_rent != null
    ? `최소 보증금 ${won(n.min_deposit)}, 최소 월임대료 ${won(n.min_rent)}.`
    : n.min_deposit != null ? `최소 보증금 ${won(n.min_deposit)}.` : "";
  return `${n.agency} ${n.housing_type}. ${regionLabel(n)}. ${period}${money}`.replace(/\s+/g, " ").trim();
}

export async function GET() {
  const page = await listNoticesPage({}, null, RSS_MAX_ITEMS);
  const self = absoluteUrl(ROUTES.rss);
  // 채널 pubDate는 맨 위 글의 공고일. 매번 now()를 박으면 내용이 안 바뀌어도 갱신된 척하게 된다
  const latest = page.items[0]?.posted_at;

  const items = page.items.map((n) => {
    const url = absoluteUrl(noticePath(n.canonical_slug ?? n.slug));
    return `    <item>
      <title>${esc(n.title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${rfc822(n.posted_at)}</pubDate>
      <category>${esc(n.housing_type)}</category>
      <description>${esc(itemDescription(n))}</description>
    </item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE_NAME)} — 입주자모집공고</title>
    <link>${esc(absoluteUrl(ROUTES.home))}</link>
    <description>${esc(SITE_DESCRIPTION)}</description>
    <language>ko</language>
    <atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>${latest ? `
    <lastBuildDate>${rfc822(latest)}</lastBuildDate>
    <pubDate>${rfc822(latest)}</pubDate>` : ""}
${items.join("\n")}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": `public, s-maxage=${REVALIDATE_SEC}, stale-while-revalidate=600`,
    },
  });
}
