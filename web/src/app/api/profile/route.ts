// 저장해 둔 「내 조건」 서버 사본. **로그인한 사람에게만 답한다** —
// 로그아웃 상태에서는 예전 그대로 브라우저에만 둔다(로그인 없이도 서비스는 그대로 돈다).
//
// GET    → { signedIn, sync, profile, updatedAt }  sync는 「서버에 행이 있나」다
// PUT    → { profile } 한 벌을 넣거나 고친다. 이게 곧 계정 저장 켜기다
// DELETE → 서버 사본만 지운다(계정 저장 끄기). 브라우저 값은 그대로 남는다
//
// 답은 늘 JSON 한 줄이고 캐시하지 않는다. 사람마다 다른 내용이라 한 번이라도 캐시되면 남의 조건이 보인다.
//
// **들어온 값을 그대로 믿지 않는다.** sanitizeProfile(…, false)이 모르는 키를 버리고, 수치를 화면과 같은
// 범위로 자르고, 건강과 이어지는 칸을 떨군다. 브라우저도 보내기 전에 한 번 거르지만 그건 편의고 여기가 문이다.
//
// 시행일(PROFILE_SYNC_START) 전에는 **쓰기를 받지 않는다**. 개인정보처리방침 개정이 시행되기 전에
// 값이 먼저 들어오면 「방침에 없는 수집」이 된다. 화면도 그 전에는 스위치를 그리지 않지만, 문도 같이 잠근다.
import { PROFILE_SYNC_START } from "@/lib/constants";
import { currentUserId } from "@/lib/auth";
import { sanitizeProfile } from "@/lib/profile";
import { clearProfile, getProfile, putProfile } from "@/lib/users";
import { PRIVACY_AMENDED_DATE } from "@/components/privacy-content";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

/** 오늘(KST)이 시행일에 닿았나. 닿기 전에는 서버가 조건을 받지 않는다 */
function syncOpen(): boolean {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  return today >= PROFILE_SYNC_START;
}

export async function GET() {
  const userId = await currentUserId();
  // 401을 주지 않는다 — 로그아웃은 오류가 아니라 정상 상태다(/api/saved와 같은 태도)
  if (userId === null) return json({ signedIn: false, sync: false, profile: null, updatedAt: null });

  const row = await getProfile(userId);
  if (!row) return json({ signedIn: true, sync: false, profile: null, updatedAt: null });
  return json({
    signedIn: true,
    sync: true,
    profile: sanitizeProfile(row.data, false),
    updatedAt: row.updated_at,
  });
}

export async function PUT(req: Request) {
  const userId = await currentUserId();
  if (userId === null) return json({ signedIn: false }, 401);
  if (!syncOpen()) return json({ error: `계정 저장은 ${PROFILE_SYNC_START}부터 열립니다` }, 409);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { profile } = (body ?? {}) as { profile?: unknown };
  if (!profile || typeof profile !== "object") return json({ error: "profile 없음" }, 400);

  const clean = sanitizeProfile(profile, false);
  const updatedAt = await putProfile(userId, clean, PRIVACY_AMENDED_DATE);
  return json({ ok: true, updatedAt });
}

export async function DELETE() {
  const userId = await currentUserId();
  if (userId === null) return json({ signedIn: false }, 401);
  await clearProfile(userId);
  return json({ ok: true });
}
