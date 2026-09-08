"""마이그레이션 적용기. psql이 없는 환경용.

    python db/migrate.py            # 미적용 파일 순차 적용
    python db/migrate.py --status   # 적용 현황만

접속 문자열은 pipeline/.env 의 DATABASE_URL (direct/unpooled). 적용 이력은 schema_migrations 테이블.
한 파일은 한 트랜잭션. 실패하면 그 파일 전체가 롤백된다.
"""
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "db" / "migrations"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env = ROOT / "pipeline" / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("DATABASE_URL 없음: 환경변수 또는 pipeline/.env")


def main() -> None:
    status_only = "--status" in sys.argv
    conn = psycopg.connect(database_url())
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename   text PRIMARY KEY,
          sha256     text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    conn.commit()
    cur.execute("SELECT filename, sha256 FROM schema_migrations ORDER BY filename")
    applied = dict(cur.fetchall())

    files = sorted(p for p in MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    for path in files:
        sql = path.read_text(encoding="utf-8")
        digest = hashlib.sha256(sql.encode("utf-8")).hexdigest()
        if path.name in applied:
            mark = "OK " if applied[path.name] == digest else "DRIFT(적용 후 파일이 바뀜)"
            print(f"  {mark} {path.name}")
            continue
        if status_only:
            print(f"  --  {path.name} (미적용)")
            continue
        try:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (filename, sha256) VALUES (%s, %s)",
                (path.name, digest),
            )
            conn.commit()
            print(f"  APPLIED {path.name}")
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            sys.exit(f"  FAILED {path.name}: {exc}")
    conn.close()


if __name__ == "__main__":
    main()
