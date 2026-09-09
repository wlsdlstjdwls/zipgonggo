"use client";

// 필터 행 — 좌: 칩(마감 7일 내) + 유형 셀렉트 / 우: 정렬 세그먼트.
// 값은 URL이 아니라 ListStateProvider가 들고 있다(사용자 요청 2026-09-09) — 목록은 /api/notices로 갈아끼운다.
// 부문·시도는 스코프(스코프 바) 담당. 여긴 스코프 안에서 좁히는 2층 필터만 다룬다(6차 설계).
import type { FilterOption } from "@/types/notice";
import { useListState } from "./list-state";
import { Select } from "./select";

type Props = {
  /** 유형 옵션만 쓴다. sector·sido는 스코프 바가 담당. */
  options: { type: FilterOption[] };
  closing7: number;
  sticky?: boolean;
};

export function FilterBar({ options, closing7, sticky }: Props) {
  const { f, set } = useListState();

  return (
    <div className={`fbar${sticky ? " sticky" : ""}`}>
      <button type="button" className={`chip-f${f.closing ? " on" : ""}`} aria-pressed={Boolean(f.closing)} onClick={() => set({ closing: f.closing ? undefined : "7d" })}>
        마감 7일 내 <small>{closing7}</small>
      </button>

      <Select
        value={f.type ?? ""}
        options={options.type.map((o) => ({ value: o.value, label: o.value, count: o.count }))}
        onChange={(v) => set({ type: v || undefined })}
        placeholder="전체 유형"
        ariaLabel="공급유형"
      />
      {f.type && <button type="button" className="reset" onClick={() => set({ type: undefined })}>초기화</button>}

      <nav className="seg grow" data-on={f.sort ?? "posted"} aria-label="정렬">
        <span className="seg-ind" aria-hidden="true" />
        <button type="button" onClick={() => set({ sort: "deadline" })} className={f.sort === "deadline" ? "on" : ""} aria-pressed={f.sort === "deadline"}>마감 임박순</button>
        <button type="button" onClick={() => set({ sort: "posted" })} className={f.sort !== "deadline" ? "on" : ""} aria-pressed={f.sort !== "deadline"}>최신 공고순</button>
      </nav>
    </div>
  );
}
