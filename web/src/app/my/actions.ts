"use server";

// 로그인한 사람이 제 계정에 하는 두 가지 — 로그아웃과 탈퇴.
//
// **web이 DB에 쓰는 자리는 원래 /api/track 하나였다.** 회원 기능을 두면서 예외를 하나 더 열었고
// (사용자 결정 2026-09-21), 그 쓰기는 전부 lib/users.ts에 모여 있다. 여기서는 그 함수만 부른다.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUserId, USER_COOKIE } from "@/lib/auth";
import { deleteUser } from "@/lib/users";
import { ROUTES } from "@/lib/routes";

async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: USER_COOKIE, path: "/" });
}

export async function signOut(): Promise<void> {
  await clearSession();
  revalidatePath("/", "layout");
  redirect(ROUTES.home);
}

/**
 * 회원 탈퇴. 행을 지우고 쿠키를 버린다 — 관심 공고는 CASCADE로 같이 사라진다.
 *
 * **카카오 쪽 「연결 끊기」까지는 못 한다.** 그건 액세스 토큰이 있어야 부를 수 있는데
 * 우리는 토큰을 저장하지 않는다(lib/kakao.ts). 대신 화면에서 카카오 설정으로 가는 길을 안내한다 —
 * 토큰을 보관해 두는 편이 이용자에게 더 나쁜 거래라고 봤다.
 */
export async function withdraw(): Promise<void> {
  const id = await currentUserId();
  if (id !== null) await deleteUser(id);
  await clearSession();
  revalidatePath("/", "layout");
  redirect(`${ROUTES.home}?bye=1`);
}
