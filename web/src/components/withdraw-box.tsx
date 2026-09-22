"use client";

// 회원 탈퇴. **한 번 더 묻는다** — 되돌릴 수 없는 일이라 실수로 눌리면 안 된다.
// 브라우저 confirm()을 쓰지 않는다(모바일에서 보기 흉하고, 무엇이 사라지는지 적을 자리가 없다).
import { useState } from "react";
import { withdraw } from "@/app/my/actions";
import { count } from "@/lib/format";

export function WithdrawBox({ savedCount }: { savedCount: number }) {
  const [asking, setAsking] = useState(false);

  return (
    <section className="acct-bye">
      <h2>회원 탈퇴</h2>
      {!asking ? (
        <>
          <p>계정과 서버에 보관 중인 관심 공고, 저장해 둔 자격진단 조건을 지웁니다. 되돌릴 수 없습니다.</p>
          <button type="button" className="acct-bye-open" onClick={() => setAsking(true)}>
            탈퇴하기
          </button>
        </>
      ) : (
        <>
          <p className="acct-bye-warn">
            정말 탈퇴하시겠습니까? 회원 정보와 서버에 있는 관심 공고{" "}
            {savedCount > 0 ? count(savedCount) : "목록"}, 저장해 둔 자격진단 조건이 바로 지워집니다.
            이 브라우저에 남아 있는 목록과 조건은 그대로 두니, 로그인 없이 계속 쓸 수 있습니다.
          </p>
          <p className="acct-bye-note">
            카카오와의 연결 끊기는 카카오 계정 관리 &gt; 연결된 서비스에서 따로 해제할 수 있습니다.
            저희는 카카오 접속 토큰을 보관하지 않아 대신 끊어 드릴 수 없습니다.
          </p>
          <div className="acct-bye-row">
            <form action={withdraw}>
              <button type="submit" className="acct-bye-go">네, 탈퇴합니다</button>
            </form>
            <button type="button" onClick={() => setAsking(false)}>그만두기</button>
          </div>
        </>
      )}
    </section>
  );
}
