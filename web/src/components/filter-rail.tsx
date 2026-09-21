"use client";

// 목록 화면 필터 — 넓은 화면은 왼쪽 고정 레일, 좁은 화면은 바텀시트(사용자 요청 2026-09-09).
// 헤더 아래 전폭 바(ScopeBar)와 칩이 늘어난 필터 행을 대신한다. 상세 화면의 오른쪽 스티키 패널과 같은 골격이다.
// 값은 URL이 아니라 ListStateProvider가 들고 있고, 수량(facets)은 지금 걸린 다른 필터를 반영한 값이다.
// 레일과 시트는 같은 본문(RailBody)을 두 번 그린다 — 어느 쪽이 보일지는 CSS가 정한다(서버 렌더와 어긋나지 않는다).
// 시트 자체는 공용 Sheet(components/sheet.tsx) — 끌어 내려 닫기·스크림·배경 잠금·ESC를 거기서 맡는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { AREA_MIN_COUNT } from "@/lib/constants";
import { hasFilter } from "@/lib/notice-filters";
import { SECTORS, type NoticeSort, type Sector } from "@/types/notice";
import { wonStep } from "@/lib/format";
import { Sheet } from "./sheet";
import { useListState } from "./list-state";
import { Select } from "./select";

// 정렬 목록. 첫 줄이 기본값(최신 공고순)이다.
// 월세 낮은 순은 임대 목록의 값싼 순 — 월세를 못 읽은 공고는 맨 뒤로 간다(2026-09-21)
const SORT_OPTIONS: { value: NoticeSort; label: string }[] = [
  { value: "posted", label: "최신 공고순" },
  { value: "deadline", label: "마감 임박순" },
  { value: "rent", label: "월세 낮은 순" },
];

/** 만원 단위 정수로 적는다. 1,096만 → "1,096" */
function toMan(v: number | undefined): string {
  return v ? Math.round(v / 10_000).toLocaleString("ko-KR") : "";
}

/** 예산 상한 한 줄 — 만원 단위 직접 입력(사용자 요청 2026-09-21).
    눈금 칩은 내 예산이 눈금 사이(예: 7,000만)에 있으면 고를 수가 없었다.
    글자마다 목록을 다시 부르지 않게 잠깐 멈추면(450ms) 그때 걸고, Enter와 포커스 이탈은 곧바로 건다 */
function BudgetInput({ label, value, onCommit }: {
  label: string;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
}) {
  const [text, setText] = useState(() => toMan(value));
  // 내가 마지막으로 올려보낸 값. 밖에서 바뀐 값(초기화 버튼·다른 쪽 입력창)만 글자에 되받는다 —
  // 이걸 안 두면 타이핑 도중 되돌아온 값이 커서를 끌고 간다
  const mine = useRef(value);

  useEffect(() => {
    if (mine.current === value) return;
    mine.current = value;
    setText(toMan(value));
  }, [value]);

  const commit = useCallback((t: string) => {
    const man = Number(t.replace(/[^\d]/g, ""));
    const won = man > 0 ? man * 10_000 : undefined;
    if (won === mine.current) return;
    mine.current = won;
    onCommit(won);
  }, [onCommit]);

  // 멈추면 건다. 타이핑 중엔 글자만 바뀌고 목록은 가만히 있는다
  useEffect(() => {
    const t = setTimeout(() => commit(text), 450);
    return () => clearTimeout(t);
  }, [text, commit]);

  return (
    <div className="rail-g rail-budget">
      <h3>{label} 상한</h3>
      <div className={`bin${value ? " on" : ""}`}>
        <input
          className="bin-i"
          type="text"
          inputMode="numeric"
          value={text}
          placeholder="제한 없음"
          aria-label={`${label} 상한(만원)`}
          onChange={(e) => setText(toMan(Number(e.target.value.replace(/[^\d]/g, "")) * 10_000))}
          onBlur={() => commit(text)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(text); } }}
        />
        {/* 빈 칸에 단위만 남으면 「제한 없음 만원」으로 읽힌다 — 숫자가 있을 때만 붙인다 */}
        {text ? <span className="bin-u">만원</span> : null}
      </div>
      {/* 만 단위 숫자는 자릿수를 세야 읽힌다 — 걸린 값은 한글로 되읽어 준다 */}
      {value ? <p className="bin-h">{wonStep(value)} 원 이하</p> : null}
    </div>
  );
}

