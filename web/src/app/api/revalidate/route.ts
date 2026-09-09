// 파이프라인이 DB를 갱신한 직후 부르는 웹훅 — unstable_cache(REVALIDATE_SEC=1시간)를 즉시 비운다.
// 그 전엔 DB를 고쳐도 시간이 찰 때까지 화면에 안 보였다(사용자 지적 2026-09-09).
// 비밀키(REVALIDATE_SECRET)로만 보호한다 — 공개 라우트라 아무나 못 두드리게.
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { CACHE_TAG_ELIGIBILITY, CACHE_TAG_NOTICE } from "@/lib/constants";

export const preferredRegion = "iad1";

const KNOWN_TAGS = [CACHE_TAG_NOTICE, CACHE_TAG_ELIGIBILITY];

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return NextResponse.json({ error: "REVALIDATE_SECRET이 설정되지 않았다" }, { status: 501 });

  const u = new URL(req.url);
  const given = req.headers.get("x-revalidate-secret") ?? u.searchParams.get("secret");
  if (given !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 본문으로 태그를 좁힐 수 있다({"tags":["eligibility"]}). 없으면 전부.
  const body = (await req.json().catch(() => null)) as { tags?: string[] } | null;
  const tags = body?.tags?.filter((t) => KNOWN_TAGS.includes(t)) ?? KNOWN_TAGS;
  for (const t of tags) revalidateTag(t);
  // unstable_cache 태그는 데이터만 비운다 — 이미 렌더된 페이지(Full Route Cache)는 경로별로 따로 지워야 한다.
  // 동적 경로(공고·단지 상세)가 많아 하나하나 짚기보다 레이아웃 단위로 전체를 다시 그린다.
  revalidatePath("/", "layout");

  return NextResponse.json({ revalidated: tags, at: new Date().toISOString() });
}
