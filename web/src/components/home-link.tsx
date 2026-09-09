"use client";

// 헤더 로고 — 홈("/")은 곧 "전국" 스코프다. 눌렀을 때 저장된 스코프를 지워야
// ScopeRestore가 다시 시도로 되돌리지 않는다(스코프 탈출구).
import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { SITE_NAME } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";
import { clearScope } from "@/lib/scope";

export function HomeLink() {
  return (
    <Link href={ROUTES.home} className="logo" onClick={clearScope}>
      <BrandMark size={22} />{SITE_NAME}
    </Link>
  );
}