function RailBody() {
  const { f, facets, set, setSido } = useListState();
  const sido = f.sido;

  // 3건 미만 시도는 감춘다(얇은 페이지 방지와 같은 기준). 지금 고른 시도는 수가 줄어도 남긴다 —
  // 사라지면 셀렉트가 「전국」으로 보여 화면과 상태가 어긋난다
  const sidoOptions = facets.sido.filter((o) => o.count >= AREA_MIN_COUNT || o.value === sido);
  if (sido && !sidoOptions.some((o) => o.value === sido)) sidoOptions.unshift({ value: sido, count: 0 });
  // 시군구는 시도를 고른 뒤에만 센다(listFacetsRaw). 지금 고른 값은 수가 0이어도 남긴다 — 사라지면 화면과 상태가 어긋난다
  const sigunguOptions = [...facets.sigungu];
  if (f.sigungu && !sigunguOptions.some((o) => o.value === f.sigungu)) sigunguOptions.unshift({ value: f.sigungu, count: 0 });
  const typeOptions = [...facets.type];
  if (f.type && !typeOptions.some((o) => o.value === f.type)) typeOptions.unshift({ value: f.type, count: 0 });

  const countOf = (s: Sector) => facets.sector.find((o) => o.value === s)?.count ?? 0;

  return (
    <>
      {/* 보기 전환(카드/목록/간략)은 감췄다 — 카드 한 형태면 된다(사용자 요청 2026-09-21).
          상태(view)와 목록 쪽 렌더는 살아 있다. 되살릴 땐 여기 스위치만 다시 그린다 */}

      {/* 정렬은 「거르는 조건」이 아니라 늘 하나가 걸려 있는 값이라 칩으로 두면 항상 검정 칩이 하나 떠 있다
          — 조건 칩과 섞여 필터가 걸린 것처럼 보였다(사용자 지적 2026-09-21). 셀렉트로 내리고 잉크 반전은 뺀다 */}
      <div className="rail-g">
        <h3>정렬</h3>
        <Select
          value={f.sort ?? "posted"}
          options={SORT_OPTIONS}
          onChange={(v) => set({ sort: v as NoticeSort })}
          placeholder={SORT_OPTIONS[0].label}
          ariaLabel="정렬"
          className="plain"
          allowAll={false}
        />
      </div>

      {/* 공공이냐 민간이냐 — 「부문」은 뜻이 흐려 「공급주체」로 고친다(사용자 지적 2026-09-21).
          바로 아래 「공급유형」(행복주택·매입임대…)과 층이 맞는다 */}
      <div className="rail-g">
        <h3>공급주체</h3>
        <Select
          value={f.sector ?? ""}
          options={[{ value: "", label: "전체", count: facets.total }, ...SECTORS.map((s) => ({ value: s, label: s, count: countOf(s) }))]}
          onChange={(v) => set({ sector: (v || undefined) as Sector | undefined })}
          placeholder="전체"
          ariaLabel="공급주체"
          allowAll={false}
        />
      </div>

      <div className="rail-g">
        <h3>지역</h3>
        <Select
          value={sido ?? ""}
          options={sidoOptions.map((o) => ({ value: o.value, label: o.value, count: o.count }))}
          onChange={(v) => setSido(v || undefined)}
          placeholder="전국"
          ariaLabel="시도"
        />
        {/* 시도를 고른 뒤에만 나온다 — 전국에서 「강서구」를 고르면 서울과 부산이 섞인다.
            시도만으로는 서울 한 곳에 공고가 수백 건이라 목록이 안 좁혀졌다(2026-09-21) */}
        {sido && sigunguOptions.length > 0 && (
          <Select
            value={f.sigungu ?? ""}
            options={sigunguOptions.map((o) => ({ value: o.value, label: o.value, count: o.count }))}
            onChange={(v) => set({ sigungu: v || undefined })}
            placeholder="전체 시군구"
            ariaLabel="시군구"
          />
        )}
      </div>

      <div className="rail-g">
        <h3>공급유형</h3>
        <Select
          value={f.type ?? ""}
          options={typeOptions.map((o) => ({ value: o.value, label: o.value, count: o.count }))}
          onChange={(v) => set({ type: v || undefined })}
          placeholder="전체 유형"
          ariaLabel="공급유형"
        />
      </div>

      {/* 예산 — 임대 목록의 첫 번째 물음인데 여기 없었다(2026-09-21).
          금액을 못 읽은 공고(전체의 17%)는 상한을 걸면 빠진다. 「제한 없음」이 기본인 이유 */}
      <BudgetInput label="보증금" value={f.maxDeposit} onCommit={(v) => set({ maxDeposit: v })} />
      <BudgetInput label="월임대료" value={f.maxRent} onCommit={(v) => set({ maxRent: v })} />

      <div className="rail-g">
        <h3>접수</h3>
        <div className="rail-chips">
          <button type="button" className={`chip-f${f.closing ? " on" : ""}`} aria-pressed={Boolean(f.closing)} onClick={() => set({ closing: f.closing ? undefined : "7d" })}>
            마감 7일 내 <small>{facets.closing7}</small>
          </button>
          {/* 마감 공고는 기본으로 감춘다(사용자 요청 2026-09-09). URL은 살아 있고 목록에서만 빠진다 */}
          <button type="button" className={`chip-f${f.closed ? " on" : ""}`} aria-pressed={Boolean(f.closed)} onClick={() => set({ closed: f.closed ? undefined : true })}>
            마감 포함
          </button>
        </div>
      </div>
    </>
  );
}

