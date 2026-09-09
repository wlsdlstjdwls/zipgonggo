"use client";

// 주소 1건 지도 — 단지 상세·공고 상세의 「위치」 섹션.
// DB에 좌표가 없어(행안부 요약DB 미승인) 브라우저에서 geocoder 서브모듈로 실시간 변환한다.
// 변환 결과는 어디에도 저장하지 않는다 — CLAUDE.md "하지 말 것 1". SDK 로드는 lib/naver-maps-loader 공용.
// 마커는 말풍선(이름 + 보조 글자)으로 띄우고, 누르면 로드뷰가 열린다. 지도 위 버튼도 같은 토글(사용자 요청 2026-09-08).

import { useCallback, useEffect, useRef, useState } from "react";
import { bubbleMarkerHtml, MARKER_H, MARKER_W } from "@/lib/brand";
import { NAVER_MAP_DEFAULT_ZOOM } from "@/lib/constants";
import { geocode, hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";
import { usePanorama } from "@/lib/use-panorama";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = { address: string; title: string; sub?: string };
type State = "loading" | "ready" | "no-key" | "failed";

export function NaverMap({ address, title, sub = "" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const panoEl = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(hasMapKey() ? "loading" : "no-key");
  const [coord, setCoord] = useState<LatLng | null>(null);
  const [roadview, setRoadview] = useState(false);
  const toggle = useCallback(() => setRoadview((v) => !v), []);
  const cb = useRef(toggle);
  cb.current = toggle;

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
        const marker = new maps.Marker({
          position: pos, map, title,
          icon: { content: bubbleMarkerHtml(title, sub), anchor: new maps.Point(MARKER_W / 2, MARKER_H - 1) },
        });
        // 마커 클릭 = 로드뷰 토글. 핀만 덩그러니 있고 눌러도 아무 일 없는 게 이상하다는 지적(2026-09-08)
        maps.Event.addListener(marker, "click", () => cb.current());
        setCoord(p);
        setState("ready");
      })
      .catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; if (map?.destroy) map.destroy(); };
  }, [address, title, sub]);

  const panoState = usePanorama(panoEl, coord, roadview, state === "ready");

  if (state === "no-key") return <p className="map-fallback">지도 키가 설정되지 않았습니다.</p>;
  if (state === "failed") return <p className="map-fallback">주소를 지도에서 찾지 못했습니다. 기관 원문의 위치 안내를 확인하세요.</p>;

  return (
    <>
      {/* 준비되기 전엔 투명 — 타일이 그려지는 순간을 부드러운 페이드로 가린다(사용자 지적 2026-09-09) */}
      <div ref={el} className={`map${state === "ready" ? " ready" : ""}`} role="img" aria-label={`${title} 위치 지도`} />
      {state === "loading" && <p className="map-fallback">지도를 불러오는 중…</p>}
      <div className="pano" hidden={!roadview}>
        <div ref={panoEl} className="canvas" role="img" aria-label={`${title} 로드뷰`} />
        {panoState === "loading" && <p className="map-note">로드뷰를 찾는 중…</p>}
        {panoState === "none" && <p className="map-note">이 위치 근처에는 로드뷰가 없습니다.</p>}
      </div>
      {state === "ready" && (
        <button type="button" className={`map-btn float${roadview ? " on" : ""}`} onClick={toggle} aria-pressed={roadview}>
          {roadview ? "지도" : "로드뷰"}
        </button>
      )}
    </>
  );
}
