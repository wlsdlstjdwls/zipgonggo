"use client";

// 목록 화면 필터 — 넓은 화면은 왼쪽 고정 레일, 좁은 화면은 바텀시트(사용자 요청 2026-09-09).
// 헤더 아래 전폭 바(ScopeBar)와 칩이 늘어난 필터 행을 대신한다. 상세 화면의 오른쪽 스티키 패널과 같은 골격이다.
// 값은 URL이 아니라 ListStateProvider가 들고 있고, 수량(facets)은 지금 걸린 다른 필터를 반영한 값이다.
// 레일과 시트는 같은 본문(RailBody)을 두 번 그린다 — 어느 쪽이 보일지는 CSS가 정하므로
// 화면 폭을 자바스크립트로 재지 않는다(서버 렌더와 어긋나지 않는다).
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { AREA_MIN_COUNT } from "@/lib/constants";
import { hasFilter } from "@/lib/notice-filters";
import { NOTICE_VIEWS, SECTORS, type NoticeView, type Sector } from "@/types/notice";
import { IconCard, IconCompact, IconList } from "./icons";
import { useListState } from "./list-state";
import { Select } from "./select";

// 보기 전환은 글자를 지우고 아이콘만 남긴다(사용자 요청 2026-09-09).
// 뜻은 title/aria-label이 지고, 모양은 카드 한 장 · 줄 목록 · 촘촘한 줄로 갈린다.
const VIEW_META: Record<NoticeView, { label: string; Icon: typeof IconCard }> = {
  card: { label: "카드", Icon: IconCard },
  list: { label: "목록", Icon: IconList },
  compact: { label: "간략", Icon: IconCompact },
};

