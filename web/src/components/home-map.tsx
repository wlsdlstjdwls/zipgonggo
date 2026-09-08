"use client";

// 홈 지도 — 목록의 공고를 라벨 핀(금액 + D-day)으로 찍는다. 네이버 Web Dynamic Map(CLAUDE.md 고정 선택).
// 좌표는 페이지 로드 시 브라우저에서 지오코딩해 탭 메모리에만 둔다(저장 금지 — CLAUDE.md 하지 말 것 1).
// design/README.md 지도 동작 이식: 라벨 겹치면 뒤 핀은 점(+N 배지), 컨테이너 비례 여백으로 fit, 행 호버 ↔ 핀 포커스.
// 주소가 없는 공고(SH 목록)는 핀이 없다 — 목록에만 뜬다.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ddayChip, moneyOf } from "@/lib/format";
import { geocodeAll, hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";
import { noticePath } from "@/lib/routes";
import type { NoticeListItem } from "@/types/notice";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  items: NoticeListItem[];
  focusId: number | null;
  onFocus: (id: number | null) => void;
  /** 화면(bounds) 안에 들어온 핀 수 — 좌하단 캡슐 */
  onVisible: (n: number) => void;
};
type Phase = "no-key" | "loading" | "ready" | "failed";

const KOREA_CENTER = { lat: 36.4, lng: 127.8 };
const KOREA_ZOOM = 7;
const SINGLE_ZOOM = 13;

function esc(s: string) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function pinHtml(n: NoticeListItem): string {
  const m = moneyOf(n);
  const d = ddayChip(n);
  const hot = d.tone === "hot";
  return `<div class="zg-pin${hot ? " hot" : ""}" data-id="${n.id}"><b>${esc(m ? m.main : n.housing_type)}</b><span>${esc(d.num === "—" ? d.unit : d.num)}</span></div>`;
}

/** 여백은 컨테이너 크기에 비례 — 300px 지도에 고정값을 쓰면 여백이 화면을 다 먹는다 */
function inset(w: number, h: number) {
  return { left: Math.min(100, w * 0.18), right: Math.min(100, w * 0.18), top: Math.min(126, h * 0.22), bottom: Math.min(116, h * 0.2) };
}

