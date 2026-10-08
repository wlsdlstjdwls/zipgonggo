"use client";

// 단지 상세 「동호수별 목록」 — SH 매입임대 별첨 주택목록의 호실 행(unit, 0021).
// 사용자 요청 2026-09-09: "이미 동수, 호수 정보가 나와 있다면 버튼이나 필터로 각 동호수별 정보를 볼 수 있어야 한다".
// 동이 둘 이상이면 동 칩으로 먼저 가르고, 구조(원룸/투룸)도 칩으로 가른다. 표에는 층·면적·구조·승강기·금액 3종.
//
// 건물을 가르는 값은 동이 1순위, 주소가 2순위다(사용자 지적 2026-09-09: "다른 동인데 동 표기가 없으면 더 헷갈린다").
// 별첨에 동이 없어도 주소가 갈리면 같은 「404호」가 건물마다 따로 있다 — 그때는 주소 칸을 세운다.
// 동도 주소도 하나뿐이면 한 건물이라 호만으로 유일하다.
// 금액은 계약 때 고를 수 있는 폭 그대로 — 최대(전세전환) / 기준 / 최소(월세전환).
//
// **자리를 못 박았다(사용자 지적 2026-09-21: "여전히 너무 많은 영역을 차지해").**
// 실측(2026-09-21): 단지 471곳 중 462곳이 15호 이하인데 엘클루(3동 17층) 172호처럼 백 줄이 넘는 단지가 있다.
// 그 세 곳 때문에 지면 아래쪽(위치 지도·용어)이 스크롤 저편으로 밀려났다. 세 번 고친 끝의 모양 —
//  1. 조건은 **셀렉트 세 개**(동/주소 · 층 · 구조). 칩으로 늘어놓으니 17층짜리 단지에서 칩 줄만 두 줄을 먹었다.
//  2. 표는 **높이를 못 박은 상자 안에서 스크롤**한다. 몇 호짜리 단지든 이 섹션이 먹는 세로 자리가 같다.
//     표 머리와 첫 열은 상자 안에서 고정이라 스크롤해도 어느 동 몇 호의 무슨 값인지 안 잃는다.
//  3. 표 머리에서 면적·보증금으로 줄 세운다 — 싼 호실·큰 호실을 찾으려고 백 줄을 훑지 않게.
// 「더 보기」로 스무 줄씩 잇던 방식은 뺐다(같은 날) — 상자가 자리를 못 박으니 끊어 줄 이유가 없고,
// 끊어 두면 Ctrl+F로 호수를 못 찾는다. 줄 수와 상관없이 「몇 호 중 몇 호」와 면적·보증금 범위는 늘 적는다.

import { type ReactNode, useCallback, useMemo, useState } from "react";
import { hoText, num, wonExact, wonKo } from "@/lib/format";
import type { NoticeUnit } from "@/types/notice";
import { Select, type SelectOption } from "./select";

type Props = { units: NoticeUnit[] };

const ALL = "";

/** 표 머리에서 고를 수 있는 정렬. `room`은 서버가 준 순서(동 → 주소 → 층 → 호) 그대로다 */
type SortKey = "room" | "area" | "deposit";
type Sort = { key: SortKey; desc: boolean };

function tally(units: NoticeUnit[], pick: (u: NoticeUnit) => string | null): [string, number][] {
  const m = new Map<string, number>();
  for (const u of units) {
    const v = pick(u);
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()];
}

function Money({ v }: { v: number | null }) {
  if (v == null) return <>—</>;
  return <span title={wonExact(v)}>{wonKo(v)}</span>;
}

/** 주소에서 시군구를 뗀다 — 머리글이 이미 말한 값이라 칸만 넓힌다 */
function addrShort(a: string): string {
  const i = a.indexOf(" ");
  return i > 0 ? a.slice(i + 1) : a;
}

