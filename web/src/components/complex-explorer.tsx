"use client";

// 공급 단지 탐색기 — 왼쪽 목록(검색·자치구·건수) + 오른쪽 지도. 벤치마크 docs/references/공고지도2.png.
// 마커·선택 말풍선·panTo·목록↔마커 동기화는 smokespot components/naver-map.tsx 패턴을 가져왔다
// (id별 마커 재사용·signature 갱신, 선택 시 zIndex·아이콘 교체, 콜백은 ref로 받아 마커 재생성 방지).
// 좌표는 페이지 로드 시 브라우저에서 지오코딩해 탭 메모리에만 둔다(저장 금지 — CLAUDE.md 하지 말 것 1).
// 클라이언트 컴포넌트지만 목록은 서버에서 HTML로 렌더되므로 크롤러도 단지명·주소를 본다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geocodeAll, hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";
import { num, wonExact } from "@/lib/format";
import type { NoticeComplex } from "@/types/notice";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = { items: NoticeComplex[]; hasUnits: boolean };
type Phase = "loading" | "ready" | "failed" | "no-key";

const BRAND = "#3d5afe"; // --acc. 마커는 SDK가 그려서 CSS 변수를 못 쓴다
const BRAND_DEEP = "#0f1216"; // --ink. 선택 말풍선
const PIN_W = 34;
const PIN_H = 42;
const PIN_PATH = "M18 43C18 43 3 25 3 16C3 7.716 9.716 1 18 1C26.284 1 33 7.716 33 16C33 25 18 43 18 43Z";
const HOUSE = `<path d="M18 9.5l7 6.2v7.3h-4.6v-4.6h-4.8v4.6H11v-7.3z" fill="${BRAND}"/>`;
const PAN = { duration: 420, easing: "easeOutCubic" };
const SELECT_ZOOM = 15; // 목록에서 고르면 이 줌으로 당겨 본다

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function pinHtml(): string {
  // 100개 넘게 찍히므로 CSS filter·애니메이션은 쓰지 않는다(렌더 부담). 그림자는 SVG 타원 하나
  return `<svg width="${PIN_W}" height="${PIN_H}" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    <ellipse cx="18" cy="42" rx="7" ry="2" fill="rgba(15,18,22,.25)"/>
    <path d="${PIN_PATH}" fill="${BRAND}" stroke="#fff" stroke-width="1.5"/><circle cx="18" cy="16" r="11" fill="#fff"/>${HOUSE}</svg>`;
}

// 선택 마커: 좌표 지점을 width:0 기준점으로 두고 말풍선을 가운데 정렬 — 이름 길이에 따라 핀이 밀리지 않는다 (smokespot)
function balloonHtml(name: string): string {
  return `<div style="position:relative;width:0;height:0;">
    <div style="position:absolute;bottom:4.5px;left:-4.5px;width:9px;height:9px;background:${BRAND_DEEP};transform:rotate(45deg);"></div>
    <div class="zg-marker-pop" style="position:absolute;bottom:9px;left:0;transform:translateX(-50%);display:flex;align-items:center;gap:6px;background:${BRAND_DEEP};border-radius:12px;padding:8px 12px;white-space:nowrap;box-shadow:0 8px 20px -8px rgba(15,18,22,.6);transform-origin:50% 100%;">
      <svg width="14" height="14" viewBox="0 0 36 36"><path d="M18 6l12 10.5v13H21.5v-8h-7v8H6v-13z" fill="#fff"/></svg>
      <span style="font-size:12px;font-weight:700;color:#fff;font-family:inherit;">${esc(name)}</span>
    </div></div>`;
}

function fullAddress(c: NoticeComplex): string {
  return c.sido === "서울특별시" ? `서울특별시 ${c.road_address}` : c.road_address;
}

function guLabel(c: NoticeComplex): string {
  return c.sido === "서울특별시" ? c.sigungu : `${c.sido} ${c.sigungu}`;
}

