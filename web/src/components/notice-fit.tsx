"use client";

// 공고별 「내 조건에 맞는 단지」 — 이 공고의 자격 묶음(공고문에서 읽은 것)에 내 조건을 대 보고, 맞는 단지를 추린다.
// ayounghome의 「내 조건으로 노려볼 만한 단지 찾기」(계층·자치구·배점·거주기간 입력 → 과거 커트라인으로 정렬)에서 착안(사용자 제안 2026-09-14).
// 과거 경쟁률·커트라인은 아직 결과 표가 1건뿐이라 못 쓴다 — 지금은 자격 판정(순위·배점)과 단지 조건(자치구·면적·금액)으로 고른다.
// 값은 전부 브라우저 안에만 있다(자가진단과 같은 약속). 양식마다 묻는 게 다르다(lib/notice-fit.ts 머리말).
import Link from "next/link";
import { useMemo, useState } from "react";
import { num, wonShort } from "@/lib/format";
import {
  areaBand, classKey, complexFacts, fitCheongnyeon, fitHaengbok, fitJanggi, fitMaeip, isSeoul, janggiAreas, MAN, seoulGus,
  type ComplexPick, type FitProfile, type FitVerdict,
} from "@/lib/notice-fit";
import { noticeComplexPath } from "@/lib/routes";
import type { EligKind, IncomeStandard, NoticeEligibilityData, RegionTier } from "@/types/eligibility";
import type { NoticeComplex, NoticeSupply } from "@/types/notice";
import { Select } from "./select";

type Props = {
  data: NoticeEligibilityData;
  complexes: NoticeComplex[];
  supply: NoticeSupply[];
  income: IncomeStandard[];
  tiers: RegionTier[];
  noticeSlug: string;
};

const DEFAULT: FitProfile = {
  household: 1, incomeWon: 300 * MAN, dual: false, newborns: 0, olderMinor: false, assetMan: 15_000, carMan: 0,
  deposits: 24, gu: "", residenceYears: 3, age: 30, under2: false, special: false, group: null, area: null, cls: null,
  applicantType: null, priorityClass: null, selfIncomeWon: 250 * MAN, parentsHomeless: false, disabledSelf: false, disabledFamily: false,
};

const LIST_STEP = 12;

