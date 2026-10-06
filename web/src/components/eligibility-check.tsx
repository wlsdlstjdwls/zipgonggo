"use client";

// 자격진단 — 내 조건을 넣으면 33개 공급유형 중 어디에 넣을 수 있는지 가른다.
// 규칙은 서버가 DB(supply_type·income_standard·region_tier)에서 읽어 넘긴다. 여기서 계산만 한다(lib/eligibility).
// 넣은 값은 **화면 셋이 같이 쓰는 한 벌**로 남는다(ProfileProvider, lib/profile.ts). 전에는 이 화면만
// 아무것도 저장하지 않아 들어올 때마다 기본값으로 되돌아갔고, 같은 소득을 공고 지면에서 또 넣어야 했다
// (사용자 지적 2026-09-22). 그 한 벌은 브라우저에 있고, 로그인한 뒤 계정 저장을 켠 사람만 서버에도 사본을 둔다.
// 장애 여부처럼 건강과 이어지는 계층은 켜도 서버로 가지 않는다(개인정보처리방침 3항).
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type Check, classOptions, diagnoseAll, HOUSEHOLD_MAX, incomeUsed, type Marital, type Profile, tierOf, type Verdict } from "@/lib/eligibility";
import { fitJanggi, type FitProfile, type FitVerdict } from "@/lib/notice-fit";
import { dateMD, daysUntil, wonKo } from "@/lib/format";
import { fromElig, reconcileRegion, SENSITIVE_CLASSES, toElig } from "@/lib/profile";
import type { OpenSoonNotice, ResidenceArea, TypeHub } from "@/lib/queries";
import { noticePath, typePath } from "@/lib/routes";
import { SIDOS, sidoShort } from "@/lib/sido";
import type { EligibilityRules, JanggiRule } from "@/types/eligibility";
import { DateField } from "./date-field";
import { useProfile } from "./profile-context";
import { Select } from "./select";

const MAN = 10_000;

const DEFAULT: Profile = {
  age: 30,
  marital: "미혼",
  marriedYears: 0,
  weddingAt: "",
  hasNewborn: false,
  household: 1,
  incomeSelfWon: 300 * MAN,
  incomeHouseholdWon: 300 * MAN,
  assetMan: 15_000,
  assetSelfMan: 15_000,
  carMan: 0,
  homeless: true,
  homelessSelf: true,
  classes: ["청년"],
  residence: "",
  dual: false,
};

// 장기전세 세부 조건 — 순위·출생자녀·맞벌이·청약 회차. supply_type 한 줄(income_pct)로는 매트릭스를 못 푼다(handoff 0-1).
// 기준은 늘 **최신 회차** 공고문의 표다. 지난 회차로 바꿔 보는 칸을 뒀었지만(2026-09-15), 지금 넣을 수 있는
// 건 최신 회차뿐이라 고를 일이 없었다 — 걷어 냈다(사용자 지적 2026-09-22). 어느 공고를 봤는지는 결과 카드가 링크로 밝힌다.

type JanggiExtra = { dual: boolean; newborns: number; olderMinor: boolean; deposits: number };

/** 결과에 붙일 「지금 열린 공고」에 몇 줄까지 보일지. 나머지는 유형 지면으로 넘긴다 */
const OPEN_ROWS = 6;

