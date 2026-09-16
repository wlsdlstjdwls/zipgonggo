import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const q = async (label, sql) => {
  const r = await pool.query(sql);
  console.log("### " + label);
  console.table(r.rows);
};
const sql = process.argv[2];
if (sql) { await q("adhoc", sql); }
await pool.end();
