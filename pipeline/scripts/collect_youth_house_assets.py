"""민간임대(청년안심주택) 공고 단지 → 포털 「주택찾기」 이미지와 단지 사실 붙이기.

왜 이 길인가: 민간임대 공고문 PDF에는 도면이 없고(첨부 452건 전수 확인 — 0026 주석 참조) **관리비도 없다**.
포털 「주택찾기」가 단지 단위로 전경·투시도·평면도·편의시설 사진과 관리비·운영사·시행사·입주예정일을 준다.
경로 실측은 `sources/youth_house.py` 머리글.

    cd pipeline
    python scripts/collect_youth_house_assets.py houses          # 단지 목록 → data/youth-house/houses.json
    python scripts/collect_youth_house_assets.py match           # 공고 단지 ↔ homeCode → match.json (--write면 DB에도)
    python scripts/collect_youth_house_assets.py fetch           # 상세 파싱 + 이미지 내려받기 → data/youth-house/img/
    python scripts/collect_youth_house_assets.py load            # 이미지(0026)+단지 사실(0027) 적재 + web/public 복사

`match`는 DB의 `notice_complex` 행(공고 수집이 넣은 것)을 대조한다 — 공고문을 다시 읽지 않는다.
SH판(`collect_sh_house_assets.py`)과 같은 흐름이되, 단지 목록이 96곳뿐이라 공고(seq)별로 나누지 않고 한 번에 돈다.

**공개 발행 전에 저작권을 확인한다.** 포털 자체는 서울시 공공저작물 정책을 따르지만 평면도 그림이
시행사 홈페이지 캡처인 단지가 있다(맹그로브창천 실측). 산출물은 커밋하지 않는다(CLAUDE.md 커밋 규칙).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from dataclasses import asdict
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT / "src"))

from zipgonggo_pipeline.sources.youth_house import (  # noqa: E402
    KIND_ORDER,
    YouthHouse,
    YouthHouseClient,
    house_from_row,
    parse_facts,
    parse_images,
)

OUT_ROOT = PIPELINE_ROOT / "data" / "youth-house"
IMG_ROOT = OUT_ROOT / "img"
# PoC 동안 웹이 읽는 자리. 발행 때 스토리지로 옮긴다(0026 주석 참조)
PUBLIC_ROOT = PIPELINE_ROOT.parent / "web" / "public" / "youth-house"

PAREN_RE = re.compile(r"\([^)]*\)")
STRIP_RE = re.compile(r"[\s\-_\[\]·,]")
# 포털은 이름 앞에 역세권을 붙인다(`홍대입구역 맹그로브창천`). 우리 단지명은 `맹그로브창천`이다.
STATION_RE = re.compile(r"^[가-힣A-Za-z0-9]{2,10}역\s*")
# 둘 다 흔히 붙였다 뗐다 하는 꼬리. 대조 키에서만 턴다
TAIL_WORDS = ("청년안심주택", "청년주택", "역세권청년주택", "아파트", "오피스텔")
UNSAFE_RE = re.compile(r'[\\/:*?"<>|]')
# `Content-Disposition: attachment; filename="평면도_26.png"`
FILENAME_RE = re.compile(r'filename\s*=\s*"?([^";]+)"?', re.I)


def _name_key(name: str) -> str:
    """단지명 대조 키. 역세권 접두사와 「청년안심주택」 꼬리를 털고 공백·기호를 지운다."""
    key = PAREN_RE.sub("", name or "")
    key = STATION_RE.sub("", key)
    key = STRIP_RE.sub("", key).upper()
    for tail in TAIL_WORDS:
        key = key.replace(STRIP_RE.sub("", tail).upper(), "")
    return key


def _addr_key(addr: str) -> str:
    return STRIP_RE.sub("", PAREN_RE.sub("", addr or "")).upper()


def _safe(name: str) -> str:
    return UNSAFE_RE.sub("_", name).strip() or "unnamed"


def _image_kind(body: bytes) -> str | None:
    """머리 바이트로 그림인지 가른다. 아니면 None — HTML 오류 쪽을 사진으로 저장하지 않는다."""
    if body.startswith(b"\x89PNG\r\n"):
        return "png"
    if body.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if body.startswith(b"GIF8"):
        return "gif"
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "webp"
    return None


# 저장 파일명이 캡션 노릇을 하는지 가른다. `커뮤니티라운지`는 말이 되고 `20210203094226450H`는 안 된다
MEANINGLESS_NAME_RE = re.compile(r"^[0-9A-Fa-f_\-]+$")


def _label_from_file(kind: str, path: Path) -> str | None:
    """편의시설 사진의 캡션. 포털이 HTML에서는 캡션을 짝지어 주지 않지만 **파일명이 캡션이다**
    (`커뮤니티라운지.png`·`무인세탁실.png`). 탭 이름이 이미 종류를 말하는 평면도·전경·투시도에는 안 붙인다.
    """
    if kind != "편의시설":
        return None
    stem = path.stem.strip()
    if not stem or MEANINGLESS_NAME_RE.match(stem):
        return None
    return stem.replace("_", " ").strip() or None


def _load_houses() -> list[YouthHouse]:
    path = OUT_ROOT / "houses.json"
    if not path.is_file():
        raise SystemExit(f"단지 목록이 없다. 먼저 houses를 돌려라: {path}")
    return [house_from_row(r["raw"]) for r in json.loads(path.read_text(encoding="utf-8"))]


def cmd_houses(client: YouthHouseClient) -> Path:
    houses = client.houses()
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    path = OUT_ROOT / "houses.json"
    path.write_text(json.dumps([asdict(h) for h in houses], ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"단지 {len(houses)}곳 → {path}", file=sys.stderr)
    return path


def _match_one(name: str, address: str | None, houses: list[YouthHouse]) -> tuple[YouthHouse | None, str]:
    """단지 하나를 포털 목록에 댄다. (단지, 붙인 근거). 못 붙이면 (None, '')."""
    key = _name_key(name)
    if key:
        for h in houses:
            if _name_key(h.name) == key:
                return h, "이름"
        # 포털이 더 길게 적는다(`퀸즈W청량리역` ⊃ `퀸즈W`). 너무 짧은 키는 아무 데나 붙으니 막는다
        if len(key) >= 4:
            hits = [h for h in houses if key in _name_key(h.name) or _name_key(h.name) in key]
            if len(hits) == 1:
                return hits[0], "이름(부분)"
    if address:
        akey = _addr_key(address)
        if len(akey) >= 8:
            hits = [h for h in houses if akey and (akey in _addr_key(h.address) or _addr_key(h.address) in akey)]
            if len(hits) == 1:
                return hits[0], "주소"
    return None, ""


def cmd_match(write: bool) -> Path:
    """DB의 민간임대 단지 행에 homeCode를 붙인다. --write 없이는 결과만 적는다."""
    from zipgonggo_pipeline.db import connect

    houses = _load_houses()
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT nc.id, nc.name, nc.road_address, nc.youth_home_code
                 FROM notice_complex nc JOIN notice n ON n.id = nc.notice_id
                WHERE n.source = 'youth_scrape'
                ORDER BY nc.id"""
        )
        rows = cur.fetchall()

        out = []
        linked = 0
        for r in rows:
            house, how = _match_one(r["name"], r["road_address"], houses)
            out.append({
                "notice_complex_id": r["id"], "단지명": r["name"], "주소": r["road_address"],
                "homeCode": house.home_code if house else None,
                "포털단지명": house.name if house else None, "근거": how,
            })
            if write and house and r["youth_home_code"] != house.home_code:
                cur.execute("UPDATE notice_complex SET youth_home_code = %s WHERE id = %s", (house.home_code, r["id"]))
                linked += cur.rowcount
        if write:
            conn.commit()

    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    path = OUT_ROOT / "match.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    hit = sum(1 for r in out if r["homeCode"])
    codes = {r["homeCode"] for r in out if r["homeCode"]}
    print(f"단지 행 {len(out)} · 붙음 {hit} · 못 붙임 {len(out) - hit} · 고유 단지 {len(codes)}"
          + (f" · DB 갱신 {linked}행" if write else " (DB 안 건드림 — --write)"), file=sys.stderr)
    return path