export function FilterRail() {
  const { f, facets, reset } = useListState();
  const [open, setOpen] = useState(false);

  // 시트가 스스로 퇴장 애니메이션을 끝낸 뒤 이 콜백을 부른다. 배경 스크롤 잠금과 ESC도 시트가 맡는다
  const close = useCallback(() => setOpen(false), []);

  // 시트 버튼에 붙는 배지 — 지금 몇 개가 걸려 있나. 정렬은 조건이 아니라 세지 않는다
  const active = [f.sector, f.sido, f.sigungu, f.type, f.closing, f.closed, f.maxDeposit, f.maxRent].filter(Boolean).length;
  const summary = [
    f.sigungu ? `${f.sido} ${f.sigungu}` : (f.sido ?? "전국"),
    f.type ?? "전체 유형",
    f.maxDeposit ? `보증금 ${wonStep(f.maxDeposit)} 이하` : null,
    f.maxRent ? `월세 ${wonStep(f.maxRent)} 이하` : null,
    f.closing ? "마감 7일 내" : null,
  ].filter(Boolean).join(" | ");
  const on = hasFilter(f);
  // 시트 확인 버튼의 수 — 부문이 걸렸으면 그 부문 수가 곧 결과 수다
  const shown = f.sector ? (facets.sector.find((o) => o.value === f.sector)?.count ?? facets.total) : facets.total;

  return (
    <>
      <aside className="rail" aria-label="목록 필터">
        <div className="rail-in">
          <RailBody />
          {on && <button type="button" className="rail-reset" onClick={reset}>필터 초기화</button>}
        </div>
      </aside>

      {/* 좁은 화면 전용 — 레일 자리에 버튼 한 줄만 두고 조건은 시트에서 고른다 */}
      <div className="fsheet-bar">
        <button type="button" className="fsheet-open" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          필터{active > 0 && <em>{active}</em>}
        </button>
        <span className="fsheet-sum">{summary}</span>
      </div>

      <Sheet
        open={open}
        onClose={close}
        title="필터"
        footer={
          <>
            <button type="button" className="btn lg" onClick={reset} disabled={!on}>초기화</button>
            <button type="button" className="btn ink lg" onClick={close}>{shown}건 보기</button>
          </>
        }
      >
        <RailBody />
      </Sheet>
    </>
  );
}
