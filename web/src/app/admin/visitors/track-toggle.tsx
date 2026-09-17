"use client";

// 「이 브라우저를 셀까」 스위치.
//
// 관리자 콘솔에 들어온 브라우저는 집계에서 빠진다(admin-nav.tsx). 기본값으로는 맞지만,
// **운영자가 제 사이트를 열어 집계가 도는지 확인할 길이 없어진다** — 아무리 돌아다녀도 0이다.
// 그래서 끄고 켜는 자리를 하나 둔다. 표식은 브라우저마다 따로라 이 스위치도 브라우저마다 따로다.
//
// 값은 셋이다 — 없음(콘솔이 곧 "1"을 심는다) / "1"(제외) / "0"(센다).
// 「센다」로 둔 브라우저는 콘솔을 다시 열어도 그대로다.
import { useEffect, useState } from "react";
import { VISIT_OPT_OUT_KEY } from "@/lib/constants";

export function TrackToggle() {
  // 서버에서는 localStorage를 못 본다. 첫 그림은 비워 두고 붙은 뒤에 읽는다 —
  // 아무 값이나 넣고 시작하면 하이드레이션이 어긋나며 글자가 한 번 튄다
  const [counted, setCounted] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setCounted(localStorage.getItem(VISIT_OPT_OUT_KEY) !== "1");
    } catch {
      // 저장이 막힌 브라우저. 이 경우 visit-tracker도 식별자를 못 만들어 어차피 안 세진다
      setCounted(null);
    }
  }, []);

  function flip() {
    const next = !counted;
    try {
      localStorage.setItem(VISIT_OPT_OUT_KEY, next ? "0" : "1");
      setCounted(next);
    } catch {
      setCounted(null);
    }
  }

  if (counted === null) return null;

  return (
    <div className="adm-run">
      <button type="button" onClick={flip}>
        {counted ? "이 브라우저 집계에서 빼기" : "이 브라우저도 집계에 넣기"}
      </button>
      {/* 「센다」가 켜진 상태만 초록으로 짚는다. 빼 둔 쪽이 평상시라 붉게 칠하면 고장으로 읽힌다 */}
      <span className={counted ? "adm-run-msg" : "adm-run-msg off"} role="status">
        {counted
          ? "지금 이 브라우저의 방문은 숫자에 들어간다"
          : "지금 이 브라우저의 방문은 숫자에 안 들어간다"}
      </span>
    </div>
  );
}
