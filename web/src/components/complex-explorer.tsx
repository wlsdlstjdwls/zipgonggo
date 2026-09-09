"use client";

// 공급 단지 탐색기 — 왼쪽 목록(검색·조건·건수) + 오른쪽 브랜드 핀 지도(ComplexMap). 벤치마크 docs/references/공고지도2.png.
// 지도는 먼저 뜨고, 좌표는 브라우저 지오코딩이 끝나면 한 번에 얹는다(탭 메모리만, 저장 금지 — CLAUDE.md 하지 말 것 1).
// 행 호버 ↔ 핀 강조, 행·핀 클릭 → 선택(핀이 이름 라벨로 바뀜, 목록 스크롤, 화면 밖이면 지도 pan). 선택 단지는 로드뷰를 열 수 있다.
// 클라이언트 컴포넌트지만 목록은 서버에서 HTML로 렌더되므로 크롤러도 단지명·주소를 본다.
//
// 조건은 늘 펼쳐져 있던 셀렉트 줄에서 접이식으로 바꿨다(사용자 요청 2026-09-09: "필터 부분도 좀 정리 좀 하자").
// 첫 줄에는 늘 쓰는 검색과 자치구만, 나머지(공급대상·면적·보증금·월임대료·신규)는 「조건」을 눌러 편다.
// 금액 조건은 구간이 아니라 상한이다 — 사람이 실제로 거는 조건은 「내 예산 이하」다.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { noticeComplexPath } from "@/lib/routes";
import { geocodeAll, hasMapKey, loadNaverMaps, type LatLng } from "@/lib/naver-maps-loader";
import { num, wonExact, wonKo, wonShort } from "@/lib/format";
import type { NoticeComplex } from "@/types/notice";
import { ComplexMap, type MapItem } from "./complex-map";
import { Select } from "./select";
import { Trunc } from "./trunc";

type Props = { items: NoticeComplex[]; hasUnits: boolean; noticeSlug: string; /** 공고 전체 공급 호수. 섹션 제목을 뺀 자리를 이 줄이 대신 센다(사용자 요청 2026-09-09) */ unitTotal?: number };
type Phase = "loading" | "ready" | "failed" | "no-key";

// 핀이 아직 없을 때 첫 화면 — 서울 전역
const SEOUL_CENTER = { lat: 37.5665, lng: 126.978 };
const SEOUL_ZOOM = 11;

function fullAddress(c: NoticeComplex): string {
  return c.sido === "서울특별시" ? `서울특별시 ${c.road_address}` : c.road_address;
}

function guLabel(c: NoticeComplex): string {
  return c.sido === "서울특별시" ? c.sigungu : `${c.sido} ${c.sigungu}`;
}

// 면적 구간 — 20㎡ 폭(사용자 요청 2026-09-09: 10㎡ 단위는 너무 잘아 선택지만 늘어난다).
// 단지의 전용면적 범위(area_min~area_max)가 구간과 겹치면 그 구간에 든다.
const AREA_BANDS: { value: string; lo: number; hi: number }[] = [
  { value: "20㎡ 이하", lo: 0, hi: 20 },
  { value: "20~40㎡", lo: 20, hi: 40 },
  { value: "40~60㎡", lo: 40, hi: 60 },
  { value: "60~80㎡", lo: 60, hi: 80 },
  { value: "80㎡ 이상", lo: 80, hi: Infinity },
];

// 금액 상한 사다리. 라벨은 wonShort가 만든다 — "3,000만 이하", "1억 이하"
const DEPOSIT_CAPS = [30_000_000, 50_000_000, 100_000_000, 200_000_000, 300_000_000, 500_000_000, 1_000_000_000];
const RENT_CAPS = [100_000, 200_000, 300_000, 500_000, 800_000];

function inBand(c: NoticeComplex, band: { lo: number; hi: number }): boolean {
  const lo = c.area_min ?? c.area_max;
  const hi = c.area_max ?? c.area_min;
  if (lo == null || hi == null) return false;
  return lo < band.hi && hi >= band.lo;
}

