// 관심 공고(★)를 모아 보는 자리. 내용은 브라우저에만 있으므로 서버가 그릴 수 있는 건 껍데기뿐이다.
//
// **색인하지 않는다.** 사람마다 내용이 다르고 크롤러에게는 언제나 빈 화면이다 — 얇은 페이지를
// 발행하지 않는다는 규칙(CLAUDE.md 하지 말 것 4)에 정면으로 걸린다. robots.ts로 막지 않고
// noindex만 다는 이유: 경로를 막아 버리면 크롤러가 이 meta를 읽지도 못한 채 URL만 기억한다.
import type { Metadata } from "next";
import { SavedNotices } from "@/components/saved-notices";

export const metadata: Metadata = {
  title: "관심 공고",
  description: "★로 담아 둔 입주자모집공고를 접수 마감이 가까운 순서로 모아 봅니다.",
  robots: { index: false, follow: true },
};

export default function MyPage() {
  return <SavedNotices />;
}
