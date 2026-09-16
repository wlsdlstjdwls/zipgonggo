// Neon Postgres 읽기 전용 접근. web은 DB를 읽기만 한다 (CLAUDE.md).
// Pool은 모듈 스코프 싱글턴 — dev HMR로 모듈이 재평가돼도 커넥션이 늘어나지 않게 globalThis에 보관.
import { Pool, types } from "pg";

// date(1082)는 문자열 그대로 받는다. Date 객체로 바꾸면 타임존 때문에 하루가 밀린다.
types.setTypeParser(1082, (v) => v);
// int8(20)·numeric(1700)은 화면에서 숫자로 쓴다. 금액은 2^53 안이라 안전.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const g = globalThis as unknown as { __zipgonggoPool?: Pool; __zipgonggoPoolHandled?: boolean };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL 이 없다. web/.env.local 확인");
  // (2026-09-09) DB를 Neon us-east-1로 옮기기 전엔 ap-southeast-1까지 새 커넥션 수립이 ~550ms였다.
  // 지금은 함수 리전(iad1)과 같은 물리 리전이라 그 정도로 느리진 않지만,
  // idle 10분 유지는 그대로 둔다 — 매 방문마다 새 커넥션 여는 비용 자체는 없느니만 못하다.
  return new Pool({ connectionString, max: 5, idleTimeoutMillis: 600_000, keepAlive: true });
}

export const pool: Pool = g.__zipgonggoPool ?? (g.__zipgonggoPool = createPool());
// Neon이 유휴 커넥션을 서버 쪽에서 끊으면 pg가 idle 클라이언트 'error'를 내고, 핸들러가 없으면 프로세스 uncaughtException.
// 끊긴 클라이언트는 풀이 알아서 버리므로 기록만 한다 (실측 2026-09-08 dev 로그 "Connection terminated unexpectedly").
if (!g.__zipgonggoPoolHandled) {
  g.__zipgonggoPoolHandled = true;
  pool.on("error", (err) => console.warn("[db] 유휴 커넥션 종료:", err.message));
}

export async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
