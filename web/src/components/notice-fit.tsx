"use client";

// 공고별 「내 조건에 맞는 단지」 — 이 공고의 자격 묶음(공고문에서 읽은 것)에 내 조건을 대 보고, 맞는 단지를 추린다.
// ayounghome의 「내 조건으로 노려볼 만한 단지 찾기」(계층·자치구·배점·거주기간 입력 → 과거 커트라인으로 정렬)에서 착안(사용자 제안 2026-09-14).
// 과거 경쟁률·커트라인은 아직 결과 표가 1건뿐이라 못 쓴다 — 지금은 자격 판정(순위·배점)과 단지 조건(자치구·면적·금액)으로 고른다.
// 값은 전부 브라우저 안에만 있다(자가진단과 같은 약속). 양식마다 묻는 게 다르다(lib/notice-fit.ts 머리말).
// 입력값·펼침 상태는 localStorage(FIT_STORAGE_KEY)에 둔다 — 단지 상세로 갔다 돌아오면 초기화되던 것(사용자 지적 2026-09-14).
// 마운트 뒤에 읽는다(서버 HTML은 접힌 기본 상태라 하이드레이션이 어긋나지 않게). 단지 상세(currentId)에서는 같은 판정을 돌리고
// 이 단지가 드는지 한 줄로 먼저 말한 뒤 목록 맨 위에 「이 단지」로 띄운다. 단지 상세는 언제나 접힌 채 시작하고 거기서 편 상태는
// 저장하지 않는다(공고 상세의 펼침만 기억, 사용자 요청 2026-09-14). 접기 버튼은 위에 하나.
// 보증금 예산 필터는 뺐다 — 대출을 끼면 예산이 뜻을 잃고, 금액은 단지 줄에 다 적혀 있다(사용자 지적 2026-09-14).
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FIT_STORAGE_KEY } from "@/lib/constants";
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
  /** 단지 상세에서 넘기는 지금 보고 있는 단지 id. 있으면 이 단지의 판정을 먼저 말하고 목록 맨 위에 둔다 */
  currentId?: number;
};

type Stored = { p: Partial<FitProfile>; open: boolean };

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(FIT_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    return {
      p: o.p && typeof o.p === "object" ? (o.p as Partial<FitProfile>) : {},
      open: o.open === true,
    };
  } catch {
    return null;
  }
}

function writeStored(v: Stored) {
  try { window.localStorage.setItem(FIT_STORAGE_KEY, JSON.stringify(v)); } catch { /* 프라이빗 모드 등 — 메모리에만 */ }
}

const DEFAULT: FitProfile = {
  household: 1, incomeWon: 300 * MAN, dual: false, newborns: 0, olderMinor: false, assetMan: 15_000, carMan: 0,
  deposits: 24, gu: "", residenceYears: 3, age: 30, under2: false, special: false, group: null, area: null, cls: null,
  applicantType: null, priorityClass: null, selfIncomeWon: 250 * MAN, parentsHomeless: false, disabledSelf: false, disabledFamily: false,
};

const LIST_STEP = 12;

