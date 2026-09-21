"use client";

// 카카오 로그인 칸. 약관과 방침에 동의해야 버튼이 열린다.
//
// **체크 없이 누르면 아무 일도 안 일어나는 화면을 만들지 않는다** — 왜 안 눌리는지 한 줄로 말해 준다.
// (smokespot에서 disabled 버튼이 클릭을 삼켜 「로그인이 안 된다」로 보였던 일을 그대로 피한다)
import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "./brand-mark";
import { IconClock, IconDevices, IconShield, IconStar } from "./icons";
import { kakaoStartPath, ROUTES } from "@/lib/routes";

// 아이콘은 글자를 거드는 자리다 — 뜻이 아이콘에만 실리면 안 된다(그래서 aria-hidden).
//
// **말하는 것은 로그인이 아니라 공고다**(사용자 지적 2026-09-21: 「로그인 얘기만 써 놨다」).
// 「세션이 어디에 남는가」는 우리 사정이고, 이용자가 얻는 건 공고를 담고 마감을 놓치지 않는 것이다.
// 이 세 칸만 반말로 쓴다(사용자 결정) — 나머지 지면은 존댓말 그대로다.
const BENEFITS = [
  {
    icon: IconStar,
    title: "눈에 든 공고, 별 하나로 담아 둔다",
    desc: "목록에서 ★만 누르면 끝. 다음에 다시 뒤져 찾을 일이 없다",
  },
  {
    icon: IconClock,
    title: "마감 가까운 순으로 쌓아 준다",
    desc: "담아 둔 공고를 접수 마감이 임박한 순서로 보여준다. 신청일을 놓치고 지나가는 일을 줄인다",
  },
  {
    icon: IconDevices,
    title: "폰에서 담고 컴퓨터에서 이어 본다",
    desc: "출근길에 담아 둔 공고를 집에서 그대로 연다. 브라우저를 정리해도 목록은 남는다",
  },
] as const;

export function LoginPanel({ next, ready, failed }: { next: string; ready: boolean; failed: boolean }) {
  const [agreed, setAgreed] = useState(false);
  const [hint, setHint] = useState(false);

  return (
    <div className="login">
      <h1>
        <BrandMark size={30} />
        집공고 로그인
      </h1>
      <p className="login-sub">카카오로 3초면 시작한다.</p>

      <ul className="login-why">
        {BENEFITS.map(({ icon: Icon, title, desc }) => (
          <li key={title}>
            <span className="login-why-ico" aria-hidden="true"><Icon /></span>
            <div>
              <b>{title}</b>
              <span>{desc}</span>
            </div>
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

      <p className="login-privacy">
        <IconShield width={15} height={15} aria-hidden="true" />
        받아 가는 건 별명 하나. 프로필 사진과 이메일은 선택이고, 전화번호와 주소는 안 묻는다. 탈퇴하면 그 자리에서 지운다
      </p>

      <p className="login-foot">
        로그인하지 않아도 공고 열람과 계산기는 그대로 쓸 수 있습니다.{" "}
        <Link href={ROUTES.home}>그냥 둘러보기</Link>
      </p>
    </div>
  );
}