/** 직접 입력한 면적 범위와 겹치나. 빈칸은 열린 끝으로 본다 */
function inRange(c: NoticeComplex, lo: number | null, hi: number | null): boolean {
  const a = c.area_min ?? c.area_max;
  const b = c.area_max ?? c.area_min;
  if (a == null || b == null) return false;
  return (hi == null || a <= hi) && (lo == null || b >= lo);
}

/** 값이 있는 항목만 뽑아 (값, 건수)로. 건수 0인 선택지는 아예 만들지 않는다 */
function tally(items: NoticeComplex[], pick: (c: NoticeComplex) => string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const c of items) for (const v of pick(c)) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()];
}

/** 상한 사다리에서 쓸모 있는 칸만 — 0건이거나, 바로 앞 칸과 건수가 같거나(가르지 못한다), 전부를 포함하는 칸은 뺀다 */
function capOptions(items: NoticeComplex[], caps: number[], pick: (c: NoticeComplex) => number | null): [string, number][] {
  const vals = items.map(pick).filter((v): v is number => v != null);
  if (vals.length === 0) return [];
  const out: [string, number][] = [];
  let prev = -1;
  for (const cap of caps) {
    const n = vals.filter((v) => v <= cap).length;
    if (n === 0 || n === prev || n === vals.length) {
      prev = Math.max(prev, n);
      continue;
    }
    out.push([`${wonShort(cap)} 이하`, n]);
    prev = n;
  }
  return out;
}

const CAP_OF = new Map<string, number>();
for (const cap of [...DEPOSIT_CAPS, ...RENT_CAPS]) CAP_OF.set(`${wonShort(cap)} 이하`, cap);

/** 선택 라벨: 굵게 단지명, 보조로 금액 → 호수 → 자치구 */
function toItem(c: NoticeComplex): MapItem {
  const sub = c.min_rent != null ? `월 ${wonShort(c.min_rent)}`
    : c.min_deposit != null ? `보증금 ${wonShort(c.min_deposit)}`
    : c.unit_count != null ? num(c.unit_count, "호")
    : guLabel(c);
  return { id: c.id, address: fullAddress(c), title: c.name, sub, isNew: c.is_new };
}

const numOrNull = (s: string) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

