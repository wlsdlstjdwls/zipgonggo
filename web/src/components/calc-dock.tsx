"use client";

// 계산기 패널 — 헤더 「계산기」 버튼이 여는 창. 벤치마크 ayounghome 데이터랩(사용자 제안 2026-09-09).
// 오른쪽 아래 떠 있던 버튼은 눈에 안 띈다는 지적(2026-09-09)에 따라 헤더 메뉴로 올렸다 — 여는 버튼은 CalcButton,
// 여기는 패널만 그린다. 탭 두 장: 「상호전환」(보증금↔월임대료)과 「대출이자」.
//
// 지키는 선(CLAUDE.md 하지 말 것 3): 상품도 기관도 이름을 대지 않는다. 금리와 기간은 사용자가 넣고,
// 우리는 산수만 한다. 중개도 유도도 아니다. 이율 기본값은 공고문에서 역산한 값이고 화면에서 고칠 수 있다.
//
// 값은 상세 페이지가 씨앗으로 넘겨준다(단지 최소 보증금·월임대료). 없으면 빈칸으로 열린다.

import { useCallback, useEffect, useId, useState } from "react";
import { CONVERT_RATE_DOWN, CONVERT_RATE_UP, convert, fullConversionDeposit, loan, type LoanPlan } from "@/lib/calc";
import { wonKo } from "@/lib/format";
import { useCalc } from "./calc-context";
import { Sheet } from "./sheet";

type Props = {
  /** 씨앗 보증금(원) — 단지·공고의 최소 보증금 */
  deposit?: number | null;
  /** 씨앗 월임대료(원) */
  rent?: number | null;
  /** 어느 공고문에서 온 값인지 — 결과 밑 안내에 넣는다 */
  sourceLabel?: string;
};

type Tab = "convert" | "loan";

const PLANS: { value: LoanPlan; label: string }[] = [
  { value: "annuity", label: "원리금균등" },
  { value: "equal", label: "원금균등" },
  { value: "bullet", label: "만기일시" },
];

/** 숫자 입력 한 칸. 빈칸을 허용해야 지우고 다시 칠 수 있어 문자열로 들고 있는다. */
function Field({ label, unit, value, onChange, step = 1, min = 0 }: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  step?: number;
  min?: number;
}) {
  const id = useId();
  return (
    <label className="calc-f" htmlFor={id}>
      <span>{label}</span>
      <span className="calc-fin">
        <input id={id} className="fld" type="number" inputMode="decimal" min={min} step={step} value={value} onChange={(e) => onChange(e.target.value)} />
        <em>{unit}</em>
      </span>
    </label>
  );
}

