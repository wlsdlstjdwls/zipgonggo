// 관리자 비밀번호 해시 만들기. 평문은 어디에도 저장하지 않는다 — 이 출력만 env에 넣는다.
//
//   node scripts/admin-password.mjs '비밀번호'
//
// 찍힌 줄을 web/.env.local(로컬)과 Vercel 환경변수(프로덕션)의 ADMIN_PASSWORD_HASH에 넣는다.
// 비밀번호를 바꾸면 해시가 바뀌고, 해시가 서명 열쇠라 **발급해 둔 로그인 쿠키가 전부 무효**가 된다.
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("쓰기: node scripts/admin-password.mjs '비밀번호'");
  process.exit(1);
}

// lib/admin-auth.ts의 인자와 같아야 한다. 한쪽만 바꾸면 검증이 통째로 실패한다
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

const salt = randomBytes(16);
const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
// 구분자는 `:`다. `$`를 쓰면 Next의 env 로더가 `$16384`를 변수로 보고 값을 통째로 지운다
console.log(`ADMIN_PASSWORD_HASH=scrypt:${N}:${R}:${P}:${salt.toString("base64")}:${key.toString("base64")}`);
