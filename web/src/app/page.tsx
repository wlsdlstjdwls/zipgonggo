import type { Metadata } from "next";
import Link from "next/link";
import { NoticeFeed } from "@/components/notice-feed";
import { listFilterOptions, listNoticesPage, PAGE_SIZE, type NoticeSort, type Sector } from "@/lib/queries";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "공공임대·민간임대 모집공고 — 최신 공고순",
  description: "LH·SH·지방공사 공공임대와 공공지원민간임대 입주자모집공고를 최신 공고순으로. 시도·공급유형별 보증금·월임대료·접수일정.",
  alternates: { canonical: "/" },
};

const SECTORS: Sector[] = ["공공임대", "민간임대"];

function pick(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

function qs(p: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `/?${s}` : "/";
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sectorRaw = pick(sp.sector);
  const sector = SECTORS.includes(sectorRaw as Sector) ? (sectorRaw as Sector) : undefined;
  const sort: NoticeSort = pick(sp.sort) === "deadline" ? "deadline" : "posted";
  const f = { sector, sido: pick(sp.sido), type: pick(sp.type) };
  const sortQ = sort === "deadline" ? "deadline" : undefined; // 기본값(posted)은 URL에 안 적는다
  const [page, options] = await Promise.all([listNoticesPage({ ...f, sort }, null, PAGE_SIZE), listFilterOptions(sector)]);
  const total = options.sector.reduce((a, o) => a + o.count, 0);
  const countOf = (s: Sector) => options.sector.find((o) => o.value === s)?.count ?? 0;
  const filtered = Boolean(f.sido || f.type);
  const feedParams = new URLSearchParams();
  if (sector) feedParams.set("sector", sector);
  if (f.sido) feedParams.set("sido", f.sido);
  if (f.type) feedParams.set("type", f.type);
  if (sortQ) feedParams.set("sort", sortQ);

  return (
    <>
      <div className="hero">
        <h1>임대주택 모집공고 지도</h1>
        <p>LH·SH·지방공사 공고를 한곳에. 최신 공고순, 보증금·월임대료는 공고에 적힌 최소값입니다.</p>
        <div className="stat">
          <div><span>전체</span><b>{total.toLocaleString("ko-KR")}</b></div>
          <div><span>서울 SH</span><b>{(options.sido.find((o) => o.value === "서울특별시")?.count ?? 0).toLocaleString("ko-KR")}</b></div>
          <div><span>민간임대</span><b>{countOf("민간임대")}</b></div>
        </div>
      </div>

      <nav className="tabs" aria-label="공공/민간 구분">
        <Link href={qs({ sido: f.sido, type: f.type, sort: sortQ })} className={!sector ? "on" : ""}>전체 <small>{total}</small></Link>
        {SECTORS.map((s) => (
          <Link key={s} href={qs({ sector: s, sido: f.sido, type: f.type, sort: sortQ })} className={sector === s ? "on" : ""}>
            {s} <small>{countOf(s)}</small>
          </Link>
        ))}
      </nav>

      <form className="filters" method="get" action="/">
        {sector && <input type="hidden" name="sector" value={sector} />}
        {sortQ && <input type="hidden" name="sort" value={sortQ} />}
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
        {filtered && <Link className="reset" href={qs({ sector, sort: sortQ })}>초기화</Link>}
      </form>

      <div className="result-row">
        <p className="result-count">{page.total.toLocaleString("ko-KR")}건</p>
        <nav className="sort" aria-label="정렬">
          <Link href={qs({ sector, sido: f.sido, type: f.type })} className={sort === "posted" ? "on" : ""} aria-current={sort === "posted" ? "true" : undefined}>최신 공고순</Link>
          <Link href={qs({ sector, sido: f.sido, type: f.type, sort: "deadline" })} className={sort === "deadline" ? "on" : ""} aria-current={sort === "deadline" ? "true" : undefined}>마감 임박순</Link>
        </nav>
      </div>

      {page.items.length === 0 ? (
        <p className="empty">
          {sector === "민간임대"
            ? "민간임대 공고가 아직 없습니다. 청년안심주택 등 민간임대는 수집 준비 중입니다."
            : "조건에 맞는 공고가 없습니다."}
        </p>
      ) : (
        <NoticeFeed key={feedParams.toString()} initial={page} params={feedParams.toString()} />
      )}
    </>
  );
}
