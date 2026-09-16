"use client";

// 관리자 토큰 입력. 회원 시스템이 없어 아이디 칸도 없다 — `ADMIN_TOKEN` 한 줄이 전부다.
import { useActionState } from "react";
import { signIn, type ActionState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(signIn, null);
  return (
    <form action={action} className="adm-login">
      <h1>관리자 콘솔</h1>
      <p>운영자 토큰을 넣으세요.</p>
      <input
        type="password"
        name="token"
        autoComplete="current-password"
        // 비밀번호 관리자가 채우도록 이름을 준다. 토큰은 서버에만 있고 화면엔 안 돌아온다
        placeholder="ADMIN_TOKEN"
        aria-label="관리자 토큰"
        autoFocus
        required
      />
      <button type="submit" disabled={pending}>
        {pending ? "확인 중" : "들어가기"}
      </button>
      {state && !state.ok && (
        <p className="adm-login-err" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