export function EligibilityCheck({ rules, open = [], hubs = [], areas = [] }: {
  rules: EligibilityRules;
  /** 마감 임박 순 열린 공고 한 줌. 통과한 유형만 골라 그린다 */
  open?: OpenSoonNotice[];
  /** 유형별 전국 현황 — 실어 온 한 줌에 안 들어온 공고까지 세어 「그 밖에 N건」을 적는다 */
  hubs?: TypeHub[];
  /** 거주지 셀렉트에 세울 전국 시군구(공고가 있는 곳만) */
  areas?: ResidenceArea[];
}) {
  const { profile, ready: profileReady, patch } = useProfile();
  // 서버 HTML은 언제나 기본값이다 — 저장된 값은 마운트 뒤에 얹는다(하이드레이션이 어긋날 자리를 만들지 않는다)
  const [p, setP] = useState<Profile>(DEFAULT);
  // setP의 갱신 함수 안에서 patch를 부르지 않는다 — 렌더 중에 남의 컴포넌트를 고치는 짓이 된다
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    const next = { ...p, [k]: v };
    setP(next);
    patch(fromElig(next, rules.tiers));
  };
  // 본인 칸과 세대 칸은 서로를 거스를 수 없다. 한 번에 둘을 고쳐야 해서 set()을 두 번 부르지 않는다 —
  // 두 번 부르면 앞의 setP가 만든 next를 뒤가 모르고 옛 p 위에 덮는다
  const setPair = (patchIn: Partial<Profile>) => {
    const next = { ...p, ...patchIn };
    setP(next);
    patch(fromElig(next, rules.tiers));
  };
  /** 본인이 집을 가졌으면 세대도 가진 것이다 */
  const setHomelessSelf = (v: boolean) => setPair(v ? { homelessSelf: true } : { homelessSelf: false, homeless: false });
  /** 본인 자산은 세대 자산의 일부다 — 본인을 올리면 세대를 같이 밀어 올린다 */
  const setAssetSelf = (v: number) => setPair({ assetSelfMan: v, ...(v > p.assetMan ? { assetMan: v } : {}) });
  /** 세대를 본인 아래로 내리면 본인도 따라 내린다 */
  const setAssetHousehold = (v: number) => setPair({ assetMan: v, ...(v < p.assetSelfMan ? { assetSelfMan: v } : {}) });

  // 기준 회차는 맨 앞(최신) 하나다
  const jg: JanggiRule | null = (rules.janggi ?? [])[0] ?? null;
  // 맞벌이·자녀·청약 회차는 여기서 묻지 않는다(사용자 요청 2026-09-22) — 장기전세 한 유형만 쓰는 값이라
  // 칸 넷이 첫 화면을 다 먹었다. 공고 지면의 「내 조건」이 묻고 그 한 벌(ProfileProvider)을 여기서 읽어 쓴다
  const [jx, setJx] = useState<JanggiExtra>(() => ({ dual: false, newborns: 0, olderMinor: false, deposits: 24 }));
  // 공급 구분과 신청 면적은 묻지 않는다(사용자 지적 2026-09-22) — 단지마다 나오는 면적이 달라
  // 여기서 하나를 고르게 하면 고른 값이 곧 틀린 값이 된다. 대신 그 회차의 표를 전부 대 보고
  // 가장 앞선 자리 하나를 보인다. 면적을 안 주면 fitJanggi가 표 안의 모든 면적 줄을 순위 순으로 훑는다.
  const jgFit = useMemo((): { v: FitVerdict; group: string | null } | null => {
    if (!jg) return null;
    const fp: FitProfile = {
      household: p.household, incomeWon: p.incomeHouseholdWon, dual: p.dual, newborns: jx.newborns, olderMinor: jx.olderMinor,
      assetMan: p.assetMan, carMan: p.carMan, deposits: jx.deposits, gu: p.residence, residenceYears: 0, age: p.age, under2: p.hasNewborn,
      special: false, group: null, area: null, cls: null,
      applicantType: null, priorityClass: null, selfIncomeWon: 0, parentsHomeless: false, disabledSelf: false, disabledFamily: false,
    };
    const groups: (string | null)[] = jg.data.rank_tables.length ? jg.data.rank_tables.map((t) => t.group) : [null];
    // 붙는 자리가 앞설수록 작다 — 통과 못 한 표는 뒤로 민다. 순위 없는 표(우선공급)는 다자녀처럼
    // 여기서 묻지 않는 자격을 더 요구하니 순위 있는 표 뒤에 세운다 — 있는 자리를 부풀리지 않는다
    const seat = (v: FitVerdict) => (v.ok ? v.rank ?? 50 : 99);
    let best: { v: FitVerdict; group: string | null } | null = null;
    for (const g of groups) {
      const v = fitJanggi(jg.data, { ...fp, group: g }, rules.income);
      if (!best || seat(v) < seat(best.v)) best = { v, group: g };
    }
    return best;
  }, [jg, p, jx, rules.income]);
  const jgVerdict = jgFit?.v ?? null;

  const classes = useMemo(() => classOptions(rules.types), [rules.types]);
  const regions = useMemo(() => rules.tiers.filter((t) => t.tier === "서울").map((t) => t.name), [rules.tiers]);
  const nearby = useMemo(() => rules.tiers.filter((t) => t.tier === "연접").map((t) => t.name), [rules.tiers]);
  // 서울 구 → 연접지역(표시로 구분) → 그 밖의 시도 순. Select는 그룹 없는 단일 목록이라 이름에 표를 붙인다.
  // region_tier에는 서울 25구와 연접 13곳뿐이라 그 밖에 사는 사람은 「그 외 지역」 하나로 뭉뚱그려졌다
  // (사용자 지적 2026-09-22). 진단에 쓰는 등급은 그래도 「기타」지만, 시도를 알면 오른쪽 공고 목록을
  // 내 시도부터 세울 수 있다 — LH 공고가 전국에서 올라온다
  const residenceOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    // 인천광역시는 연접 줄에도 있다 — 값으로도 표로도 한 번씩만 들어가게 둘 다 본다.
    // 시군구 이름은 시도를 건너 겹치기도 한다(고성군 강원/경남) — 먼저 들어온 쪽만 남는다.
    // 값은 **시군구 이름 한 토막**으로 둔다: region_tier 조회(tierOf)와 공고의 sigungu 비교가 그 어휘를 쓴다
    const push = (value: string, label: string) => {
      if (seen.has(value) || seen.has(label)) return;
      seen.add(value); seen.add(label);
      out.push({ value, label });
    };
    for (const r of regions) push(r, r);
    for (const r of nearby) push(r, `${r} (연접지역)`);
    // 나머지는 시도별로 「전체」 한 줄 뒤에 그 시도의 시군구를 세운다. 시도 순서는 SIDOS를 따르고,
    // 표에 없는 시도(통합특별시처럼 새로 생긴 이름)는 뒤에 붙인다
    const bySido = new Map<string, string[]>();
    for (const a of areas) {
      if (a.sido === "서울특별시") continue;
      const list = bySido.get(a.sido);
      if (list) list.push(a.sigungu);
      else bySido.set(a.sido, [a.sigungu]);
    }
    const order = (name: string) => {
      const i = SIDOS.findIndex((sd) => sd.name === name);
      return i < 0 ? SIDOS.length : i;
    };
    for (const sido of [...bySido.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b, "ko"))) {
      const short = sidoShort(sido);
      push(sido, `${short} 전체`);
      for (const gu of bySido.get(sido) ?? []) push(gu, `${short} ${gu}`);
    }
    return out;
  }, [regions, nearby, areas]);

  const verdicts = useMemo(() => diagnoseAll(p, rules), [p, rules]);
  const pass = verdicts.filter((v) => v.ok);
  const fail = verdicts.filter((v) => !v.ok);

  // 통과한 공급유형의 housing_type들. 한 housing_type에 공급유형이 여럿 걸리니(행복주택 5개) 묶는다.
  // supply_type.housing_type이 null인 「수요자맞춤형」과, 공고 쪽에만 있는 유형(10년임대·통합공공임대 등)은
  // 짝이 없다 — 억지로 잇지 않고 빠뜨린다. 없는 짝을 있는 척하는 게 더 나쁘다
  const passTypes = useMemo(() => {
    const set = new Set<string>();
    for (const v of pass) if (v.type.housing_type) set.add(v.type.housing_type);
    return set;
  }, [pass]);

  // 내가 사는 데를 앞에 세운다. 마감 임박 순으로만 세우면 서울 사람에게 대구 공고가 먼저 뜬다.
  // 거주지를 아직 안 골랐으면(기본값) 손대지 않고 마감 순 그대로 둔다
  const mySido = useMemo(() => {
    if (!p.residence) return null;
    if (tierOf(p.residence, rules.tiers) === "서울") return "서울특별시";
    // 시도를 골랐으면 그대로. 시군구를 골랐으면 전국 목록에서 그 시군구의 시도를 찾는다
    if (SIDOS.some((sd) => sd.name === p.residence)) return p.residence;
    return areas.find((a) => a.sigungu === p.residence)?.sido ?? null;
  }, [p.residence, rules.tiers, areas]);
  const openMine = useMemo(() => {
    const mine = open.filter((n) => passTypes.has(n.housing_type));
    if (!p.residence) return mine;
    // 시도는 통칭으로 견준다 — 공고가 「강원도」로 올라오고 고른 값이 「강원특별자치도」면 글자로는 안 맞는다
    const near = (n: OpenSoonNotice) =>
      n.sigungu === p.residence ? 0 : mySido && n.sido && sidoShort(n.sido) === sidoShort(mySido) ? 1 : 2;
    // 정렬이 안정적이라(ES2019) 같은 등급 안에서는 쿼리가 준 마감 임박 순이 그대로 남는다
    return [...mine].sort((a, b) => near(a) - near(b));
  }, [open, passTypes, p.residence, mySido]);
  /** 실어 온 한 줌 밖의 공고까지 센 진짜 건수. hubs는 전국 현황이라 한 줌에 안 실린 것도 안다 */
  const openTotal = useMemo(
    () => hubs.filter((h) => passTypes.has(h.housing_type)).reduce((s, h) => s + h.open, 0),
    [hubs, passTypes],
  );
  const openByType = useMemo(
    () => hubs.filter((h) => passTypes.has(h.housing_type) && h.open > 0).sort((a, b) => b.open - a.open),
    [hubs, passTypes],
  );

  const toggleClass = (c: string) =>
    set("classes", p.classes.includes(c) ? p.classes.filter((x) => x !== c) : [...p.classes, c]);

  // 저장된 한 벌을 화면에 얹는다. 서버 사본이 뒤늦게 도착해도 같은 길로 들어온다 —
  // 얹는 자리가 하나뿐이라 두 경로가 어긋날 여지가 없다
  useEffect(() => {
    if (!profileReady) return;
    setP(toElig(profile));
    setJx((prev) => ({ ...prev, dual: profile.dual, newborns: profile.newborns, olderMinor: profile.olderMinor, deposits: profile.deposits }));
  }, [profileReady, profile]);
  // 옛 저장분에서 온 거주지는 한쪽 어휘만 차 있다. 시군구 목록을 든 이 화면이 한 번 채운다
  const fixed = useRef(false);
  useEffect(() => {
    if (!profileReady || fixed.current) return;
    fixed.current = true;
    const fix = reconcileRegion(profile, rules.tiers);
    if (fix) patch(fix);
  }, [profileReady, profile, rules.tiers, patch]);

  // 결과를 세 묶음으로 가른다(사용자 요청 2026-10-06: "가능/불가뿐이라 밋밋하다").
  // 한 가지 기준만 걸린 유형은 「얼마나 모자라나」를 말해 줄 수 있어 따로 세운다 — 무엇을 바꾸면 되는지가 보인다
  const near = fail.filter((v) => v.checks.filter((c) => !c.ok).length === 1);
  /** 지원 가능 중 우리가 단정 못 한 항목이 섞인 것 — 카드가 「확인 필요」로 그린다 */
  const passUnsure = pass.filter((v) => v.unsure).length;
  const far = fail.filter((v) => v.checks.filter((c) => !c.ok).length > 1);
  const classGroups = useMemo(() => groupClasses(classes), [classes]);

  return (
    <div className="elig">
      <form className="elig-form ej-form" onSubmit={(e) => e.preventDefault()} aria-label="내 조건 입력">
        {/* 입력을 주제별 다섯 덩이로 묶는다(사용자 요청 2026-10-06: 가독성). 한 질문씩 넘기는 마법사는 만들지 않는다 —
            값을 바꿔 가며 결과를 견주는 게 이 화면의 쓸모다(사용자 결정 2026-09-22) */}
        <Section n={1} title="나와 가구">
          <div className="elig-grid">
            <Num label="나이" value={p.age} unit="세" onChange={(v) => set("age", v)} max={120} help="만 나이" />
            <Num label="가구원 수" value={p.household} unit="명" onChange={(v) => set("household", v)} min={1} max={HOUSEHOLD_MAX} help="나를 포함해 등본에 함께 오른 사람" />
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
              <Num label="혼인 연차" value={p.marriedYears} unit="년차" onChange={(v) => set("marriedYears", v)} max={60} help="혼인신고일부터 센다" />
            )}
            {/* 예비신혼부부는 입주 전까지 혼인신고를 마쳐야 자격이 서니 예정일을 묻는다(사용자 지적 2026-09-22) */}
            {p.marital === "예비신혼부부" && (
              <div className="elig-f wide">
                <span>혼인 예정일</span>
                {/* OS 달력 대신 셀렉트와 같은 톤의 달력(사용자 지적 2026-10-06) */}
                <DateField value={p.weddingAt} onChange={(v) => set("weddingAt", v)} ariaLabel="혼인 예정일" />
              </div>
            )}
          </div>
          <label className="elig-chk">
            <input type="checkbox" checked={p.hasNewborn} onChange={(e) => set("hasNewborn", e.target.checked)} />
            <span>2세 이하 자녀가 있다 <small>신혼 유형은 만 6세 이하 자녀가 있으면 혼인기간 제한이 풀린다</small></span>
          </label>
        </Section>

        <Section n={2} title="한 달 소득" hint="세금 떼기 전, 월평균">
          <div className="elig-grid">
            <Num label="본인 월소득" value={Math.round(p.incomeSelfWon / MAN)} unit="만 원" onChange={(v) => set("incomeSelfWon", v * MAN)} max={100_000} read />
            <Num label="세대 합산 월소득" value={Math.round(p.incomeHouseholdWon / MAN)} unit="만 원" onChange={(v) => set("incomeHouseholdWon", v * MAN)} max={100_000} read />
          </div>
          {/* 신혼 계열은 외벌이와 맞벌이 기준이 다르다(외벌이 70% / 맞벌이 90% 등, docs/eligibility-audit.md) */}
          {p.marital !== "미혼" && (
            <label className="elig-chk">
              <input type="checkbox" checked={p.dual} onChange={(e) => set("dual", e.target.checked)} />
              <span>맞벌이다 <small>본인과 배우자 모두 소득이 있으면 신혼 유형의 소득 기준이 올라간다</small></span>
            </label>
          )}
          <p className="ej-help">
            연봉이면 12로 나눠 넣습니다(연봉 4,200만 원이면 350). 세대 합산은 등본에 함께 오른 배우자와 부모 등의 소득을 모두 더한 값입니다.
          </p>
        </Section>

        <Section n={3} title="자산과 자동차">
          {/* 자산을 두 칸으로 나눈 건 시드가 asset_scope를 「본인」과 「세대」로 갈라 두었기 때문이다.
              한 칸으로 보면 부모와 사는 청년이 세대 자산 때문에 청년 유형까지 떨어진다(2026-09-22 정정) */}
          <div className="elig-grid">
            <Num label="본인 총자산" value={p.assetSelfMan} unit="만 원" onChange={(v) => setAssetSelf(v)} max={1_000_000} read />
            <Num label="세대 총자산" value={p.assetMan} unit="만 원" onChange={(v) => setAssetHousehold(v)} max={1_000_000} read />
            <Num label="자동차가액" value={p.carMan} unit="만 원" onChange={(v) => set("carMan", v)} max={100_000} read help="없으면 0" />
          </div>
          <p className="ej-help">
            총자산은 부동산, 예금과 주식, 전월세 보증금, 자동차를 더하고 빚을 뺀 값입니다. 자동차가액은 보험개발원 차량기준가액으로 봅니다.
          </p>
        </Section>

        <Section n={4} title="집과 사는 곳">
          <div className="elig-checks">
            {/* 무주택도 시드가 「본인」과 「세대원」으로 갈라 두었다. 본인이 유주택이면 세대도 유주택이라
                세대 칸은 본인이 무주택일 때만 묻는다 */}
            <label className="elig-chk">
              <input type="checkbox" checked={p.homelessSelf} onChange={(e) => setHomelessSelf(e.target.checked)} />
              <span>본인 명의 주택이 없다</span>
            </label>
            {p.homelessSelf && (
              <label className="elig-chk">
                <input type="checkbox" checked={p.homeless} onChange={(e) => set("homeless", e.target.checked)} />
                <span>세대원(부모 등) 명의 주택도 없다</span>
              </label>
            )}
          </div>
          <div className="elig-f">
            <span>거주지</span>
            <Select
              value={p.residence}
              options={residenceOptions}
              onChange={(v) => set("residence", v)}
              placeholder="선택 안 함"
              ariaLabel="거주지"
            />
            <small className="ej-fhelp">서울 거주자만 받는 유형이 있어 묻습니다</small>
          </div>
        </Section>

        <Section n={5} title="해당하는 대상" hint="여러 개 고를 수 있어요">
          {classGroups.map((g) => (
            <div key={g.title} className="ej-clsg">
              <b>{g.title}</b>
              <div className="elig-chips">
                {g.items.map((c) => (
                  <button key={c} type="button" className={`elig-chip${p.classes.includes(c) ? " on" : ""}`} aria-pressed={p.classes.includes(c)} onClick={() => toggleClass(c)}>
                    {c}
                  </button>
                ))}
              </div>
              {g.sensitive && <small className="ej-fhelp">이 항목은 이 기기에만 남고 계정에 저장해도 서버로 보내지 않습니다</small>}
            </div>
          ))}
        </Section>

        {/* 폰에서는 조건 칸 다섯 덩이 밑에 결과가 있어 한참 내려가야 한다 — 조건을 넣는 동안 바닥에 붙어 따라오는 지름길.
            조건 칸이 끝나면 같이 밀려 올라가 결과와 겹치지 않는다(sticky) */}
        <a href="#ej-pass" className="ej-jump">
          <span>결과 보기</span>
          <b>지원 가능 {pass.length}</b>
          <small>한 가지만 걸림 {near.length}</small>
        </a>
      </form>

      <div className="elig-out">
        {/* 한눈에 셋 — 몇 개가 되고, 몇 개가 한 끗 차이고, 몇 개가 멀었나. 누르면 그 묶음으로 내려간다 */}
        <nav className="ej-sum" aria-label="진단 요약">
          <a href="#ej-pass" className="ok"><b>{pass.length}</b><span>지원 가능{passUnsure > 0 ? ` (확인 ${passUnsure})` : ""}</span></a>
          <a href="#ej-near" className="near"><b>{near.length}</b><span>한 가지만 걸림</span></a>
          <a href="#ej-far" className="far"><b>{far.length}</b><span>지원 어려움</span></a>
        </nav>
        <p className="ej-note">제도 일반 기준으로 본 결과입니다. 공고마다 기준이 조금씩 달라 실제 자격은 공고문과 기관 심사가 정합니다.</p>

        <h2 id="ej-pass">지원 가능한 유형 <b>{pass.length}</b></h2>
        {pass.length === 0 ? (
          <p className="elig-none">지금 조건으로 바로 되는 유형은 없습니다. 아래 「한 가지만 걸림」에서 무엇이 모자란지 볼 수 있어요.</p>
        ) : (
          <ul className="ej-list">
            {pass.map((v) => (
              <PassCard key={v.type.code} v={v} p={p} janggi={v.type.housing_type === "장기전세" ? jgVerdict : null} janggiRef={jg} group={jgFit?.group ?? null} />
            ))}
          </ul>
        )}

        {/* 유형 목록에서 끝나면 「그래서 지금 뭘 넣나」에 답이 없다. 통과한 유형의 열린 공고로 잇는다 */}
        {openTotal > 0 && (
          <section className="elig-open">
            <h2>
              지금 신청할 수 있는 공고 <b>{openTotal.toLocaleString("ko-KR")}</b>
              <small>지원 가능한 유형 기준</small>
            </h2>
            <p className="elig-open-sub">유형이 맞는다는 뜻이고, 공고마다 나이와 소득 기준이 조금씩 다릅니다. 신청 전에 공고문을 확인하세요.</p>
            {openMine.length > 0 && (
              <ul className="elig-open-list">
                {openMine.slice(0, OPEN_ROWS).map((n) => {
                  const d = daysUntil(n.apply_end_at);
                  return (
                    <li key={n.id}>
                      <Link href={noticePath(n.slug)}>
                        <em>{n.housing_type}</em>
                        <b>{n.title}</b>
                        <span>
                          {[n.agency, n.sigungu || n.sido].filter(Boolean).join(" | ")}
                          {/* LH는 한 모집을 seq 여러 개로 올린다 — 접어 놓고 몇 건인지는 밝힌다 */}
                          {n.same_count > 1 && <u>외 {n.same_count - 1}건</u>}
                          {n.apply_end_at && (
                            <i>
                              {d !== null && d >= 0 ? (d === 0 ? "오늘 마감" : `D-${d}`) : "마감"}
                              {" "}({dateMD(n.apply_end_at)})
                            </i>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="elig-open-more">
              {openByType.map((h) => (
                <Link key={h.housing_type} href={typePath(h.housing_type)}>
                  {h.housing_type} {h.open}
                </Link>
              ))}
            </p>
          </section>
        )}

        <h2 id="ej-near" className="ej-h-near">한 가지만 걸리는 유형 <b>{near.length}</b><small>이것만 맞으면 지원할 수 있어요</small></h2>
        {near.length === 0 ? (
          <p className="elig-none">한 가지 기준만 걸리는 유형은 없습니다.</p>
        ) : (
          <ul className="ej-list">{near.map((v) => <NearCard key={v.type.code} v={v} p={p} />)}</ul>
        )}

        {/* 여러 기준에 걸리는 유형은 접어 둔다 — 펴 두면 지면 절반이 「안 된다」로 찬다 */}
        <details className="ej-far" id="ej-far">
          <summary>
            <b>지원 어려운 유형 {far.length}개</b>
            <small>두 가지 이상 기준에 걸립니다</small>
          </summary>
          <ul className="ej-farlist">
            {far.map((v) => {
              const failed = v.checks.filter((c) => !c.ok);
              return (
                <li key={v.type.code}>
                  <b>{v.type.category} <span>{v.type.name}</span></b>
                  <p>{failed.map((c) => c.label).join(", ")} 기준에 걸림</p>
                </li>
              );
            })}
          </ul>
        </details>
      </div>
    </div>
  );
}

/** 대상 칩을 성격별로 묶는다. 시드에 새 계층이 생기면 「그 밖의 대상」으로 떨어진다 — 목록을 코드에 박아 두되 잃지는 않는다 */
const CLASS_GROUPS: { title: string; items: string[]; sensitive?: boolean }[] = [
  { title: "청년과 학생", items: ["청년", "대학생", "취업준비생", "사회초년생"] },
  { title: "신혼과 자녀", items: ["신혼", "혼인가구", "신생아", "한부모", "다자녀"] },
  { title: "고령과 소득 지원", items: ["고령자", "수급자", "차상위", "저소득"] },
  { title: "보호 대상", items: SENSITIVE_CLASSES, sensitive: true },
];

function groupClasses(all: string[]) {
  const used = new Set<string>();
  const out = CLASS_GROUPS.map((g) => {
    const items = g.items.filter((c) => all.includes(c));
    items.forEach((c) => used.add(c));
    return { ...g, items };
  }).filter((g) => g.items.length > 0);
  const rest = all.filter((c) => !used.has(c));
  if (rest.length) out.push({ title: "그 밖의 대상", items: rest });
  return out;
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="ej-sec">
      <h3><i>{n}</i>{title}{hint && <small>{hint}</small>}</h3>
      {children}
    </section>
  );
}

/** 화면에는 만 원 단위로만 — 「381만 3,363원」은 읽히지 않는다. 정확한 값은 title로 */
const roundMan = (n: number) => Math.round(n / MAN) * MAN;

/** 시드 선정 방식 칸의 메모 말투를 화면 말로 */
const RANKING_TEXT: Record<string, string> = { 자치구별상이: "자치구마다 다름" };
const rankingText = (m: string | null) => (m && m !== "무관" ? RANKING_TEXT[m] ?? m : null);

/** 소득처럼 금액으로 견주는 기준을 막대 하나로. 막대가 짧을수록 여유가 있다 */
function Meter({ mine, limit, label }: { mine: number; limit: number; label: string }) {
  const ratio = limit > 0 ? Math.min(mine / limit, 1.25) : 0;
  const over = mine > limit;
  return (
    <div className={`ej-meter${over ? " over" : ""}`}>
      <div className="ej-meter-t">
        <span>{label}</span>
        <b title={`${mine.toLocaleString("ko-KR")}원 / 기준 ${limit.toLocaleString("ko-KR")}원`}>
          내 {wonKo(roundMan(mine))} <small>/ 기준 {wonKo(roundMan(limit))}</small>
        </b>
      </div>
      <div className="ej-meter-bar"><i style={{ width: `${Math.min(ratio / 1.25, 1) * 100}%` }} /><u style={{ left: `${(1 / 1.25) * 100}%` }} /></div>
    </div>
  );
}

function PassCard({ v, p, janggi, janggiRef, group }: { v: Verdict; p: Profile; janggi?: FitVerdict | null; janggiRef?: JanggiRule | null; group?: string | null }) {
  const t = v.type;
  // 소득이 세대주 여부로 갈리면 막대 하나로 그릴 수 없다 — 막대를 걷고 아래 「확인 필요」 줄이 두 갈래를 말한다
  const incomeUnsure = v.checks.some((c) => c.label === "소득" && c.unsure);
  const income = v.incomeLimitWon != null && !incomeUnsure ? { mine: incomeUsed(t, p), limit: v.incomeLimitWon } : null;
  // 단정 못 한 항목(세대주 여부, 부모 소득, 6세 이하 자녀, 거주지 미입력)은 숨기지 않고 카드 위로 올린다
  const unsure = v.checks.filter((c) => c.unsure);
  return (
    <li className={`ej-card ${v.unsure ? "near" : "ok"}`}>
      <div className="ej-card-h">
        <b>{t.category}</b>
        <span>{t.name}</span>
        <em className={`ej-badge ${v.unsure ? "near" : "ok"}`}>{v.unsure ? "확인 필요" : "지원 가능"}</em>
      </div>
      {income ? (
        <Meter mine={income.mine} limit={income.limit} label={`소득 ${v.incomePct}% 기준`} />
      ) : !incomeUnsure && (
        <p className="ej-card-s">소득 기준 없음</p>
      )}
      {unsure.map((c) => (
        <p key={c.label} className="ej-unsure"><b>{c.label}</b> {c.detail}</p>
      ))}
      {janggi && janggiRef && (
        /* 시드 한 줄(income_pct)이 아니라 최근 공고문의 면적×순위 매트릭스로 본 자리 — 순위가 곧 당락 순서다 */
        <p className={`elig-rank elig-jg${janggi.ok === false ? " n" : ""}`}>
          <b>{[group, janggi.rankLabel].filter(Boolean).join(" ")}</b>
          {janggi.reasons[0] && <span> | {janggi.reasons[0].text}</span>}
          <small> | <Link href={noticePath(janggiRef.slug)}>{janggiRef.title}</Link> 기준</small>
        </p>
      )}
      <details className="ej-more">
        <summary>기준 {v.checks.length}가지 모두 보기{rankingText(t.ranking_method) ? ` | 선정 ${rankingText(t.ranking_method)}` : ""}</summary>
        <ul className="elig-why">
          {v.checks.map((c) => (
            <li key={c.label} className={c.unsure ? "q" : "y"}><span>{c.label}</span><p>{c.detail}</p></li>
          ))}
        </ul>
        {t.note && <p className="elig-memo">{t.note}</p>}
      </details>
    </li>
  );
}

/** 하나 걸린 기준을 「얼마나 모자라나」로 바꿔 말한다. 금액이면 차이를, 나머지는 기준 문장을 그대로 */
function gapText(c: Check, v: Verdict, p: Profile): string {
  const t = v.type;
  if (c.label === "소득" && v.incomeLimitWon != null) {
    return `월 ${wonKo(roundMan(incomeUsed(t, p) - v.incomeLimitWon))} 넘습니다 (기준 월 ${wonKo(roundMan(v.incomeLimitWon))} 이하)`;
  }
  if (c.label === "자산" && t.asset_limit_man != null) {
    const mine = t.asset_scope === "본인" ? p.assetSelfMan : p.assetMan;
    return `${wonKo((mine - t.asset_limit_man) * MAN)} 넘습니다 (기준 ${wonKo(t.asset_limit_man * MAN)} 이하)`;
  }
  if (c.label === "자동차" && t.car_limit_man) {
    return `${wonKo((p.carMan - t.car_limit_man) * MAN)} 넘습니다 (기준 ${wonKo(t.car_limit_man * MAN)} 이하)`;
  }
  if (c.label === "나이") {
    if (p.age < t.age_min) return `${t.age_min - p.age}년 뒤 나이 기준(${t.age_min}세 이상)에 듭니다`;
    if (t.age_max < 999) return `나이 기준(${t.age_max}세 이하)을 넘습니다`;
  }
  return c.detail;
}

function NearCard({ v, p }: { v: Verdict; p: Profile }) {
  const t = v.type;
  const c = v.checks.find((x) => !x.ok)!;
  return (
    <li className="ej-card near">
      <div className="ej-card-h">
        <b>{t.category}</b>
        <span>{t.name}</span>
        <em className="ej-badge near">{c.label} 기준</em>
      </div>
      <p className="ej-gap">{gapText(c, v, p)}</p>
      <details className="ej-more">
        <summary>기준 {v.checks.length}가지 모두 보기</summary>
        <ul className="elig-why">
          {v.checks.map((x) => (
            <li key={x.label} className={x.ok ? "y" : "n"}><span>{x.label}</span><p>{x.detail}</p></li>
          ))}
        </ul>
        {t.note && <p className="elig-memo">{t.note}</p>}
      </details>
    </li>
  );
}

function Num({ label, value, unit, onChange, min = 0, max, help, read }: {
  label: string; value: number; unit: string; onChange: (v: number) => void; min?: number; max: number;
  /** 칸 밑 한 줄 도움말 */
  help?: string;
  /** 만 원 단위 칸 — 「15000」을 「1억 5,000만 원」으로 밑에 읽어 준다. 0이 넷 넘으면 눈으로 못 센다 */
  read?: boolean;
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
      {(read || help) && (
        <small className="ej-fhelp">
          {read && <b>{value > 0 ? wonKo(value * MAN) : "0원"}</b>}
          {read && help ? " | " : ""}
          {help}
        </small>
      )}
    </label>
  );
}