export function NoticeFit({ data, complexes, supply, income, tiers, noticeSlug }: Props) {
  const kind: EligKind = data.kind ?? "janggi";
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<FitProfile>(() => ({
    ...DEFAULT,
    group: data.rank_tables[0]?.group ?? null,
    area: data.rank_tables[0] ? janggiAreas(data.rank_tables[0])[0] ?? null : null,
    cls: data.class_blocks?.[0]?.name ?? null,
    applicantType: data.applicant_types?.[0]?.name ?? null,
  }));
  const [budgetMan, setBudgetMan] = useState<number>(0);
  const [shown, setShown] = useState(LIST_STEP);
  const set = <K extends keyof FitProfile>(k: K, v: FitProfile[K]) => setP((prev) => ({ ...prev, [k]: v }));

  const gus = useMemo(() => seoulGus(tiers), [tiers]);
  const guOptions = useMemo(() => [
    ...gus.map((g) => ({ value: g, label: g })),
    { value: "연접", label: "서울 외 연접지역 (경기 일부, 인천)" },
    { value: "경기기타", label: "그 외 경기" },
    { value: "기타", label: "그 외 지역" },
  ], [gus]);
  const table = data.rank_tables.find((t) => t.group === p.group) ?? data.rank_tables[0];
  const areas = useMemo(() => (table ? janggiAreas(table) : []), [table]);
  const facts = useMemo(() => complexFacts(supply), [supply]);

  const verdict: FitVerdict | null = useMemo(() => {
    if (kind === "haengbok") return fitHaengbok(data, p, income);
    if (kind === "maeip") return fitMaeip(data, p, income);
    if (kind === "cheongnyeon") return fitCheongnyeon(data, p, income);
    return fitJanggi(data, p, income);
  }, [kind, data, p, income]);
  const firstClasses = useMemo(
    () => (kind === "cheongnyeon" ? (data.rank_tables[0]?.rows ?? []).filter((r) => r.rank === 1 && r.label).map((r) => r.label!) : []),
    [kind, data],
  );

  const picks: ComplexPick[] = useMemo(() => {
    const out: ComplexPick[] = [];
    const band = kind === "janggi" ? areaBand(p.area) : null;
    const key = kind === "haengbok" && p.cls ? classKey(p.cls) : null;
    for (const c of complexes) {
      const f = facts.get(c.name);
      const areasOf = f?.areas.length ? f.areas : [c.area_min, c.area_max].filter((a): a is number => a != null);
      const deposit = f?.deposit ?? c.min_deposit;
      const rent = f?.rent ?? c.min_rent;
      if (budgetMan > 0 && deposit != null && deposit > budgetMan * MAN) continue;
      let tag: string | null = null;
      let tone: ComplexPick["tone"] = "soft";
      let order = 0;
      if (kind === "janggi") {
        // 고른 면적 구간에 드는 주택형이 있는 단지. 면적을 모르는 단지는 뒤로 보내되 빼지는 않는다
        if (band && areasOf.length) {
          const hit = areasOf.some((a) => a > band.lo && a <= band.hi) || (band.lo === 0 && areasOf.some((a) => a <= band.hi));
          if (!hit) continue;
          order = 0;
        } else {
          order = 1;
          tag = areasOf.length ? null : "면적 미확인";
        }
        // 거주지 순위 표(매입형 50㎡ 미만)는 단지 자치구로 다시 가른다
        if (table && table.rows.some((r) => /위치한 자치구 거주/.test(r.requirement ?? ""))) {
          const v = fitJanggi(data, p, income, c.sigungu);
          if (v.rank != null) { tag = `${v.rank}순위`; tone = v.rank === 1 ? "acc" : "soft"; order += v.rank / 10; }
        } else if (verdict?.rank != null) {
          tag = `${verdict.rank}순위`;
          tone = verdict.rank === 1 ? "acc" : "soft";
        }
        order += (deposit ?? 9e12) / 1e13;
      } else if (kind === "haengbok") {
        // 이 단지 공급대상에 내 계층이 있어야 한다(공급현황이 없는 단지는 판단 못 해 남긴다)
        if (key && f && f.classes.size && ![...f.classes].some((x) => x.includes(key))) continue;
        if (isSeoul(p.gu)) {
          const mine = c.sigungu === p.gu;
          tag = mine ? "우선공급 1순위" : "우선공급 2순위";
          tone = mine ? "acc" : "soft";
          order = mine ? 0 : 1;
        }
        order += (rent ?? deposit ?? 9e12) / 1e13;
      } else {
        if (verdict?.rank != null) { tag = `${verdict.rank}순위`; tone = verdict.rank === 1 ? "acc" : "soft"; }
        order = (deposit ?? 9e12) / 1e13;
      }
      const areaTxt = areasOf.length ? (Math.min(...areasOf) === Math.max(...areasOf) ? `${Math.min(...areasOf)}㎡` : `${Math.min(...areasOf)}~${Math.max(...areasOf)}㎡`) : "";
      const money = rent != null ? `월 ${wonShort(rent)}${deposit != null ? ` | 보증금 ${wonShort(deposit)}` : ""}` : deposit != null ? `보증금 ${wonShort(deposit)}` : "";
      out.push({ c, tag, tone, order, sub: [areaTxt, money, c.unit_count != null ? num(c.unit_count, "호") : ""].filter(Boolean).join(" | ") });
    }
    return out.sort((a, b) => a.order - b.order || a.c.name.localeCompare(b.c.name, "ko"));
  }, [kind, complexes, facts, p, budgetMan, data, income, table, verdict]);

  const eligible = verdict?.ok !== false;

  return (
    <div className={`fit${open ? " open" : ""}`}>
      {!open ? (
        <button type="button" className="btn acc fit-open" onClick={() => setOpen(true)}>
          내 조건 넣고 맞는 단지 보기
        </button>
      ) : (
        <div className="fit-body">
          <form className="fit-form" onSubmit={(e) => e.preventDefault()} aria-label="내 조건 입력">
            <div className="elig-grid">
              {kind === "janggi" && data.rank_tables.length > 1 && (
                <div className="elig-f wide">
                  <span>공급 구분</span>
                  <Select value={p.group ?? ""} options={data.rank_tables.map((t) => ({ value: t.group, label: t.group }))}
                    onChange={(v) => { const t = data.rank_tables.find((x) => x.group === v); setP((prev) => ({ ...prev, group: v || null, area: t ? janggiAreas(t)[0] ?? null : null })); }}
                    placeholder="공급 구분" ariaLabel="공급 구분" />
                </div>
              )}
              {kind === "janggi" && areas.length > 0 && (
                <div className="elig-f wide">
                  <span>신청 면적</span>
                  <div className="elig-seg" role="group" aria-label="신청 면적">
                    {areas.map((a) => (
                      <button key={a} type="button" className={p.area === a ? "on" : ""} onClick={() => set("area", a)}>{a}</button>
                    ))}
                  </div>
                </div>
              )}
              {kind === "haengbok" && (data.class_blocks?.length ?? 0) > 0 && (
                <div className="elig-f wide">
                  <span>계층</span>
                  <div className="elig-seg wrap" role="group" aria-label="계층">
                    {data.class_blocks!.map((c) => (
                      <button key={c.name} type="button" className={p.cls === c.name ? "on" : ""} onClick={() => set("cls", c.name)}>{classKey(c.name)}</button>
                    ))}
                  </div>
                </div>
              )}
              {kind === "cheongnyeon" && (data.applicant_types?.length ?? 0) > 0 && (
                <div className="elig-f wide">
                  <span>신청유형</span>
                  <div className="elig-seg wrap" role="group" aria-label="신청유형">
                    {data.applicant_types!.map((t) => (
                      <button key={t.name} type="button" className={p.applicantType === t.name ? "on" : ""} onClick={() => set("applicantType", t.name)}>{t.name}</button>
                    ))}
                  </div>
                </div>
              )}
              {kind === "cheongnyeon" && firstClasses.length > 0 && (
                <div className="elig-f wide">
                  <span>1순위 자격</span>
                  <Select value={p.priorityClass ?? ""} options={firstClasses.map((c) => ({ value: c, label: c }))}
                    onChange={(v) => set("priorityClass", v || null)} placeholder="해당 없음" ariaLabel="1순위 자격" />
                </div>
              )}
              {kind !== "cheongnyeon" && (
                <div className="elig-f">
                  <span>거주지</span>
                  <Select value={p.gu} options={guOptions} onChange={(v) => set("gu", v)} placeholder="선택 안 함" ariaLabel="거주지" />
                </div>
              )}
              {(kind === "haengbok") && (
                <Num label={isSeoul(p.gu) ? `${p.gu} 거주 햇수` : "현재 거주지 햇수"} value={p.residenceYears} unit="년" onChange={(v) => set("residenceYears", v)} max={80} />
              )}
              {(kind === "haengbok" || kind === "cheongnyeon") && <Num label="나이" value={p.age} unit="세" onChange={(v) => set("age", v)} max={120} />}
              <Num label={kind === "cheongnyeon" ? "본인과 부모 가구원 수" : "가구원 수"} value={p.household} unit="명" onChange={(v) => set("household", v)} min={1} max={7} />
              <Num label={kind === "cheongnyeon" || (kind === "haengbok" && p.cls && classKey(p.cls) === "대학생") ? "본인과 부모 월소득" : "세대 월소득"} value={Math.round(p.incomeWon / MAN)} unit="만 원" onChange={(v) => set("incomeWon", v * MAN)} max={100_000} />
              {kind === "cheongnyeon" && <Num label="본인 월소득 (3순위 판정)" value={Math.round(p.selfIncomeWon / MAN)} unit="만 원" onChange={(v) => set("selfIncomeWon", v * MAN)} max={100_000} />}
              {kind !== "maeip" && <Num label={kind === "cheongnyeon" ? "총자산 (2순위 본인과 부모, 3순위 본인)" : "총자산"} value={p.assetMan} unit="만 원" onChange={(v) => set("assetMan", v)} max={1_000_000} />}
              {kind !== "maeip" && <Num label="자동차가액" value={p.carMan} unit="만 원" onChange={(v) => set("carMan", v)} max={100_000} />}
              {kind !== "maeip" && <Num label="청약 납입 회차" value={p.deposits} unit="회" onChange={(v) => set("deposits", v)} max={600} />}
              {kind !== "maeip" && kind !== "cheongnyeon" && <Num label="2023.3.28. 이후 출생 자녀" value={p.newborns} unit="명" onChange={(v) => set("newborns", v)} max={10} />}
              <Num label="보증금 예산 (0이면 무관)" value={budgetMan} unit="만 원" onChange={setBudgetMan} max={10_000_000} />
            </div>
            {kind === "cheongnyeon" && (
              <div className="elig-checks">
                <label className="elig-chk"><input type="checkbox" checked={p.parentsHomeless} onChange={(e) => set("parentsHomeless", e.target.checked)} /><span>부모가 무주택자다 (사망 등 부재 포함)</span></label>
                <label className="elig-chk"><input type="checkbox" checked={p.disabledSelf} onChange={(e) => set("disabledSelf", e.target.checked)} /><span>본인이 등록 장애인이다</span></label>
                <label className="elig-chk"><input type="checkbox" checked={p.disabledFamily} onChange={(e) => set("disabledFamily", e.target.checked)} /><span>부모 중 등록 장애인이 있다</span></label>
              </div>
            )}
            {kind !== "maeip" && kind !== "cheongnyeon" && (
              <div className="elig-checks">
                <label className="elig-chk"><input type="checkbox" checked={p.dual} onChange={(e) => set("dual", e.target.checked)} /><span>맞벌이다</span></label>
                <label className="elig-chk"><input type="checkbox" checked={p.olderMinor} onChange={(e) => set("olderMinor", e.target.checked)} /><span>2023.3.27. 이전 출생 미성년 자녀가 있다</span></label>
                {kind === "haengbok" && (
                  <label className="elig-chk"><input type="checkbox" checked={p.under2} onChange={(e) => set("under2", e.target.checked)} /><span>2세 미만 자녀가 있다</span></label>
                )}
                {kind === "haengbok" && p.cls && /고령자|주거급여/.test(p.cls) && (
                  <label className="elig-chk"><input type="checkbox" checked={p.special} onChange={(e) => set("special", e.target.checked)} /><span>장애인 | 국가유공자 등에 해당한다</span></label>
                )}
              </div>
            )}
          </form>

          {verdict && (
            <div className={`fit-verdict${verdict.ok === false ? " no" : verdict.ok ? " ok" : ""}`}>
              <div className="fit-verdict-h">
                <em className={`elig-badge${verdict.ok ? " ok" : ""}`}>{verdict.ok === false ? "기준 미달" : verdict.ok ? "신청 가능" : "확인 필요"}</em>
                <b>{verdict.rankLabel}</b>
                {verdict.score && <span>{kind === "haengbok" ? "우선공급 예상 배점" : "예상 가점"} <b>{verdict.score.total}</b> / {verdict.score.max}점</span>}
              </div>
              <ul className="elig-why">
                {verdict.reasons.map((r, i) => (
                  <li key={i} className={r.ok === true ? "y" : r.ok === false ? "n" : ""}><span>{r.label}</span><p>{r.text}</p></li>
                ))}
                {verdict.score?.lines.map((l, i) => <li key={`s${i}`}><span>배점</span><p>{l}</p></li>)}
              </ul>
            </div>
          )}

          <div className="fit-list">
            <h3>
              {eligible ? "맞는 단지" : "조건에 맞으면 볼 수 있는 단지"} <b>{picks.length}</b><small>곳</small>
              {kind === "haengbok" && isSeoul(p.gu) && <small> | {p.gu} 단지가 우선공급 1순위</small>}
            </h3>
            {picks.length === 0 ? (
              <p className="elig-none">조건에 드는 단지가 없습니다. 면적이나 예산을 넓혀 보세요.</p>
            ) : (
              <ul className="fit-rows">
                {picks.slice(0, shown).map(({ c, tag, tone, sub }) => (
                  <li key={c.id}>
                    <Link href={noticeComplexPath(noticeSlug, c)}>
                      <span className="fit-row-main">
                        <b>{c.name}</b>
                        <small>{c.sigungu}{c.is_new ? " | 신규" : ""}</small>
                      </span>
                      <span className="fit-row-sub">{sub}</span>
                      {tag && <em className={`tag ${tone}`}>{tag}</em>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {picks.length > shown && (
              <button type="button" className="btn fit-more" onClick={() => setShown((n) => n + LIST_STEP * 2)}>
                {picks.length - shown}곳 더 보기
              </button>
            )}
            <p className="elig-note">
              공고문의 기준을 내 조건에 대 본 안내입니다. 심사 결과가 아니며, 경쟁률과 당첨선은 이 공고의 결과가 나와야 알 수 있습니다.
              입력한 값은 이 브라우저를 벗어나지 않습니다.
            </p>
          </div>
        </div>
      )}
    </div>
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
