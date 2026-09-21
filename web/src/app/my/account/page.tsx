// 내 계정. 보여주는 건 넷뿐이다 — 누구로 들어와 있나, 언제 가입했나, 무엇을 담아 뒀나,
// 그리고 나가는 문 둘(로그아웃과 탈퇴).
//
// **고칠 수 있는 값을 두지 않는다.** 별명과 사진은 카카오가 원천이라 여기서 바꿔 봐야
// 다음 로그인에 되돌아간다 — 바꾸는 자리는 카카오라고 말해 주는 편이 정직하다.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WithdrawBox } from "@/components/withdraw-box";
import { currentUser } from "@/lib/auth";
import { count } from "@/lib/format";
import { loginPath, ROUTES } from "@/lib/routes";
import { listSavedIds } from "@/lib/users";
import { signOut } from "../actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "내 계정",
  robots: { index: false, follow: false },
};

function dateKST(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect(loginPath(ROUTES.myAccount));

  const saved = await listSavedIds(user.id);
  const name = user.nickname?.trim() || "회원";

  return (
    <div className="acct-page">
      <h1>내 계정</h1>

      <div className="acct-card">
        {user.profile_image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.profile_image} alt="" width={52} height={52} referrerPolicy="no-referrer" />
        ) : (
          <i aria-hidden="true">{name.slice(0, 1)}</i>
        )}
        <div>
          <b>{name}</b>
          <span>카카오 계정으로 로그인 | {dateKST(user.created_at)} 가입</span>
          {user.email && <span>{user.email}</span>}
        </div>
      </div>

      <dl className="acct-facts">
        <div>
          <dt>담아 둔 관심 공고</dt>
          <dd>
            {saved.length > 0 ? <Link href={ROUTES.my}>{count(saved.length)}</Link> : "아직 없습니다"}
          </dd>
        </div>
        <div>
          <dt>별명과 프로필 사진</dt>
          <dd>
            카카오에서 바꾸면 다음 로그인 때 따라옵니다 —{" "}
            <a href="https://accounts.kakao.com" target="_blank" rel="noopener noreferrer">카카오 계정 관리</a>
          </dd>
        </div>
      </dl>

      <div className="acct-out">
        <form action={signOut}>
          <button type="submit" className="btn">로그아웃</button>
        </form>
      </div>

      <WithdrawBox savedCount={saved.length} />
    </div>
  );
}
