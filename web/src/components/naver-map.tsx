"use client";

// 공고 주소 1건을 네이버 지도에 표시한다.
// DB에 좌표가 없어(행안부 요약DB 미승인) 브라우저에서 geocoder 서브모듈로 실시간 변환한다.
// 변환 결과는 어디에도 저장하지 않는다 — CLAUDE.md "하지 말 것 1".
// 스크립트 로드 패턴은 smokespot/src/components/naver-map.tsx 에서 차용.

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const CLIENT_ID = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ?? "";
const SDK = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${CLIENT_ID}&submodules=geocoder`;

type Props = { address: string; title: string };
type State = "loading" | "ready" | "no-key" | "failed";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { naver?: any }
}

export function NaverMap({ address, title }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(CLIENT_ID ? "loading" : "no-key");
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    if (!sdkReady || !el.current || !window.naver?.maps) return;
    const maps = window.naver.maps;
    if (!maps.Service?.geocode) { setState("failed"); return; }
    let cancelled = false;
    maps.Service.geocode({ query: address }, (status: number, res: any) => {
      if (cancelled) return;
      const item = res?.v2?.addresses?.[0];
      if (status !== maps.Service.Status.OK || !item) { setState("failed"); return; }
      const pos = new maps.LatLng(Number(item.y), Number(item.x));
      const map = new maps.Map(el.current!, { center: pos, zoom: 16, zoomControl: true, scaleControl: false, mapDataControl: false });
      new maps.Marker({ position: pos, map, title });
      setState("ready");
    });
    return () => { cancelled = true; };
  }, [sdkReady, address, title]);

  if (state === "no-key") return <p className="map-fallback">지도 키가 설정되지 않았습니다.</p>;
  if (state === "failed") return <p className="map-fallback">주소를 지도에서 찾지 못했습니다. 기관 원문의 위치 안내를 확인하세요.</p>;

  return (
    <>
      <Script src={SDK} strategy="afterInteractive" onReady={() => setSdkReady(true)} onError={() => setState("failed")} />
      <div ref={el} className="map" role="img" aria-label={`${title} 위치 지도`}>
        {state === "loading" && <p className="map-fallback">지도를 불러오는 중…</p>}
      </div>
    </>
  );
}