export function ComplexExplorer({ items, hasUnits, noticeSlug, unitTotal }: Props) {
  const listEl = useRef<HTMLUListElement>(null);
  const [phase, setPhase] = useState<Phase>(hasMapKey() ? "loading" : "no-key");
  const [progress, setProgress] = useState(0);
  const [coords, setCoords] = useState<Map<string, LatLng | null>>(new Map());
  const [focus, setFocus] = useState<number | null>(null);
  const [roadview, setRoadview] = useState(false);
  const [gu, setGu] = useState("");
  const [cls, setCls] = useState("");
  const [band, setBand] = useState("");
  const [areaLo, setAreaLo] = useState("");
  const [areaHi, setAreaHi] = useState("");
  const [dep, setDep] = useState("");
  const [rent, setRent] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const gus = useMemo(() => tally(items, (c) => [guLabel(c)]), [items]);
  // 아래 넷은 데이터가 있는 공고에서만 나타난다(사용자 요청 2026-09-09: "있는 경우만")
  const classes = useMemo(() => tally(items, (c) => c.tenant_classes ?? []), [items]);
  const bands = useMemo(
    () => AREA_BANDS.map((b) => [b.value, items.filter((c) => inBand(c, b)).length] as [string, number]).filter(([, n]) => n > 0),
    [items],
  );
  const deposits = useMemo(() => capOptions(items, DEPOSIT_CAPS, (c) => c.min_deposit), [items]);
  const rents = useMemo(() => capOptions(items, RENT_CAPS, (c) => c.min_rent), [items]);
  const newCount = useMemo(() => items.filter((c) => c.is_new).length, [items]);
  const showNewChip = newCount > 0 && newCount < items.length;

  const lo = numOrNull(areaLo);
  const hi = numOrNull(areaHi);
  const custom = lo != null || hi != null;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const b = AREA_BANDS.find((x) => x.value === band);
    const depCap = CAP_OF.get(dep);
    const rentCap = CAP_OF.get(rent);
    return items.filter((c) =>
      (!gu || guLabel(c) === gu) &&
      (!cls || (c.tenant_classes ?? []).includes(cls)) &&
      // 직접 입력이 있으면 그게 구간 선택을 대신한다
      (custom ? inRange(c, lo, hi) : !b || inBand(c, b)) &&
      (depCap === undefined || (c.min_deposit != null && c.min_deposit <= depCap)) &&
      (rentCap === undefined || (c.min_rent != null && c.min_rent <= rentCap)) &&
      (!onlyNew || c.is_new) &&
      (!needle || `${c.name} ${c.road_address}`.toLowerCase().includes(needle)),
    );
  }, [items, gu, cls, band, custom, lo, hi, dep, rent, onlyNew, q]);

  const clearAll = useCallback(() => {
    setGu(""); setCls(""); setBand(""); setAreaLo(""); setAreaHi(""); setDep(""); setRent(""); setOnlyNew(false); setQ(""); setSelected(null);
  }, []);
  const conds = [cls, band, areaLo.trim(), areaHi.trim(), dep, rent, onlyNew ? "new" : ""].filter(Boolean).length;
  const filtered = Boolean(gu || q.trim()) || conds > 0;
  const hasMoreTools = classes.length > 1 || bands.length > 1 || deposits.length > 0 || rents.length > 0 || showNewChip;

  // 1) 지오코딩 — 마운트 즉시
  useEffect(() => {
    if (!hasMapKey()) return;
    let cancelled = false;
    setPhase("loading");
    setProgress(0);
    loadNaverMaps()
      .then((maps) => geocodeAll(maps, items.map(fullAddress), (n) => { if (!cancelled) setProgress(n); }))
      .then((r) => { if (!cancelled) { setCoords(r); setPhase("ready"); } })
      .catch(() => { if (!cancelled) setPhase("failed"); });
    return () => { cancelled = true; };
  }, [items]);

  const mapItems = useMemo(() => visible.map(toItem), [visible]);

  // 2) 선택 → 목록 스크롤. 지도 이동은 ComplexMap이 화면 밖일 때만 한다
  useEffect(() => {
    if (selected === null) return;
    // scrollIntoView는 창 스크롤까지 건드린다 — 목록 컨테이너만 직접 옮긴다
    const list = listEl.current;
    const row = list?.querySelector<HTMLElement>(`[data-id="${selected}"]`);
    if (list && row) {
      // .cx-list가 position:relative라 offsetTop은 목록 내용 기준. 행을 목록 가운데에. smooth는 탭이 비활성이면 멈추므로 즉시 이동
      list.scrollTop = Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
    }
  }, [selected]);

  useEffect(() => { if (selected === null) setRoadview(false); }, [selected]);

  // 필터·검색으로 선택 항목이 빠지면 선택 해제
  useEffect(() => {
    if (selected !== null && !visible.some((c) => c.id === selected)) setSelected(null);
  }, [visible, selected]);

  // 키보드: ↑↓ 이동, Enter 선택 토글, Esc 해제
  const onListKey = useCallback((e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "Escape") { setSelected(null); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = visible.findIndex((c) => c.id === selected);
    const next = e.key === "ArrowDown" ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1);
    const id = visible[next]?.id;
    if (id === undefined) return;
    setSelected(id);
    listEl.current?.querySelector<HTMLElement>(`[data-id="${id}"] button`)?.focus();
  }, [visible, selected]);

  const onPick = useCallback((id: number) => setSelected((cur) => (cur === id ? null : id)), []);
  const onPinFocus = useCallback((id: number | null) => setFocus(id), []);

  // 지도 위 선택 카드 — 로드뷰 토글과 상세 이동을 지도 안에서 끝낸다(사용자 요청 2026-09-08)
  const picked = selected === null ? null : (visible.find((c) => c.id === selected) ?? null);
  const pickedPin = picked ? Boolean(coords.get(fullAddress(picked))) : false;

  return (
    <div className="cx">
      <div className="cx-panel">
        <div className="cx-tools">
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setSelected(null); }} placeholder="단지명, 주소 검색" aria-label="단지명, 주소 검색" className="fld cx-q" />
          <Select
            value={gu}
            options={gus.map(([g, n]) => ({ value: g, label: g, count: n }))}
            onChange={(v) => { setGu(v); setSelected(null); }}
            placeholder="자치구 전체"
            ariaLabel="자치구"
          />
          {hasMoreTools && (
            <button type="button" className={`cx-more${more ? " on" : ""}`} aria-expanded={more} onClick={() => setMore((v) => !v)}>
              조건{conds > 0 && <em>{conds}</em>}
            </button>
          )}
        </div>

        {more && hasMoreTools && (
          <div className="cx-cond">
            {/* 공급대상·면적·금액은 그 공고에 값이 있을 때만 나온다 — 빈 셀렉트를 늘어놓지 않는다 */}
            {classes.length > 1 && (
              <Select
                value={cls}
                options={classes.map(([v, n]) => ({ value: v, label: v, count: n }))}
                onChange={(v) => { setCls(v); setSelected(null); }}
                placeholder="공급대상 전체"
                ariaLabel="공급대상"
              />
            )}
            {bands.length > 1 && (
              <Select
                value={band}
                options={bands.map(([v, n]) => ({ value: v, label: v, count: n }))}
                onChange={(v) => { setBand(v); setAreaLo(""); setAreaHi(""); setSelected(null); }}
                placeholder="면적 전체"
                ariaLabel="전용면적"
              />
            )}
            {deposits.length > 0 && (
              <Select
                value={dep}
                options={deposits.map(([v, n]) => ({ value: v, label: v, count: n }))}
                onChange={(v) => { setDep(v); setSelected(null); }}
                placeholder="보증금 전체"
                ariaLabel="보증금 상한"
              />
            )}
            {rents.length > 0 && (
              <Select
                value={rent}
                options={rents.map(([v, n]) => ({ value: v, label: v, count: n }))}
                onChange={(v) => { setRent(v); setSelected(null); }}
                placeholder="월임대료 전체"
                ariaLabel="월임대료 상한"
              />
            )}
            {bands.length > 1 && (
              /* 구간으로 안 떨어지는 폭은 직접 넣는다(사용자 요청 2026-09-09). 넣는 순간 구간 선택은 비운다 */
              <div className="cx-range">
                <span>전용면적 직접 입력</span>
                <input type="number" inputMode="decimal" min={0} step={1} className="fld" value={areaLo}
                  onChange={(e) => { setAreaLo(e.target.value); setBand(""); setSelected(null); }} aria-label="전용면적 최소" placeholder="최소" />
                <i aria-hidden="true">~</i>
                <input type="number" inputMode="decimal" min={0} step={1} className="fld" value={areaHi}
                  onChange={(e) => { setAreaHi(e.target.value); setBand(""); setSelected(null); }} aria-label="전용면적 최대" placeholder="최대" />
                <em>㎡</em>
              </div>
            )}
            {showNewChip && (
              <button type="button" className={`chip-f${onlyNew ? " on" : ""}`} aria-pressed={onlyNew} onClick={() => { setOnlyNew((v) => !v); setSelected(null); }}>
                신규 공급만 <small>{newCount}</small>
              </button>
            )}
          </div>
        )}

        <p className="cx-count">
          <b>{visible.length}</b> / {items.length}{hasUnits ? "단지" : "곳"}{unitTotal ? <em> | {num(unitTotal, "호")}</em> : null}
          {filtered && <button type="button" className="cx-clear" onClick={clearAll}>필터 초기화</button>}
        </p>
        <ul className="cx-list" ref={listEl} aria-label="공급 단지 목록" onKeyDown={onListKey}>
          {visible.map((c) => {
            const on = c.id === selected;
            const noPin = phase === "ready" && !coords.get(fullAddress(c));
            return (
              <li key={c.id} data-id={c.id} className={`${on ? "on" : ""}${focus === c.id ? " is-focus" : ""}`.trim() || undefined}>
                <button type="button" onClick={() => onPick(c.id)} aria-pressed={on} onMouseEnter={() => setFocus(c.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(c.id)} onBlur={() => setFocus(null)}>
                  <span className="cx-row-main">
                    <span className="cx-name"><Trunc text={c.name} />{c.is_new && <span className="chip new">신규</span>}</span>
                    <Trunc className="cx-addr" text={fullAddress(c)} />
                  </span>
                  <span className="cx-row-side">
                    <span className="chip">{guLabel(c)}</span>
                    {noPin && <span className="cx-nopin">지도 미표시</span>}
                    {hasUnits && c.unit_count != null && <span className="cx-units">{num(c.unit_count, "호")}</span>}
                    {hasUnits && c.min_deposit != null && <span className="cx-money" title={wonExact(c.min_deposit)}>보증금 {wonKo(c.min_deposit)}~</span>}
                    {hasUnits && c.min_rent != null && <span className="cx-money" title={wonExact(c.min_rent)}>월 {wonKo(c.min_rent)}~</span>}
                  </span>
                </button>
                <Link href={noticeComplexPath(noticeSlug, c)} className="cx-go" aria-label={`${c.name} 상세`} title={`${c.name} 상세`}>→</Link>
              </li>
            );
          })}
          {visible.length === 0 && <li className="cx-empty">조건에 맞는 단지가 없습니다.</li>}
        </ul>
      </div>
      <div className="cx-map-wrap">
        <div className="cx-map">
          <ComplexMap
            items={mapItems}
            coords={coords}
            focusId={focus}
            selectedId={selected}
            onFocus={onPinFocus}
            onSelect={onPick}
            roadview={roadview}
            split={showNewChip}
            center={SEOUL_CENTER}
            zoom={SEOUL_ZOOM}
            ariaLabel="공급 단지 위치 지도"
          />
          {/* 핀 색의 뜻 — 신규 공급과 재공급이 섞인 공고에서만 띄운다(사용자 요청 2026-09-09) */}
          {showNewChip && phase === "ready" && (
            <p className="cx-legend">
              <span className="lg new" aria-hidden="true" />신규 공급
              <span className="lg" aria-hidden="true" />재공급
            </p>
          )}
          {phase !== "failed" && (
            /* 지도 위 진행 오버레이 — 상태 문구만으로는 몇 곳이 남았는지 안 보인다(사용자 요청 2026-09-09).
               다 되면 조건부로 떼지 않고 옅어지게만 한다 — 지도가 뒤에서 빡 하고 드러나던 걸 막는다(사용자 지적 2026-09-09) */
            <div className={`cx-load${phase !== "loading" ? " hide" : ""}`} role="status" aria-live="polite" aria-hidden={phase !== "loading"}>
              <p className="cx-load-n"><b>{progress}</b><span>/ {items.length}</span></p>
              <p className="cx-load-t">주소를 좌표로 바꾸는 중</p>
              <div className="cx-load-bar" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={progress}>
                <i style={{ transform: `scaleX(${items.length ? progress / items.length : 0})` }} />
              </div>
            </div>
          )}
          {phase === "failed" && <p className="map-note">주소를 찾지 못해 핀을 표시하지 못했습니다.</p>}
          {picked && (
            <div className="cx-card">
              <div className="cx-card-t">
                <Trunc as="span" className="cx-card-n" text={picked.name} />
                <Trunc text={fullAddress(picked)} />
              </div>
              <div className="cx-card-a">
                {pickedPin && (
                  <button type="button" className={`map-btn${roadview ? " on" : ""}`} onClick={() => setRoadview((v) => !v)} aria-pressed={roadview}>
                    {roadview ? "지도" : "로드뷰"}
                  </button>
                )}
                <Link href={noticeComplexPath(noticeSlug, picked)} className="map-btn acc">상세 보기 →</Link>
              </div>
              <button type="button" className="cx-card-x" onClick={() => setSelected(null)} aria-label="선택 해제">✕</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
