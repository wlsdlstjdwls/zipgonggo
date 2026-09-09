// 브랜드 마크의 단일 원천. 헤더 로고·지도 마커·파비콘·OG 이미지가 전부 이 글리프에서 파생된다.
// 마크 컨셉: 지붕(집) 아래에 귀가 접힌 공고문 시트(공고). 64×64 좌표계.
// 색은 design/README.md 토큰값과 같다 — SDK 마커·SVG 파일은 CSS 변수를 못 읽어 리터럴로 둔다.
export const BRAND_ACC = "#3d5afe"; // --acc
export const BRAND_INK = "#0f1216"; // --ink
// 금회 신규 공급 핀. 기본 핀(액센트 파랑)은 그대로 두고 이 색만 갈린다(사용자 지적 2026-09-09: 기존 마커는 건드리지 말 것).
// 초록(#0f766e)은 폐기 — 파랑 옆에서 가장 멀리 떨어지는 주황으로.
export const BRAND_NEW = "#ea580c";
export const BRAND_TILE_RADIUS = 16; // 64 기준 25%

/**
 * 마크 글리프(지붕 + 시트 + 접힌 귀 + 글줄 2개). 배경은 그리지 않는다.
 * @param primary 지붕·시트 색  @param contrast 글줄 색(시트 위)
 */
export function markGlyph(primary: string, contrast: string): string {
  return (
    `<path d="M13 33L32 15L51 33" fill="none" stroke="${primary}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M20 31H38.5L45 37.5V50.5A3.5 3.5 0 0 1 41.5 54H23.5A3.5 3.5 0 0 1 20 50.5Z" fill="${primary}"/>` +
    `<path d="M38.5 31V37.5H45Z" fill="${primary}" fill-opacity="0.5"/>` +
    `<path d="M26 42H39M26 47.5H35" stroke="${contrast}" stroke-width="3" stroke-linecap="round"/>`
  );
}

/** 액센트 타일 위 흰 글리프 — 앱 아이콘·헤더 로고. */
export function brandTileSvg(size: number, radius = BRAND_TILE_RADIUS): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" rx="${radius}" fill="${BRAND_ACC}"/>${markGlyph("#fff", BRAND_ACC)}</svg>`;
}

// 지도 마커 — 물방울 핀 안에 흰 원, 그 안에 마크. 100개 넘게 찍혀도 가볍게 SVG 하나로.
export const MARKER_W = 34;
export const MARKER_H = 42;
const MARKER_PATH = "M18 43C18 43 3 25 3 16C3 7.716 9.716 1 18 1C26.284 1 33 7.716 33 16C33 25 18 43 18 43Z";

/** 마커 SVG. fill은 핀 색(기본 액센트, 선택 시 잉크). 앵커는 (MARKER_W/2, MARKER_H-1). */
export function markerSvg(fill = BRAND_ACC): string {
  // 글리프 64 좌표계의 중심(32,33)을 흰 원 중심(18,16)에 맞춰 0.38배
  const s = 0.38;
  const tx = 18 - 32 * s;
  const ty = 16 - 33 * s;
  return (
    `<svg width="${MARKER_W}" height="${MARKER_H}" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg" style="display:block;">` +
    `<ellipse cx="18" cy="42" rx="7" ry="2" fill="rgba(15,18,22,.25)"/>` +
    `<path d="${MARKER_PATH}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>` +
    `<circle cx="18" cy="16" r="11" fill="#fff"/>` +
    `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s})">${markGlyph(fill, "#fff")}</g></svg>`
  );
}

/** 네이버 Marker icon.content용 래퍼. 호버 확대는 globals.css .zg-mk */
export function markerHtml(fill = BRAND_ACC): string {
  return `<div class="zg-mk">${markerSvg(fill)}</div>`;
}

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * 선택 마커 — 잉크색 핀 + 그 위에 꼬리 달린 말풍선(이름 + 보조 글자).
 * 앵커는 평소 핀과 같은 (MARKER_W/2, MARKER_H-1)이라 선택해도 위치가 튀지 않는다. 모양은 globals.css .zg-sel/.zg-bub.
 */
export function bubbleMarkerHtml(title: string, sub: string): string {
  return `<div class="zg-sel"><div class="zg-bub"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>${markerSvg(BRAND_INK)}</div>`;
}
