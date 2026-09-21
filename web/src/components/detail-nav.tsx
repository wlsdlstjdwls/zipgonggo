"use client";

// 긴 상세 지면의 차례(2026-09-14 도입, 2026-09-21 따라붙게 고침).
//
// 공고 상세는 4,000px이 넘는다. 차례가 머리글에만 붙어 있으면 아래에서 다른 섹션으로 가려고
// 맨 위까지 되올라가야 했다 — 헤더 바로 밑에 붙여 두고, 지금 보고 있는 섹션을 표시한다.
//
// 어느 섹션이 "지금"인지는 경계선을 하나 긋고 **그 선을 넘긴 것 중 가장 아래**로 정한다 —
// 읽는 사람의 눈이 있는 자리다.
import { useEffect, useRef, useState } from "react";

export type DetailNavItem = { id: string; label: string };

/** 헤더(60px) + 이 바(59px) 밑으로 조금 더 내려온 자리. 이 선을 지난 섹션이 "지금 읽는 곳" */
const LINE = 148;

export function DetailNav({ items }: { items: DetailNavItem[] }) {
  const [cur, setCur] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const keys = items.map((i) => i.id).join("|");

  useEffect(() => {
    const ids = keys.split("|");
    const pick = () => {
      let now: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= LINE) now = id;
      }
      setCur((prev) => (prev === now ? prev : now));
    };
    // IntersectionObserver는 섹션이 경계를 **넘나드는 순간**에만 울린다 — 단지 목록처럼 한 섹션이
    // 화면보다 길면 그 안을 아무리 굴러도 소식이 없어 표시가 안 바뀐다(2026-09-21 실측).
    // 그래서 스크롤을 듣되 한 프레임에 한 번만 다시 잰다.
    let tick = 0;
    const onScroll = () => {
      if (tick) return;
      tick = requestAnimationFrame(() => {
        tick = 0;
        pick();
      });
    };
    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (tick) cancelAnimationFrame(tick);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [keys]);

  // 좁은 화면에서는 이 줄이 가로로 스크롤된다 — 현재 칩이 잘려 있으면 보이는 자리로 끌어온다
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !cur) return;
    const chip = rail.querySelector<HTMLElement>(`[data-id="${CSS.escape(cur)}"]`);
    if (!chip) return;
    const l = chip.offsetLeft;
    const r = l + chip.offsetWidth;
    if (l < rail.scrollLeft || r > rail.scrollLeft + rail.clientWidth) {
      rail.scrollTo({ left: Math.max(0, l - 16), behavior: "smooth" });
    }
  }, [cur]);

  return (
    <nav className="d-nav" aria-label="이 페이지 차례">
      <div className="d-nav-in" ref={railRef}>
        {items.map((i) => (
          <a
            key={i.id}
            href={`#${i.id}`}
            data-id={i.id}
            className={cur === i.id ? "on" : undefined}
            aria-current={cur === i.id ? "true" : undefined}
          >
            {i.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
