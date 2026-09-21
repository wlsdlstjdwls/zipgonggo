// 관심 공고(★) 서버 동기화. **로그인한 사람에게만 답한다** — 로그아웃 상태에서는
// 예전 그대로 브라우저 localStorage만 쓴다(로그인 없이도 서비스는 그대로 돈다).
//
// GET  → 서버에 담겨 있는 id 묶음
// POST → { op: "add" | "remove", id } 한 건 토글, 또는 { op: "merge", ids } 로그인 직후 한 번
//
// 답은 늘 JSON 한 줄이고 캐시하지 않는다. 사람마다 다른 내용이라 한 번이라도 캐시되면 남의 목록이 보인다.
import { currentUserId } from "@/lib/auth";
import { addSaved, listSavedIds, mergeSaved, removeSaved } from "@/lib/users";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET() {
  const userId = await currentUserId();
  // 401을 주지 않는다 — 로그아웃은 오류가 아니라 정상 상태다. 빈 목록과 「로그인 안 함」을 같이 알려준다
  if (userId === null) return json({ signedIn: false, ids: [] });
  return json({ signedIn: true, ids: await listSavedIds(userId) });
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (userId === null) return json({ signedIn: false }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { op, id, ids } = (body ?? {}) as { op?: string; id?: unknown; ids?: unknown };

  if (op === "merge") {
    if (!Array.isArray(ids)) return json({ error: "ids 없음" }, 400);
    await mergeSaved(userId, ids.filter((v): v is number => typeof v === "number"));
    return json({ ok: true, ids: await listSavedIds(userId) });
  }

  const noticeId = typeof id === "number" ? id : Number.NaN;
  if (!Number.isInteger(noticeId) || noticeId <= 0) return json({ error: "id 없음" }, 400);

  if (op === "add") await addSaved(userId, noticeId);
  else if (op === "remove") await removeSaved(userId, noticeId);
  else return json({ error: "모르는 op" }, 400);

  return json({ ok: true });
}
