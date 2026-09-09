"use client";

// 상세 화면 머리글이 헤더에 완전히 가리면, 그 정보를 헤더 자리에 서서히 띄운다(사용자 요청 2026-09-09).
// 다시 머리글이 보이면 서서히 사라진다. 스크롤 위치를 매 프레임 재지 않고 IntersectionObserver 하나로 판정한다 —
// 관찰 대상은 머리글 자체가 아니라 그 아래 1px 센티넬이다(머리글이 화면보다 길어도 판정이 흔들리지 않는다).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Trunc } from "./trunc";

type Props = {
  /** 헤더에 띄울 제목 */
  title: string;
  /** 제목 위 작은 줄(공고명·지역 등). 없으면 안 그린다 */
  sub?: string | null;
  /** 상태 한 마디와 색 */
  state?: { label: string; tone: string } | null;
  /** 왼쪽 뒤로가기 */
  back: { href: string; label: string };
  /** 오른쪽 버튼(원문 링크 등) */
  action?: React.ReactNode;
};

export function DetailHeadBar({ title, sub, state, back, action }: Props) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // 헤더(60px)에 물리는 순간이 경계. rootMargin 위쪽을 헤더 높이만큼 깎아 "헤더에 가렸나"를 그대로 묻는다
    const io = new IntersectionObserver(([e]) => setOn(!e.isIntersecting), { rootMargin: "-60px 0px 0px 0px", threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} className="dhb-sentinel" aria-hidden="true" />
      {mounted && createPortal(
        <div className={`dhb${on ? " on" : ""}`} aria-hidden={!on}>
          <div className="dhb-in">
            <Link href={back.href} className="dhb-back" tabIndex={on ? 0 : -1}>{back.label}</Link>
            <span className="dhb-t">
              {sub && <Trunc className="dhb-sub" text={sub} />}
              <Trunc className="dhb-n" text={title} />
            </span>
            {state && <span className={`dhb-s ${state.tone}`}>{state.label}</span>}
            {action && <span className="dhb-a">{action}</span>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
