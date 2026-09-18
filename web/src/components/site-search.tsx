"use client";

// 헤더 검색칸. 공고 이름·단지 이름·지역을 한 칸에서 받는다.
//
// 지금까지 목록을 좁히는 길은 왼쪽 필터 레일뿐이었다 — 「고덕리엔파크」를 아는 사람이 들어올 문이 없었다.
// 여는 순간 목록 전체를 다시 그리지 않는다: 여기서 고르는 건 **갈 곳**이고, 필터 상태(ListStateProvider)는 건드리지 않는다.
//
// 접근성은 combobox + listbox 패턴 — ↑↓ 이동, Enter 이동, Esc 닫기, 바깥 클릭 닫기.
// 아무것도 고르지 않고 Enter를 치면 /search 지면으로 간다(드롭다운은 갈래마다 다섯 줄만 보여 준다).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ROUTES, noticeComplexPath, noticePath, searchPath } from "@/lib/routes";
import { SEARCH_MIN_LEN } from "@/lib/search";
import { regionShort } from "@/lib/sido";
import type { SearchResult } from "@/types/notice";

/** 타이핑이 멎고 이만큼 지나야 쏜다. 한 글자마다 쏘면 왕복이 타이핑을 따라오지 못한다 */
const DEBOUNCE_MS = 180;

const EMPTY: SearchResult = { q: "", shortcuts: [], notices: [], complexes: [] };

/** 키보드 이동용으로 세 갈래를 한 줄로 편다. 화면 순서와 같아야 ↑↓가 눈과 맞는다 */
type Row = { href: string; label: string };

function flatten(r: SearchResult): Row[] {
  return [
    ...r.shortcuts.map((s) => ({ href: s.href, label: s.label })),
    ...r.notices.map((n) => ({ href: noticePath(n.slug), label: n.title })),
    ...r.complexes.map((c) => ({ href: noticeComplexPath(c.notice_slug, c), label: c.name })),
  ];
}

export function SiteSearch() {
  const router = useRouter();
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);

  const term = q.trim();
  const ready = term.length >= SEARCH_MIN_LEN;
  const rows = flatten(res);

  // 타이핑 → 조회. 앞선 요청은 버린다(AbortController) — 느린 응답이 나중에 도착해 새 결과를 덮는 걸 막는다
  useEffect(() => {
    if (!ready) {
      setRes(EMPTY);
      setBusy(false);
      return;
    }
    const ac = new AbortController();
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${ROUTES.apiSearch}?q=${encodeURIComponent(term)}`, { signal: ac.signal });
        if (!r.ok) throw new Error(String(r.status));
        setRes((await r.json()) as SearchResult);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setRes(EMPTY);
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [term, ready]);

  // 새 결과가 오면 활성 줄을 처음으로 되돌린다 — 안 그러면 사라진 줄을 가리킨 채 Enter를 먹는다
  useEffect(() => setActive(-1), [res]);

  // 바깥 클릭 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function go(href: string) {
    setOpen(false);
    input.current?.blur();
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      setOpen(true);
      // -1은 「아무것도 안 고름」 자리 — 여기서 Enter를 치면 /search 지면으로 간다. 양끝에서 그 자리로 돌아온다
      if (e.key === "ArrowDown") setActive((i) => (i + 1 >= rows.length ? -1 : i + 1));
      else setActive((i) => (i - 1 < -1 ? rows.length - 1 : i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && rows[active]) go(rows[active].href);
      else if (term) go(searchPath(term));
    }
  }

  const showPanel = open && ready;
  const nothing = !busy && rows.length === 0;

  return (
    <div className="site-search" ref={wrap}>
      <svg className="ss-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.6-3.6" />
      </svg>
      <input
        ref={input}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="단지, 공고, 지역 찾기"
        aria-label="공고와 단지 검색"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        enterKeyHint="search"
      />
      {showPanel && (
        <div className="ss-panel" id={listId} role="listbox" aria-label="검색 결과">
          {res.shortcuts.length > 0 && (
            <section>
              <b>바로 가기</b>
              {res.shortcuts.map((s, i) => (
                <SsRow key={s.key} href={s.href} on={active === i} onPick={go} title={s.label} meta={s.sub} tail={`${s.count}건`} />
              ))}
            </section>
          )}
          {res.notices.length > 0 && (
            <section>
              <b>공고</b>
              {res.notices.map((n, i) => (
                <SsRow
                  key={n.id}
                  href={noticePath(n.slug)}
                  on={active === res.shortcuts.length + i}
                  onPick={go}
                  title={n.title}
                  meta={`${n.agency} | ${regionShort(n)} | ${n.housing_type}`}
                />
              ))}
            </section>
          )}
          {res.complexes.length > 0 && (
            <section>
              <b>단지</b>
              {res.complexes.map((c, i) => (
                <SsRow
                  key={c.id}
                  href={noticeComplexPath(c.notice_slug, c)}
                  on={active === res.shortcuts.length + res.notices.length + i}
                  onPick={go}
                  title={c.name}
                  meta={c.road_address || regionShort(c)}
                  tail={c.closed ? "마감" : undefined}
                />
              ))}
            </section>
          )}
          {nothing ? (
            <p className="ss-none">「{term}」에 걸리는 공고나 단지가 없다. 띄어쓰기를 빼고 이름 일부만 쳐 보세요.</p>
          ) : (
            <Link className="ss-all" href={searchPath(term)} onClick={() => setOpen(false)}>
              「{term}」 검색 결과 전부 보기 →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function SsRow({ href, on, onPick, title, meta, tail }: { href: string; on: boolean; onPick: (href: string) => void; title: string; meta: string; tail?: string }) {
  return (
    // Link로 두는 건 새 탭으로 여는 길(가운데 클릭·Cmd+클릭)을 남기기 위해서다. 이동 자체는 onPick이 맡아 패널을 먼저 닫는다
    <Link
      href={href}
      role="option"
      aria-selected={on}
      className={`ss-row${on ? " on" : ""}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onPick(href);
      }}
    >
      <span className="ss-t">{title}</span>
      <span className="ss-m">{meta}</span>
      {tail && <em>{tail}</em>}
    </Link>
  );
}
