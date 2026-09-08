import type { Metadata } from "next";
import { NoticeCard } from "@/components/notice-card";
import { listFilterOptions, listNotices } from "@/lib/queries";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "공공임대 모집공고 — 마감 임박순",
  description: "진행 중인 LH·지방공사 공공임대 입주자모집공고를 마감 임박순으로. 시도·공급유형별 보증금·월임대료·접수일정.",
  alternates: { canonical: "/" },
};

type Search = { sido?: string; type?: string };

function pick(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f: Search = { sido: pick(sp.sido), type: pick(sp.type) };
  const [notices, options] = await Promise.all([listNotices(f), listFilterOptions()]);
  const filtered = Boolean(f.sido || f.type);

  return (
    <>
      <h1 className="page-title">공공임대 모집공고</h1>
      <p className="page-sub">마감 임박순. 보증금·월임대료는 공고에 적힌 최소값입니다.</p>

      <form className="filters" method="get" action="/">
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
        {filtered && <a className="reset" href="/">초기화</a>}
      </form>

      <p className="result-count">{notices.length.toLocaleString("ko-KR")}건</p>
      {notices.length === 0 ? (
        <p className="empty">조건에 맞는 공고가 없습니다.</p>
      ) : (
        <ul className="card-list">
          {notices.map((n) => <NoticeCard key={n.id} n={n} />)}
        </ul>
      )}
    </>
  );
}
