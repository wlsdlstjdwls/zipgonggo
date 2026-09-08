"use client";

// KPI 스트립 4칸. 진입 시 카운트업 800ms — 경과 시간 기준 보간(1-(1-p)^3), 끝에서 실제 값으로 스냅.
// 탭이 백그라운드여도 마지막엔 반드시 실제 값이 된다. reduced-motion이면 바로 실제 값.
import { useEffect, useState, type ReactNode } from "react";
import { KPI_COUNT_MS, KPI_LABELS } from "@/lib/constants";
import type { HomeStats } from "@/types/notice";

function useCountUp(target: number, decimals = 0): string {
  const [v, setV] = useState(target);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setV(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / KPI_COUNT_MS);
      const e = 1 - Math.pow(1 - p, 3);
      setV(target * e);
      if (p < 1) raf = requestAnimationFrame(tick); else setV(target);
    };
    setV(0);
    raf = requestAnimationFrame(tick);
    const guard = setTimeout(() => { cancelAnimationFrame(raf); setV(target); }, KPI_COUNT_MS + 250);
    return () => { cancelAnimationFrame(raf); clearTimeout(guard); };
  }, [target]);
  return v.toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** 셀 하나. 서버 HTML엔 실제 값이 들어가고(SEO·no-JS), 하이드레이션 후 0부터 올라간다. */
function Cell({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: "hot" | "acc" }) {
  return (
    <div>
      <span className="k">{label}</span>
      <span className="v">
        <b className={tone}>{value}</b>
        <span className="u">{unit}</span>
      </span>
    </div>
  );
}

function CountCell({ label, target, unit, tone, decimals }: { label: string; target: number; unit: string; tone?: "hot" | "acc"; decimals?: number }) {
  return <Cell label={label} value={useCountUp(target, decimals)} unit={unit} tone={tone} />;
}

export function KpiStrip({ stats }: { stats: HomeStats }) {
  const rentMan = stats.medianRent != null ? stats.medianRent / 10_000 : null;
  return (
    <div className="kpi" aria-label="현황">
      <CountCell label={KPI_LABELS[0]} target={stats.total} unit="건" />
      <CountCell label={KPI_LABELS[1]} target={stats.seoul} unit="건" />
      <CountCell label={KPI_LABELS[2]} target={stats.closing7} unit="건" tone="hot" />
      {rentMan != null ? <CountCell label={KPI_LABELS[3]} target={rentMan} unit="만 원" tone="acc" decimals={1} /> : <Cell label={KPI_LABELS[3]} value="—" unit="" />}
    </div>
  );
}

/** 스트리밍 폴백용. 숫자 자리만 골격. */
export function KpiStripSkeleton({ box }: { box: ReactNode }) {
  return (
    <div className="kpi" aria-hidden="true">
      {KPI_LABELS.map((k) => (
        <div key={k}><span className="k">{k}</span><span className="v">{box}</span></div>
      ))}
    </div>
  );
}
