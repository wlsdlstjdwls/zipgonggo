"use client";

// 페이지 밑 「용어 설명」 묶음 — 기본은 접힌 상태다(사용자 요청 2026-09-09).
// 본문 용어 링크(.term)를 누르면 여기가 펴지면서 그 항목으로 부드럽게 내려간다.
// 링크 처리는 위임(document click)으로 한다 — <Term>은 서버 컴포넌트로 남겨야 상세 페이지의 클라이언트 경계가 번지지 않는다.
// 접혀 있어도 dl은 DOM(HTML)에 그대로 있다 — 크롤러는 설명 본문을 읽는다.

import { useCallback, useEffect, useState } from "react";
import { glossaryFor, glossaryId } from "@/lib/glossary";

type Jump = { id: string; n: number };

export function GlossaryList({ terms }: { terms: readonly string[] }) {
  const items = glossaryFor(terms);
  const [open, setOpen] = useState(false);
  const [jump, setJump] = useState<Jump | null>(null);

  const go = useCallback((id: string) => {
    setOpen(true);
    setJump((j) => ({ id, n: (j?.n ?? 0) + 1 }));
  }, []);

  // 본문 용어 링크 클릭 — 기본 해시 점프(즉시 튐) 대신 펴고 부드럽게
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a.term") as HTMLAnchorElement | null;
      const id = a?.getAttribute("href")?.slice(1);
      if (!id || !document.getElementById(id)) return;
      e.preventDefault();
      history.replaceState(null, "", `#${id}`);
      go(id);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [go]);

  // 해시를 달고 들어온 링크(#g-3)도 같은 자리로 연다
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id.startsWith("g-") && document.getElementById(id)) go(id);
  }, [go]);

  // 펴진 뒤에 옮긴다 — 접힌 채로 scrollIntoView하면 접힌 자리(높이 0)로 간다
  useEffect(() => {
    if (!jump) return;
    const r = requestAnimationFrame(() => {
      const el = document.getElementById(jump.id);
      if (!el) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      el.classList.add("hit");
      window.setTimeout(() => el.classList.remove("hit"), 1800);
    });
    return () => cancelAnimationFrame(r);
  }, [jump]);

  if (items.length === 0) return null;
  return (
    <section className={`dsec gloss${open ? " on" : ""}`}>
      <h2>
        <button type="button" className="gloss-t" aria-expanded={open} aria-controls="gloss-l" onClick={() => setOpen((v) => !v)}>
          용어 설명<em>{items.length}</em>
          <i aria-hidden="true" />
        </button>
      </h2>
      <dl id="gloss-l" className="gloss-l" hidden={!open}>
        {items.map((g) => (
          <div key={g.term} id={glossaryId(g.term)}>
            <dt>{g.term}</dt>
            <dd>{g.def}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
