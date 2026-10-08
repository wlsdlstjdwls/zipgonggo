"use client";

// 사진이 없는 단지의 「사진과 도면」 자리 — 건물 앞 거리 사진(네이버 로드뷰)을 그 자리에 바로 펼친다(사용자 요청 2026-10-08
// 「사진 없으면 사진 반영」). LH와 지방공사 매입임대, SH 재개발임대처럼 사진을 주는 기관이 없는 단지가 열린 공고의 대부분이다.
//
// 로드뷰는 지도 SDK가 그 자리에서 불러오는 화면일 뿐 우리가 받아 두는 사진이 아니다 — 좌표도 그림도 어디에도 저장하지 않는다
// (CLAUDE.md 하지 말 것 1). 좌표는 단지 상세면 S6가 도로명주소 요약DB로 맞춘 DB 값(notice_complex.geom), 공고 상세면
// 위치 지도와 같이 브라우저에서 실시간 지오코딩한 값이다(저장하지 않는다).
//
// 지면에 들어왔을 때만 연다(IntersectionObserver). 페이지를 열자마자 파노라마를 띄우면 사진 칸까지 내려오지 않는 사람에게도
// 지도 이용량이 나간다. 근처 300m 안에 로드뷰가 없거나 키가 없으면 children(사진 없음 안내)으로 물러난다.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { geocode, hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";
import { usePanorama } from "@/lib/use-panorama";

export function StreetPhoto({ coord, address, name, more, children }: {
  /** DB 좌표(단지 상세). 있으면 지오코딩을 건너뛴다 */
  coord?: LatLng | null;
  /** 좌표가 없는 지면(공고 상세)은 주소를 그 자리에서 좌표로 바꾼다 — 탭 메모리에만 둔다 */
  address?: string | null;
  name: string;
  /** 거리 사진 밑 설명 끝에 붙일 말(평면도는 어디서 보는지) */
  more?: ReactNode;
  children?: ReactNode;
}) {
  const box = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [failed, setFailed] = useState(!(coord || address) || !hasMapKey());

  useEffect(() => {
    const el = box.current;
    if (!el || failed) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [failed]);

  useEffect(() => {
    if (!seen) return;
    let cancelled = false;
    loadNaverMaps()
      .then(async (maps) => {
        const p = coord ?? (address ? await geocode(maps, address) : null);
        if (cancelled) return;
        if (p) setPos(p); else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // coord는 렌더마다 새 객체일 수 있어 숫자만 의존성에 건다
  }, [seen, coord?.lat, coord?.lng, address]); // eslint-disable-line react-hooks/exhaustive-deps

  const pano = usePanorama(host, pos, seen, pos !== null);

  if (failed || pano === "none") return <>{children ?? null}</>;
  return (
    <figure className="street" ref={box}>
      <div className="street-frame">
        <div ref={host} className="canvas" role="img" aria-label={`${name} 앞 거리 사진`} />
        {pano !== "ok" && <p className="map-note">거리 사진을 불러오는 중…</p>}
      </div>
      <figcaption>
        <b>건물 앞 거리 사진</b> 네이버 로드뷰라 찍은 때에 따라 지금 모습과 다를 수 있습니다. 끌어서 둘러볼 수 있습니다. {more}
      </figcaption>
    </figure>
  );
}
