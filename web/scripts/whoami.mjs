// ADMIN_KAKAO_ID에 넣을 값을 찾아 준다.
//
//   node --env-file=.env.local scripts/whoami.mjs
//
// 카카오로 한 번 로그인해 둔 뒤에 돌린다 — 로그인해야 user_account에 행이 생긴다.
// 회원이 여럿이면 전부 찍는다. 운영자 본인의 별명을 보고 고르면 된다.
//
// 이 값은 **아직 안 연 메뉴를 보일지만 가린다.** 콘솔(/admin) 출입과는 무관하다
// (web/src/lib/admin-auth.ts adminKakaoId 주석).
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL이 없다. --env-file=.env.local 을 붙였는지 확인할 것.");
  process.exit(1);
}

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(
  `SELECT kakao_id, nickname, created_at, last_login_at FROM user_account ORDER BY last_login_at DESC`,
);
await c.end();

if (rows.length === 0) {
  console.log("회원이 없다. 카카오로 한 번 로그인한 뒤 다시 돌릴 것.");
  process.exit(0);
}

console.log(`회원 ${rows.length}명 (마지막 접속 순)\n`);
for (const r of rows) {
  console.log(`  ${r.nickname ?? "(별명 없음)"}  가입 ${r.created_at.toISOString().slice(0, 10)}`);
  console.log(`  ADMIN_KAKAO_ID=${r.kakao_id}\n`);
}
console.log("본인 줄의 ADMIN_KAKAO_ID= 를 .env.local에 그대로 붙여 넣고 dev를 다시 띄운다.");
