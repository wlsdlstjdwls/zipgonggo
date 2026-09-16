"use client";

// 운영자 로그인. 계정은 env 두 줄(ADMIN_EMAIL · ADMIN_PASSWORD_HASH)이 전부다 —
// 회원 표도, 가입도, 비밀번호 찾기도 없다. 비밀번호를 바꾸는 길은 해시를 새로 넣고 배포하는 것뿐.
import { useActionState } from "react";
import { signIn, type ActionState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(signIn, null);
  return (
    <form action={action} className="adm-login">
      <h1>관리자 콘솔</h1>
      <p>운영자 계정으로 들어가세요.</p>
      <input
        type="email"
        name="email"
        autoComplete="username"
        placeholder="이메일"
        aria-label="이메일"
        autoFocus
        required
      />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="비밀번호"
        aria-label="비밀번호"
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
