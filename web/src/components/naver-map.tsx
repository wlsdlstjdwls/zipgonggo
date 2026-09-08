"use client";

// 공고 주소 1건을 네이버 지도에 표시한다.
// DB에 좌표가 없어(행안부 요약DB 미승인) 브라우저에서 geocoder 서브모듈로 실시간 변환한다.
// 변환 결과는 어디에도 저장하지 않는다 — CLAUDE.md "하지 말 것 1".
// 스크립트 로드 패턴은 smokespot/src/components/naver-map.tsx 에서 차용.

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { NAVER_MAP_CLIENT_ID, NAVER_MAP_DEFAULT_ZOOM, NAVER_MAP_GEOCODER_TIMEOUT_MS, NAVER_MAP_SDK_URL } from "@/lib/constants";

type Props = { address: string; title: string };
type State = "loading" | "ready" | "no-key" | "failed";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { naver?: any }
}

// maps.js의 onReady 시점엔 서브모듈(maps-geocoder.js)이 아직 안 붙어 있을 수 있다. 붙을 때까지 기다린다.
function waitForGeocoder(timeoutMs = NAVER_MAP_GEOCODER_TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const maps = window.naver?.maps;
      if (maps?.Service?.geocode) return resolve(maps);
      if (Date.now() - started > timeoutMs) return reject(new Error("geocoder timeout"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

export function NaverMap({ address, title }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(NAVER_MAP_CLIENT_ID ? "loading" : "no-key");
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    if (!sdkReady || !el.current) return;
    let cancelled = false;
    let map: any = null;
    waitForGeocoder()
      .then((maps) => {
        if (cancelled) return;
        maps.Service.geocode({ query: address }, (status: number, res: any) => {
          if (cancelled) return;
          const item = res?.v2?.addresses?.[0];
          if (status !== maps.Service.Status.OK || !item || !el.current) { setState("failed"); return; }
          const pos = new maps.LatLng(Number(item.y), Number(item.x));
          map = new maps.Map(el.current, { center: pos, zoom: NAVER_MAP_DEFAULT_ZOOM, zoomControl: true, scaleControl: false, mapDataControl: false });
          new maps.Marker({ position: pos, map, title });
          setState("ready");
        });
      })
      .catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; if (map?.destroy) map.destroy(); };
  }, [sdkReady, address, title]);

  if (state === "no-key") return <p className="map-fallback">지도 키가 설정되지 않았습니다.</p>;
  if (state === "failed") return <p className="map-fallback">주소를 지도에서 찾지 못했습니다. 기관 원문의 위치 안내를 확인하세요.</p>;

  return (
    <>
      <Script src={NAVER_MAP_SDK_URL} strategy="afterInteractive" onReady={() => setSdkReady(true)} onError={() => setState("failed")} />
      <div ref={el} className="map" role="img" aria-label={`${title} 위치 지도`} />
      {state === "loading" && <p className="map-fallback">지도를 불러오는 중…</p>}
    </>
  );
}
