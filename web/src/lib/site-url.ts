// 절대 URL이 필요한 곳(metadataBase, sitemap, robots, JSON-LD)의 공통 사이트 오리진.
// 프로덕션은 운영 도메인으로 고정 — env가 vercel.app 주소로 남아 canonical이 배포별 주소로 나가는 사고 방지
// (smokespot 2026-08-26 사례). env는 프리뷰/로컬 오버라이드 용도로만 쓴다.
export const PRODUCTION_ORIGIN = "https://zipgonggo.com";

export const SITE_URL =
  process.env.VERCEL_ENV === "production"
    ? PRODUCTION_ORIGIN
    : (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3100"));

/**
 * 경로 → 절대 URL. 홈("/")만은 **끝 슬래시를 떼어** SITE_URL 그대로 돌려준다.
 * Next가 metadata.alternates.canonical을 만들 때 루트를 "https://zipgonggo.com"(슬래시 없음)으로 정규화하는데,
 * 사이트맵·RSS·JSON-LD는 "https://zipgonggo.com/"을 내보내 같은 홈이 두 표기로 갈렸다(2026-09-16 실측).
 * 같은 URL로 정규화되긴 하지만 색인 신호는 글자 그대로 맞춰 두는 게 낫다 — canonical 쪽 표기로 통일한다.
 */
export function absoluteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}
