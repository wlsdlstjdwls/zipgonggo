"use client";

// 말줄임 글자에만 붙는 툴팁(사용자 요청 2026-09-09: "…로 자를 거면 툴팁도 넣어 달라").
// 잘리지 않은 글자에까지 말풍선이 뜨면 소음이라, 마우스를 올리는 순간 실제로 넘쳤는지 재서 정한다.
// 마운트할 때 재지 않는 이유: 목록은 한 화면에 수십 줄이라 관찰자·측정이 그만큼 쌓인다.
// 말풍선 모양은 globals.css의 [data-tip] 한 곳에 있다.
import { useCallback, useState } from "react";

type Props = {
  text: string;
  className?: string;
  /** 화면 오른쪽 끝 요소 — 말풍선을 오른쪽에 맞춰 밖으로 나가지 않게 한다 */
  end?: boolean;
  /** 기본은 span. 블록 요소가 필요하면 넘긴다 */
  as?: "span" | "p" | "div";
};

function overflows(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

export function Trunc({ text, className, end, as: Tag = "span" }: Props) {
  const [tip, setTip] = useState("");
  const measure = useCallback((e: React.SyntheticEvent<HTMLElement>) => {
    setTip(overflows(e.currentTarget) ? text : "");
  }, [text]);

  return (
    <Tag
      className={`${className ?? ""}${end ? " tip-end" : ""}`.trim() || undefined}
      data-tip={tip}
      onMouseEnter={measure}
      onFocus={measure}
    >
      {text}
    </Tag>
  );
}
