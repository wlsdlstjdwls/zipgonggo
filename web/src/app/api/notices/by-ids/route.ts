// 저장(★)해 둔 공고를 id 묶음으로 받아 오는 자리. /my 화면만 쓴다.
//
// 저장 목록은 브라우저 localStorage에만 있다(서버에 사용자가 없다) — 그래서 화면이 id를 들고 와
// 여기에 묻는 구조가 된다. 개인 목록이므로 **캐시하지 않는다**: 공유 캐시에 남으면
// 남의 저장 목록이 다른 사람에게 그대로 나갈 수 있다.
import { NextResponse } from "next/server";
import { SAVED_MAX_IDS } from "@/lib/constants";
import { listNoticesByIds } from "@/lib/queries";
import type { NoticeListItem } from "@/types/notice";

export const preferredRegion = "iad1";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** "12,7,999" → [12, 7, 999]. 숫자가 아닌 값·중복은 버리고 상한에서 끊는다 */
function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of raw.split(",")) {
    const n = Number(part);
    if (!Number.isSafeInteger(n) || n <= 0 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= SAVED_MAX_IDS) break;
  }
  return out;
}

export async function GET(req: Request) {
  const ids = parseIds(new URL(req.url).searchParams.get("ids"));
  const items: NoticeListItem[] = ids.length ? await listNoticesByIds(ids) : [];
  return NextResponse.json({ items }, { headers: NO_STORE });
}
