"use client";

// 자격진단 — 내 조건을 넣으면 33개 공급유형 중 어디에 넣을 수 있는지 가른다.
// 규칙은 서버가 DB(supply_type·income_standard·region_tier)에서 읽어 넘긴다. 여기서 계산만 한다(lib/eligibility).
// 값은 전부 브라우저 안에만 있다 — 어디로도 보내지 않는다(개인정보처리방침과 같은 약속).
import Link from "next/link";
import { useMemo, useState } from "react";
import { classOptions, diagnoseAll, HOUSEHOLD_MAX, type Marital, type Profile, type Verdict } from "@/lib/eligibility";
import { fitJanggi, janggiAreas, type FitProfile, type FitVerdict } from "@/lib/notice-fit";
import { noticePath } from "@/lib/routes";
import type { EligibilityRules, JanggiRule } from "@/types/eligibility";
import { Select } from "./select";

const MAN = 10_000;

const DEFAULT: Profile = {
  age: 30,
  marital: "미혼",
  marriedYears: 0,
  hasNewborn: false,
  household: 1,
  incomeSelfWon: 300 * MAN,
  incomeHouseholdWon: 300 * MAN,
  assetMan: 15_000,
  carMan: 0,
  homeless: true,
  classes: ["청년"],
  residence: "",
};

// 장기전세 세부 조건 — 면적·순위·출생자녀·맞벌이·청약 회차. supply_type 한 줄(income_pct)로는 매트릭스를 못 푼다(handoff 0-1).
// 기준은 장기전세 공고문의 표다. 공고마다 같은 양식이라 다음 공고에도 거의 그대로 가지만, 회차마다 소득 기준액과
// 공급 구분이 조금씩 갈린다 — 그래서 기본은 최신 회차로 두고 화면에서 회차를 바꿔 볼 수 있게 열어 뒀다(사용자 요청 2026-09-15).
/** 셀렉트에 걸 짧은 이름 — 「제51차 (2026.08.31)」. 회차를 못 읽으면 제목 앞머리를 쓴다 */
function janggiLabel(o: JanggiRule): string {
  const cha = /제\s*(\d+)\s*차/.exec(o.title);
  const head = cha ? `제${cha[1]}차` : o.title.slice(0, 14);
  return `${head} (${o.posted_at.replace(/-/g, ".")})`;
}

type JanggiExtra = { group: string | null; area: string | null; dual: boolean; newborns: number; olderMinor: boolean; deposits: number };