def _fetch_image(client: YouthHouseClient, url: str, dest_dir: Path, fallback: str) -> tuple[Path, int] | None:
    """한 장 내려받는다. 파일명은 서버가 준 것을 쓰고, 없으면 fallback.

    Content-Type을 믿지 않는다 — 포털이 같은 PNG를 어떤 건 `image/png`로, 어떤 건 `application/octet-stream`으로
    준다(편의시설 사진 다수 실측 2026-09-15). 머리 바이트로 가른다.
    """
    resp = client._http.get(url, label=f"youth img {fallback}")  # noqa: SLF001 — 이미지에는 별도 래퍼를 두지 않는다
    kind = _image_kind(resp.content)
    if not kind:
        return None
    m = FILENAME_RE.search(resp.headers.get("Content-Disposition", ""))
    name = _safe(m.group(1)) if m else f"{fallback}.{kind}"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / name
    # 같은 이름이 겹치면(단지마다 `평면도_26.png`) 앞에 순번을 단다
    if dest.exists() and dest.stat().st_size != len(resp.content):
        dest = dest_dir / f"{fallback}_{name}"
    dest.write_bytes(resp.content)
    return dest, len(resp.content)


def cmd_fetch(client: YouthHouseClient, only: str, refresh: bool) -> int:
    """match된 단지의 상세를 열어 그림을 내려받고 manifest.json에 적는다."""
    match = json.loads((OUT_ROOT / "match.json").read_text(encoding="utf-8"))
    codes: dict[str, str] = {}
    for r in match:
        if r["homeCode"] and (not only or only in (r["단지명"] or "") or only in (r["포털단지명"] or "")):
            codes[r["homeCode"]] = r["포털단지명"] or r["단지명"]

    manifest = []
    got = 0
    for code, name in codes.items():
        dest_dir = IMG_ROOT / code
        html = client.detail_html(code)
        facts = parse_facts(html)
        images = parse_images(html)
        rows = []
        # 같은 파일을 두 자리에서 내주는 단지가 있다 — 맹그로브창천은 fileSn 1(상세소개)과 2(투시도)가
        # 바이트까지 같은 한 파일이다. 그대로 실으면 갤러리에 같은 그림이 「전경」과 「투시도」로 두 번 뜬다
        taken: set[tuple[str, int]] = set()
        for sort_no, im in enumerate(images):
            saved = None
            existing = json.loads((dest_dir / "_files.json").read_text(encoding="utf-8")) if (dest_dir / "_files.json").is_file() else {}
            if not refresh and im.path in existing and (dest_dir / existing[im.path]["file"]).is_file():
                saved = (dest_dir / existing[im.path]["file"], existing[im.path]["bytes"])
            if saved is None:
                saved = _fetch_image(client, im.url, dest_dir, f"{im.kind}{sort_no}")
                if saved:
                    got += 1
            if not saved:
                print(f"  ! 이미지가 아니다: {code} {im.kind} {im.path}", file=sys.stderr)
                continue
            key = (saved[0].name, saved[1])
            if key in taken:
                continue
            taken.add(key)
            rows.append({"kind": im.kind, "sply_ty": im.sply_ty, "label": im.label or _label_from_file(im.kind, saved[0]),
                         "url": im.url, "file": saved[0].name, "bytes": saved[1], "sort_no": sort_no})
        if rows:
            (dest_dir / "_files.json").write_text(
                json.dumps({r["url"].split(".go.kr")[-1]: {"file": r["file"], "bytes": r["bytes"]} for r in rows},
                           ensure_ascii=False, indent=1), encoding="utf-8")
        manifest.append({"homeCode": code, "단지명": name, "사실": asdict(facts), "이미지": rows})
        kinds = ", ".join(f"{k} {sum(1 for r in rows if r['kind'] == k)}" for k in KIND_ORDER
                          if any(r["kind"] == k for r in rows))
        print(f"  {code} {name}: {len(rows)}장 ({kinds or '없음'})", file=sys.stderr)

    (OUT_ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(m["이미지"]) for m in manifest)
    print(f"단지 {len(manifest)}곳 · 그림 {total}장(새로 받은 것 {got}) → {OUT_ROOT / 'manifest.json'}", file=sys.stderr)
    return total


