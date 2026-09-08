"use client";

// 라벨 핀 지도 — 목록의 항목을 라벨 핀(굵은 글자 + 보조 글자)으로 찍는다. 네이버 Web Dynamic Map(CLAUDE.md 고정 선택).
// 홈 지도(2026-09-08 제거)에서 옮겨 온 동작: 라벨 겹치면 뒤 핀은 점(+N 배지), 컨테이너 비례 여백으로 fit,
// 행 호버 ↔ 핀 포커스, 선택 핀은 화면 밖일 때만 panTo(줌은 건드리지 않는다 — 휙휙 이동 방지).
// 지도는 마운트 즉시 만든다. 좌표는 부모가 지오코딩해 넘긴다(탭 메모리만, 저장 금지 — CLAUDE.md 하지 말 것 1).

import { useEffect, useRef, useState } from "react";
import { hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PinItem = {
  id: number;
  address: string;
  title: string;
  /** 핀 굵은 글자 */
  main: string;
  /** 핀 보조 글자 */
  sub: string;
  /** 잉크 배경 강조(신규·마감 임박 등) */
  hot?: boolean;
};

type Props = {
  pins: PinItem[];
  /** 주소 → 좌표. 아직 없으면(undefined) 핀을 찍지 않는다 */
  coords: Map<string, LatLng | null>;
  focusId: number | null;
  selectedId: number | null;
  onFocus: (id: number | null) => void;
  onSelect: (id: number) => void;
  /** 화면(bounds) 안에 들어온 핀 수 — 캡슐 */
  onVisible: (n: number) => void;
  /** 핀이 없을 때 첫 화면 */
  center: LatLng;
  zoom: number;
  ariaLabel: string;
};

const SINGLE_ZOOM = 15;
const PAN = { duration: 420, easing: "easeOutCubic" };

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function pinHtml(p: PinItem): string {
  return `<div class="zg-pin${p.hot ? " hot" : ""}" data-id="${p.id}"><b>${esc(p.main)}</b><span>${esc(p.sub)}</span></div>`;
}

/** 여백은 컨테이너 크기에 비례 — 300px 지도에 고정값을 쓰면 여백이 화면을 다 먹는다 */
function inset(w: number, h: number) {
  return { left: Math.min(100, w * 0.18), right: Math.min(100, w * 0.18), top: Math.min(126, h * 0.22), bottom: Math.min(116, h * 0.2) };
}

export function LabelPinMap({ pins, coords, focusId, selectedId, onFocus, onSelect, onVisible, center, zoom, ariaLabel }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markers = useRef<Map<number, { marker: any; pos: any }>>(new Map());
  const cb = useRef({ onFocus, onSelect, onVisible });
  cb.current = { onFocus, onSelect, onVisible };
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  // 1) 지도 생성 — 마운트 즉시. 지오코딩을 기다리지 않는다
  useEffect(() => {
    if (!hasMapKey() || !el.current) return;
    let cancelled = false;
    loadNaverMaps()
      .then((maps) => {
        if (cancelled || !el.current) return;
        const map = new maps.Map(el.current, {
          center: new maps.LatLng(center.lat, center.lng),
          zoom,
          zoomControl: false,
          scaleControl: true,
          mapDataControl: false,
          logoControlOptions: { position: maps.Position.BOTTOM_RIGHT },
          scaleControlOptions: { position: maps.Position.BOTTOM_RIGHT },
        });
        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      markers.current.forEach(({ marker }) => marker.setMap(null));
      markers.current.clear();
      if (mapRef.current?.destroy) mapRef.current.destroy();
      mapRef.current = null;
      setMapReady(false);
    };
    // 첫 화면 중심·줌은 마운트 때만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 마커 동기화 + fit + 디클러터
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const maps = window.naver.maps;
    const live = new Set<number>();
    let changed = 0;
    for (const p of pins) {
      const c = coords.get(p.address);
      if (!c) continue;
      live.add(p.id);
      if (markers.current.has(p.id)) continue;
      const pos = new maps.LatLng(c.lat, c.lng);
      const marker = new maps.Marker({ position: pos, map, title: p.title, icon: { content: pinHtml(p), anchor: new maps.Point(0, 0) }, zIndex: 100 });
      maps.Event.addListener(marker, "click", () => cb.current.onSelect(p.id));
      maps.Event.addListener(marker, "mouseover", () => cb.current.onFocus(p.id));
      maps.Event.addListener(marker, "mouseout", () => cb.current.onFocus(null));
      markers.current.set(p.id, { marker, pos });
      changed += 1;
    }
    for (const [id, { marker }] of markers.current) {
      if (!live.has(id)) { marker.setMap(null); markers.current.delete(id); changed += 1; }
    }

    const declutter = () => {
      const proj = map.getProjection();
      const leaders: { x: number; y: number; w: number; el: HTMLElement; n: number }[] = [];
      for (const { marker, pos } of markers.current.values()) {
        const wrap: HTMLElement | null = marker.getElement?.() ?? null;
        const pin = wrap?.querySelector<HTMLElement>(".zg-pin");
        if (!pin) continue;
        pin.classList.remove("is-dot");
        pin.querySelector(".zg-pin-more")?.remove();
        const pt = proj.fromCoordToOffset(pos);
        const w = pin.offsetWidth || 110;
        const hit = leaders.find((L) => Math.abs(L.x - pt.x) < ((L.w + w) / 2) * 0.92 && Math.abs(L.y - pt.y) < 48);
        if (hit) { pin.classList.add("is-dot"); hit.n += 1; } else leaders.push({ x: pt.x, y: pt.y, w, el: pin, n: 0 });
      }
      for (const L of leaders) {
        if (L.n === 0) continue;
        const b = document.createElement("span");
        b.className = "zg-pin-more";
        b.textContent = `+${L.n}`;
        L.el.appendChild(b);
      }
    };
    const countVisible = () => {
      const b = map.getBounds();
      let c = 0;
      for (const { pos } of markers.current.values()) if (b.hasLatLng(pos)) c += 1;
      cb.current.onVisible(c);
    };
    const settle = () => { declutter(); countVisible(); };

    // 핀 집합이 바뀌었을 때만 한 번 fit — 호버·선택으로는 움직이지 않는다
    if (changed > 0 && markers.current.size > 0) {
      const s = map.getSize();
      const all = [...markers.current.values()];
      if (all.length === 1) {
        map.setCenter(all[0].pos);
        map.setZoom(SINGLE_ZOOM);
      } else if (s.width > 0 && s.height > 0) {
        const b = new maps.LatLngBounds();
        all.forEach(({ pos }) => b.extend(pos));
        map.fitBounds(b, inset(s.width, s.height));
      }
    }
    const idle = maps.Event.addListener(map, "idle", settle);
    // 컨테이너 크기가 바뀌면(900px 분기) 지도에 알리고 다시 앉힌다
    const ro = el.current ? new ResizeObserver(() => { maps.Event.trigger(map, "resize"); settle(); }) : null;
    if (ro && el.current) ro.observe(el.current);
    settle();
    return () => { maps.Event.removeListener(idle); ro?.disconnect(); };
  }, [pins, coords, mapReady]);

  // 3) 강조 — 호버 중이거나 선택된 핀. 선택 핀이 화면 밖이면 그때만 panTo
  useEffect(() => {
    const map = mapRef.current;
    for (const [id, { marker, pos }] of markers.current) {
      const pin: HTMLElement | null = marker.getElement?.()?.querySelector(".zg-pin") ?? null;
      if (!pin) continue;
      const on = id === focusId || id === selectedId;
      pin.classList.toggle("is-focus", on);
      marker.setZIndex(id === selectedId ? 950 : on ? 900 : 100);
      if (map && id === selectedId && !map.getBounds().hasLatLng(pos)) {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduce) map.setCenter(pos); else map.panTo(pos, PAN);
      }
    }
  }, [focusId, selectedId, coords, mapReady]);

  if (!hasMapKey()) return <p className="map-note">지도 키가 설정되지 않았습니다.</p>;
  return (
    <>
      <div ref={el} className="canvas" role="img" aria-label={ariaLabel} />
      {failed && <p className="map-note">지도를 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>}
    </>
  );
}
