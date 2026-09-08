"use client";

// 공급 단지 지도 — 클릭했을 때만 브라우저에서 주소를 실시간 지오코딩해 마커로 찍는다.
// 페이지 로드 시 자동으로 부르지 않는다: 접속 1회 = 호출 N회가 되면 무료 한도를 갉아먹는다.
// 좌표는 탭 메모리에만 있다(저장 금지). 행안부 요약DB(S6)가 붙으면 이 컴포넌트는 좌표를 props로 받는 형태로 바뀐다.

import { useEffect, useMemo, useRef, useState } from "react";
import { NAVER_MAP_DEFAULT_ZOOM } from "@/lib/constants";
import { geocodeAll, hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";
import type { NoticeComplex } from "@/types/notice";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = { items: NoticeComplex[] };
type Phase = "idle" | "loading" | "ready" | "failed";

function fullAddress(c: NoticeComplex): string {
  return c.sido === "서울특별시" ? `서울특별시 ${c.road_address}` : c.road_address;
}

function guLabel(c: NoticeComplex): string {
  return c.sido === "서울특별시" ? c.sigungu : `${c.sido} ${c.sigungu}`;
}

export function ComplexMap({ items }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [coords, setCoords] = useState<Map<string, LatLng | null>>(new Map());
  const [gu, setGu] = useState<string>("");

  const gus = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of items) m.set(guLabel(c), (m.get(guLabel(c)) ?? 0) + 1);
    return [...m.entries()];
  }, [items]);

  const visible = useMemo(() => (gu ? items.filter((c) => guLabel(c) === gu) : items), [items, gu]);

  async function open() {
    setPhase("loading");
    setProgress(0);
    try {
      const maps = await loadNaverMaps();
      const result = await geocodeAll(maps, items.map(fullAddress), setProgress);
      setCoords(result);
      setPhase("ready");
    } catch {
      setPhase("failed");
    }
  }

  // 마커 그리기. 자치구 필터가 바뀌면 다시 그린다
  useEffect(() => {
    if (phase !== "ready" || !el.current) return;
    const maps = window.naver?.maps;
    if (!maps) return;
    const pts = visible
      .map((c) => ({ c, p: coords.get(fullAddress(c)) }))
      .filter((x): x is { c: NoticeComplex; p: LatLng } => Boolean(x.p));
    if (!mapRef.current) {
      mapRef.current = new maps.Map(el.current, { zoom: NAVER_MAP_DEFAULT_ZOOM, zoomControl: true, scaleControl: false, mapDataControl: false });
      infoRef.current = new maps.InfoWindow({ borderWidth: 0, disableAnchor: true, backgroundColor: "transparent" });
    }
    const map = mapRef.current;
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    if (pts.length === 0) return;
    const bounds = new maps.LatLngBounds();
    for (const { c, p } of pts) {
      const pos = new maps.LatLng(p.lat, p.lng);
      bounds.extend(pos);
      const marker = new maps.Marker({ position: pos, map, title: c.name });
      maps.Event.addListener(marker, "click", () => {
        infoRef.current.setContent(
          `<div class="map-info"><b>${c.name}${c.is_new ? ' <span class="chip new">신규</span>' : ""}</b><br/>${fullAddress(c)}</div>`,
        );
        infoRef.current.open(map, marker);
      });
      markersRef.current.push(marker);
    }
    if (pts.length === 1) { map.setCenter(bounds.getCenter()); map.setZoom(NAVER_MAP_DEFAULT_ZOOM); }
    else map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
  }, [phase, visible, coords]);

  if (!hasMapKey()) return null;

  if (phase === "idle") {
    return (
      <div className="map-cta">
        <button type="button" className="btn primary" onClick={open}>지도로 보기</button>
        <span className="note" style={{ margin: 0 }}>클릭하면 단지 {items.length}곳 주소를 브라우저에서 찾아 지도에 표시합니다.</span>
      </div>
    );
  }
  if (phase === "failed") return <p className="map-fallback">지도를 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>;

  const found = visible.filter((c) => coords.get(fullAddress(c))).length;
  return (
    <div className="map-panel">
      <div className="card-chips map-tools" role="group" aria-label="자치구">
        <button type="button" className={`chip${gu === "" ? " on" : ""}`} onClick={() => setGu("")}>전체 {items.length}</button>
        {gus.map(([g, n]) => (
          <button key={g} type="button" className={`chip${gu === g ? " on" : ""}`} onClick={() => setGu(g)}>{g} {n}</button>
        ))}
      </div>
      <div ref={el} className="map" role="img" aria-label="공급 단지 위치 지도" />
      <p className="note" style={{ marginTop: 6 }}>
        {phase === "loading"
          ? `주소 찾는 중 ${progress}/${items.length}`
          : `${found}/${visible.length}곳 표시 · 위치는 도로명주소 기준 근사치. 마커를 누르면 단지명이 보입니다.`}
      </p>
    </div>
  );
}
