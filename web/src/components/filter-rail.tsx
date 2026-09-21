"use client";

// 목록 화면 필터 — 넓은 화면은 왼쪽 고정 레일, 좁은 화면은 바텀시트(사용자 요청 2026-09-09).
// 헤더 아래 전폭 바(ScopeBar)와 칩이 늘어난 필터 행을 대신한다. 상세 화면의 오른쪽 스티키 패널과 같은 골격이다.
// 값은 URL이 아니라 ListStateProvider가 들고 있고, 수량(facets)은 지금 걸린 다른 필터를 반영한 값이다.
// 레일과 시트는 같은 본문(RailBody)을 두 번 그린다 — 어느 쪽이 보일지는 CSS가 정한다(서버 렌더와 어긋나지 않는다).
// 시트 자체는 공용 Sheet(components/sheet.tsx) — 끌어 내려 닫기·스크림·배경 잠금·ESC를 거기서 맡는다.
import { useCallback, useState } from "react";
import { AREA_MIN_COUNT } from "@/lib/constants";
import { hasFilter } from "@/lib/notice-filters";
import { DEPOSIT_STEPS, NOTICE_VIEWS, RENT_STEPS, SECTORS, type NoticeView, type Sector } from "@/types/notice";
import { wonStep } from "@/lib/format";
import { IconCard, IconCompact, IconList } from "./icons";
import { Sheet } from "./sheet";
import { useListState } from "./list-state";
import { Select } from "./select";

// 보기 전환은 글자를 지우고 아이콘만 남긴다(사용자 요청 2026-09-09).
// 뜻은 title/aria-label이 지고, 모양은 카드 한 장 · 줄 목록 · 촘촘한 줄로 갈린다.
const VIEW_META: Record<NoticeView, { label: string; Icon: typeof IconCard }> = {
  card: { label: "카드", Icon: IconCard },
  list: { label: "목록", Icon: IconList },
  compact: { label: "간략", Icon: IconCompact },
};

/** 예산 눈금 한 줄. 「제한 없음」 + 상한 칩들. 슬라이더가 아니라 칩인 이유 —
    폰에서 한 손으로 한 번에 고를 수 있고, 지금 뭐가 걸렸는지 글자로 남는다 */
function BudgetChips({ label, steps, value, onPick }: {
  label: string;
  steps: readonly number[];
  value: number | undefined;
  onPick: (v: number | undefined) => void;
}) {
  return (
    <div className="rail-g rail-budget">
      <h3>{label} 이하</h3>
      <div className="rail-chips">
        {/* 「제한 없음」은 기본 상태다 — 다른 칩과 같은 잉크 반전을 주면 검정 칩이 셋으로 늘어
            「필터 3개가 걸렸다」로 오독된다(2026-09-21). 켜짐 표시는 하되 무게는 뺀다 */}
        <button type="button" className={`chip-f none${!value ? " on" : ""}`} aria-pressed={!value} onClick={() => onPick(undefined)}>
          제한 없음
        </button>
        {/* 칩에 「이하」를 붙이면 236px 레일에서 한 줄에 하나씩만 들어간다 — 뜻은 제목이 지고 칩은 금액만 */}
        {steps.map((v) => (
          <button key={v} type="button" className={`chip-f${value === v ? " on" : ""}`} aria-pressed={value === v}
            aria-label={`${wonStep(v)} 이하`} onClick={() => onPick(value === v ? undefined : v)}>
            {wonStep(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

function RailBody() {
  const { f, facets, set, setSido, view, setView } = useListState();
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
      {/* 「무엇을 보느냐」가 아니라 「어떻게 보느냐」 — 조건 위에 한 줄로 묶는다.
          예전엔 목록 위 얇은 바(filter-bar)였는데 좁은 화면에서 두 줄로 넘쳤다(사용자 요청 2026-09-09) */}
      <div className="rail-g rail-view">
        <h3>보기</h3>
        <div className="viewsw" role="group" aria-label="목록 보기">
          {NOTICE_VIEWS.map((v) => {
            const { label, Icon } = VIEW_META[v];
            return (
              <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} aria-label={label} title={label} onClick={() => setView(v)}>
                <Icon />
              </button>
            );
          })}
        </div>
      </div>

      <div className="rail-g">
        <h3>정렬</h3>
        <div className="rail-chips">
          <button type="button" className={`chip-f${!f.sort || f.sort === "posted" ? " on" : ""}`} aria-pressed={!f.sort || f.sort === "posted"} onClick={() => set({ sort: "posted" })}>최신 공고순</button>
          <button type="button" className={`chip-f${f.sort === "deadline" ? " on" : ""}`} aria-pressed={f.sort === "deadline"} onClick={() => set({ sort: "deadline" })}>마감 임박순</button>
          {/* 임대 목록에 값싼 순이 없었다(2026-09-21). 월세를 못 읽은 공고는 맨 뒤로 간다 */}
          <button type="button" className={`chip-f${f.sort === "rent" ? " on" : ""}`} aria-pressed={f.sort === "rent"} onClick={() => set({ sort: "rent" })}>월세 낮은 순</button>
        </div>
      </div>

      <div className="rail-g">
        <h3>부문</h3>
        <div className="rail-chips">
          <button type="button" className={`chip-f${!f.sector ? " on" : ""}`} aria-pressed={!f.sector} onClick={() => set({ sector: undefined })}>
            전체 <small>{facets.total}</small>
          </button>
          {SECTORS.map((s) => (
            <button key={s} type="button" className={`chip-f${f.sector === s ? " on" : ""}`} aria-pressed={f.sector === s} onClick={() => set({ sector: s })}>
              {s} <small>{countOf(s)}</small>
            </button>
          ))}
        </div>
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
      <BudgetChips label="보증금" steps={DEPOSIT_STEPS} value={f.maxDeposit} onPick={(v) => set({ maxDeposit: v })} />
      <BudgetChips label="월임대료" steps={RENT_STEPS} value={f.maxRent} onPick={(v) => set({ maxRent: v })} />

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
