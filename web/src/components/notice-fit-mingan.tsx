"use client";

// 민간임대(청년안심주택) 공고의 「내 조건에 맞는 주택형」.
// 공공 공고의 NoticeFit과 묻는 것도 고르는 것도 다르다 — 민간임대 공고는 단지가 하나뿐이라(467건 중 465건)
// 고를 것은 단지가 아니라 주택형이고, 자격은 공고문에서 읽은 묶음이 아니라 제도 고정 규칙이다(lib/mingan-fit.ts 머리말).
// 특별공급과 일반공급을 따로 매겨 나란히 보인다 — 특별공급에서 떨어져도 일반공급은 열려 있다는 게
// 이 제도에서 제일 자주 오해받는 자리이고, 물량도 일반공급이 8할이다.
// 내 조건 값은 **화면 셋이 같이 쓰는 한 벌**이다(ProfileProvider, lib/profile.ts) — 자가진단에 넣은 소득을
// 여기서 또 넣지 않는다(사용자 요청 2026-09-22). 이 화면에만 있는 값은 없어서 제 저장소를 따로 두지 않는다.
// 옛 키(FIT_MINGAN_STORAGE_KEY)에 남아 있던 값은 ProfileProvider가 한 번 읽어 옮긴다.
import { useEffect, useMemo, useState } from "react";
import { num, wonShort } from "@/lib/format";
import {
  fitMingan, MINGAN_CLASSES, minganPicks,
  type MinganPick, type MinganProfile, type MinganTrack,
} from "@/lib/mingan-fit";
import { fromMingan, toMingan } from "@/lib/profile";
import type { IncomeStandard, RegionTier, SupplyType } from "@/types/eligibility";
import type { NoticeSupply } from "@/types/notice";
import { useProfile } from "./profile-context";
import { Select } from "./select";

type Props = {
  supply: NoticeSupply[];
  types: SupplyType[];
  income: IncomeStandard[];
  tiers: RegionTier[];
  /** 단지가 있는 자치구. 특별공급 지역순위를 가르는 값 */
  complexGu: string | null;
  /** 소득 기준액의 통계 연도와 이 공고의 연도. 다르면 「지금 기준」이라고 밝힌다 */
  incomeYear: number;
  noticeYear: number | null;
};

const MAN = 10_000;

const DEFAULT: MinganProfile = {
  cls: "청년", age: 30, household: 1, incomeWon: 300 * MAN, assetMan: 15_000, carMan: 0, homeless: true, gu: "",
};

