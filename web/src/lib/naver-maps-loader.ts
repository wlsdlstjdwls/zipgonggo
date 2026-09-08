// 네이버 지도 SDK(+geocoder 서브모듈) 1회 로드. 브라우저 전용.
// NaverMap(주소 1건)·ComplexMap(단지 여러 건)이 같은 스크립트를 공유한다.
// 지오코딩 결과는 이 탭의 메모리에만 둔다 — 서버·DB·localStorage 어디에도 저장하지 않는다 (CLAUDE.md 하지 말 것 1).
import { NAVER_MAP_CLIENT_ID, NAVER_MAP_GEOCODER_TIMEOUT_MS, NAVER_MAP_SDK_URL } from "./constants";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { naver?: any }
}

export type LatLng = { lat: number; lng: number };

let loading: Promise<any> | null = null;

export function hasMapKey(): boolean {
  return Boolean(NAVER_MAP_CLIENT_ID);
}

/** maps 네임스페이스. 스크립트 태그를 한 번만 꽂고, geocoder 서브모듈까지 붙을 때까지 기다린다. */
export function loadNaverMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
  if (!NAVER_MAP_CLIENT_ID) return Promise.reject(new Error("no map key"));
  if (window.naver?.maps?.Service?.geocode) return Promise.resolve(window.naver.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const fail = (e: unknown) => { loading = null; reject(e instanceof Error ? e : new Error("naver maps load failed")); };
    if (!document.querySelector(`script[src="${NAVER_MAP_SDK_URL}"]`)) {
      const s = document.createElement("script");
      s.src = NAVER_MAP_SDK_URL;
      s.async = true;
      s.onerror = fail;
      document.head.appendChild(s);
    }
    // maps.js 로드 직후엔 서브모듈(maps-geocoder.js)이 아직 안 붙어 있을 수 있다. 붙을 때까지 폴링
    const started = Date.now();
    const tick = () => {
      const maps = window.naver?.maps;
      if (maps?.Service?.geocode) return resolve(maps);
      if (Date.now() - started > NAVER_MAP_GEOCODER_TIMEOUT_MS) return fail(new Error("geocoder timeout"));
      setTimeout(tick, 100);
    };
    tick();
  });
  return loading;
}

// 탭 메모리 캐시. 같은 주소를 두 번 묻지 않는다. 새로고침하면 사라진다.
const cache = new Map<string, LatLng | null>();

/** 주소 1건 → 좌표. 못 찾으면 null. */
export function geocode(maps: any, address: string): Promise<LatLng | null> {
  const hit = cache.get(address);
  if (hit !== undefined) return Promise.resolve(hit);
  return new Promise((resolve) => {
    maps.Service.geocode({ query: address }, (status: number, res: any) => {
      const item = res?.v2?.addresses?.[0];
      const pos = status === maps.Service.Status.OK && item ? { lat: Number(item.y), lng: Number(item.x) } : null;
      cache.set(address, pos);
      resolve(pos);
    });
  });
}

/** 여러 주소를 동시 n건씩. 진행 콜백으로 "12/138" 표시. */
export async function geocodeAll(
  maps: any,
  addresses: string[],
  onProgress?: (done: number) => void,
  concurrency = 4,
): Promise<Map<string, LatLng | null>> {
  const out = new Map<string, LatLng | null>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < addresses.length) {
      const a = addresses[next++];
      out.set(a, await geocode(maps, a));
      onProgress?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, addresses.length) }, worker));
  return out;
}
