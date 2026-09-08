import type { Metadata } from "next";
import Link from "next/link";
import { Hero } from "@/components/hero";
import { NoticeFeed } from "@/components/notice-feed";
import { PAGE_SIZE, SH_SIDO } from "@/lib/constants";
import { count } from "@/lib/format";
import { hasFilter, noticeFiltersToParams, parseNoticeFilters } from "@/lib/notice-filters";
import { listFilterOptions, listNoticesPage } from "@/lib/queries";
import { homePath, ROUTES } from "@/lib/routes";
import { SECTORS, type Sector } from "@/types/notice";

// Next 세그먼트 설정은 리터럴만 허용 — lib/constants REVALIDATE_SEC(3600)와 같은 값을 유지할 것
export const revalidate = 3600;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const HOME_TITLE = "공공임대·민간임대 모집공고 — 최신 공고순";
const HOME_DESCRIPTION = "LH·SH·지방공사 공공임대와 공공지원민간임대 입주자모집공고를 최신 공고순으로. 시도·공급유형별 보증금·월임대료·접수일정.";

// 필터 결과(?sector=&sido=&type=&sort=)는 noindex, canonical은 파라미터 없는 "/" — docs/url-structure.md
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const sp = await searchParams;
  const f = parseNoticeFilters((k) => sp[k]);
  return {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    alternates: { canonical: ROUTES.home },
    robots: hasFilter(f) ? { index: false, follow: true } : undefined,
  };
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const f = parseNoticeFilters((k) => sp[k]);
  const { sector, sort } = f;
  const [page, options] = await Promise.all([listNoticesPage(f, null, PAGE_SIZE), listFilterOptions(sector)]);
  const total = options.sector.reduce((a, o) => a + o.count, 0);
  const countOf = (s: Sector) => options.sector.find((o) => o.value === s)?.count ?? 0;
  const shCount = options.sido.find((o) => o.value === SH_SIDO)?.count ?? 0;
  const filtered = Boolean(f.sido || f.type);
  const feedParams = noticeFiltersToParams(f).toString();

  return (
    <>
      <Hero stats={[<b key="all">{count(total, "")}</b>, <b key="sh">{count(shCount, "")}</b>, <b key="private">{countOf("민간임대")}</b>]} />

      <nav className="tabs" aria-label="공공/민간 구분">
        <Link href={homePath({ ...f, sector: undefined })} className={!sector ? "on" : ""}>전체 <small>{total}</small></Link>
        {SECTORS.map((s) => (
          <Link key={s} href={homePath({ ...f, sector: s })} className={sector === s ? "on" : ""}>
            {s} <small>{countOf(s)}</small>
          </Link>
        ))}
      </nav>

      <form className="filters" method="get" action={ROUTES.home}>
        {sector && <input type="hidden" name="sector" value={sector} />}
        {sort === "deadline" && <input type="hidden" name="sort" value={sort} />}
        <select name="sido" defaultValue={f.sido ?? ""} aria-label="시도">
          <option value="">전체 지역</option>
          {options.sido.map((o) => (
            <option key={o.value} value={o.value}>{o.value} ({o.count})</option>
          ))}
        </select>
        <select name="type" defaultValue={f.type ?? ""} aria-label="공급유형">
          <option value="">전체 유형</option>
          {options.type.map((o) => (
            <option key={o.value} value={o.value}>{o.value} ({o.count})</option>
          ))}
        </select>
        <button type="submit">적용</button>
        {filtered && <Link className="reset" href={homePath({ sector, sort })}>초기화</Link>}
      </form>

      <div className="result-row">
        <p className="result-count">{count(page.total)}</p>
        <nav className="sort" aria-label="정렬">
          <Link href={homePath({ ...f, sort: "posted" })} className={sort === "posted" ? "on" : ""} aria-current={sort === "posted" ? "true" : undefined}>최신 공고순</Link>
          <Link href={homePath({ ...f, sort: "deadline" })} className={sort === "deadline" ? "on" : ""} aria-current={sort === "deadline" ? "true" : undefined}>마감 임박순</Link>
        </nav>
      </div>

      {page.items.length === 0 ? (
        <p className="empty">
          {sector === "민간임대"
            ? "민간임대 공고가 아직 없습니다. 청년안심주택 등 민간임대는 수집 준비 중입니다."
            : "조건에 맞는 공고가 없습니다."}
        </p>
      ) : (
        <NoticeFeed key={feedParams} initial={page} params={feedParams} />
      )}
    </>
  );
}