export function NoticeFitMingan({ supply, types, income, tiers, complexGu, incomeYear, noticeYear }: Props) {
  const { profile, ready: profileReady, patch } = useProfile();
  const [open, setOpen] = useState(false);
  // 서버 HTML은 언제나 기본값이다 — 저장된 값은 마운트 뒤에 얹는다(하이드레이션이 어긋날 자리를 만들지 않는다)
  const [p, setP] = useState<MinganProfile>(DEFAULT);
  // setP의 갱신 함수 안에서 patch를 부르지 않는다 — 렌더 중에 남의 컴포넌트를 고치는 짓이 된다
  const set = <K extends keyof MinganProfile>(k: K, v: MinganProfile[K]) => {
    const next = { ...p, [k]: v };
    setP(next);
    patch(fromMingan(next, tiers, profile));
  };

  useEffect(() => {
    if (!profileReady) return;
    setP(toMingan(profile));
  }, [profileReady, profile]);

  const guOptions = useMemo(
    () => [...tiers.filter((t) => t.tier === "서울" && t.kind === "sigungu").map((t) => ({ value: t.name, label: t.name })), { value: "기타", label: "서울 외 지역" }],
    [tiers],
  );
  const verdict = useMemo(() => fitMingan(types, income, p, complexGu), [types, income, p, complexGu]);
  const picks = useMemo(() => minganPicks(supply, p, verdict), [supply, p, verdict]);
  const canCount = picks.filter((x) => x.can).length;
  const anyTrack = verdict.tracks.some((t) => t.ok);
  // 공고는 전년도 통계를 쓴다 — 시드 연도보다 뒤(2026년 공고 × 2025년 통계)라야 당시 기준과 같다
  const oldStandard = noticeYear != null && noticeYear <= incomeYear;

  return (
    <div className={`fit${open ? " open" : ""}`}>
      <button type="button" className={`btn${open ? "" : " acc"} fit-open`} aria-expanded={open} aria-controls="fit-body" onClick={() => setOpen((v) => !v)}>
        {open ? "내 조건 접기" : "내 조건 넣고 맞는 주택형 보기"}
      </button>
      {open && (
        <div className="fit-body" id="fit-body">
          <form className="fit-form" onSubmit={(e) => e.preventDefault()} aria-label="내 조건 입력">
            <div className="elig-grid">
              <div className="elig-f wide">
                <span>계층</span>
                <div className="elig-seg" role="group" aria-label="계층">
                  {MINGAN_CLASSES.map((c) => (
                    // 신혼부부로 바꿀 때 가구원 수가 1이면 2로 올린다 — 1인 기준 소득 한도를 대면 부부 소득이 무조건 넘는다
                    <button key={c} type="button" className={p.cls === c ? "on" : ""}
                      onClick={() => {
                        const next: MinganProfile = { ...p, cls: c, household: c === "신혼부부" && p.household < 2 ? 2 : p.household };
                        setP(next);
                        patch(fromMingan(next, tiers, profile));
                      }}>{c}</button>
                  ))}
                </div>
              </div>
              <div className="elig-f">
                <span>거주지</span>
                <Select value={p.gu} options={guOptions} onChange={(v) => set("gu", v)} placeholder="선택 안 함" ariaLabel="거주지" />
              </div>
              <Num label="나이" value={p.age} unit="세" onChange={(v) => set("age", v)} max={120} />
              <Num label="가구원 수" value={p.household} unit="명" onChange={(v) => set("household", v)} min={1} max={7} />
              <Num label={p.cls === "청년" ? "해당 세대 월소득" : "부부 합산 월소득"} value={Math.round(p.incomeWon / MAN)} unit="만 원" onChange={(v) => set("incomeWon", v * MAN)} max={100_000} />
              <Num label={p.cls === "청년" ? "본인 총자산" : "세대 총자산"} value={p.assetMan} unit="만 원" onChange={(v) => set("assetMan", v)} max={1_000_000} />
              <Num label="자동차가액" value={p.carMan} unit="만 원" onChange={(v) => set("carMan", v)} max={100_000} />
            </div>
            <div className="elig-checks">
              <label className="elig-chk"><input type="checkbox" checked={p.homeless} onChange={(e) => set("homeless", e.target.checked)} /><span>본인이 무주택자다</span></label>
            </div>
          </form>

          <div className={`fit-verdict${anyTrack ? " ok" : " no"}`}>
            <div className="fit-verdict-h">
              <em className={`elig-badge${anyTrack ? " ok" : ""}`}>{anyTrack ? "신청 가능" : "기준 미달"}</em>
              <b>{verdict.tracks.filter((t) => t.ok).map((t) => t.label).join(" | ") || "두 갈래 모두 미달"}</b>
            </div>
            <ul className="elig-why">
              {verdict.common.map((r, i) => (
                <li key={`c${i}`} className={r.ok === true ? "y" : r.ok === false ? "n" : ""}><span>{r.label}</span><p>{r.text}</p></li>
              ))}
            </ul>
            <div className="mg-tracks">
              {verdict.tracks.map((t) => <Track key={t.key} t={t} />)}
            </div>
            {verdict.region && (
              <p className="fit-tracks">
                <b>지역순위</b>는 특별공급에서 소득순위가 같을 때만 갈립니다 — {verdict.region.text}.
                거주지 외에 대학과 직장 소재지로도 인정됩니다. 일반공급은 지역을 보지 않습니다.
              </p>
            )}
            {!verdict.region && (
              <p className="fit-tracks">거주지를 고르면 특별공급 지역순위를 같이 매깁니다. 일반공급은 지역을 보지 않습니다.</p>
            )}
          </div>

          <div className="fit-list">
            <h3>
              내 조건에 드는 주택형 <b>{canCount}</b><small>개</small>
              {picks.length > canCount && <small>| 전체 {picks.length}개</small>}
            </h3>
            {picks.length === 0 ? (
              <p className="elig-none">이 공고의 공급현황 표에 {p.cls} 계층 줄이 없습니다. 계층을 바꿔 보세요.</p>
            ) : (
              <ul className="fit-rows">
                {picks.map((x) => <Row key={x.key} x={x} />)}
              </ul>
            )}
            <p className="elig-note">
              공고문의 제도 기준을 내 조건에 대 본 안내입니다. 심사 결과가 아닙니다.
              {oldStandard
                ? ` 소득 기준액은 ${incomeYear}년 통계이고 이 공고는 ${noticeYear}년 공고라, 당시 기준과 다릅니다. 자산과 자동차가액 한도도 지금 기준입니다.`
                : ` 소득 기준액은 ${incomeYear}년 통계 기준입니다.`}
              {" "}자세한 요건과 제출서류는 공고문 원본을 보세요. 넣은 값은 자격진단 화면과 같은 한 벌이며,
              내 계정에서 저장을 켜지 않는 한 서버로 보내지 않습니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Track({ t }: { t: MinganTrack }) {
  return (
    <div className={`mg-track${t.ok ? " ok" : ""}`}>
      <b>{t.key}</b>
      <em>{t.ok ? (t.rank != null ? `소득 ${t.rank}순위` : "신청 가능") : "미달"}</em>
      <ul className="elig-why">
        {t.reasons.map((r, i) => (
          <li key={i} className={r.ok === true ? "y" : r.ok === false ? "n" : ""}><span>{r.label}</span><p>{r.text}</p></li>
        ))}
      </ul>
    </div>
  );
}

function Row({ x }: { x: MinganPick }) {
  const money = x.rent != null
    ? `월 ${wonShort(x.rent)}${x.deposit != null ? ` | 보증금 ${wonShort(x.deposit)}` : ""}`
    : x.deposit != null ? `보증금 ${wonShort(x.deposit)}` : "";
  const ratios = (x.depositOptions ?? []).map((o) => o.label).filter(Boolean);
  const sub = [x.area != null ? `전용 ${x.area}㎡` : "", money, x.units != null ? num(x.units, "호") : ""].filter(Boolean).join(" | ");
  // 공급 구분이 표에 없는 줄은 특별공급인지 일반공급인지 몰라 「신청 가능」이라 못 박지 않는다
  const sure = x.option != null;
  return (
    <li>
      <div className={`fit-row${x.can && sure ? " can" : ""}`}>
        <span className="fit-row-main">
          <b>{x.supplyType}</b>
          <small>{x.tenantClass}{x.option ? ` | ${x.option}` : ""}</small>
        </span>
        <span className="fit-row-sub">{sub || "금액 미확인"}</span>
        {ratios.length > 1 && <span className="fit-row-prior"><small>보증금 비율</small><span>{ratios.join(" | ")}</span></span>}
        <span className="fit-tags">
          <em className={`tag ${x.can && sure ? "acc" : "soft"}`}>{!sure ? "구분 미확인" : x.can ? "신청 가능" : "해당 없음"}</em>
        </span>
      </div>
    </li>
  );
}

function Num({ label, value, unit, onChange, min = 0, max }: {
  label: string; value: number; unit: string; onChange: (v: number) => void; min?: number; max: number;
}) {
  return (
    <label className="elig-f">
      <span>{label}</span>
      <span className="elig-in">
        <input type="number" inputMode="numeric" value={Number.isFinite(value) ? value : 0} min={min} max={max}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} />
        <em>{unit}</em>
      </span>
    </label>
  );
}
