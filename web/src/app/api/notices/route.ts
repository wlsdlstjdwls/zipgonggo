// 목록 다음 페이지. 첫 페이지는 page.tsx가 서버 렌더하고, 스크롤로 이어지는 페이지만 여기서 받는다.
import { NextResponse } from "next/server";
import { API_CACHE_CONTROL, PAGE_SIZE } from "@/lib/constants";
import { parseNoticeFilters } from "@/lib/notice-filters";
import { listNoticesPage } from "@/lib/queries";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const f = parseNoticeFilters((k) => u.searchParams.get(k));
  const cursor = u.searchParams.get("cursor") || null;
  const page = await listNoticesPage(f, cursor, PAGE_SIZE);
  return NextResponse.json(page, { headers: { "Cache-Control": API_CACHE_CONTROL } });
}
