import { notFound } from "next/navigation";
import { getNoticeBySlug, getNoticeComplexes } from "@/lib/queries";
import { complexSegment } from "@/lib/routes";

// 단지 상세의 404 판정. 왜 page가 아니라 layout인지는 (detail)/layout.tsx 머리글 참고 —
// 같은 세그먼트의 loading.tsx보다 layout이 위라서 여기서만 404 코드가 나온다.
// 찾는 규칙은 page.tsx의 load()와 **같아야 한다** — 한쪽만 고치면 가드와 화면이 갈린다.
export default async function ComplexGuardLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ slug: string; complex: string }> },
) {
  const { slug, complex } = await params;
  const n = await getNoticeBySlug(decodeURIComponent(slug));
  if (!n) notFound();
  const siblings = await getNoticeComplexes(n.id);
  const seg = decodeURIComponent(complex);
  // 코드가 붙기 전에 나간 링크(이름만)도 살려 준다 — CLAUDE.md 「URL을 삭제하지 않는다」
  if (!siblings.some((x) => complexSegment(x) === seg || x.name === seg)) notFound();
  return children;
}
