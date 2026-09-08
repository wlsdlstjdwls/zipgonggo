"use client";

// 로드뷰(네이버 Panorama) 패널 하나를 붙였다 떼는 훅. 공고 지도(ComplexMap)와 단지 지도(NaverMap)가 같이 쓴다.
// SDK가 좌표 반경 300m 안에서 가장 가까운 파노라마를 찾는다. 없으면 "none" — 화면에 안내를 띄운다.
// 좌표는 인자로 받는다(호출부가 실시간 지오코딩한 값). 여기서도 어디에도 저장하지 않는다 — CLAUDE.md 하지 말 것 1.

import { useEffect, useState, type RefObject } from "react";
import type { LatLng } from "./naver-maps-loader";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PanoState = "idle" | "loading" | "ok" | "none";

/** pano_status 이벤트가 안 올 때 판정까지 기다리는 시간 */
const PANO_LOOKUP_MS = 4000;

/**
 * @param hostRef 파노라마를 그릴 div
 * @param pos 볼 위치. null이면 열지 않는다
 * @param open 패널 열림 여부
 * @param ready 지도 SDK 준비 완료(window.naver.maps 사용 가능)
 */
export function usePanorama(hostRef: RefObject<HTMLDivElement | null>, pos: LatLng | null, open: boolean, ready: boolean): PanoState {
  const [state, setState] = useState<PanoState>("idle");
  const lat = pos?.lat ?? null;
  const lng = pos?.lng ?? null;

  useEffect(() => {
    if (!open || !ready || lat === null || lng === null) { setState("idle"); return; }
    const host = hostRef.current;
    const maps = window.naver?.maps;
    if (!host || !maps?.Panorama) { setState("none"); return; }
    setState("loading");
    let cancelled = false;
    const pano = new maps.Panorama(host, {
      position: new maps.LatLng(lat, lng),
      flightSpot: false,
      aroundControl: true,
      zoomControl: false,
      logoControlOptions: { position: maps.Position.BOTTOM_LEFT },
    });
    const listener = maps.Event.addListener(pano, "pano_status", (status: string) => {
      if (!cancelled) setState(status === "OK" ? "ok" : "none");
    });
    const timer = setTimeout(() => {
      if (!cancelled) setState((s) => (s === "loading" ? (pano.getPanoId?.() ? "ok" : "none") : s));
    }, PANO_LOOKUP_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      maps.Event.removeListener(listener);
      if (pano.destroy) pano.destroy();
    };
  }, [hostRef, lat, lng, open, ready]);

  return state;
}
