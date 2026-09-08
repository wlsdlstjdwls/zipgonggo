// 헤더 로고 마크. lib/brand의 글리프를 인라인 SVG로 — 파비콘·마커와 같은 형태.
import { BRAND_ACC, BRAND_TILE_RADIUS } from "@/lib/brand";

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx={BRAND_TILE_RADIUS} fill={BRAND_ACC} />
      <path d="M13 33L32 15L51 33" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 31H38.5L45 37.5V50.5A3.5 3.5 0 0 1 41.5 54H23.5A3.5 3.5 0 0 1 20 50.5Z" fill="#fff" />
      <path d="M38.5 31V37.5H45Z" fill="#fff" fillOpacity="0.5" />
      <path d="M26 42H39M26 47.5H35" stroke={BRAND_ACC} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
