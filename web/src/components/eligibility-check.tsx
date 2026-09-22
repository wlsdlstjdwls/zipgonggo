"use client";

// 자격진단 — 내 조건을 넣으면 33개 공급유형 중 어디에 넣을 수 있는지 가른다.
// 규칙은 서버가 DB(supply_type·income_standard·region_tier)에서 읽어 넘긴다. 여기서 계산만 한다(lib/eligibility).
// 넣은 값은 **화면 셋이 같이 쓰는 한 벌**로 남는다(ProfileProvider, lib/profile.ts). 전에는 이 화면만
// 아무것도 저장하지 않아 들어올 때마다 기본값으로 되돌아갔고, 같은 소득을 공고 지면에서 또 넣어야 했다
// (사용자 지적 2026-09-22). 그 한 벌은 브라우저에 있고, 로그인한 뒤 계정 저장을 켠 사람만 서버에도 사본을 둔다.
// 장애 여부처럼 건강과 이어지는 계층은 켜도 서버로 가지 않는다(개인정보처리방침 3항).
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { classOptions, diagnoseAll, HOUSEHOLD_MAX, type Marital, type Profile, tierOf, type Verdict } from "@/lib/eligibility";
import { fitJanggi, type FitProfile, type FitVerdict } from "@/lib/notice-fit";
import { dateMD, daysUntil } from "@/lib/format";
import { fromElig, reconcileRegion, toElig } from "@/lib/profile";
import type { OpenSoonNotice, ResidenceArea, TypeHub } from "@/lib/queries";
import { noticePath, typePath } from "@/lib/routes";
import { SIDOS, sidoShort } from "@/lib/sido";
import type { EligibilityRules, JanggiRule } from "@/types/eligibility";
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
      household: p.household, incomeWon: p.incomeHouseholdWon, dual: jx.dual, newborns: jx.newborns, olderMinor: jx.olderMinor,
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

  return (
    <div className="elig">
      <form className="elig-form" onSubmit={(e) => e.preventDefault()} aria-label="내 조건 입력">
        <div className="elig-grid">
          {/* 나이와 가구원 수를 한 줄에 세운다 — 나이만 두면 옆칸이 비어 줄 하나를 통째로 먹는다 */}
          <Num label="나이" value={p.age} unit="세" onChange={(v) => set("age", v)} max={120} />
          <Num label="가구원 수" value={p.household} unit="명" onChange={(v) => set("household", v)} min={1} max={HOUSEHOLD_MAX} />
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
          {/* 기혼에만 칸이 뜨고 예비신혼부부에는 아무것도 없어 한쪽만 묻는 꼴이었다(사용자 지적 2026-09-22).
              예비신혼부부는 입주 전까지 혼인신고를 마쳐야 자격이 서니 예정일을 묻는다 */}
          {p.marital === "예비신혼부부" && (
            <label className="elig-f">
              <span>혼인 예정일</span>
              <span className="elig-in elig-date">
                {/* 칸 아무 데나 눌러도 달력이 열리게 한다 — 네이티브는 달력 아이콘만 눌러야 열려서
                    나머지 폭이 죽은 자리처럼 느껴진다. showPicker가 없는 브라우저는 그냥 지나간다 */}
                <input
                  type="date"
                  className={p.weddingAt ? "" : "empty"}
                  value={p.weddingAt}
                  onChange={(e) => set("weddingAt", e.target.value)}
                  onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* 사용자 제스처가 아니면 조용히 넘긴다 */ } }}
                />
              </span>
            </label>
          )}
          <Num label="본인 월소득" value={Math.round(p.incomeSelfWon / MAN)} unit="만 원" onChange={(v) => set("incomeSelfWon", v * MAN)} max={100_000} />
          <Num label="세대 합산 월소득" value={Math.round(p.incomeHouseholdWon / MAN)} unit="만 원" onChange={(v) => set("incomeHouseholdWon", v * MAN)} max={100_000} />
          {/* 자산을 두 칸으로 나눈 건 시드가 asset_scope를 「본인」 5개와 「세대」 17개로 갈라 두었기 때문이다.
              한 칸으로 보면 부모와 사는 청년이 세대 자산 때문에 청년 유형까지 떨어진다(2026-09-22 정정) */}
          <Num label="본인 총자산" value={p.assetSelfMan} unit="만 원" onChange={(v) => setAssetSelf(v)} max={1_000_000} />
          <Num label="세대 총자산" value={p.assetMan} unit="만 원" onChange={(v) => setAssetHousehold(v)} max={1_000_000} />
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
          {/* 무주택도 시드가 「본인」 8개와 「세대원」 24개로 갈라 두었다. 본인이 유주택이면 세대도 유주택이라
              세대 칸은 본인이 무주택일 때만 묻는다 — 질문을 하나라도 줄인다 */}
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
          <label className="elig-chk">
            <input type="checkbox" checked={p.hasNewborn} onChange={(e) => set("hasNewborn", e.target.checked)} />
            <span>2세 이하 자녀가 있다</span>
          </label>
        </div>

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
        {/* 유형 목록에서 끝나면 「그래서 지금 뭘 넣나」에 답이 없다. 통과한 유형의 열린 공고로 잇는다 */}
        {openTotal > 0 && (
          <section className="elig-open">
            <h2>
              지금 신청할 수 있는 공고 <b>{openTotal.toLocaleString("ko-KR")}</b>
              <small>내 조건에 맞는 유형 기준</small>
            </h2>
            <p className="elig-open-sub">
              유형이 맞는다는 뜻이고, 공고마다 나이와 소득 기준이 조금씩 다릅니다. 신청 전에 공고문을 확인하세요.
            </p>
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

        <h2>
          신청해 볼 수 있는 유형 <b>{pass.length}</b>
          <small>전체 {verdicts.length}개 중</small>
        </h2>
        {pass.length === 0 ? (
          <p className="elig-none">조건에 맞는 유형이 없다. 아래 미달 목록에서 어떤 기준에 걸리는지 볼 수 있다.</p>
        ) : (
          <ul className="elig-list">{pass.map((v) => <Card key={v.type.code} v={v} janggi={v.type.housing_type === "장기전세" ? jgVerdict : null} janggiRef={jg} group={jgFit?.group ?? null} />)}</ul>
        )}

        <h2 className="mute">기준에 못 미치는 유형 <b>{fail.length}</b></h2>
        <ul className="elig-list">{fail.map((v) => <Card key={v.type.code} v={v} janggi={v.type.housing_type === "장기전세" ? jgVerdict : null} janggiRef={jg} group={jgFit?.group ?? null} />)}</ul>

      </div>
    </div>
  );
}

function Card({ v, janggi, janggiRef, group }: { v: Verdict; janggi?: FitVerdict | null; janggiRef?: JanggiRule | null; group?: string | null }) {
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
          <b>{[group, janggi.rankLabel].filter(Boolean).join(" ")}</b>
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
