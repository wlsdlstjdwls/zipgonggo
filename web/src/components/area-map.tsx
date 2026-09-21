"use client";

// 시군구 지도 — 단지 주소가 없는 공고의 「공고 지도」.
//
// LH 매입임대는 호실 주소가 첨부에만 있고 그 첨부를 robots.txt가 막는다(docs/handoff.md 59차).
// 그래서 이 공고들은 지도가 아예 없었다 — "주소는 있는데 왜 지도가 없냐"(사용자 지적 2026-09-21).
// 우리가 아는 가장 좁은 위치는 시군구다. 그 단위로라도 찍어 준다. **구 중심이지 집 위치가 아니라고 밑에 적는다.**
//
// 좌표는 브라우저 지오코더로 그때그때 얻고 어디에도 저장하지 않는다 — CLAUDE.md 「하지 말 것 1」.
// 시군구 이름은 24개 안팎이라 한 탭 안에서 캐시가 잘 먹는다(lib/naver-maps-loader의 Map 캐시).

import { useEffect, useRef, useState } from "react";
import { geocodeAll, hasMapKey, loadNaverMaps } from "@/lib/naver-maps-loader";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AreaPin = { sido: string; sigungu: string; count: number | null };

type State = "loading" | "ready" | "no-key" | "failed";

/** 한 곳뿐이면 fitBounds가 쓸 수 있는 테두리가 없다 — 그때 쓰는 배율 */
const SINGLE_ZOOM = 12;
/** 이름표를 펴 주는 배율. 서울 전체가 보이는 배율에서는 구 이름 24장이 서로를 덮는다 */
const LABEL_ZOOM = 12;
const DOT_MIN = 26;
const DOT_MAX = 52;

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * 호수에 따라 커지는 동그라미(비례기호). 24개를 말풍선으로 띄우면 서로를 덮어 한 장도 못 읽는다 —
 * 숫자만 동그라미 안에 넣고 구 이름은 배율이 올라갔을 때만 밑에 펴 준다.
 * 넓이가 호수에 비례하도록 지름은 제곱근으로 키운다(면적 착시 방지).
 */
function dotHtml(name: string, count: number | null, max: number): { html: string; size: number } {
  const r = max > 0 && count != null ? Math.sqrt(count / max) : 0;
  const size = Math.round(DOT_MIN + (DOT_MAX - DOT_MIN) * r);
  const html =
    `<div class="zg-dot" style="width:${size}px;height:${size}px;font-size:${Math.max(11, Math.round(size / 3.6))}px">` +
    `<b>${count != null ? count.toLocaleString("ko-KR") : "?"}</b>` +
    `<em>${esc(name)}</em></div>`;
  return { html, size };
}

export function AreaMap({ items, label }: { items: AreaPin[]; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>(hasMapKey() ? "loading" : "no-key");

  useEffect(() => {
    if (!hasMapKey() || !el.current) return;
    let cancelled = false;
    let map: any = null;
    const queries = items.map((a) => `${a.sido} ${a.sigungu}`);

    loadNaverMaps()
      .then(async (maps) => {
        const coords = await geocodeAll(maps, queries);
        if (cancelled || !el.current) return;
        const found = items
          .map((a, i) => ({ a, p: coords.get(queries[i]) ?? null }))
          .filter((x): x is { a: AreaPin; p: { lat: number; lng: number } } => x.p !== null);
        if (found.length === 0) { setState("failed"); return; }

        const first = found[0].p;
        map = new maps.Map(el.current, {
          center: new maps.LatLng(first.lat, first.lng),
          zoom: SINGLE_ZOOM,
          zoomControl: false,
          scaleControl: true,
          mapDataControl: false,
          logoControlOptions: { position: maps.Position.BOTTOM_LEFT },
          scaleControlOptions: { position: maps.Position.BOTTOM_RIGHT },
        });

        const max = found.reduce((m, x) => Math.max(m, x.a.count ?? 0), 0);
        const bounds = new maps.LatLngBounds(new maps.LatLng(first.lat, first.lng), new maps.LatLng(first.lat, first.lng));
        for (const { a, p } of found) {
          const pos = new maps.LatLng(p.lat, p.lng);
          const { html, size } = dotHtml(a.sigungu, a.count, max);
          new maps.Marker({
            position: pos, map, title: a.count != null ? `${a.sigungu} ${a.count}호` : a.sigungu,
            icon: { content: html, anchor: new maps.Point(size / 2, size / 2) },
          });
          bounds.extend(pos);
        }
        // 여백(margin)을 주면 한 단계 더 물러나 서울이 인천~양평 사이 점 무리로 쪼그라든다 — 여백 없이 맞춘다
        if (found.length > 1) map.fitBounds(bounds);

        // 이름표는 배율이 올라갔을 때만 — 지도 바깥 컨테이너에 표시를 걸어 CSS가 가른다
        const syncLabels = () => el.current?.parentElement?.classList.toggle("near", map.getZoom() >= LABEL_ZOOM);
        syncLabels();
        maps.Event.addListener(map, "zoom_changed", syncLabels);
        setState("ready");
      })
      .catch(() => { if (!cancelled) setState("failed"); });

    return () => { cancelled = true; if (map?.destroy) map.destroy(); };
    // items는 렌더마다 새 배열이라 내용을 키로 삼는다 — 안 그러면 지도를 부수고 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinsKey(items)]);

  if (state === "no-key") return <p className="map-fallback">지도 키가 설정되지 않았습니다.</p>;
  if (state === "failed") return <p className="map-fallback">지역을 지도에서 찾지 못했습니다. 아래 표로 확인하세요.</p>;

  return (
    <div className="d-map area-map">
      <div ref={el} className="map" role="img" aria-label={label} />
      {state === "loading" && <p className="map-note">지도를 불러오는 중…</p>}
    </div>
  );
}

function pinsKey(items: AreaPin[]): string {
  return items.map((a) => `${a.sido}/${a.sigungu}/${a.count ?? ""}`).join("|");
}
