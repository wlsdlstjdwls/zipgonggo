"""도로명주소 요약DB에서 수도권만 뽑아 축소본을 만든다 — GitHub Actions에 올리기 위한 것.

전국본 `entrance.sqlite`는 641만 행 1.16GB라 CI가 매번 받기엔 무겁고 커밋도 금지다(CLAUDE.md 하지 말 것 2).
수도권(서울·경기·인천)은 173만 행(27%)이라 잘라 내면 ~300MB로 떨어진다.
`dong_center`는 5천 행이라 통째로 가져간다.

서울만 남기면 90MB까지 줄지만 실측에서 전국본 대비 300건 중 2건을 놓쳤다(서울 밖 물건).
틀린 값을 싣느니 비워 둔다는 규율(handoff)과 별개로 **맞출 수 있는 걸 놓치는 건 손해**라 수도권으로 잡는다.

    cd pipeline && python scripts/make_seoul_juso.py
    gh release upload juso-data data/juso/entrance-capital.sqlite.gz --clobber

원본이 갱신되면(행안부는 월 단위 배포) 다시 돌려 올린다. 산출물은 커밋하지 않는다.
"""

from __future__ import annotations

import argparse
import gzip
import shutil
import sqlite3
import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SRC = PIPELINE_ROOT / "data" / "juso" / "entrance.sqlite"
DEFAULT_DST = PIPELINE_ROOT / "data" / "juso" / "entrance-capital.sqlite"
CAPITAL = ("서울특별시", "경기도", "인천광역시")


def build(src: Path, dst: Path, sidos: list[str]) -> None:
    if not src.exists():
        raise SystemExit(f"원본이 없다: {src}")
    dst.unlink(missing_ok=True)
    Path(str(dst) + ".gz").unlink(missing_ok=True)

    con = sqlite3.connect(src)
    con.execute("ATTACH DATABASE ? AS out", (str(dst),))

    # 스키마는 원본에서 그대로 베낀다 — 컬럼이 늘어도 이 스크립트를 고칠 일이 없게.
    for name, sql in con.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('entrance','dong_center')"
    ).fetchall():
        con.execute(sql.replace(f"TABLE {name}", f"TABLE out.{name}", 1))

    marks = ",".join("?" * len(sidos))
    con.execute(f"INSERT INTO out.entrance SELECT * FROM main.entrance WHERE sido IN ({marks})", sidos)
    con.execute("INSERT INTO out.dong_center SELECT * FROM main.dong_center")
    # 조회 인덱스는 S6이 쓰는 것과 같아야 한다(geo/store.py의 road_name·main_no·sub_no·underground).
    con.execute(
        "CREATE INDEX out.idx_entrance_lookup ON entrance (road_name, main_no, sub_no, underground)"
    )
    con.commit()
    rows = con.execute("SELECT count(*) FROM out.entrance").fetchone()[0]
    dongs = con.execute("SELECT count(*) FROM out.dong_center").fetchone()[0]
    con.close()

    with open(dst, "rb") as fi, gzip.open(str(dst) + ".gz", "wb", compresslevel=9) as fo:
        shutil.copyfileobj(fi, fo)

    mb = dst.stat().st_size / 1e6
    gz = Path(str(dst) + ".gz").stat().st_size / 1e6
    print(f"{'/'.join(sidos)} 출입구 {rows:,}행 / 동중심 {dongs:,}행 → {mb:.0f}MB (gz {gz:.0f}MB)")
    print(f"  {dst}.gz")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--dst", type=Path, default=DEFAULT_DST)
    ap.add_argument("--sido", action="append", default=None,
                    help=f"기본값 {' '.join(CAPITAL)}. 여러 번 줄 수 있다")
    a = ap.parse_args(argv)
    build(a.src, a.dst, a.sido or list(CAPITAL))
    return 0


if __name__ == "__main__":
    sys.exit(main())
