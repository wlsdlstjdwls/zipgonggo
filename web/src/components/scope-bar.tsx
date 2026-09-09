"use client";

// 스코프 바 — 부문(공공/민간)+시도. 헤더 바로 아래 상시 노출, 필터(FilterBar)보다 상위 범위.
// 부문은 쿼리(?sector=), 시도는 경로(/area/{시도})로 다르다 — "부문은 갈림길 페이지를 만들지 않는다"(6차 결정,
// 민간임대 0건이라 카드 2장이면 절반이 빈 문). 저장은 여기서 하지 않는다 — ScopeSync가 URL을 보고 기억한다.
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AREA_MIN_COUNT } from "@/lib/constants";
import { areaPath, homePath } from "@/lib/routes";
import { SECTORS, type FilterOption, type NoticeClosing, type NoticeSort, type Sector } from "@/types/notice";

type Props = { sidoOptions: FilterOption[]; sectorOptions: FilterOption[] };

function sidoFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/area\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

function isSector(v: string | null): v is Sector {
  return v === "공공임대" || v === "민간임대";
}

export function ScopeBar({ sidoOptions, sectorOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sido = sidoFromPath(pathname);
  const sector = isSector(searchParams.get("sector")) ? (searchParams.get("sector") as Sector) : undefined;
  const rest = {
    type: searchParams.get("type") ?? undefined,
    closing: searchParams.get("closing") === "7d" ? ("7d" as NoticeClosing) : undefined,
    sort: searchParams.get("sort") === "deadline" ? ("deadline" as NoticeSort) : undefined,
  };

  const total = sidoOptions.reduce((a, o) => a + o.count, 0);
  const countOf = (s: Sector) => sectorOptions.find((o) => o.value === s)?.count ?? 0;
  const scopeCount = sido ? sidoOptions.find((o) => o.value === sido)?.count ?? 0 : total;

  const hrefFor = (nextSido: string | undefined, nextSector: Sector | undefined) => {
    const f = { ...rest, sector: nextSector };
    return nextSido ? areaPath(nextSido, f) : homePath(f);
  };

  return (
    <div className="sbar">
      <p className="sbar-txt">
        {sector ?? "전체"} <b>{sido ?? "전국"}</b> <span>{scopeCount}건</span>
      </p>

      <Link href={hrefFor(sido, undefined)} className={`chip-f${!sector ? " on" : ""}`}>
        전체 <small>{total}</small>
      </Link>
      {SECTORS.map((s) =>
        s === "민간임대" ? (
          <span key={s} className="chip-f dis" aria-disabled="true" title="수집 준비 중">
            민간임대 <small>준비 중</small>
          </span>
        ) : (
          <Link key={s} href={hrefFor(sido, s)} className={`chip-f${sector === s ? " on" : ""}`}>
            {s} <small>{countOf(s)}</small>
          </Link>
        ),
      )}

      <select
        value={sido ?? ""}
        onChange={(e) => {
          router.push(hrefFor(e.target.value || undefined, sector));
        }}
        aria-label="시도"
        className={`sel${sido ? " on" : ""}`}
      >
        <option value="">전국</option>
        {sidoOptions.filter((o) => o.count >= AREA_MIN_COUNT).map((o) => (
          <option key={o.value} value={o.value}>{o.value} ({o.count})</option>
        ))}
      </select>
    </div>
  );
}
