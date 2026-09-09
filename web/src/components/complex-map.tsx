"use client";

// 단지 지도 — 모든 단지를 같은 브랜드 핀으로 찍고, 선택한 단지만 이름 라벨로 바꾼다. 네이버 Web Dynamic Map(CLAUDE.md 고정 선택).
// 사용자 결정(2026-09-08): 라벨 핀·디클러터(점·+N)는 기준이 안 보여 폐기. 오버레이 칩·캡슐도 없앰. 대신 로드뷰(파노라마).
// 지도는 마운트 즉시 만들고, 좌표는 부모가 지오코딩해 넘긴다(탭 메모리만, 저장 금지 — CLAUDE.md 하지 말 것 1).
// 선택 핀은 화면 밖일 때만 panTo, 줌은 건드리지 않는다(휙휙 이동 방지).

import { useEffect, useRef, useState } from "react";
import { BRAND_ACC, BRAND_NEW, bubbleMarkerHtml, MARKER_H, MARKER_W, markerHtml } from "@/lib/brand";
import { hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";
import { usePanorama } from "@/lib/use-panorama";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MapItem = { id: number; address: string; title: string; sub: string;
  /** 금회 신규 공급 단지. 핀 색이 갈린다(사용자 요청 2026-09-09) */ isNew?: boolean };

/** 핀 색 — 기본은 액센트. 신규와 재공급이 섞인 공고에서 신규만 주황으로 갈린다 */
function pinFill(it: { isNew?: boolean } | undefined, split: boolean): string {
  return split && it?.isNew ? BRAND_NEW : BRAND_ACC;
}

type Props = {
  items: MapItem[];
  /** 주소 → 좌표. 아직 없으면(undefined) 핀을 찍지 않는다 */
  coords: Map<string, LatLng | null>;
  focusId: number | null;
  selectedId: number | null;
  onFocus: (id: number | null) => void;
  onSelect: (id: number) => void;
  /** 로드뷰 패널 열림 여부(부모가 토글). 닫기는 지도 위 선택 카드가 맡는다 */
  roadview: boolean;
  /** 신규와 재공급이 한 공고에 섞여 있나. 섞였을 때만 핀 색을 가른다 */
  split: boolean;
  center: LatLng;
  zoom: number;
  ariaLabel: string;
};

const SINGLE_ZOOM = 15;
const PAN = { duration: 420, easing: "easeOutCubic" };

/** 여백은 컨테이너 크기에 비례 — 300px 지도에 고정값을 쓰면 여백이 화면을 다 먹는다 */
function inset(w: number, h: number) {
  return { left: Math.min(80, w * 0.14), right: Math.min(80, w * 0.14), top: Math.min(90, h * 0.16), bottom: Math.min(70, h * 0.14) };
}

export function ComplexMap({ items, coords, focusId, selectedId, onFocus, onSelect, roadview, split, center, zoom, ariaLabel }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const panoEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markers = useRef<Map<number, { marker: any; pos: any; selected: boolean }>>(new Map());
  const cb = useRef({ onFocus, onSelect });
  cb.current = { onFocus, onSelect };
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
          logoControlOptions: { position: maps.Position.BOTTOM_LEFT },
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

  // 2) 마커 동기화 + 핀 집합이 바뀌었을 때만 한 번 fit
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const maps = window.naver.maps;
    const live = new Set<number>();
    let changed = 0;
    for (const it of items) {
      const c = coords.get(it.address);
      if (!c) continue;
      live.add(it.id);
      if (markers.current.has(it.id)) continue;
      const pos = new maps.LatLng(c.lat, c.lng);
      const marker = new maps.Marker({
        position: pos, map, title: it.title, zIndex: 100,
        icon: { content: markerHtml(pinFill(it, split)), anchor: new maps.Point(MARKER_W / 2, MARKER_H - 1) },
      });
      maps.Event.addListener(marker, "click", () => cb.current.onSelect(it.id));
      maps.Event.addListener(marker, "mouseover", () => cb.current.onFocus(it.id));
      maps.Event.addListener(marker, "mouseout", () => cb.current.onFocus(null));
      markers.current.set(it.id, { marker, pos, selected: false });
      changed += 1;
    }
    for (const [id, { marker }] of markers.current) {
      if (!live.has(id)) { marker.setMap(null); markers.current.delete(id); changed += 1; }
    }
    if (changed > 0 && markers.current.size > 0) {
      const s = map.getSize();
      const all = [...markers.current.values()];
      if (all.length === 1) { map.setCenter(all[0].pos); map.setZoom(SINGLE_ZOOM); }
      else if (s.width > 0 && s.height > 0) {
        const b = new maps.LatLngBounds();
        all.forEach(({ pos }) => b.extend(pos));
        map.fitBounds(b, inset(s.width, s.height));
      }
    }
    // 컨테이너 크기가 바뀌면(900px 분기) 지도에 알린다
    const ro = el.current ? new ResizeObserver(() => maps.Event.trigger(map, "resize")) : null;
    if (ro && el.current) ro.observe(el.current);
    return () => ro?.disconnect();
  }, [items, coords, split, mapReady]);

  // 3) 선택 → 그 핀만 이름 라벨로, 나머지는 브랜드 핀. 호버 → 핀 살짝 확대. 선택 핀이 화면 밖이면 그때만 panTo
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const maps = window.naver.maps;
    const byId = new Map(items.map((it) => [it.id, it]));
    for (const [id, m] of markers.current) {
      const sel = id === selectedId;
      if (sel !== m.selected) {
        const it = byId.get(id);
        m.marker.setIcon(sel && it
          ? { content: bubbleMarkerHtml(it.title, it.sub), anchor: new maps.Point(MARKER_W / 2, MARKER_H - 1) }
          : { content: markerHtml(pinFill(it, split)), anchor: new maps.Point(MARKER_W / 2, MARKER_H - 1) });
        m.selected = sel;
      }
      m.marker.setZIndex(sel ? 950 : id === focusId ? 900 : 100);
      const wrap: HTMLElement | null = m.marker.getElement?.()?.querySelector(".zg-mk") ?? null;
      wrap?.classList.toggle("is-focus", id === focusId);
      if (sel && !map.getBounds().hasLatLng(m.pos)) {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduce) map.setCenter(m.pos); else map.panTo(m.pos, PAN);
      }
    }
  }, [items, focusId, selectedId, coords, split, mapReady]);

  // 4) 로드뷰 — 선택 단지 좌표에서 가장 가까운 파노라마(SDK가 반경 300m 탐색). 없으면 "로드뷰 없음"
  const selAddress = selectedId === null ? null : (items.find((i) => i.id === selectedId)?.address ?? null);
  const panoState = usePanorama(panoEl, selAddress ? (coords.get(selAddress) ?? null) : null, roadview, mapReady);

  if (!hasMapKey()) return <p className="map-note">지도 키가 설정되지 않았습니다.</p>;
  return (
    <>
      <div ref={el} className="canvas" role="img" aria-label={ariaLabel} />
      {failed && <p className="map-note">지도를 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>}
      <div className="pano" hidden={!roadview}>
        <div ref={panoEl} className="canvas" role="img" aria-label="선택한 단지 로드뷰" />
        {panoState === "loading" && <p className="map-note">로드뷰를 찾는 중…</p>}
        {panoState === "none" && <p className="map-note">이 위치 근처에는 로드뷰가 없습니다.</p>}
      </div>
    </>
  );
}
