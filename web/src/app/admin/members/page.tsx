// 회원 — 누가 들어와 있고, 무엇을 담아 두는가.
//
// **조회 전용이다.** 콘솔은 DB를 읽기만 한다는 규칙(CLAUDE.md)이 회원 표에도 그대로 간다 —
// 여기서 회원을 지우거나 막지 않는다. 탈퇴는 본인이 /my/account에서 한다.
//
// 이메일은 카카오 검수를 통과한 앱에만 들어오므로 보통 비어 있다. 값이 있어도 가운데를 가린다 —
// 운영자가 목록을 훑다가 어깨너머로 새는 걸 막는 정도의 최소한이다.
import Link from "next/link";
import { isAdmin } from "@/lib/admin-auth";
import { ago, stampKST } from "@/lib/admin";
import { count } from "@/lib/format";
import { noticePath, ROUTES } from "@/lib/routes";
import { listMembers, memberStats, topSavedNotices } from "@/lib/users";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="adm-stat">
      <span>{label}</span>
      <b>{value.toLocaleString("ko-KR")}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

/** `ab***@gmail.com`. 아이디 앞 두 글자만 남긴다 */
function maskEmail(email: string | null): string {
  if (!email) return "";
  const [id, host] = email.split("@");
  if (!host) return "***";
  return `${id.slice(0, 2)}***@${host}`;
}

/** 가입 뒤 얼마나 지났는지(분) — ago()가 분을 받는다 */
function minsSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export default async function AdminMembers({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  if (!(await isAdmin())) return null;

  const { page: raw } = await searchParams;
  const page = Math.max(1, Number(raw) || 1);
  const [stats, rows, top] = await Promise.all([
    memberStats(),
    listMembers(PER_PAGE, (page - 1) * PER_PAGE),
    topSavedNotices(),
  ]);
  const hasMore = rows.length === PER_PAGE;

  return (
    <div className="adm-page">
      <header className="adm-head">
        <h1>회원</h1>
        <p className="adm-sub">
          카카오 로그인만 받는다. 저장하는 값은 회원번호와 별명, 프로필 사진, 접속 시각뿐이다
        </p>
      </header>

      <section className="adm-sec">
        <h2>요약</h2>
        <div className="adm-stats">
          <Stat label="전체 회원" value={stats.total} />
          <Stat label="7일 신규" value={stats.new7d} />
          <Stat label="30일 내 접속" value={stats.active30d} note="살아 있는 회원" />
          <Stat label="관심 공고를 담은 회원" value={stats.with_saved} note={`담긴 공고 ${stats.saved_total.toLocaleString("ko-KR")}건`} />
        </div>
      </section>

      <section className="adm-sec">
        <h2>
          목록
          <small>최근 가입 순 | {page}쪽</small>
        </h2>
        {rows.length === 0 ? (
          <p className="adm-note">아직 회원이 없다. 카카오 콘솔에 콜백 주소를 등록했는지부터 본다</p>
        ) : (
          <div className="adm-table">
            <table>
              <thead>
                <tr>
                  <th>회원</th>
                  <th>가입</th>
                  <th>최근 접속</th>
                  <th>로그인</th>
                  <th>관심 공고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <b>{m.nickname?.trim() || "이름 없음"}</b>
                      {m.email && <small> {maskEmail(m.email)}</small>}
                      <i> #{m.id}</i>
                    </td>
                    <td>
                      {stampKST(m.created_at)}
                      <small> {ago(minsSince(m.created_at))}</small>
                    </td>
                    <td>{ago(minsSince(m.last_login_at))}</td>
                    <td>{m.login_count.toLocaleString("ko-KR")}회</td>
                    <td>{m.saved_count > 0 ? count(m.saved_count) : <i>없음</i>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(hasMore || page > 1) && (
          <div className="adm-more">
            {page > 1 && <Link href={`${ROUTES.adminMembers}?page=${page - 1}`}>이전</Link>}
            {hasMore && <Link href={`${ROUTES.adminMembers}?page=${page + 1}`}>다음</Link>}
          </div>
        )}
      </section>

      <section className="adm-sec">
        <h2>
          많이 담은 공고
          <small>방문 수보다 이쪽이 「눈여겨보는 공고」에 가깝다</small>
        </h2>
        {top.length === 0 ? (
          <p className="adm-note">아직 담긴 공고가 없다</p>
        ) : (
          <div className="adm-table">
            <table>
              <thead>
                <tr>
                  <th>공고</th>
                  <th>담은 사람</th>
                </tr>
              </thead>
              <tbody>
                {top.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <Link href={noticePath(n.slug)} className="adm-path">{n.title}</Link>
                    </td>
                    <td>{n.savers.toLocaleString("ko-KR")}명</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
