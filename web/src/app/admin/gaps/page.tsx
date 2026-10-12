// 빈 칸 점검 — 파서가 오류 없이 끝났는데 일정, 단지, 공급 호수, 좌표가 빈 최근 공고(2026-10-12).
// 읽기만 한다. 고치는 일은 pipeline 스테이지를 다시 돌려서 한다(CLAUDE.md admin 규칙). 질의 하나(lib/admin.ts gapRows).
import Link from "next/link";
import { isAdmin } from "@/lib/admin-auth";
import { GAP_DAYS, gapRows, type GapRow } from "@/lib/admin";
import { noticePath } from "@/lib/routes";

export const dynamic = "force-dynamic";

const FLAGS: { key: keyof Pick<GapRow, "no_schedule" | "no_complex" | "no_supply" | "no_geo">; label: string }[] = [
  { key: "no_schedule", label: "일정" },
  { key: "no_complex", label: "단지" },
  { key: "no_supply", label: "공급 호수" },
  { key: "no_geo", label: "좌표" },
];

export default async function AdminGaps() {
  if (!(await isAdmin())) return null;
  const rows = await gapRows();
  const counts = FLAGS.map((f) => ({ ...f, n: rows.filter((r) => r[f.key]).length }));

  return (
    <div className="adm-page">
      <header className="adm-head">
        <h1>빈 칸 점검</h1>
        <p className="adm-sub">
          최근 {GAP_DAYS}일 SH와 서울시 공고 중 빈 칸이 있는 {rows.length}건 | {counts.map((c) => `${c.label} ${c.n}`).join(" | ")}
        </p>
      </header>
      <p className="adm-sub">
        파서가 실패하면 수집 이력에 빨갛게 남는다. 여기는 <b>오류 없이 0건으로 끝난</b> 공고를 찾는 자리다 — 공고문 조판이 바뀌면 이렇게 조용히 빈다.
        전세임대, 일정 연기 안내처럼 원래 비는 공고도 섞여 있다.
      </p>
      <div className="adm-table">
        <table>
          <thead>
            <tr>
              <th>공고일</th>
              <th>공고</th>
              <th>빈 칸</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug}>
                <td>{r.posted_at}</td>
                <td>
                  <Link href={noticePath(r.slug)} target="_blank">{r.title}</Link>
                  <small> {r.agency} | {r.housing_type} | {r.slug}</small>
                </td>
                <td className="adm-sum">
                  {FLAGS.filter((f) => r[f.key]).map((f) => <span key={f.key} className="skip">{f.label}</span>)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3}>빈 칸 있는 공고가 없다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
