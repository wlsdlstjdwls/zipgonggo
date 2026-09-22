"use client";

// 동호수별 목록을 지면에 펼치지 않고 창으로 연다(사용자 결정 2026-09-22:
// "동호수별 정보도 데스크탑은 팝업, 모바일은 바텀시트로 제공하자").
//
// 표 자체는 UnitTable 그대로다 — 여는 버튼과 껍데기만 여기 있다.
// 넓은 화면에서 가운데 뜨는 창, 좁은 화면에서 아래에서 올라오는 시트는 Sheet가 이미 둘 다 한다(계산기와 같은 부품).
// 172호짜리 단지에서도 지면이 먹는 자리는 버튼 하나다.

import { useCallback, useRef, useState } from "react";
import { num } from "@/lib/format";
import type { NoticeUnit } from "@/types/notice";
import { Sheet } from "./sheet";
import { UnitTable } from "./unit-table";

export function UnitSheet({ units, label }: { units: NoticeUnit[]; label: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  // 닫고 나면 여는 버튼으로 초점을 돌려준다. 닫힘 자체(퇴장 애니메이션·ESC·배경 잠금)는 Sheet가 맡는다
  const close = useCallback(() => { setOpen(false); btn.current?.focus(); }, []);

  if (units.length === 0) return null;

  return (
    <>
      <button ref={btn} type="button" className="facts-more" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        {label} <b>{num(units.length, "호")}</b>
        <i aria-hidden="true">→</i>
      </button>
      {/* 표는 열었을 때만 만든다 — 닫힌 채로 172줄을 세워 둘 이유가 없다 */}
      <Sheet open={open} onClose={close} title={`${label} | ${num(units.length, "호")}`} size="lg" maxHeight="86vh">
        {open && <UnitTable units={units} />}
      </Sheet>
    </>
  );
}
