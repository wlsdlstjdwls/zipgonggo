"use client";

// 카카오 로그인 칸. 약관과 방침에 동의해야 버튼이 열린다.
//
// **체크 없이 누르면 아무 일도 안 일어나는 화면을 만들지 않는다** — 왜 안 눌리는지 한 줄로 말해 준다.
// (smokespot에서 disabled 버튼이 클릭을 삼켜 「로그인이 안 된다」로 보였던 일을 그대로 피한다)
import Link from "next/link";
import { useState } from "react";
import { kakaoStartPath, ROUTES } from "@/lib/routes";

const BENEFITS = [
  {
    title: "관심 공고가 기기를 넘어 남습니다",
    desc: "휴대폰에서 담아 둔 공고를 데스크탑에서 그대로 봅니다",
  },
  {
    title: "브라우저를 지워도 목록이 남습니다",
    desc: "지금까지는 이 브라우저에만 있어서 사이트 데이터를 지우면 함께 사라졌습니다",
  },
  {
    title: "받아 가는 것은 별명과 프로필 사진뿐입니다",
    desc: "전화번호도 주소도 묻지 않습니다. 탈퇴하면 그 자리에서 지웁니다",
  },
] as const;

export function LoginPanel({ next, ready, failed }: { next: string; ready: boolean; failed: boolean }) {
  const [agreed, setAgreed] = useState(false);
  const [hint, setHint] = useState(false);

  return (
    <div className="login">
      <h1>집공고 로그인</h1>
      <p className="login-sub">카카오 계정으로 3초 만에 시작합니다. 따로 만들 아이디도 비밀번호도 없습니다.</p>

      <ul className="login-why">
        {BENEFITS.map((b) => (
          <li key={b.title}>
            <b>{b.title}</b>
            <span>{b.desc}</span>
          </li>
        ))}
      </ul>

      {failed && (
        <p className="login-err" role="alert">
          로그인을 끝내지 못했습니다. 다시 시도해 주세요.
        </p>
      )}

      {ready ? (
        <>
          <label className="login-agree">
            <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setHint(false); }} />
            <span>
              <Link href={ROUTES.terms}>이용약관</Link>과 <Link href={ROUTES.privacy}>개인정보처리방침</Link>에
              동의합니다
            </span>
          </label>

          {agreed ? (
            <a className="login-kakao" href={kakaoStartPath(next)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 3C6.48 3 2 6.48 2 10.8c0 2.76 1.85 5.19 4.63 6.61-.2.75-.73 2.74-.84 3.16-.13.51.19.5.4.37.16-.1 2.6-1.77 3.66-2.49.7.1 1.42.15 2.15.15 5.52 0 10-3.48 10-7.8S17.52 3 12 3z" />
              </svg>
              카카오로 로그인
            </a>
          ) : (
            <button type="button" className="login-kakao off" onClick={() => setHint(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 3C6.48 3 2 6.48 2 10.8c0 2.76 1.85 5.19 4.63 6.61-.2.75-.73 2.74-.84 3.16-.13.51.19.5.4.37.16-.1 2.6-1.77 3.66-2.49.7.1 1.42.15 2.15.15 5.52 0 10-3.48 10-7.8S17.52 3 12 3z" />
              </svg>
              카카오로 로그인
            </button>
          )}
          {hint && <p className="login-hint" role="alert">약관에 동의해야 로그인할 수 있습니다.</p>}
        </>
      ) : (
        <p className="login-hint">로그인은 준비 중입니다. 조금 뒤에 다시 들러 주세요.</p>
      )}

      <p className="login-foot">
        로그인하지 않아도 공고 열람과 계산기는 그대로 쓸 수 있습니다.{" "}
        <Link href={ROUTES.home}>그냥 둘러보기</Link>
      </p>
    </div>
  );
}