export function ComplexExplorer({ items, hasUnits }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const listEl = useRef<HTMLUListElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<number, any>>(new Map());
  const sigRef = useRef<Map<number, string>>(new Map());
  const [phase, setPhase] = useState<Phase>(hasMapKey() ? "loading" : "no-key");
  const [progress, setProgress] = useState(0);
  const [coords, setCoords] = useState<Map<string, LatLng | null>>(new Map());
  const [mapReady, setMapReady] = useState(false);
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

  // 2) 지도 생성 — 줌 바 없음, 축척·네이버 로고는 SDK 기본 노출. 빈 곳 클릭이면 선택 해제
  useEffect(() => {
    if (phase !== "ready" || !mapEl.current || mapRef.current) return;
    const maps = window.naver?.maps;
    if (!maps) return;
    const map = new maps.Map(mapEl.current, {
      zoom: 11,
      zoomControl: false,
      scaleControl: true,
      logoControl: true,
      mapDataControl: false,
      logoControlOptions: { position: maps.Position.BOTTOM_LEFT },
      scaleControlOptions: { position: maps.Position.BOTTOM_RIGHT },
    });
    maps.Event.addListener(map, "click", () => setSelected(null));
    mapRef.current = map;
    setMapReady(true);
  }, [phase]);

  // 3) 마커 동기화 — 보이는 항목만. 바뀐 것만 아이콘 교체(smokespot signature 패턴)
  useEffect(() => {
    const map = mapRef.current;
    const maps = window.naver?.maps;
    if (!map || !maps || !mapReady) return;
    const byId = markersRef.current;
    const sigs = sigRef.current;
    const next = new Map<number, { c: NoticeComplex; p: LatLng }>();
    for (const c of visible) {
      const p = coords.get(fullAddress(c));
      if (p) next.set(c.id, { c, p });
    }
    for (const [id, m] of byId) {
      if (!next.has(id)) { m.setMap(null); byId.delete(id); sigs.delete(id); }
    }
    for (const [id, { c, p }] of next) {
      const isSel = id === selected;
      const sig = `${p.lat}:${p.lng}:${isSel}`;
      const icon = isSel
        ? { content: balloonHtml(c.name), anchor: new maps.Point(0, 0) }
        : { content: pinHtml(), anchor: new maps.Point(PIN_W / 2, PIN_H - 1) };
      const existing = byId.get(id);
      if (existing) {
        if (sigs.get(id) !== sig) { existing.setIcon(icon); existing.setZIndex(isSel ? 150 : 100); sigs.set(id, sig); }
        continue;
      }
      const marker = new maps.Marker({ position: new maps.LatLng(p.lat, p.lng), map, title: c.name, icon, zIndex: isSel ? 150 : 100 });
      maps.Event.addListener(marker, "click", () => setSelected((cur) => (cur === id ? null : id)));
      byId.set(id, marker);
      sigs.set(id, sig);
    }
  }, [visible, coords, selected, mapReady]);

  // 4) 필터가 바뀌면 보이는 마커 전체가 들어오게 bounds — 선택 변경 때는 안 움직인다
  useEffect(() => {
    const map = mapRef.current;
    const maps = window.naver?.maps;
    if (!map || !maps || !mapReady) return;
    const pts = visible.map((c) => coords.get(fullAddress(c))).filter((p): p is LatLng => Boolean(p));
    if (pts.length === 0) return;
    if (pts.length === 1) { map.setCenter(new maps.LatLng(pts[0].lat, pts[0].lng)); map.setZoom(15); return; }
    const b = new maps.LatLngBounds();
    for (const p of pts) b.extend(new maps.LatLng(p.lat, p.lng));
    map.fitBounds(b, { top: 48, right: 40, bottom: 40, left: 40 });
  }, [visible, coords, mapReady]);

  // 5) 선택 → 지도 이동 + 목록 스크롤
  useEffect(() => {
    if (selected === null) return;
    const c = items.find((x) => x.id === selected);
    const map = mapRef.current;
    const maps = window.naver?.maps;
    const p = c && coords.get(fullAddress(c));
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (map && maps && p) {
      const target = new maps.LatLng(p.lat, p.lng);
      const zoom = Math.max(map.getZoom(), SELECT_ZOOM);
      // 줌과 팬을 따로 걸면 애니메이션이 서로 끊어 타일·마커가 어긋난다. morph가 둘을 한 번에 한다
      if (reduce || zoom !== map.getZoom()) { map.setZoom(zoom); map.setCenter(target); }
      else map.panTo(target, PAN);
    }
    // scrollIntoView는 창 스크롤까지 건드리고 지도 이동과 겹치면 중간에 끊긴다 — 목록 컨테이너만 직접 옮긴다
    const list = listEl.current;
    const row = list?.querySelector<HTMLElement>(`[data-id="${selected}"]`);
    if (list && row) {
      // .cx-list가 position:relative라 offsetTop은 목록 내용 기준. 행을 목록 가운데에. smooth는 탭이 비활성이면 멈추므로 즉시 이동
      list.scrollTop = Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
    }
  }, [selected, items, coords]);

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

  const found = visible.filter((c) => coords.get(fullAddress(c))).length;

  return (
    <div className="cx">
      <div className="cx-panel">
        <div className="cx-tools">
          <select value={gu} onChange={(e) => { setGu(e.target.value); setSelected(null); }} aria-label="자치구">
            <option value="">자치구 전체</option>
            {gus.map(([g, n]) => <option key={g} value={g}>{g} ({n})</option>)}
          </select>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setSelected(null); }} placeholder="단지명·주소 검색" aria-label="단지명·주소 검색" />
        </div>
        <p className="cx-count"><b>{visible.length}</b> / {items.length}{hasUnits ? "단지" : "곳"}</p>
        <ul className="cx-list" ref={listEl} aria-label="공급 단지 목록" onKeyDown={onListKey}>
          {visible.map((c) => {
            const on = c.id === selected;
            const noPin = phase === "ready" && !coords.get(fullAddress(c));
            return (
              <li key={c.id} data-id={c.id} className={on ? "on" : undefined}>
                <button type="button" onClick={() => onPick(c.id)} aria-pressed={on}>
                  <span className="cx-row-main">
                    <span className="cx-name">{c.name}{c.is_new && <span className="chip new">신규</span>}</span>
                    <span className="cx-addr">{fullAddress(c)}</span>
                  </span>
                  <span className="cx-row-side">
                    <span className="chip">{guLabel(c)}</span>
                    {noPin && <span className="cx-nopin">지도 미표시</span>}
                    {hasUnits && c.unit_count != null && <span className="cx-units">{num(c.unit_count, "호")}</span>}
                    {hasUnits && c.min_deposit != null && <span className="cx-money">보증금 {wonExact(c.min_deposit)}~</span>}
                    {hasUnits && c.min_rent != null && <span className="cx-money">월 {wonExact(c.min_rent)}~</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {visible.length === 0 && <li className="cx-empty">조건에 맞는 단지가 없습니다.</li>}
        </ul>
      </div>
      <div className="cx-map-wrap">
        {phase === "no-key" && <p className="map-fallback">지도 키가 설정되지 않았습니다.</p>}
        {phase === "failed" && <p className="map-fallback">지도를 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>}
        {(phase === "loading" || phase === "ready") && (
          <>
            <div ref={mapEl} className="cx-map" role="img" aria-label="공급 단지 위치 지도" />
            <p className="cx-status">
              {phase === "loading"
                ? `주소 찾는 중 ${progress}/${items.length}`
                : `${found}/${visible.length}곳 표시 · 위치는 도로명주소 기준 근사치. 목록이나 마커를 누르면 선택됩니다.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
