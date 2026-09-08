// 목록 다음 페이지. 첫 페이지는 page.tsx가 서버 렌더하고, 스크롤로 이어지는 페이지만 여기서 받는다.
import { NextResponse } from "next/server";
import { listNoticesPage, PAGE_SIZE, type NoticeFilters, type Sector } from "@/lib/queries";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const sectorRaw = u.searchParams.get("sector");
  const sector = sectorRaw === "공공임대" || sectorRaw === "민간임대" ? (sectorRaw as Sector) : undefined;
  const f: NoticeFilters = {
    sector,
    sido: u.searchParams.get("sido") || undefined,
    type: u.searchParams.get("type") || undefined,
    sort: u.searchParams.get("sort") === "deadline" ? "deadline" : "posted",
  };
  const cursor = u.searchParams.get("cursor") || null;
  const page = await listNoticesPage(f, cursor, PAGE_SIZE);
  return NextResponse.json(page, {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" },
  });
}
