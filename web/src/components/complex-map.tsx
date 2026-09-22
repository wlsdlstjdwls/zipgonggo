"use client";

// 단지 지도 — 모든 단지를 같은 브랜드 핀으로 찍고, 선택한 단지만 이름 라벨로 바꾼다. 네이버 Web Dynamic Map(CLAUDE.md 고정 선택).
// 사용자 결정(2026-09-08): 라벨 핀·디클러터(점·+N)는 기준이 안 보여 폐기. 오버레이 칩·캡슐도 없앰. 대신 로드뷰(파노라마).
// 지도는 마운트 즉시 만들고, 좌표는 부모가 지오코딩해 넘긴다(탭 메모리만, 저장 금지 — CLAUDE.md 하지 말 것 1).
// 선택 핀은 화면 밖일 때만 panTo, 줌은 건드리지 않는다(휙휙 이동 방지).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BRAND_ACC, BRAND_NEW, bubbleMarkerHtml, MARKER_H, MARKER_W, markerHtml } from "@/lib/brand";
import { NAVER_MAP_DEFAULT_ZOOM } from "@/lib/constants";
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

/** 단지가 1곳뿐이면 「위치」 지도(NaverMap)와 같은 배율로 — 둘 다 "공고상세"의 같은 지도로 보인다는 지적(2026-09-09) */
const SINGLE_ZOOM = NAVER_MAP_DEFAULT_ZOOM;
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
  const cb = useRef({ onFocus, onSelect, selectedId });
  cb.current = { onFocus, onSelect, selectedId };
  // 마지막으로 pan해 준 선택. 선택이 그대로인데 호버·좌표 갱신으로 효과가 다시 돌 때는 지도를 건드리지 않는다 —
  // 사용자가 끌어서 핀을 화면 밖으로 보낸 뒤 핀에 마우스만 스쳐도 도로 당겨 왔다(사용자 지적 2026-09-14: "제멋대로 계속 움직여")
  const panned = useRef<number | null>(null);
  // 마지막으로 만들어진 fit(). ResizeObserver가 자기 효과에서 늘 최신 것을 부르게 한다
  const fitRef = useRef<(() => void) | null>(null);
  // 지난 번에 확대해 둔 핀. 호버가 바뀔 때 **그 둘만** 손보면 된다 — 138개를 전부 훑지 않는다
  const focused = useRef<number | null>(null);
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
  // useEffect(그리기 다음 틱)이면 첫 페인트에 아직 fitBounds 전
  // (마운트 때 줌 — 좁은 서울 기준)이 한 프레임 비쳤다가 fit 결과로 튀는 게 보였다(사용자 지적 2026-09-09).
  // useLayoutEffect로 같은 커밋의 페인트 전에 끝내 그 프레임 자체를 없앤다.
  useLayoutEffect(() => {
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
    // 핀 전부를 담는 확대·중심 계산 — 컨테이너 실제 크기에 좌우된다. map.getSize()는 지도 생성 시점에
    // SDK 내부에 캐시된 값이라 그 뒤 레이아웃이 자리 잡아도 그대로 낡아 있을 수 있다 — DOM에서 직접 잰다
    // (모바일 주소창이 접히며 높이가 나중에 바뀌는 경우도 포함. "로딩 끝나면 계속 더 축소돼 보인다"는
    // 지적의 원인, 2026-09-09)
    const fit = () => {
      const all = [...markers.current.values()];
      if (all.length === 0) return;
      if (all.length === 1) { map.setCenter(all[0].pos); map.setZoom(SINGLE_ZOOM); return; }
      const box = el.current?.getBoundingClientRect();
      const w = box?.width ?? 0;
      const h = box?.height ?? 0;
      if (w <= 0 || h <= 0) return;
      maps.Event.trigger(map, "resize");
      const b = new maps.LatLngBounds();
      all.forEach(({ pos }) => b.extend(pos));
      map.fitBounds(b, inset(w, h));
      // 단지들이 아주 가까이 모여 있으면 fitBounds가 「위치」 지도보다 더 확대해버린다 — 그 이상은 자른다
      if (map.getZoom() > NAVER_MAP_DEFAULT_ZOOM) map.setZoom(NAVER_MAP_DEFAULT_ZOOM);
    };
    if (changed > 0 && markers.current.size > 0) fit();
    fitRef.current = fit;
  }, [items, coords, split, mapReady]);

  // 2-1) 컨테이너 크기가 바뀌면(900px 분기, 모바일 주소창 접힘) 지도에 알리고, 아직 단지를 고르지 않았으면 다시 fit.
  // 위 효과 안에 있을 땐 목록이 걸러질 때마다 관찰자를 새로 만들었다 끊었다 했다 — 한 글자마다 그 비용이 붙는다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !el.current) return;
    const ro = new ResizeObserver(() => {
      window.naver.maps.Event.trigger(map, "resize");
      if (cb.current.selectedId === null) fitRef.current?.();
    });
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [mapReady]);

  // 3) 선택 → 그 핀만 이름 라벨로, 나머지는 브랜드 핀. 호버 → 핀 살짝 확대.
  //    선택이 새로 잡혔고 그 핀이 화면 밖일 때만 panTo — 그 뒤로는 사용자가 어디로 끌든 따라가지 않는다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const maps = window.naver.maps;
    const byId = new Map(items.map((it) => [it.id, it]));
    const newlySelected = selectedId !== panned.current;
    panned.current = selectedId;

    // 호버 표시는 **바뀐 두 핀만** 손댄다. 전에는 매번 138개를 돌며 getElement().querySelector를 했고,
    // 그 효과가 글자 한 자마다 다시 돌았다(사용자 지적 2026-09-22: "지우는 것도 목록도 느리다")
    const mark = (id: number | null, on: boolean) => {
      if (id === null) return;
      const m = markers.current.get(id);
      const wrap: HTMLElement | null = m?.marker.getElement?.()?.querySelector(".zg-mk") ?? null;
      wrap?.classList.toggle("is-focus", on);
      if (m) m.marker.setZIndex(id === selectedId ? 950 : on ? 900 : 100);
    };
    if (focused.current !== focusId) {
      mark(focused.current, false);
      mark(focusId, true);
      focused.current = focusId;
    }

    // 아이콘 교체와 panTo도 바뀐 핀에만. selected 표시는 마커마다 들고 있으므로 옛 선택을 따로 찾지 않아도 된다
    for (const [id, m] of markers.current) {
      const sel = id === selectedId;
      if (sel === m.selected) continue;
      const it = byId.get(id);
      m.marker.setIcon(sel && it
        ? { content: bubbleMarkerHtml(it.title, it.sub), anchor: new maps.Point(MARKER_W / 2, MARKER_H - 1) }
        : { content: markerHtml(pinFill(it, split)), anchor: new maps.Point(MARKER_W / 2, MARKER_H - 1) });
      m.selected = sel;
      m.marker.setZIndex(sel ? 950 : id === focusId ? 900 : 100);
    }

    const cur = selectedId === null ? null : markers.current.get(selectedId);
    if (cur && newlySelected && !map.getBounds().hasLatLng(cur.pos)) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduce) map.setCenter(cur.pos); else map.panTo(cur.pos, PAN);
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