DATE_RE = re.compile(r"(\d{4})[-.](\d{1,2})[-.](\d{1,2})")


def _date(v: str | None) -> str | None:
    """`2026-11-16`·`2026.11.16` → ISO. 「2026년 상반기」처럼 날짜가 아닌 안내문은 버린다."""
    m = DATE_RE.search(v or "")
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def cmd_load() -> int:
    """받아 둔 이미지를 DB(0026)에, 단지 사실을 DB(0027)에 넣고 웹이 읽을 자리로 파일을 복사한다.

    사실은 목록(관리비·운영사·세대수·주소)과 상세(시행사·시공사·입주예정일·연락처)를 합쳐 만든다 —
    `houses.json`과 `manifest.json`이 둘 다 있어야 하니 `houses` → `match` → `fetch` → `load` 순서를 지킨다.
    """
    from zipgonggo_pipeline.db import connect

    manifest = json.loads((OUT_ROOT / "manifest.json").read_text(encoding="utf-8"))
    by_house = {h.home_code: h for h in _load_houses()}
    copied = 0
    rows: list[tuple] = []
    for m in manifest:
        for row in m["이미지"]:
            src = IMG_ROOT / m["homeCode"] / row["file"]
            if not src.exists():
                continue
            dest = PUBLIC_ROOT / m["homeCode"] / src.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists() or dest.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dest)
                copied += 1
            rows.append((m["homeCode"], row["kind"], row["sply_ty"] or "", row["label"],
                         row["url"], src.name, row["bytes"], row["sort_no"]))

    by_code: dict[str, list[str]] = {}
    for row in rows:
        by_code.setdefault(row[0], []).append(row[4])

    with connect() as conn, conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """INSERT INTO youth_house_image
                     (home_code, kind, sply_ty, label, source_url, file_name, bytes, sort_no)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (home_code, source_url) DO UPDATE
                     SET kind = EXCLUDED.kind, sply_ty = EXCLUDED.sply_ty, label = EXCLUDED.label,
                         file_name = EXCLUDED.file_name, bytes = EXCLUDED.bytes, sort_no = EXCLUDED.sort_no""",
                row,
            )
        # 이번에 안 실은 행은 지운다 — 포털이 파일을 갈거나(옛 URL) 우리가 거르기로 한 것(같은 그림 두 번)이
        # 남아 있으면 지면에 유령 사진이 뜬다. 이 단지를 다시 실을 때만 지운다
        pruned = 0
        for code, urls in by_code.items():
            cur.execute("DELETE FROM youth_house_image WHERE home_code = %s AND source_url <> ALL(%s)", (code, urls))
            pruned += cur.rowcount
        # 단지 사실(0027) — 관리비가 여기 있다. 이미지가 0장인 단지도 사실은 실을 값이 있다
        facts_n = 0
        for m in manifest:
            h = by_house.get(m["homeCode"])
            if not h:
                continue
            f = m.get("사실") or {}
            cur.execute(
                """INSERT INTO youth_house
                     (home_code, name, address, sigungu, maint_low, maint_high, households, manager,
                      developer, builder, movein, phone, homepage, subway, scale, source_url, collected_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                   ON CONFLICT (home_code) DO UPDATE SET
                     name = EXCLUDED.name, address = EXCLUDED.address, sigungu = EXCLUDED.sigungu,
                     maint_low = EXCLUDED.maint_low, maint_high = EXCLUDED.maint_high,
                     households = EXCLUDED.households, manager = EXCLUDED.manager,
                     developer = EXCLUDED.developer, builder = EXCLUDED.builder, movein = EXCLUDED.movein,
                     phone = EXCLUDED.phone, homepage = EXCLUDED.homepage, subway = EXCLUDED.subway,
                     scale = EXCLUDED.scale, source_url = EXCLUDED.source_url, collected_at = now()""",
                (h.home_code, h.name, h.address or None, h.gu or None,
                 # 관리비는 상세 표가 먼저다 — 목록 JSON은 단지 절반만 준다(90곳 중 47곳)
                 f.get("maint_low") or h.maint_low, f.get("maint_high") or h.maint_high,
                 int(h.households) if h.households.isdigit() else None,
                 h.manager or None, f.get("developer"), f.get("builder"), _date(f.get("movein")),
                 f.get("phone"), f.get("homepage"), f.get("subway"), f.get("scale"), h.source_url),
            )
            facts_n += 1
        conn.commit()
    print(f"이미지 {len(rows)}행 적재(묵은 행 {pruned} 삭제), 단지 사실 {facts_n}행, 파일 {copied}장 복사 → {PUBLIC_ROOT}",
          file=sys.stderr)
    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delay", type=float, default=1.0, help="요청 간격 초(기본 1.0)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("houses", help="포털 단지 목록을 받는다")
    p_match = sub.add_parser("match", help="공고 단지에 homeCode를 붙인다")
    p_match.add_argument("--write", action="store_true", help="DB에도 반영한다")
    p_fetch = sub.add_parser("fetch", help="상세를 열어 이미지를 내려받는다")
    p_fetch.add_argument("--only", default="", help="단지명에 이 말이 든 것만")
    p_fetch.add_argument("--refresh", action="store_true", help="받아 둔 파일도 다시 받는다")
    sub.add_parser("load", help="받아 둔 이미지를 DB에 넣고 웹 자리로 복사한다")
    args = ap.parse_args()

    if args.cmd == "match":
        cmd_match(args.write)
        return
    if args.cmd == "load":
        cmd_load()
        return
    client = YouthHouseClient(delay_sec=args.delay)
    if args.cmd == "houses":
        cmd_houses(client)
    elif args.cmd == "fetch":
        cmd_fetch(client, args.only, args.refresh)


if __name__ == "__main__":
    main()