export function EligibilityCheck({ rules }: { rules: EligibilityRules }) {
  const [p, setP] = useState<Profile>(DEFAULT);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const jgList = rules.janggi ?? [];
  // 기준 회차 — 기본은 맨 앞(최신). 회차를 바꾸면 그 공고문의 표로 다시 푼다
  const [jgSlug, setJgSlug] = useState<string>(() => jgList[0]?.slug ?? "");
  const jg = jgList.find((o) => o.slug === jgSlug) ?? jgList[0] ?? null;
  const [jx, setJx] = useState<JanggiExtra>(() => ({
    group: jg?.data.rank_tables[0]?.group ?? null,
    area: jg?.data.rank_tables[0] ? janggiAreas(jg.data.rank_tables[0])[0] ?? null : null,
    dual: false, newborns: 0, olderMinor: false, deposits: 24,
  }));
  const setJ = <K extends keyof JanggiExtra>(k: K, v: JanggiExtra[K]) => setJx((prev) => ({ ...prev, [k]: v }));
  // 회차를 갈아타면 공급 구분과 면적은 그 회차 표의 첫 값으로 되돌린다 — 없는 구분이 남으면 진단이 빈손이 된다
  const pickJanggi = (slug: string) => {
    const next = jgList.find((o) => o.slug === slug);
    if (!next) return;
    setJgSlug(slug);
    const t = next.data.rank_tables[0];
    setJx((prev) => ({ ...prev, group: t?.group ?? null, area: t ? janggiAreas(t)[0] ?? null : null }));
  };
  const jgTable = jg?.data.rank_tables.find((t) => t.group === jx.group) ?? jg?.data.rank_tables[0];
  const jgAreas = useMemo(() => (jgTable ? janggiAreas(jgTable) : []), [jgTable]);
  const jgVerdict: FitVerdict | null = useMemo(() => {
    if (!jg) return null;
    const fp: FitProfile = {
      household: p.household, incomeWon: p.incomeHouseholdWon, dual: jx.dual, newborns: jx.newborns, olderMinor: jx.olderMinor,
      assetMan: p.assetMan, carMan: p.carMan, deposits: jx.deposits, gu: p.residence, residenceYears: 0, age: p.age, under2: p.hasNewborn,
      special: false, group: jx.group, area: jx.area, cls: null,
      applicantType: null, priorityClass: null, selfIncomeWon: 0, parentsHomeless: false, disabledSelf: false, disabledFamily: false,
    };
    return fitJanggi(jg.data, fp, rules.income);
  }, [jg, p, jx, rules.income]);

  const classes = useMemo(() => classOptions(rules.types), [rules.types]);
  const regions = useMemo(() => rules.tiers.filter((t) => t.tier === "서울").map((t) => t.name), [rules.tiers]);
  const nearby = useMemo(() => rules.tiers.filter((t) => t.tier === "연접").map((t) => t.name), [rules.tiers]);
  // 서울 구 → 연접지역(표시로 구분) → 그 외 지역 순. Select는 그룹 없는 단일 목록이라 이름에 표를 붙인다
  const residenceOptions = useMemo(() => [
    ...regions.map((r) => ({ value: r, label: r })),
    ...nearby.map((r) => ({ value: r, label: `${r} (연접지역)` })),
    { value: "그 외 지역", label: "그 외 지역" },
  ], [regions, nearby]);

  const verdicts = useMemo(() => diagnoseAll(p, rules), [p, rules]);
  const pass = verdicts.filter((v) => v.ok);
  const fail = verdicts.filter((v) => !v.ok);

  const toggleClass = (c: string) =>
    set("classes", p.classes.includes(c) ? p.classes.filter((x) => x !== c) : [...p.classes, c]);

  return (
    <div className="elig">
      <form className="elig-form" onSubmit={(e) => e.preventDefault()} aria-label="내 조건 입력">
        <div className="elig-grid">
          <Num label="나이" value={p.age} unit="세" onChange={(v) => set("age", v)} max={120} />
          <div className="elig-f wide">
            <span>혼인 상태</span>
            {/* 혼인신고 전인 예비신혼부부도 신혼부부 유형 상당수가 받아 준다 — 미혼/기혼 둘로는 못 담는 상태다 */}
            <div className="elig-seg" role="group" aria-label="혼인 상태">
              {(["미혼", "예비신혼부부", "기혼"] as Marital[]).map((m) => (
                <button key={m} type="button" className={p.marital === m ? "on" : ""} onClick={() => set("marital", m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          {p.marital === "기혼" && (
            <Num label="혼인 연차" value={p.marriedYears} unit="년차" onChange={(v) => set("marriedYears", v)} max={60} />
          )}
          <Num label="가구원 수" value={p.household} unit="명" onChange={(v) => set("household", v)} min={1} max={HOUSEHOLD_MAX} />
          <Num label="본인 월소득" value={Math.round(p.incomeSelfWon / MAN)} unit="만 원" onChange={(v) => set("incomeSelfWon", v * MAN)} max={100_000} />
          <Num label="세대 합산 월소득" value={Math.round(p.incomeHouseholdWon / MAN)} unit="만 원" onChange={(v) => set("incomeHouseholdWon", v * MAN)} max={100_000} />
          <Num label="총자산" value={p.assetMan} unit="만 원" onChange={(v) => set("assetMan", v)} max={1_000_000} />
          <Num label="자동차가액" value={p.carMan} unit="만 원" onChange={(v) => set("carMan", v)} max={100_000} />
          <div className="elig-f">
            <span>거주지</span>
            <Select
              value={p.residence}
              options={residenceOptions}
              onChange={(v) => set("residence", v)}
              placeholder="선택 안 함"
              ariaLabel="거주지"
            />
          </div>
        </div>

        <div className="elig-checks">
          <label className="elig-chk">
            <input type="checkbox" checked={p.homeless} onChange={(e) => set("homeless", e.target.checked)} />
            <span>무주택이다</span>
          </label>
          <label className="elig-chk">
            <input type="checkbox" checked={p.hasNewborn} onChange={(e) => set("hasNewborn", e.target.checked)} />
            <span>2세 이하 자녀가 있다</span>
          </label>
        </div>

        {jg && (
          <fieldset className="elig-cls">
            <legend>장기전세 세부 조건</legend>
            <div className="elig-grid">
              {/* 어느 회차의 표로 볼지. 기본은 최신 회차고, 지난 회차 표로 견줘 볼 수도 있다 */}
              <div className="elig-f wide">
                <span>기준 공고</span>
                {jgList.length > 1 ? (
                  <Select
                    value={jg.slug}
                    options={jgList.map((o) => ({ value: o.slug, label: janggiLabel(o) }))}
                    onChange={(v) => pickJanggi(v || jgList[0].slug)}
                    placeholder={janggiLabel(jgList[0])}
                    ariaLabel="기준 공고"
                    allowAll={false}
                  />
                ) : (
                  <p className="elig-src">{janggiLabel(jg)}</p>
                )}
              </div>
              {jg.data.rank_tables.length > 1 && (
                <div className="elig-f wide">
                  <span>공급 구분</span>
                  <Select value={jx.group ?? ""} options={jg.data.rank_tables.map((t) => ({ value: t.group, label: t.group }))}
                    onChange={(v) => { const t = jg.data.rank_tables.find((x) => x.group === v); setJx((prev) => ({ ...prev, group: v || null, area: t ? janggiAreas(t)[0] ?? null : null })); }}
                    placeholder="공급 구분" ariaLabel="장기전세 공급 구분" />
                </div>
              )}
              {jgAreas.length > 0 && (
                <div className="elig-f wide">
                  <span>신청 면적</span>
                  <div className="elig-seg" role="group" aria-label="신청 면적">
                    {jgAreas.map((a) => (
                      <button key={a} type="button" className={jx.area === a ? "on" : ""} onClick={() => setJ("area", a)}>{a}</button>
                    ))}
                  </div>
                </div>
              )}
              <Num label="청약 납입 회차" value={jx.deposits} unit="회" onChange={(v) => setJ("deposits", v)} max={600} />
              <Num label="2023.3.28. 이후 출생 자녀" value={jx.newborns} unit="명" onChange={(v) => setJ("newborns", v)} max={10} />
            </div>
            <div className="elig-checks" style={{ marginTop: 10 }}>
              <label className="elig-chk"><input type="checkbox" checked={jx.dual} onChange={(e) => setJ("dual", e.target.checked)} /><span>맞벌이다</span></label>
              <label className="elig-chk"><input type="checkbox" checked={jx.olderMinor} onChange={(e) => setJ("olderMinor", e.target.checked)} /><span>2023.3.27. 이전 출생 미성년 자녀가 있다</span></label>
            </div>
          </fieldset>
        )}

        <fieldset className="elig-cls">
          <legend>해당하는 계층 (여러 개 고를 수 있다)</legend>
          <div className="elig-chips">
            {classes.map((c) => (
              <button key={c} type="button" className={`elig-chip${p.classes.includes(c) ? " on" : ""}`} aria-pressed={p.classes.includes(c)} onClick={() => toggleClass(c)}>
                {c}
              </button>
            ))}
          </div>
        </fieldset>
      </form>

      <div className="elig-out">
        <h2>
          신청해 볼 수 있는 유형 <b>{pass.length}</b>
          <small>전체 {verdicts.length}개 중</small>
        </h2>
        {pass.length === 0 ? (
          <p className="elig-none">조건에 맞는 유형이 없다. 아래 미달 목록에서 어떤 기준에 걸리는지 볼 수 있다.</p>
        ) : (
          <ul className="elig-list">{pass.map((v) => <Card key={v.type.code} v={v} janggi={v.type.housing_type === "장기전세" ? jgVerdict : null} janggiRef={jg} area={jx.area} />)}</ul>
        )}

        <h2 className="mute">기준에 못 미치는 유형 <b>{fail.length}</b></h2>
        <ul className="elig-list">{fail.map((v) => <Card key={v.type.code} v={v} janggi={v.type.housing_type === "장기전세" ? jgVerdict : null} janggiRef={jg} area={jx.area} />)}</ul>

        <p className="elig-note">
          도시근로자 월평균소득은 {rules.incomeYear}년 고시액 기준이다. 이 진단은 안내일 뿐 심사 결과가 아니다 —
          실제 자격은 각 공고문과 기관 심사가 정한다. 입력한 값은 이 브라우저를 벗어나지 않는다.
        </p>
      </div>
    </div>
  );
}

function Card({ v, janggi, janggiRef, area }: { v: Verdict; janggi?: FitVerdict | null; janggiRef?: JanggiRule | null; area?: string | null }) {
  const t = v.type;
  const failed = v.checks.filter((c) => !c.ok);
  return (
    <li className={`elig-card${v.ok ? " ok" : ""}`}>
      <div className="elig-card-h">
        <b>{t.category}</b>
        <span>{t.name}</span>
        {/* 카드 색만으로는 통과·미달이 잘 안 읽힌다는 지적(2026-09-09) — 말로도 못 박는다 */}
        <span className="elig-card-r">
          <em className={`elig-badge${v.ok ? " ok" : ""}`}>{v.ok ? "신청 가능" : "신청불가"}</em>
          {t.ranking_method && <small>{t.ranking_method}</small>}
        </span>
      </div>
      <ul className="elig-why">
        {(v.ok ? v.checks : failed).map((c) => (
          <li key={c.label} className={c.ok ? "y" : "n"}>
            <span>{c.label}</span>
            <p>{c.detail}</p>
          </li>
        ))}
      </ul>
      {v.ok && t.ranks.length > 0 && (
        <p className="elig-rank">
          순위 {t.ranks.map((r, i) => `${i + 1}순위 ${r}`).join(" | ")}
        </p>
      )}
      {janggi && janggiRef && (
        /* 시드 한 줄(income_pct)이 아니라 최근 공고문의 면적×순위 매트릭스로 본 자리 — 순위가 곧 당락 순서다 */
        <p className={`elig-rank elig-jg${janggi.ok === false ? " n" : ""}`}>
          <b>{area ?? ""} {janggi.rankLabel}</b>
          {janggi.reasons[0] && <span> | {janggi.reasons[0].text}</span>}
          <small> | <Link href={noticePath(janggiRef.slug)}>{janggiRef.title}</Link> 기준</small>
        </p>
      )}
      {v.ok && t.note && <p className="elig-memo">{t.note}</p>}
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
        <input
          type="number"
          inputMode="numeric"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
        />
        <em>{unit}</em>
      </span>
    </label>
  );
}
