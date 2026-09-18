"use client";

// 헤더의 「저장」 메뉴. 저장 건수 배지가 붙는다.
//
// 건수는 localStorage에서 나오므로 서버 HTML에는 없다. 0일 때 배지를 아예 안 그리는 게
// 하이드레이션 안전장치이기도 하다 — SaveProvider의 첫 렌더는 항상 빈 집합이라 서버와 같은 모양이 되고,
// 실제 값은 그 다음 렌더에서 들어온다(save-button.tsx 머리글의 함정과 같은 이유).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import { useSave } from "./save-context";

export function SavedLink() {
  const { saved } = useSave();
  const on = usePathname() === ROUTES.my;
  const n = saved.size;
  return (
    // saved-nav 클래스는 좁은 화면에서 이 링크만 남기는 표식이다(globals.css)
    <Link href={ROUTES.my} className={`saved-nav${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
      저장
      {n > 0 && <em className="nav-badge">{n}</em>}
    </Link>
  );
}