export function NoticeFit({ data, complexes, supply, income, tiers, noticeSlug, currentId }: Props) {
  const kind: EligKind = data.kind ?? "janggi";
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<FitProfile>(() => ({
    ...DEFAULT,
    group: data.rank_tables[0]?.group ?? null,
    area: data.rank_tables[0] ? janggiAreas(data.rank_tables[0])[0] ?? null : null,
    cls: data.class_blocks?.[0]?.name ?? null,
    applicantType: data.applicant_types?.[0]?.name ?? null,
  }));
  const [shown, setShown] = useState(LIST_STEP);
  const onComplexPage = currentId != null;
  const set = <K extends keyof FitProfile>(k: K, v: FitProfile[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const firstClasses = useMemo(
    () => (kind === "cheongnyeon" ? (data.rank_tables[0]?.rows ?? []).filter((r) => r.rank === 1 && r.label).map((r) => r.label!) : []),
    [kind, data],
  );

  // 저장된 조건 되살리기 — 읽기 전엔 쓰지 않는다(기본값으로 덮어쓰지 않게). 공고마다 다른 항목은 이 공고에 있는 값일 때만 받는다
  const loaded = useRef(false);
  // 저장소에 있던 펼침 값. 단지 상세에서는 화면의 open 대신 이 값을 그대로 다시 써서 공고 상세의 기억을 건드리지 않는다
  const storedOpen = useRef(false);
  useEffect(() => {
    const s = readStored();
    if (s) {
      storedOpen.current = s.open;
      setP((prev) => {
        const next: FitProfile = { ...prev };
        for (const k of Object.keys(DEFAULT) as (keyof FitProfile)[]) {
          const v = s.p[k];
          if (v === undefined || v === null || typeof v !== typeof DEFAULT[k]) continue;
          if (typeof v === "number" && !Number.isFinite(v)) continue;
          (next as Record<keyof FitProfile, unknown>)[k] = v;
        }
        const group = typeof s.p.group === "string" && data.rank_tables.some((t) => t.group === s.p.group) ? s.p.group : prev.group;
        const t = data.rank_tables.find((x) => x.group === group);
        const areasOfT = t ? janggiAreas(t) : [];
        next.group = group;
        next.area = typeof s.p.area === "string" && areasOfT.includes(s.p.area) ? s.p.area : (group === prev.group ? prev.area : areasOfT[0] ?? null);
        next.cls = typeof s.p.cls === "string" && data.class_blocks?.some((c) => c.name === s.p.cls) ? s.p.cls : prev.cls;
        next.applicantType = typeof s.p.applicantType === "string" && data.applicant_types?.some((a) => a.name === s.p.applicantType) ? s.p.applicantType : prev.applicantType;
        next.priorityClass = typeof s.p.priorityClass === "string" && firstClasses.includes(s.p.priorityClass) ? s.p.priorityClass : null;
        return next;
      });
      if (!onComplexPage) setOpen(s.open);
    }
    // 마운트 때 한 번만 — data·firstClasses·currentId는 서버가 준 값이라 안 바뀐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // 첫 커밋의 쓰기는 건너뛴다 — 위 읽기 effect와 같은 커밋에 돌아 기본값으로 저장소를 덮어썼다(setState는 다음 렌더에야 반영)
    if (!loaded.current) { loaded.current = true; return; }
    writeStored({ p, open: onComplexPage ? storedOpen.current : open });
  }, [p, open, onComplexPage]);

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

  const picks: ComplexPick[] = useMemo(() => {
    const out: ComplexPick[] = [];
    const band = kind === "janggi" ? areaBand(p.area) : null;
    const key = kind === "haengbok" && p.cls ? classKey(p.cls) : null;
    for (const c of complexes) {
      const f = facts.get(c.name);
      const areasOf = f?.areas.length ? f.areas : [c.area_min, c.area_max].filter((a): a is number => a != null);
      const deposit = f?.deposit ?? c.min_deposit;
      const rent = f?.rent ?? c.min_rent;
      const tags: ComplexPick["tags"] = [];
      const rankTag = (rank: number, prefix = "") => tags.push({ text: `${prefix}${rank}순위`, tone: rank === 1 ? "acc" : "soft" });
      let order = 0;
      if (kind === "janggi") {
        // 고른 면적 구간에 드는 주택형이 있는 단지. 면적을 모르는 단지는 뒤로 보내되 빼지는 않는다
        if (band && areasOf.length) {
          const hit = areasOf.some((a) => a > band.lo && a <= band.hi) || (band.lo === 0 && areasOf.some((a) => a <= band.hi));
          if (!hit) continue;
          order = 0;
        } else {
          order = 1;
          if (!areasOf.length) tags.push({ text: "면적 미확인", tone: "soft" });
        }
        // 거주지 순위 표(매입형 50㎡ 미만)는 단지 자치구로 다시 가른다
        if (table && table.rows.some((r) => /위치한 자치구 거주/.test(r.requirement ?? ""))) {
          const v = fitJanggi(data, p, income, c.sigungu);
          if (v.rank != null) { rankTag(v.rank); order += v.rank / 10; }
        } else if (verdict?.rank != null) {
          rankTag(verdict.rank);
        }
        order += (deposit ?? 9e12) / 1e13;
      } else if (kind === "haengbok") {
        // 이 단지 공급대상에 내 계층이 있어야 한다(공급현황이 없는 단지는 판단 못 해 남긴다)
        if (key && f && f.classes.size && ![...f.classes].some((x) => x.includes(key))) continue;
        // 두 트랙을 따로 단다 — 우선공급 순위는 단지 자치구로 갈리고(내 자치구 1순위, 그 외 서울 2순위), 일반공급 순위는 모든 단지가 같다.
        // 태그 하나에 「우선공급 1순위」만 적으니 머리의 「일반공급 1순위」와 다른 말로 보였다(사용자 지적 2026-09-14)
        if (isSeoul(p.gu)) {
          const mine = c.sigungu === p.gu;
          rankTag(mine ? 1 : 2, "우선공급 ");
          order = mine ? 0 : 1;
        }
        if (verdict?.rank != null) tags.push({ text: `일반공급 ${verdict.rank}순위`, tone: "soft" });
        order += (rent ?? deposit ?? 9e12) / 1e13;
      } else {
        if (verdict?.rank != null) rankTag(verdict.rank);
        order = (deposit ?? 9e12) / 1e13;
      }
      const areaTxt = areasOf.length ? (Math.min(...areasOf) === Math.max(...areasOf) ? `${Math.min(...areasOf)}㎡` : `${Math.min(...areasOf)}~${Math.max(...areasOf)}㎡`) : "";
      const money = rent != null ? `월 ${wonShort(rent)}${deposit != null ? ` | 보증금 ${wonShort(deposit)}` : ""}` : deposit != null ? `보증금 ${wonShort(deposit)}` : "";
      out.push({ c, tags, order, sub: [areaTxt, money, c.unit_count != null ? num(c.unit_count, "호") : ""].filter(Boolean).join(" | ") });
    }
    // 단지 상세에서는 보고 있는 단지를 맨 위에
    return out.sort((a, b) => Number(b.c.id === currentId) - Number(a.c.id === currentId) || a.order - b.order || a.c.name.localeCompare(b.c.name, "ko"));
  }, [kind, complexes, facts, p, data, income, table, verdict, currentId]);

  // 행복주택 경쟁 순서(공고문 선정기준 절). 배점이 순위를 바꾸는 게 아니라 같은 순위 안 순서라는 걸 이 줄로 보인다
  const haengbokSteps = useMemo(() => {
    if (kind !== "haengbok") return null;
    const block = (data.class_blocks ?? []).find((c) => c.name === p.cls) ?? data.class_blocks?.[0];
    const row = block?.selection?.rows.find((r) => r.group === "우선공급");
    return row?.steps.length ? row.steps.join(" → ") : "2세 미만 자녀 → 순위 → 배점 → 추첨";
  }, [kind, data, p.cls]);

  const eligible = verdict?.ok !== false;
  const current = currentId != null ? complexes.find((c) => c.id === currentId) ?? null : null;
  const currentPick = current ? picks.find((x) => x.c.id === current.id) ?? null : null;

  return (
    <div className={`fit${open ? " open" : ""}`}>
      <button type="button" className={`btn${open ? "" : " acc"} fit-open`} aria-expanded={open} aria-controls="fit-body" onClick={() => setOpen((v) => !v)}>
        {open ? "내 조건 접기" : "내 조건 넣고 맞는 단지 보기"}
      </button>
      {open && (
        <div className="fit-body" id="fit-body">
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
                {verdict.score && <span>{kind === "haengbok" ? "우선공급 배점" : "예상 가점"} <b>{verdict.score.total}</b> / {verdict.score.max}점</span>}
              </div>
              {/* 행복주택은 일반공급과 우선공급이 딴 트랙이고 우선공급 순위는 단지마다 갈린다. 배점은 순위를 올리고 내리는 값이 아니라
                  같은 순위끼리 겨룰 때의 순서다 — 「배점 때문에 1순위가 아닌데 1순위로 나온다」는 오해(사용자 2026-09-14)를 여기서 푼다 */}
              {kind === "haengbok" && isSeoul(p.gu) && (
                <p className="fit-tracks">
                  <b>우선공급</b> 순위는 단지가 있는 자치구로만 갈립니다. <b>{p.gu}</b> 단지는 1순위, 그 외 서울 단지는 2순위.
                  배점은 순위를 바꾸지 않고 같은 순위끼리 겨룰 때 순서를 정합니다({haengbokSteps}).
                  우선공급에서 떨어지면 자동으로 <b>일반공급</b>{verdict.rank != null ? ` ${verdict.rank}순위` : ""}로 넘어가며, 일반공급은 순위 뒤 추첨입니다.
                </p>
              )}
              <ul className="elig-why">
                {verdict.reasons.map((r, i) => (
                  <li key={i} className={r.ok === true ? "y" : r.ok === false ? "n" : ""}><span>{r.label}</span><p>{r.text}</p></li>
                ))}
                {verdict.score?.lines.map((l, i) => <li key={`s${i}`}><span>배점</span><p>{l}</p></li>)}
              </ul>
            </div>
          )}

          {current && (
            <p className={`fit-me${currentPick ? " ok" : " no"}`}>
              <b>{current.name}</b>
              <span>
                {currentPick
                  ? <>{eligible ? "이 단지는 내 조건에 듭니다" : "조건에 맞으면 볼 수 있는 단지입니다"}{currentPick.tags.map((t) => ` | ${t.text}`).join("")}</>
                  : "이 단지는 지금 조건(면적이나 계층)에 들지 않습니다"}
              </span>
            </p>
          )}

          <div className="fit-list">
            <h3>
              {eligible ? "맞는 단지" : "조건에 맞으면 볼 수 있는 단지"} <b>{picks.length}</b><small>곳</small>
            </h3>
            {picks.length === 0 ? (
              <p className="elig-none">조건에 드는 단지가 없습니다. 면적이나 계층을 바꿔 보세요.</p>
            ) : (
              <ul className="fit-rows">
                {picks.slice(0, shown).map(({ c, tags, sub }) => (
                  <li key={c.id} className={c.id === currentId ? "me" : undefined}>
                    <Link href={noticeComplexPath(noticeSlug, c)} aria-current={c.id === currentId ? "page" : undefined}>
                      <span className="fit-row-main">
                        <b>{c.name}</b>
                        <small>{c.sigungu}{c.is_new ? " | 신규" : ""}{c.id === currentId ? " | 이 단지" : ""}</small>
                      </span>
                      <span className="fit-row-sub">{sub}</span>
                      {tags.length > 0 && (
                        <span className="fit-tags">
                          {tags.map((t) => <em key={t.text} className={`tag ${t.tone}`}>{t.text}</em>)}
                        </span>
                      )}
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
