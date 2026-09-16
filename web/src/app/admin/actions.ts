"use server";

// 관리자 콘솔이 하는 유일한 「쓰기」 셋 — 로그인 쿠키, 로그아웃, 워크플로 dispatch.
// **DB에는 한 글자도 안 쓴다**(CLAUDE.md 디렉터리 경계: web은 DB를 읽기만 한다).
// 데이터를 고쳐야 하면 pipeline 스테이지를 돌린다 — 그 방아쇠가 여기 runJob이다.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
  adminCreds,
  isAdmin,
  makeSession,
  verifyPassword,
} from "@/lib/admin-auth";
import { dispatchJob, JOBS } from "@/lib/jobs";
import { ROUTES } from "@/lib/routes";

export type ActionState = { ok: boolean; message: string } | null;

// 무차별 대입 억제. 계정이 하나뿐이라 시도 횟수를 막아 둔다.
// 람다 인스턴스마다 따로라 완벽한 방벽은 아니지만(그래서 비밀번호를 길게 잡아야 한다),
// 한 인스턴스에 붙어 반복해 찌르는 흔한 경우는 이걸로 끊긴다.
const WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 10;
const g = globalThis as unknown as { __zipgonggoAdminFails?: number[] };
const fails = (g.__zipgonggoAdminFails ??= []);

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const creds = adminCreds();
  if (!creds) return { ok: false, message: "ADMIN_EMAIL 과 ADMIN_PASSWORD_HASH 가 설정돼 있지 않다" };

  const now = Date.now();
  while (fails.length > 0 && now - fails[0] > WINDOW_MS) fails.shift();
  if (fails.length >= MAX_FAILS) return { ok: false, message: "시도가 너무 잦다. 10분 뒤에 다시" };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  // 이메일이 틀렸어도 비밀번호 검증까지 돌린다 — 먼저 끊으면 응답 시간이 「이 이메일은 있다」를 알려준다.
  // 답도 한 가지로 준다(어느 칸이 틀렸는지 말하지 않는다)
  const passOk = verifyPassword(password, creds.hash);
  if (email !== creds.email || !passOk) {
    fails.push(now);
    return { ok: false, message: "이메일이나 비밀번호가 다르다" };
  }

  fails.length = 0;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, makeSession(creds), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: ROUTES.admin,
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  revalidatePath(ROUTES.admin, "layout");
  return { ok: true, message: "들어왔다" };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: ADMIN_COOKIE, path: ROUTES.admin });
  revalidatePath(ROUTES.admin, "layout");
}

/**
 * 「지금 돌리기」 — GitHub 워크플로를 부른다. 판단(주기가 찼나·이미 도는 중인가)은
 * `/api/cron/{job}`과 **같은 함수**가 한다. 여기서만 force를 쓴다 — 사람이 일부러 누른 것이라
 * 주기를 기다리게 하지 않는다. 다만 이미 도는 중이면 force라도 안 부른다(같이 돌면 서로 덮는다).
 */
export async function runJob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "권한 없음" };

  const name = String(formData.get("job") ?? "");
  if (!JOBS[name]) return { ok: false, message: `모르는 잡: ${name}` };

  const { status, body } = await dispatchJob(name, { force: true });
  revalidatePath(ROUTES.adminIngest);
  revalidatePath(ROUTES.admin);

  if (status === 202) return { ok: true, message: `${JOBS[name].label} 실행을 걸었다` };
  if (status === 200) {
    const skipped = "skipped" in body ? body.skipped : "";
    const why = skipped === "running" ? "이미 도는 중이다" : `건너뛰었다(${skipped})`;
    return { ok: true, message: why };
  }
  return { ok: false, message: "error" in body ? String(body.error) : `실패 ${status}` };
}
