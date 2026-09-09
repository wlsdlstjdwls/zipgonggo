"use client";

// 공급 단지 탐색기 — 왼쪽 목록(검색·자치구·건수) + 오른쪽 브랜드 핀 지도(ComplexMap). 벤치마크 docs/references/공고지도2.png.
// 지도는 먼저 뜨고, 좌표는 브라우저 지오코딩이 끝나면 한 번에 얹는다(탭 메모리만, 저장 금지 — CLAUDE.md 하지 말 것 1).
// 행 호버 ↔ 핀 강조, 행·핀 클릭 → 선택(핀이 이름 라벨로 바뀜, 목록 스크롤, 화면 밖이면 지도 pan). 선택 단지는 로드뷰를 열 수 있다.
// 클라이언트 컴포넌트지만 목록은 서버에서 HTML로 렌더되므로 크롤러도 단지명·주소를 본다.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { noticeComplexPath } from "@/lib/routes";
import { geocodeAll, hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";
import { num, wonExact, wonKo, wonShort } from "@/lib/format";
import type { NoticeComplex } from "@/types/notice";
import { ComplexMap, type MapItem } from "./complex-map";
import { Select } from "./select";

type Props = { items: NoticeComplex[]; hasUnits: boolean; noticeSlug: string };
type Phase = "loading" | "ready" | "failed" | "no-key";

// 핀이 아직 없을 때 첫 화면 — 서울 전역
const SEOUL_CENTER = { lat: 37.5665, lng: 126.978 };
const SEOUL_ZOOM = 11;

function fullAddress(c: NoticeComplex): string {
  return c.sido === "서울특별시" ? `서울특별시 ${c.road_address}` : c.road_address;
}

function guLabel(c: NoticeComplex): string {
  return c.sido === "서울특별시" ? c.sigungu : `${c.sido} ${c.sigungu}`;
}

/** 선택 라벨: 굵게 단지명, 보조로 금액 → 호수 → 자치구 */
function toItem(c: NoticeComplex): MapItem {
  const sub = c.min_rent != null ? `월 ${wonShort(c.min_rent)}`
    : c.min_deposit != null ? `보증금 ${wonShort(c.min_deposit)}`
    : c.unit_count != null ? num(c.unit_count, "호")
    : guLabel(c);
  return { id: c.id, address: fullAddress(c), title: c.name, sub };
}

export function ComplexExplorer({ items, hasUnits, noticeSlug }: Props) {
  const listEl = useRef<HTMLUListElement>(null);
  const [phase, setPhase] = useState<Phase>(hasMapKey() ? "loading" : "no-key");
  const [progress, setProgress] = useState(0);
  const [coords, setCoords] = useState<Map<string, LatLng | null>>(new Map());
  const [focus, setFocus] = useState<number | null>(null);
  const [roadview, setRoadview] = useState(false);
  const [gu, setGu] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const gus = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of items) m.set(guLabel(c), (m.get(guLabel(c)) ?? 0) + 1);
    return [...m.entries()];
  }, [items]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((c) => (!gu || guLabel(c) === gu) && (!needle || `${c.name} ${c.road_address}`.toLowerCase().includes(needle)));
  }, [items, gu, q]);

  // 1) 지오코딩 — 마운트 즉시
  useEffect(() => {
    if (!hasMapKey()) return;
    let cancelled = false;
    setPhase("loading");
    setProgress(0);
    loadNaverMaps()
      .then((maps) => geocodeAll(maps, items.map(fullAddress), (n) => { if (!cancelled) setProgress(n); }))
      .then((r) => { if (!cancelled) { setCoords(r); setPhase("ready"); } })
      .catch(() => { if (!cancelled) setPhase("failed"); });
    return () => { cancelled = true; };
  }, [items]);

  const mapItems = useMemo(() => visible.map(toItem), [visible]);

  // 2) 선택 → 목록 스크롤. 지도 이동은 LabelPinMap이 화면 밖일 때만 한다
  useEffect(() => {
    if (selected === null) return;
    // scrollIntoView는 창 스크롤까지 건드린다 — 목록 컨테이너만 직접 옮긴다
    const list = listEl.current;
    const row = list?.querySelector<HTMLElement>(`[data-id="${selected}"]`);
    if (list && row) {
      // .cx-list가 position:relative라 offsetTop은 목록 내용 기준. 행을 목록 가운데에. smooth는 탭이 비활성이면 멈추므로 즉시 이동
      list.scrollTop = Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
    }
  }, [selected]);

  useEffect(() => { if (selected === null) setRoadview(false); }, [selected]);

  // 필터·검색으로 선택 항목이 빠지면 선택 해제
  useEffect(() => {
    if (selected !== null && !visible.some((c) => c.id === selected)) setSelected(null);
  }, [visible, selected]);

  // 키보드: ↑↓ 이동, Enter 선택 토글, Esc 해제
  const onListKey = useCallback((e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "Escape") { setSelected(null); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = visible.findIndex((c) => c.id === selected);
    const next = e.key === "ArrowDown" ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1);
    const id = visible[next]?.id;
    if (id === undefined) return;
    setSelected(id);
    listEl.current?.querySelector<HTMLElement>(`[data-id="${id}"] button`)?.focus();
  }, [visible, selected]);

  const onPick = useCallback((id: number) => setSelected((cur) => (cur === id ? null : id)), []);
  const onPinFocus = useCallback((id: number | null) => setFocus(id), []);

  const found = visible.filter((c) => coords.get(fullAddress(c))).length;
  // 지도 위 선택 카드 — 로드뷰 토글과 상세 이동을 지도 안에서 끝낸다(사용자 요청 2026-09-08)
  const picked = selected === null ? null : (visible.find((c) => c.id === selected) ?? null);
  const pickedPin = picked ? Boolean(coords.get(fullAddress(picked))) : false;

  return (
    <div className="cx">
      <div className="cx-panel">
        <div className="cx-tools">
          <Select
            value={gu}
            options={gus.map(([g, n]) => ({ value: g, label: g, count: n }))}
            onChange={(v) => { setGu(v); setSelected(null); }}
            placeholder="자치구 전체"
            ariaLabel="자치구"
          />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setSelected(null); }} placeholder="단지명, 주소 검색" aria-label="단지명, 주소 검색" className="fld" />
        </div>
        <p className="cx-count"><b>{visible.length}</b> / {items.length}{hasUnits ? "단지" : "곳"}</p>
        <ul className="cx-list" ref={listEl} aria-label="공급 단지 목록" onKeyDown={onListKey}>
          {visible.map((c) => {
            const on = c.id === selected;
            const noPin = phase === "ready" && !coords.get(fullAddress(c));
            return (
              <li key={c.id} data-id={c.id} className={`${on ? "on" : ""}${focus === c.id ? " is-focus" : ""}`.trim() || undefined}>
                <button type="button" onClick={() => onPick(c.id)} aria-pressed={on} onMouseEnter={() => setFocus(c.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(c.id)} onBlur={() => setFocus(null)}>
                  <span className="cx-row-main">
                    <span className="cx-name">{c.name}{c.is_new && <span className="chip new">신규</span>}</span>
                    <span className="cx-addr">{fullAddress(c)}</span>
                  </span>
                  <span className="cx-row-side">
                    <span className="chip">{guLabel(c)}</span>
                    {noPin && <span className="cx-nopin">지도 미표시</span>}
                    {hasUnits && c.unit_count != null && <span className="cx-units">{num(c.unit_count, "호")}</span>}
                    {hasUnits && c.min_deposit != null && <span className="cx-money" title={wonExact(c.min_deposit)}>보증금 {wonKo(c.min_deposit)}~</span>}
                    {hasUnits && c.min_rent != null && <span className="cx-money" title={wonExact(c.min_rent)}>월 {wonKo(c.min_rent)}~</span>}
                  </span>
                </button>
                <Link href={noticeComplexPath(noticeSlug, c)} className="cx-go" aria-label={`${c.name} 상세`} title={`${c.name} 상세`}>→</Link>
              </li>
            );
          })}
          {visible.length === 0 && <li className="cx-empty">조건에 맞는 단지가 없습니다.</li>}
        </ul>
      </div>
      <div className="cx-map-wrap">
        <div className="cx-map">
          <ComplexMap
            items={mapItems}
            coords={coords}
            focusId={focus}
            selectedId={selected}
            onFocus={onPinFocus}
            onSelect={onPick}
            roadview={roadview}
            center={SEOUL_CENTER}
            zoom={SEOUL_ZOOM}
            ariaLabel="공급 단지 위치 지도"
          />
          {phase === "failed" && <p className="map-note">주소를 찾지 못해 핀을 표시하지 못했습니다.</p>}
          {picked && (
            <div className="cx-card">
              <div className="cx-card-t">
                <b>{picked.name}</b>
                <span>{fullAddress(picked)}</span>
              </div>
              <div className="cx-card-a">
                {pickedPin && (
                  <button type="button" className={`map-btn${roadview ? " on" : ""}`} onClick={() => setRoadview((v) => !v)} aria-pressed={roadview}>
                    {roadview ? "지도" : "로드뷰"}
                  </button>
                )}
                <Link href={noticeComplexPath(noticeSlug, picked)} className="map-btn acc">상세 보기 →</Link>
              </div>
              <button type="button" className="cx-card-x" onClick={() => setSelected(null)} aria-label="선택 해제">✕</button>
            </div>
          )}
        </div>
        <p className="cx-status">
          {phase === "loading"
            ? `주소 찾는 중 ${progress}/${items.length}`
            : phase === "ready"
              ? `${found}/${visible.length}곳 표시. 위치는 도로명주소 기준 근사치입니다. 목록이나 핀을 누르면 이름이 보이고, 로드뷰를 열 수 있습니다.`
              : "위치는 도로명주소 기준 근사치입니다."}
        </p>
      </div>
    </div>
  );
}
