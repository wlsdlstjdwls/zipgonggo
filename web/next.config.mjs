/** @type {import('next').NextConfig} */
const nextConfig = {
  // URL 식별자에 한글을 쓴다(/area/서울/강동구/천호동).
  // Next는 인코딩된 경로를 그대로 처리하므로 추가 설정은 필요 없고,
  // 슬러그 생성 시 정규화 규칙만 지키면 된다 — docs/url-structure.md 참조.
  trailingSlash: false,

  // 마커 좌표는 클라이언트에서 fetch하지 않고 서버 렌더 HTML에 포함시킨다.
  // 크롤러가 데이터를 봐야 pSEO가 성립한다.
  experimental: {
    // 호실 상세 약 3만 페이지는 generateStaticParams 없이 온디맨드 ISR로 처리한다.
  },
};

export default nextConfig;
