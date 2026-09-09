"use client";

// 스코프 바 — 부문(공공/민간)+시도. 헤더 바로 아래 상시 노출, 필터(FilterBar)보다 상위 범위.
// 부문도 시도도 URL에 남지 않는다 — ListStateProvider가 들고 localStorage에 저장한다(사용자 요청 2026-09-09).
// 목록 화면(홈, /area/{시도})에서만 보인다. 공고 상세에선 스코프를 바꿀 일이 없어 감춘다.
// "부문은 갈림길 페이지를 만들지 않는다"(6차 결정, 민간임대 0건이라 카드 2장이면 절반이 빈 문)는 그대로다.
import { AREA_MIN_COUNT } from "@/lib/constants";
import { SECTORS, type FilterOption, type Sector } from "@/types/notice";
import { useListState } from "./list-state";
import { Select } from "./select";

type Props = { sidoOptions: FilterOption[]; sectorOptions: FilterOption[] };

export function ScopeBar({ sidoOptions, sectorOptions }: Props) {
  const { f, isList, set, setSido } = useListState();
  if (!isList) return null;
  const sido = f.sido;

  // 요약 문구("전체 서울특별시 8건")는 뺐다 — 칩과 시도 셀렉트, 목록 머리의 총 건수가 같은 말을 세 번 한다(2026-09-09)
  const total = sidoOptions.reduce((a, o) => a + o.count, 0);
  const countOf = (s: Sector) => sectorOptions.find((o) => o.value === s)?.count ?? 0;

  return (
    <div className="sbar">
      <button type="button" className={`chip-f${!f.sector ? " on" : ""}`} aria-pressed={!f.sector} onClick={() => set({ sector: undefined })}>
        전체 <small>{total}</small>
      </button>
      {SECTORS.map((s) =>
        s === "민간임대" ? (
          <span key={s} className="chip-f dis" aria-disabled="true" title="수집 준비 중">
            민간임대 <small>준비 중</small>
          </span>
        ) : (
          <button key={s} type="button" className={`chip-f${f.sector === s ? " on" : ""}`} aria-pressed={f.sector === s} onClick={() => set({ sector: s })}>
            {s} <small>{countOf(s)}</small>
          </button>
        ),
      )}

      <Select
        value={sido ?? ""}
        options={sidoOptions.filter((o) => o.count >= AREA_MIN_COUNT).map((o) => ({ value: o.value, label: o.value, count: o.count }))}
        onChange={(v) => setSido(v || undefined)}
        placeholder="전국"
        ariaLabel="시도"
      />
    </div>
  );
}
