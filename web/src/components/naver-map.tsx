"use client";

// 공고 주소 1건을 네이버 지도에 표시한다.
// DB에 좌표가 없어(행안부 요약DB 미승인) 브라우저에서 geocoder 서브모듈로 실시간 변환한다.
// 변환 결과는 어디에도 저장하지 않는다 — CLAUDE.md "하지 말 것 1". SDK 로드는 lib/naver-maps-loader 공용.

import { useEffect, useRef, useState } from "react";
import { NAVER_MAP_DEFAULT_ZOOM } from "@/lib/constants";
import { geocode, hasMapKey, loadNaverMaps } from "@/lib/naver-maps-loader";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = { address: string; title: string };
type State = "loading" | "ready" | "no-key" | "failed";

export function NaverMap({ address, title }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(hasMapKey() ? "loading" : "no-key");

  useEffect(() => {
    if (!hasMapKey() || !el.current) return;
    let cancelled = false;
    let map: any = null;
    loadNaverMaps()
      .then(async (maps) => {
        const p = await geocode(maps, address);
        if (cancelled) return;
        if (!p || !el.current) { setState("failed"); return; }
        const pos = new maps.LatLng(p.lat, p.lng);
        map = new maps.Map(el.current, { center: pos, zoom: NAVER_MAP_DEFAULT_ZOOM, zoomControl: false, scaleControl: true, mapDataControl: false });
        new maps.Marker({ position: pos, map, title });
        setState("ready");
      })
      .catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; if (map?.destroy) map.destroy(); };
  }, [address, title]);

  if (state === "no-key") return <p className="map-fallback">지도 키가 설정되지 않았습니다.</p>;
  if (state === "failed") return <p className="map-fallback">주소를 지도에서 찾지 못했습니다. 기관 원문의 위치 안내를 확인하세요.</p>;

  return (
    <>
      <div ref={el} className="map" role="img" aria-label={`${title} 위치 지도`} />
      {state === "loading" && <p className="map-fallback">지도를 불러오는 중…</p>}
    </>
  );
}
