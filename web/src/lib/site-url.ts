// 절대 URL이 필요한 곳(metadataBase, sitemap, robots, JSON-LD)의 공통 사이트 오리진.
// 프로덕션은 운영 도메인으로 고정 — env가 vercel.app 주소로 남아 canonical이 배포별 주소로 나가는 사고 방지
// (smokespot 2026-08-26 사례). env는 프리뷰/로컬 오버라이드 용도로만 쓴다.
export const PRODUCTION_ORIGIN = "https://zipgonggo.com";

export const SITE_URL =
  process.env.VERCEL_ENV === "production"
    ? PRODUCTION_ORIGIN
    : (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3100"));

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}
