"use client";

// 단지 상세 「동호수별 목록」 — SH 매입임대 별첨 주택목록의 호실 행(unit, 0021).
// 사용자 요청 2026-09-09: "이미 동수, 호수 정보가 나와 있다면 버튼이나 필터로 각 동호수별 정보를 볼 수 있어야 한다".
// 동이 둘 이상이면 동 칩으로 먼저 가르고, 구조(원룸/투룸)도 칩으로 가른다. 표에는 층·면적·구조·승강기·금액 3종.
//
// 건물을 가르는 값은 동이 1순위, 주소가 2순위다(사용자 지적 2026-09-09: "다른 동인데 동 표기가 없으면 더 헷갈린다").
// 별첨에 동이 없어도 주소가 갈리면 같은 「404호」가 건물마다 따로 있다 — 그때는 주소 칸을 세운다.
// 동도 주소도 하나뿐이면 한 건물이라 호만으로 유일하다.
// 금액은 계약 때 고를 수 있는 폭 그대로 — 최대(전세전환) / 기준 / 최소(월세전환).

import { useCallback, useMemo, useState } from "react";
import { num, wonExact, wonKo } from "@/lib/format";
import type { NoticeUnit } from "@/types/notice";
import { Term } from "./glossary";

type Props = { units: NoticeUnit[] };

const ALL = "";

function tally(units: NoticeUnit[], pick: (u: NoticeUnit) => string | null): [string, number][] {
  const m = new Map<string, number>();
  for (const u of units) {
    const v = pick(u);
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()];
}

/** 별첨의 호는 "0302"처럼 층+호를 붙인 네 자리다 — 사람이 읽는 "302호"로 편다 */
function hoText(room: string): string {
  const t = room.replace(/^0+/, "");
  return /^\d+$/.test(t) ? `${t}호` : room;
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

export function UnitTable({ units }: Props) {
  const [dong, setDong] = useState(ALL);
  const [layout, setLayout] = useState(ALL);

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

  const visible = useMemo(
    () => units.filter((u) => (!dong || groupOf(u) === dong) && (!layout || u.room_layout === layout)),
    [units, dong, layout, groupOf],
  );

  // 전세전환·월세전환 열은 값이 있을 때만 — 장기전세형 별첨에는 없다
  const hasSwap = units.some((u) => u.deposit_jeonse != null || u.deposit_wolse != null);
  const hasRent = units.some((u) => u.rent != null);
  // 호 + 전용면적/구조/승강기/보증금(+월임대료)(+전세전환/월세전환) — colSpan은 실제로 그리는 열 수와 맞춰야 한다
  const colCount = 4 + (hasRent ? 2 : 1) + (hasSwap ? 2 : 0);

  const Chips = ({ label, list, value, set, labelize }: { label: string; list: [string, number][]; value: string; set: (v: string) => void; labelize?: (v: string) => string }) =>
    list.length < 2 ? null : (
      <div className="ut-chips" role="group" aria-label={label}>
        <button type="button" className={`chip-f${value === ALL ? " on" : ""}`} aria-pressed={value === ALL} onClick={() => set(ALL)}>
          전체 <small>{units.length}</small>
        </button>
        {list.map(([v, n]) => (
          <button key={v} type="button" className={`chip-f${value === v ? " on" : ""}`} aria-pressed={value === v} onClick={() => set(value === v ? ALL : v)} title={v}>
            {labelize ? labelize(v) : v} <small>{n}</small>
          </button>
        ))}
      </div>
    );

  return (
    <div className="ut">
      <div className="ut-tools">
        <Chips label={groupLabel} list={dongs} value={dong} set={setDong} labelize={byDong ? undefined : addrShort} />
        <Chips label="구조" list={layouts} value={layout} set={setLayout} />
      </div>
      <p className="ut-count"><b>{visible.length}</b> / {num(units.length, "호")}</p>
      <div className="tbl wide">
        <table className="supply">
          <thead>
            <tr>
              {/* 동 열을 따로 두면 좁은 화면에서 스크롤할 때 어느 동인지 잊어버린다(사용자 지적
                  2026-09-09) — 호 열 하나에 합쳐 sticky로 고정한다(globals.css) */}
              <th>{dongs.length > 0 ? `${groupLabel}/호` : "호"}</th>
              <th className="num">전용면적</th>
              <th>구조</th>
              <th>승강기</th>
              <th className="num">{hasRent ? "임대보증금" : "전세금"}</th>
              {hasRent && <th className="num">월임대료</th>}
              {hasSwap && <th className="num">최대 보증금</th>}
              {hasSwap && <th className="num">최소 보증금</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <tr key={u.id}>
                <td className="tc-key">
                  {dongs.length > 0 && (
                    <span className="ut-dong" title={groupOf(u) ?? undefined}>
                      {byDong ? (u.building ?? "—") : addrShort(groupOf(u) ?? "—")}
                    </span>
                  )}
                  {hoText(u.room)}{u.floor != null && <small> {u.floor}층</small>}
                </td>
                <td className="num">{u.area_m2 != null ? `${u.area_m2}㎡` : "—"}</td>
                <td>{u.room_layout ?? "—"}</td>
                <td>{u.elevator ?? "—"}</td>
                <td className="num strong"><Money v={u.deposit} /></td>
                {hasRent && <td className="num"><Money v={u.rent} /></td>}
                {hasSwap && (
                  <td className="num stack">
                    <b><Money v={u.deposit_jeonse} /></b>
                    {u.rent_jeonse != null && <small>월 {wonKo(u.rent_jeonse)}</small>}
                  </td>
                )}
                {hasSwap && (
                  <td className="num stack">
                    <b><Money v={u.deposit_wolse} /></b>
                    {u.rent_wolse != null && <small>월 {wonKo(u.rent_wolse)}</small>}
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={colCount} className="ut-empty">조건에 맞는 호실이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {dongs.length === 0 && (
        <p className="note">공고문 별첨에 이 단지의 동 표기가 없습니다. 주소도 하나라 한 건물이며, 호만으로 호실이 갈립니다.</p>
      )}
      {dongs.length > 0 && !byDong && (
        <p className="note">이 단지는 별첨에 동 표기가 없어 주소로 나눴습니다. 같은 호수가 건물마다 따로 있으니 주소를 함께 보세요.</p>
      )}
      {hasSwap && (
        <p className="note">
          최대 보증금은 <Term>전세전환</Term>, 최소 보증금은 <Term>월세전환</Term>을 끝까지 적용했을 때의 값입니다. 그 사이 금액도 고를 수 있습니다.
        </p>
      )}
    </div>
  );
}
