"use client";

// 필터 행 — 좌: 칩 4개(전체·공공임대·민간임대·마감 7일 내) + 시도·유형 셀렉트 / 우: 정렬 세그먼트.
// 전부 URL 파라미터(?sector=&closing=7d&sido=&type=&sort=). 셀렉트는 바꾸는 즉시 이동한다.
// 칩 카운트는 서비스 전체 집계(KPI와 같은 기준).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { homePath } from "@/lib/routes";
import { SECTORS, type FilterOption, type NoticeFilters, type Sector } from "@/types/notice";

type Props = {
  f: NoticeFilters;
  options: { sector: FilterOption[]; sido: FilterOption[]; type: FilterOption[] };
  closing7: number;
  sticky?: boolean;
};

export function FilterBar({ f, options, closing7, sticky }: Props) {
  const router = useRouter();
  const total = options.sector.reduce((a, o) => a + o.count, 0);
  const countOf = (s: Sector) => options.sector.find((o) => o.value === s)?.count ?? 0;
  const base = { ...f, sector: undefined, closing: undefined };
  const go = (patch: Partial<NoticeFilters>) => router.push(homePath({ ...f, ...patch }));
  const allOn = !f.sector && !f.closing;

  return (
    <div className={`fbar${sticky ? " sticky" : ""}`}>
      <Link href={homePath(base)} className={`chip-f${allOn ? " on" : ""}`} aria-current={allOn ? "true" : undefined}>전체 <small>{total}</small></Link>
      {SECTORS.map((s) => (
        <Link key={s} href={homePath({ ...base, sector: s })} className={`chip-f${f.sector === s ? " on" : ""}`} aria-current={f.sector === s ? "true" : undefined}>
          {s} <small>{countOf(s)}</small>
        </Link>
      ))}
      <Link href={homePath(f.closing ? base : { ...base, closing: "7d" })} className={`chip-f${f.closing ? " on" : ""}`} aria-current={f.closing ? "true" : undefined}>
        마감 7일 내 <small>{closing7}</small>
      </Link>

      <select value={f.sido ?? ""} onChange={(e) => go({ sido: e.target.value || undefined })} aria-label="시도" className={`sel${f.sido ? " on" : ""}`}>
        <option value="">전체 지역</option>
        {options.sido.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
      </select>
      <select value={f.type ?? ""} onChange={(e) => go({ type: e.target.value || undefined })} aria-label="공급유형" className={`sel${f.type ? " on" : ""}`}>
        <option value="">전체 유형</option>
        {options.type.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
      </select>
      {(f.sido || f.type) && <Link className="reset" href={homePath({ ...f, sido: undefined, type: undefined })}>초기화</Link>}

      <nav className="seg grow" data-on={f.sort ?? "posted"} aria-label="정렬">
        <span className="seg-ind" aria-hidden="true" />
        <Link href={homePath({ ...f, sort: "deadline" })} className={f.sort === "deadline" ? "on" : ""} aria-current={f.sort === "deadline" ? "true" : undefined}>마감 임박순</Link>
        <Link href={homePath({ ...f, sort: "posted" })} className={f.sort !== "deadline" ? "on" : ""} aria-current={f.sort !== "deadline" ? "true" : undefined}>최신 공고순</Link>
      </nav>
    </div>
  );
}