/** 값이 있는 것들의 최솟값·최댓값. 하나도 없으면 null */
function span(vals: (number | null)[]): [number, number] | null {
  const xs = vals.filter((v): v is number => v != null);
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

export function UnitTable({ units }: Props) {
  const [dong, setDong] = useState(ALL);
  const [layout, setLayout] = useState(ALL);
  const [floor, setFloor] = useState(ALL);
  const [sort, setSort] = useState<Sort>({ key: "room", desc: false });

  // 동이 하나라도 있으면 동으로, 없으면 주소가 갈릴 때만 주소로 가른다
  const byDong = units.some((u) => u.building);
  const addrs = useMemo(() => new Set(units.map((u) => u.road_address).filter(Boolean)), [units]);
  const groupOf = useCallback(
    (u: NoticeUnit) => (byDong ? u.building : addrs.size > 1 ? u.road_address : null),
    [byDong, addrs.size],
  );
  const groupLabel = byDong ? "동" : "주소";

  const dongs = useMemo(() => tally(units, groupOf), [units, groupOf]);
  const layouts = useMemo(() => tally(units, (u) => u.room_layout), [units]);
  // 층은 숫자로 줄 세운다 — 글자로 세면 10층이 2층 앞에 선다
  const floors = useMemo(
    () => tally(units, (u) => (u.floor != null ? String(u.floor) : null)).sort((a, b) => Number(a[0]) - Number(b[0])),
    [units],
  );

  const filtered = useMemo(
    () =>
      units.filter(
        (u) =>
          (!dong || groupOf(u) === dong) &&
          (!layout || u.room_layout === layout) &&
          (!floor || String(u.floor) === floor),
      ),
    [units, dong, layout, floor, groupOf],
  );

  const hasRent = units.some((u) => u.rent != null);

  // 열은 **호실마다 값이 갈릴 때만** 세운다(사용자 결정 2026-09-22:
  // "호실별 정보가 좀 중복정보가 많은데 중복 정보는 상단에 표기하고 서로 다른 것만 표기하면 어떤가").
  // 단지 전체가 같은 값이면 그건 이 단지의 성질이지 호실의 차이가 아니라 위 제원 줄이 말한다 —
  // 같은 「개방형원룸」을 172줄 반복하는 건 표가 아니라 벽지다.
  // 전세전환·월세전환 두 열은 통째로 뺐다(같은 날) — 「보증금과 임대료」 슬라이더가 그 폭을 다룬다.
  const many = (pick: (u: NoticeUnit) => string | number | null): boolean =>
    new Set(units.map(pick).filter((v) => v != null)).size > 1;
  const col = {
    area: many((u) => u.area_m2),
    layout: many((u) => u.room_layout),
    elevator: many((u) => u.elevator),
    deposit: many((u) => u.deposit),
    rent: hasRent && many((u) => u.rent),
  };
  // colSpan은 실제로 그리는 열 수와 맞춰야 한다 — 호 열 하나에 켜진 열을 더한다
  const colCount = 1 + Object.values(col).filter(Boolean).length;

  // 정렬은 거른 다음에. 값이 없는 호실은 방향과 상관없이 맨 뒤로 보낸다 — 「모름」은 0원도 0㎡도 아니다.
  // 열이 꺼지면 그 열로 걸어 둔 정렬도 같이 풀린다 — 누를 머리가 없는 정렬은 되돌릴 길이 없다
  const visible = useMemo(() => {
    if (sort.key === "room") return filtered;
    if ((sort.key === "area" && !col.area) || (sort.key === "deposit" && !col.deposit)) return filtered;
    const pick = sort.key === "area" ? (u: NoticeUnit) => u.area_m2 : (u: NoticeUnit) => u.deposit;
    return [...filtered].sort((a, b) => {
      const [x, y] = [pick(a), pick(b)];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return sort.desc ? y - x : x - y;
    });
  }, [filtered, sort, col.area, col.deposit]);

  // 지금 거른 조건의 폭. 스크롤해 내려가 보지 않아도 이 조건이 어떤 값들인지 안다
  const areaSpan = span(visible.map((u) => u.area_m2));
  const depositSpan = span(visible.map((u) => u.deposit));


  /** 조건 하나. 고를 게 하나뿐이면 세우지 않는다 — 누를 것도 없는 셀렉트는 자리만 먹는다 */
  const Picker = ({ label, list, value, set, labelize }: { label: string; list: [string, number][]; value: string; set: (v: string) => void; labelize?: (v: string) => string }) => {
    if (list.length < 2) return null;
    const options: SelectOption[] = list.map(([v, n]) => ({ value: v, label: labelize ? labelize(v) : v, count: n }));
    return <Select value={value} options={options} onChange={set} placeholder={`${label} 전체`} ariaLabel={label} />;
  };

  /** 정렬을 거는 표 머리. 누르면 오름차순, 한 번 더 누르면 내림차순, 세 번째면 원래 순서(동 → 호)로 돌아온다 */
  const SortTh = ({ k, children }: { k: SortKey; children: ReactNode }) => {
    const on = sort.key === k;
    return (
      <th className="num">
        <button
          type="button"
          className={`ut-sort${on ? " on" : ""}`}
          aria-label={`${typeof children === "string" ? children : ""} 기준 정렬`}
          onClick={() => setSort(on ? (sort.desc ? { key: "room", desc: false } : { key: k, desc: true }) : { key: k, desc: false })}
        >
          {children}
          <i aria-hidden="true">{on ? (sort.desc ? "▾" : "▴") : "⇅"}</i>
        </button>
      </th>
    );
  };

  return (
    <div className="ut">
      <div className="ut-tools">
        <Picker label={groupLabel} list={dongs} value={dong} set={setDong} labelize={byDong ? undefined : addrShort} />
        <Picker label="층" list={floors} value={floor} set={setFloor} labelize={(v) => `${v}층`} />
        <Picker label="구조" list={layouts} value={layout} set={setLayout} />
        {(dong || floor || layout) && (
          <button type="button" className="ut-clear" onClick={() => { setDong(ALL); setFloor(ALL); setLayout(ALL); }}>조건 초기화</button>
        )}
      </div>
      <p className="ut-count">
        <b>{visible.length}</b> / {num(units.length, "호")}
        {areaSpan && <em>전용 {areaSpan[0] === areaSpan[1] ? `${areaSpan[0]}㎡` : `${areaSpan[0]}~${areaSpan[1]}㎡`}</em>}
        {depositSpan && (
          <em title={depositSpan[0] === depositSpan[1] ? wonExact(depositSpan[0]) : `${wonExact(depositSpan[0])} ~ ${wonExact(depositSpan[1])}`}>
            {hasRent ? "보증금" : "전세금"}{" "}
            {depositSpan[0] === depositSpan[1] ? wonKo(depositSpan[0]) : `${wonKo(depositSpan[0])}~${wonKo(depositSpan[1])}`}
          </em>
        )}
      </p>
      <div className="tbl wide stack ut-box">
        <table className="supply">
          <thead>
            <tr>
              {/* 동 열을 따로 두면 좁은 화면에서 스크롤할 때 어느 동인지 잊어버린다(사용자 지적
                  2026-09-09) — 호 열 하나에 합쳐 sticky로 고정한다(globals.css) */}
              <th>{dongs.length > 0 ? `${groupLabel}/호` : "호"}</th>
              {col.area && <SortTh k="area">전용면적</SortTh>}
              {col.layout && <th>구조</th>}
              {col.elevator && <th>승강기</th>}
              {col.deposit && <SortTh k="deposit">{hasRent ? "임대보증금" : "전세금"}</SortTh>}
              {col.rent && <th className="num">월임대료</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <tr key={u.id}>
                <td className="tc-key">
                  {dongs.length > 0 && (
                    <span className="tc-tag" title={groupOf(u) ?? undefined}>
                      {byDong ? (u.building ?? "—") : addrShort(groupOf(u) ?? "—")}
                    </span>
                  )}
                  {hoText(u.room)}{u.floor != null && <small> {u.floor}층</small>}
                </td>
                {col.area && <td className="num" data-label="전용면적">{u.area_m2 != null ? `${u.area_m2}㎡` : "—"}</td>}
                {col.layout && <td data-label="구조">{u.room_layout ?? "—"}</td>}
                {col.elevator && <td data-label="승강기">{u.elevator ?? "—"}</td>}
                {col.deposit && <td className="num strong" data-label={hasRent ? "임대보증금" : "전세금"}><Money v={u.deposit} /></td>}
                {col.rent && <td className="num" data-label="월임대료"><Money v={u.rent} /></td>}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={colCount} className="ut-empty">조건에 맞는 호실이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {/* 「동 표기가 없습니다」 줄은 뺐다(사용자 요청 2026-09-22) — 한 건물이라는 건 호만 적힌 표가 이미 말한다.
          같은 호수가 건물마다 따로 있는 단지만은 남긴다: 그건 안 적으면 엉뚱한 집을 본다 */}
      {dongs.length > 0 && !byDong && (
        <p className="note">이 단지는 별첨에 동 표기가 없어 주소로 나눴습니다. 같은 호수가 건물마다 따로 있으니 주소를 함께 보세요.</p>
      )}
    </div>
  );
}
