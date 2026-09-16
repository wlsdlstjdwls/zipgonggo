import { notFound } from "next/navigation";
import { getNoticeBySlug } from "@/lib/queries";

// ── 404 상태 코드는 Suspense 경계 **위**에서만 나온다 (2026-09-16, 56차 실측) ────────────────
// notFound()를 어디서 부르든 화면은 not-found.tsx가 그려지지만, 그 자리 위에 Suspense 경계가
// 하나라도 있으면 응답 코드는 200으로 남는다 — 검색엔진이 말하는 soft 404다.
// 경계를 만드는 것은 둘: ① loading.tsx ② 직접 쓴 <Suspense>.
// 그래서 발행 페이지의 "있나 없나" 판정은 **그 세그먼트의 layout**에서 한다 —
// 같은 세그먼트라도 layout은 loading.tsx보다 위다(실측: layout에서 부르면 404, page에서 부르면 200).
//
// 이 파일이 (detail) 그룹 안에 있는 이유: loading.tsx(SkeletonDetail)를 [slug] 바로 밑에 두면
// 그 경계가 형제인 [complex]까지 덮어 단지 페이지가 다시 soft 404가 된다. 그룹은 URL을 바꾸지 않으면서
// 경계만 공고 상세 한 장에 가둔다. **loading.tsx를 이 그룹 밖으로 옮기지 말 것.**
export default async function NoticeGuardLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  // page·generateMetadata가 같은 함수를 부른다 — react cache()라 질의는 한 번뿐이다(lib/queries)
  if (!(await getNoticeBySlug(decodeURIComponent(slug)))) notFound();
  return children;
}
