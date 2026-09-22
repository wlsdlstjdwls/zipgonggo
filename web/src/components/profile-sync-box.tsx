"use client";

// 「내 조건」을 계정에도 저장할지 고르는 자리(/my/account).
//
// **기본은 꺼짐이다.** 로그인만으로는 조건이 서버로 가지 않는다(사용자 결정 2026-09-22).
// 켜기는 지금 값을 한 번 올리는 것이고, 끄기는 서버 사본을 지우는 것이다 —
// 브라우저에 있는 값은 어느 쪽이든 그대로 남아 진단은 계속 돈다.
//
// 켠 뒤에는 **무엇이 서버에 있는지 그대로 보인다.** 「저장했다」고만 적고 내용을 안 보이면
// 이용자는 제 값이 어디까지 갔는지 알 길이 없다. 건강과 이어지는 칸은 애초에 올라가지 않으므로
// 이 목록에도 나오지 않는다(개인정보처리방침 3항).
import Link from "next/link";
import { useEffect, useState } from "react";
import { PROFILE_SYNC_START } from "@/lib/constants";
import { wonKo } from "@/lib/format";
import { stripSensitive } from "@/lib/profile";
import { ROUTES } from "@/lib/routes";
import { useProfile } from "./profile-context";

const MAN = 10_000;

export function ProfileSyncBox() {
  const { profile, sync, syncLoading, setSync } = useProfile();
  const [busy, setBusy] = useState(false);
  // 시행일 비교는 브라우저 시계로 한다 — 마운트 전에는 예고 문구를 그대로 그려 하이드레이션이 어긋나지 않게
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    setOpened(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) >= PROFILE_SYNC_START);
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      await setSync(!sync);
    } finally {
      setBusy(false);
    }
  };

  const shown = stripSensitive(profile);
  const rows: [string, string][] = [
    ["나이", `${shown.age}세`],
    ["혼인 상태", shown.marital + (shown.marital === "기혼" && shown.marriedYears > 0 ? ` ${shown.marriedYears}년차` : "")],
    ["가구원 수", `${shown.household}명`],
    ["본인 월소득", wonKo(shown.incomeSelfWon)],
    ["세대 합산 월소득", wonKo(shown.incomeHouseholdWon)],
    ["총자산", wonKo(shown.assetMan * MAN)],
    ["자동차가액", shown.carMan > 0 ? wonKo(shown.carMan * MAN) : "없음"],
    ["거주지", shown.region || shown.gu || "선택 안 함"],
    ["무주택", shown.homeless ? "예" : "아니오"],
    ["청약 납입 회차", `${shown.deposits}회`],
    ["해당 계층", shown.classes.length > 0 ? shown.classes.join(" | ") : "없음"],
  ];

  return (
    <section className="acct-sync">
      <h2>자격진단 조건 저장</h2>
      {!opened ? (
        <p>
          자가진단과 공고 지면에 넣은 조건은 지금 이 브라우저에만 있습니다. 계정에도 저장해 기기를 바꿔도
          이어 쓰는 기능을 <strong>{PROFILE_SYNC_START}</strong>부터 엽니다 —{" "}
          <Link href={ROUTES.privacy}>개인정보처리방침</Link> 11항에 미리 알린 대로입니다.
        </p>
      ) : (
        <>
          <p>
            {sync
              ? "이 계정에 조건을 저장하고 있습니다. 기기를 바꾸거나 브라우저 데이터를 지워도 이어집니다."
              : "지금은 이 브라우저에만 있습니다. 켜면 계정에도 한 벌 저장해 기기를 바꿔도 이어 쓸 수 있습니다."}
          </p>
          <p className="acct-sync-note">
            장애 여부, 국가유공 여부, 북한이탈주민 여부는 켜더라도 계정으로 올라가지 않고 이 브라우저에만
            남습니다. 끄면 서버 사본을 즉시 지우며, 브라우저에 있는 값은 그대로 두어 진단은 계속 돌아갑니다.
          </p>
          <button type="button" className={sync ? "acct-sync-off" : "acct-sync-on"} disabled={busy || syncLoading} onClick={toggle}>
            {busy ? "처리하는 중" : sync ? "끄고 계정에서 지우기" : "이 계정에 저장하기"}
          </button>
          {sync && (
            <dl className="acct-facts acct-sync-list">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  );
}