export function HomeMap({ items, focusId, onFocus, onVisible }: Props) {
  const router = useRouter();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markers = useRef<Map<number, { marker: any; pos: any }>>(new Map());
  const cb = useRef({ onFocus, onVisible, push: (href: string) => router.push(href) });
  cb.current = { onFocus, onVisible, push: (href: string) => router.push(href) };
  const [phase, setPhase] = useState<Phase>(hasMapKey() ? "loading" : "no-key");
  const [coords, setCoords] = useState<Map<string, LatLng | null>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  const withAddr = useMemo(() => items.filter((n) => n.address), [items]);

  // 1) 지도 생성 (한 번)
  useEffect(() => {
    if (!hasMapKey() || !el.current) return;
    let cancelled = false;
    loadNaverMaps()
      .then((maps) => {
        if (cancelled || !el.current) return;
        const map = new maps.Map(el.current, {
          center: new maps.LatLng(KOREA_CENTER.lat, KOREA_CENTER.lng),
          zoom: KOREA_ZOOM,
          zoomControl: false,
          scaleControl: false,
          mapDataControl: false,
          logoControlOptions: { position: maps.Position.BOTTOM_RIGHT },
        });
        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() => { if (!cancelled) setPhase("failed"); });
    return () => {
      cancelled = true;
      markers.current.forEach(({ marker }) => marker.setMap(null));
      markers.current.clear();
      if (mapRef.current?.destroy) mapRef.current.destroy();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // 2) 주소 → 좌표 (탭 메모리 캐시. 이미 아는 주소는 다시 묻지 않는다)
  useEffect(() => {
    if (!mapReady) return;
    const todo = [...new Set(withAddr.map((n) => n.address as string))].filter((a) => !coords.has(a));
    if (todo.length === 0) { setPhase("ready"); return; }
    let cancelled = false;
    loadNaverMaps()
      .then((maps) => geocodeAll(maps, todo))
      .then((res) => {
        if (cancelled) return;
        setCoords((prev) => { const next = new Map(prev); res.forEach((v, k) => next.set(k, v)); return next; });
        setPhase("ready");
      })
      .catch(() => { if (!cancelled) setPhase("failed"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, withAddr]);

  // 3) 마커 동기화 + fit + 디클러터
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const maps = window.naver.maps;
    const live = new Set<number>();
    let added = 0;
    for (const n of withAddr) {
      const p = coords.get(n.address as string);
      if (!p) continue;
      live.add(n.id);
      if (markers.current.has(n.id)) continue;
      const pos = new maps.LatLng(p.lat, p.lng);
      const marker = new maps.Marker({ position: pos, map, title: n.title, icon: { content: pinHtml(n), anchor: new maps.Point(0, 0) }, zIndex: 100 });
      maps.Event.addListener(marker, "click", () => cb.current.push(noticePath(n.slug)));
      maps.Event.addListener(marker, "mouseover", () => cb.current.onFocus(n.id));
      maps.Event.addListener(marker, "mouseout", () => cb.current.onFocus(null));
      markers.current.set(n.id, { marker, pos });
      added += 1;
    }
    for (const [id, { marker }] of markers.current) {
      if (!live.has(id)) { marker.setMap(null); markers.current.delete(id); added += 1; }
    }

    const size = () => { const s = map.getSize(); return { w: s.width as number, h: s.height as number }; };
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
        const hit = leaders.find((L) => Math.abs(L.x - pt.x) < ((L.w + w) / 2) * 0.92 && Math.abs(L.y - pt.y) < 40);
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

    if (added > 0 && markers.current.size > 0) {
      const { w, h } = size();
      const all = [...markers.current.values()];
      if (all.length === 1) {
        map.setCenter(all[0].pos);
        map.setZoom(SINGLE_ZOOM);
      } else if (w > 0 && h > 0) {
        const b = new maps.LatLngBounds();
        all.forEach(({ pos }) => b.extend(pos));
        map.fitBounds(b, inset(w, h));
      }
    }
    const idle = maps.Event.addListener(map, "idle", settle);
    // 컨테이너 크기가 바뀌면(900px 분기) 지도에 알리고 다시 앉힌다
    const ro = el.current ? new ResizeObserver(() => { maps.Event.trigger(map, "resize"); settle(); }) : null;
    if (ro && el.current) ro.observe(el.current);
    settle();
    return () => { maps.Event.removeListener(idle); ro?.disconnect(); };
  }, [withAddr, coords, mapReady]);

  // 4) 포커스 핀 강조 (행 호버 ↔ 핀)
  useEffect(() => {
    for (const [id, { marker }] of markers.current) {
      const pin: HTMLElement | null = marker.getElement?.()?.querySelector(".zg-pin") ?? null;
      if (!pin) continue;
      const on = id === focusId;
      pin.classList.toggle("is-focus", on);
      marker.setZIndex(on ? 900 : 100);
    }
  }, [focusId, coords]);

  const pinned = withAddr.filter((n) => coords.get(n.address as string)).length;

  return (
    <>
      <div ref={el} className="canvas" role="img" aria-label="공고 위치 지도" />
      {phase === "no-key" && <p className="map-note">지도 키가 설정되지 않았습니다.</p>}
      {phase === "failed" && <p className="map-note">지도를 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>}
      {phase === "ready" && pinned === 0 && withAddr.length === 0 && <p className="map-note">이 목록의 공고는 목록 데이터에 주소가 없어 지도에 표시하지 않습니다. 단지 위치는 각 공고 페이지에서 확인하세요.</p>}
    </>
  );
}
