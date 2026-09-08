import Link from "next/link";
import { ROUTES } from "@/lib/routes";

export default function NotFound() {
  return (
    <div className="empty">
      <p>페이지를 찾을 수 없습니다.</p>
      <Link href={ROUTES.home} className="back">← 공고 목록</Link>
    </div>
  );
}
