// Neon Postgres 읽기 전용 접근. web은 DB를 읽기만 한다 (CLAUDE.md).
// Pool은 모듈 스코프 싱글턴 — dev HMR로 모듈이 재평가돼도 커넥션이 늘어나지 않게 globalThis에 보관.
import { Pool, types } from "pg";

// date(1082)는 문자열 그대로 받는다. Date 객체로 바꾸면 타임존 때문에 하루가 밀린다.
types.setTypeParser(1082, (v) => v);
// int8(20)·numeric(1700)은 화면에서 숫자로 쓴다. 금액은 2^53 안이라 안전.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const g = globalThis as unknown as { __zipgonggoPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL 이 없다. web/.env.local 확인");
  return new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
}

export const pool: Pool = g.__zipgonggoPool ?? (g.__zipgonggoPool = createPool());

export async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
