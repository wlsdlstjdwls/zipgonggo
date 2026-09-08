"use client";

// 필터 행 — 좌: 칩(마감 7일 내) + 유형 셀렉트 / 우: 정렬 세그먼트. 전부 URL 파라미터(?closing=7d&type=&sort=).
// 부문·시도는 스코프(스코프 바)로 옮겨갔다 — 여긴 스코프 안에서 좁히는 2층 필터만 다룬다(6차 설계).
// basePath로 "/"와 "/area/{시도}" 둘 다에서 쓴다. 셀렉트는 바꾸는 즉시 이동한다.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { areaPath, homePath } from "@/lib/routes";
import type { FilterOption, NoticeFilters } from "@/types/notice";

type Props = {
  f: NoticeFilters;
  /** 유형 옵션만 쓴다. sector·sido는 스코프 바가 담당. */
  options: { type: FilterOption[] };
  closing7: number;
  sticky?: boolean;
  /** 이 필터가 걸리는 스코프. 시도가 있으면 /area/{시도}, 없으면 "/". */
  basePath?: { sido?: string };
};

export function FilterBar({ f, options, closing7, sticky, basePath }: Props) {
  const router = useRouter();
  const buildPath = (patch: NoticeFilters) => (basePath?.sido ? areaPath(basePath.sido, patch) : homePath(patch));
  const base = { ...f, closing: undefined };
  const go = (patch: Partial<NoticeFilters>) => router.push(buildPath({ ...f, ...patch }));

  return (
    <div className={`fbar${sticky ? " sticky" : ""}`}>
      <Link href={buildPath(f.closing ? base : { ...base, closing: "7d" })} className={`chip-f${f.closing ? " on" : ""}`} aria-current={f.closing ? "true" : undefined}>
        마감 7일 내 <small>{closing7}</small>
      </Link>

      <select value={f.type ?? ""} onChange={(e) => go({ type: e.target.value || undefined })} aria-label="공급유형" className={`sel${f.type ? " on" : ""}`}>
        <option value="">전체 유형</option>
        {options.type.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
      </select>
      {f.type && <Link className="reset" href={buildPath({ ...f, type: undefined })}>초기화</Link>}

      <nav className="seg grow" data-on={f.sort ?? "posted"} aria-label="정렬">
        <span className="seg-ind" aria-hidden="true" />
        <Link href={buildPath({ ...f, sort: "deadline" })} className={f.sort === "deadline" ? "on" : ""} aria-current={f.sort === "deadline" ? "true" : undefined}>마감 임박순</Link>
        <Link href={buildPath({ ...f, sort: "posted" })} className={f.sort !== "deadline" ? "on" : ""} aria-current={f.sort !== "deadline" ? "true" : undefined}>최신 공고순</Link>
      </nav>
    </div>
  );
}
