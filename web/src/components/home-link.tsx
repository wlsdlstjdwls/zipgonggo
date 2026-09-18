"use client";

// 헤더 로고 — 홈으로만 간다. 스코프는 지우지 않는다(사용자 요청 2026-09-09: 로고를 눌렀다고 필터가 풀리면 안 된다).
// "전국 전체"로 되돌리는 자리는 스코프 바의 "전체" 칩과 시도 셀렉트의 "전국"이다.
import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { SITE_NAME } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";

export function HomeLink() {
  return (
    <Link href={ROUTES.home} className="logo">
      <BrandMark size={22} />
      {/* 워드마크를 b로 싼다 — 좁은 화면에서 이것만 접는다(상세 머리바 .dhb-logo와 같은 순서) */}
      <b>{SITE_NAME}</b>
    </Link>
  );
}