function RailBody() {
  const { f, facets, set, setSido, view, setView } = useListState();
  const sido = f.sido;

  // 3건 미만 시도는 감춘다(얇은 페이지 방지와 같은 기준). 지금 고른 시도는 수가 줄어도 남긴다 —
  // 사라지면 셀렉트가 「전국」으로 보여 화면과 상태가 어긋난다
  const sidoOptions = facets.sido.filter((o) => o.count >= AREA_MIN_COUNT || o.value === sido);
  if (sido && !sidoOptions.some((o) => o.value === sido)) sidoOptions.unshift({ value: sido, count: 0 });
  const typeOptions = [...facets.type];
  if (f.type && !typeOptions.some((o) => o.value === f.type)) typeOptions.unshift({ value: f.type, count: 0 });

  const countOf = (s: Sector) => facets.sector.find((o) => o.value === s)?.count ?? 0;

  return (
    <>
      {/* 「무엇을 보느냐」가 아니라 「어떻게 보느냐」 — 조건 위에 한 줄로 묶는다.
          예전엔 목록 위 얇은 바(filter-bar)였는데 좁은 화면에서 두 줄로 넘쳤다(사용자 요청 2026-09-09) */}
      <div className="rail-g rail-view">
        <h3>보기</h3>
        <div className="viewsw" role="group" aria-label="목록 보기">
          {NOTICE_VIEWS.map((v) => {
            const { label, Icon } = VIEW_META[v];
            return (
              <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} aria-label={label} title={label} onClick={() => setView(v)}>
                <Icon />
              </button>
            );
          })}
        </div>
      </div>

      <div className="rail-g">
        <h3>정렬</h3>
        <div className="rail-chips">
          <button type="button" className={`chip-f${f.sort === "deadline" ? " on" : ""}`} aria-pressed={f.sort === "deadline"} onClick={() => set({ sort: "deadline" })}>마감 임박순</button>
          <button type="button" className={`chip-f${f.sort !== "deadline" ? " on" : ""}`} aria-pressed={f.sort !== "deadline"} onClick={() => set({ sort: "posted" })}>최신 공고순</button>
        </div>
      </div>

      <div className="rail-g">
        <h3>부문</h3>
        <div className="rail-chips">
          <button type="button" className={`chip-f${!f.sector ? " on" : ""}`} aria-pressed={!f.sector} onClick={() => set({ sector: undefined })}>
            전체 <small>{facets.total}</small>
          </button>
          {SECTORS.map((s) => (
            <button key={s} type="button" className={`chip-f${f.sector === s ? " on" : ""}`} aria-pressed={f.sector === s} onClick={() => set({ sector: s })}>
              {s} <small>{countOf(s)}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="rail-g">
        <h3>지역</h3>
        <Select
          value={sido ?? ""}
          options={sidoOptions.map((o) => ({ value: o.value, label: o.value, count: o.count }))}
          onChange={(v) => setSido(v || undefined)}
          placeholder="전국"
          ariaLabel="시도"
        />
      </div>

      <div className="rail-g">
        <h3>공급유형</h3>
        <Select
          value={f.type ?? ""}
          options={typeOptions.map((o) => ({ value: o.value, label: o.value, count: o.count }))}
          onChange={(v) => set({ type: v || undefined })}
          placeholder="전체 유형"
          ariaLabel="공급유형"
        />
      </div>

      <div className="rail-g">
        <h3>접수</h3>
        <div className="rail-chips">
          <button type="button" className={`chip-f${f.closing ? " on" : ""}`} aria-pressed={Boolean(f.closing)} onClick={() => set({ closing: f.closing ? undefined : "7d" })}>
            마감 7일 내 <small>{facets.closing7}</small>
          </button>
          {/* 마감 공고는 기본으로 감춘다(사용자 요청 2026-09-09). URL은 살아 있고 목록에서만 빠진다 */}
          <button type="button" className={`chip-f${f.closed ? " on" : ""}`} aria-pressed={Boolean(f.closed)} onClick={() => set({ closed: f.closed ? undefined : true })}>
            마감 포함
          </button>
        </div>
      </div>
    </>
  );
}

export function FilterRail() {
  const { f, facets, reset } = useListState();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const close = useCallback(() => setOpen(false), []);

  // 시트가 열린 동안은 뒤 목록이 따라 스크롤되지 않게 잠근다. Esc로도 닫는다.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [open]);

  // 시트 버튼에 붙는 배지 — 지금 몇 개가 걸려 있나. 정렬은 조건이 아니라 세지 않는다
  const active = [f.sector, f.sido, f.type, f.closing, f.closed].filter(Boolean).length;
  const summary = [f.sido ?? "전국", f.type ?? "전체 유형", f.closing ? "마감 7일 내" : null].filter(Boolean).join(" | ");
  const on = hasFilter(f);
  // 시트 확인 버튼의 수 — 부문이 걸렸으면 그 부문 수가 곧 결과 수다
  const shown = f.sector ? (facets.sector.find((o) => o.value === f.sector)?.count ?? facets.total) : facets.total;

  return (
    <>
      <aside className="rail" aria-label="목록 필터">
        <div className="rail-in">
          <RailBody />
          {on && <button type="button" className="rail-reset" onClick={reset}>필터 초기화</button>}
        </div>
      </aside>

      {/* 좁은 화면 전용 — 레일 자리에 버튼 한 줄만 두고 조건은 시트에서 고른다 */}
      <div className="fsheet-bar">
        <button type="button" className="fsheet-open" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          필터{active > 0 && <em>{active}</em>}
        </button>
        <span className="fsheet-sum">{summary}</span>
      </div>

      {mounted && open && createPortal(
        <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="목록 필터">
          <button type="button" className="sheet-scrim" aria-label="필터 닫기" onClick={close} />
          <div className="sheet">
            <div className="sheet-h">
              <span className="sheet-grip" aria-hidden="true" />
              <b>필터</b>
              <button type="button" className="sheet-x" onClick={close} aria-label="닫기">✕</button>
            </div>
            <div className="sheet-b">
              <RailBody />
            </div>
            <div className="sheet-f">
              <button type="button" className="btn lg" onClick={reset} disabled={!on}>초기화</button>
              <button type="button" className="btn ink lg" onClick={close}>{shown}건 보기</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