function Out({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="calc-o">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

const toNum = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** 원 단위 값을 만 원 입력칸 문자열로. 씨앗이 없으면 빈칸 */
const toMan = (won: number | null | undefined) => (won == null ? "" : String(Math.round(won / 10_000)));

function ConvertTab({ deposit, rent, sourceLabel }: Props) {
  const [d0, setD0] = useState(toMan(deposit));
  const [r0, setR0] = useState(rent == null ? "" : String(Math.round(rent / 10_000 * 10) / 10));
  const [up, setUp] = useState(String(CONVERT_RATE_UP));
  const [down, setDown] = useState(String(CONVERT_RATE_DOWN));
  const baseDeposit = toNum(d0) * 10_000;
  const baseRent = Math.round(toNum(r0) * 10_000);
  const rateUp = toNum(up);
  const rateDown = toNum(down);
  const max = fullConversionDeposit(baseDeposit, baseRent, rateUp || CONVERT_RATE_UP);
  const [target, setTarget] = useState<number | null>(null);
  // 기준값이 바뀌면 슬라이더를 기준으로 되돌린다 — 남아 있던 목표가 범위를 벗어난다
  useEffect(() => { setTarget(null); }, [baseDeposit, baseRent, rateUp, rateDown]);
  const at = target ?? baseDeposit;
  const r = convert(baseDeposit, baseRent, at, rateUp, rateDown);
  const empty = baseDeposit <= 0 && baseRent <= 0;

  return (
    <div className="calc-body">
      <div className="calc-grid">
        <Field label="기준 보증금" unit="만 원" value={d0} onChange={setD0} step={100} />
        <Field label="기준 월임대료" unit="만 원" value={r0} onChange={setR0} step={1} />
        <Field label="보증금 올릴 때 이율" unit="%" value={up} onChange={setUp} step={0.1} />
        <Field label="보증금 내릴 때 이율" unit="%" value={down} onChange={setDown} step={0.1} />
      </div>

      <label className="calc-slide">
        <span>바꿀 보증금 <b>{wonKo(r.deposit)}</b></span>
        <input
          type="range"
          min={0}
          max={Math.max(max, baseDeposit, 10_000)}
          step={100_000}
          value={at}
          onChange={(e) => setTarget(Number(e.target.value))}
          aria-label="바꿀 보증금"
          disabled={empty}
        />
      </label>

      <div className="calc-outs">
        <Out label="보증금" value={wonKo(r.deposit)} sub={r.depositDelta === 0 ? "기준 그대로" : `기준 대비 ${r.depositDelta > 0 ? "+" : "-"}${wonKo(Math.abs(r.depositDelta))}`} />
        <Out label="월임대료" value={wonKo(r.rent)} sub={r.rentDelta === 0 ? "기준 그대로" : `기준 대비 ${r.rentDelta > 0 ? "+" : "-"}${wonKo(Math.abs(r.rentDelta))}`} />
        <Out label="적용 이율" value={`연 ${r.rate}%`} sub={r.depositDelta >= 0 ? "보증금을 올리는 쪽" : "보증금을 내리는 쪽"} />
      </div>

      <p className="calc-note">
        전환 한도와 이율은 공고마다 다릅니다. 기본값은 SH 행복주택 공고문 별표1에서 역산한 값이고, 실제 조건은
        {sourceLabel ? ` ${sourceLabel}` : " 기관 공고문"}에서 확인하세요. 여기 값은 계약 조건이 아닙니다.
      </p>
    </div>
  );
}

function LoanTab({ deposit }: Props) {
  const [amount, setAmount] = useState(toMan(deposit));
  const [rate, setRate] = useState("3.0");
  const [years, setYears] = useState("2");
  const [plan, setPlan] = useState<LoanPlan>("bullet");
  const principal = toNum(amount) * 10_000;
  const months = Math.max(1, Math.round(toNum(years) * 12));
  const l = loan(principal, toNum(rate), months, plan);

  return (
    <div className="calc-body">
      <div className="calc-grid">
        <Field label="빌릴 금액" unit="만 원" value={amount} onChange={setAmount} step={100} />
        <Field label="연이율" unit="%" value={rate} onChange={setRate} step={0.1} />
        <Field label="기간" unit="년" value={years} onChange={setYears} step={1} min={1} />
      </div>

      <div className="calc-plans" role="group" aria-label="상환 방식">
        {PLANS.map((p) => (
          <button key={p.value} type="button" className={`chip-f${plan === p.value ? " on" : ""}`} aria-pressed={plan === p.value} onClick={() => setPlan(p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="calc-outs">
        <Out label="첫 달" value={wonKo(l.first)} sub={plan === "bullet" ? "이자만" : plan === "equal" ? "원금 + 이자" : "매달 같은 금액"} />
        <Out label="마지막 달" value={wonKo(l.last)} sub={plan === "bullet" ? "이자 + 원금 전액" : undefined} />
        <Out label="총 이자" value={wonKo(l.interest)} sub={`총 상환 ${wonKo(l.total)}`} />
      </div>

      <p className="calc-note">
        입력한 값으로 이자만 계산합니다. 집공고는 대출 상품을 안내하거나 중개하지 않습니다.
        실제 한도와 금리, 중도상환 조건은 금융기관에서 확인하세요.
      </p>
    </div>
  );
}

export function CalcDock() {
  const { open, setOpen, seed, buttonRef } = useCalc();
  const [tab, setTab] = useState<Tab>("convert");

  // 여는 버튼으로 초점을 돌려준다. 닫기 자체(퇴장 애니메이션 · ESC · 배경 잠금)는 Sheet가 맡는다 —
  // 좁은 화면에선 아래에서 올라오는 시트, 넓은 화면에선 가운데 뜨는 창이다(fitin과 같은 분기).
  const close = useCallback(() => { setOpen(false); buttonRef.current?.focus(); }, [setOpen, buttonRef]);

  // 씨앗이 바뀌면(다른 공고로 이동) 입력칸을 새 값으로 다시 연다 — key로 탭 컴포넌트를 갈아끼운다
  const seedKey = `${seed.deposit ?? ""}|${seed.rent ?? ""}`;

  return (
    <Sheet open={open} onClose={close} title="계산기" size="sm">
      <nav className="seg calc-seg" data-on={tab} aria-label="계산기 종류">
        <span className="seg-ind" aria-hidden="true" />
        <button type="button" className={tab === "convert" ? "on" : ""} aria-pressed={tab === "convert"} onClick={() => setTab("convert")}>상호전환</button>
        <button type="button" className={tab === "loan" ? "on" : ""} aria-pressed={tab === "loan"} onClick={() => setTab("loan")}>대출이자</button>
      </nav>
      {tab === "convert"
        ? <ConvertTab key={seedKey} deposit={seed.deposit} rent={seed.rent} sourceLabel={seed.sourceLabel} />
        : <LoanTab key={seedKey} deposit={seed.deposit} />}
    </Sheet>
  );
}
