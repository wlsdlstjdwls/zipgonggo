"use client";

// 공유 버튼 — 모바일은 OS 공유 시트(navigator.share), 없는 환경(대부분 데스크톱)은 링크 복사로 대신한다.
// 공유 시트를 취소해도 복사로 대체하지 않는다(취소했는데 클립보드가 바뀌면 놀란다).
import { useState } from "react";

export function ShareButton({ title, text, variant = "panel" }: { title: string; text?: string; variant?: "panel" | "icon" }) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    const url = window.location.href;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        /* 사용자가 공유 시트를 닫음 — 조용히 넘어간다 */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 클립보드 권한이 없는 드문 환경 */
    }
  };

  if (variant === "icon") {
    return (
      <button type="button" className={`share${copied ? " on" : ""}`} onClick={onClick} aria-label={copied ? "링크 복사됨" : "공유하기"}>
        {copied ? "✓" : "⇧"}
      </button>
    );
  }
  return (
    <button type="button" className="btn lg" onClick={onClick}>
      {copied ? "✓ 링크 복사됨" : "공유하기"}
    </button>
  );
}
