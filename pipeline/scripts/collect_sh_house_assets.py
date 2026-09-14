"""SH 공고 단지 → SH주택정보 이미지(평면도·전경·배치도·실내) 붙이기. PoC.

왜 이 길인가: 공고문 PDF 안에는 도면이 없다(제51차 64쪽 전수 확인, 도면 0장). 공고문은 12·19·49·56쪽에서
「전자팸플릿·SH주택정보 참조」로 넘기고, 그 참조처의 API가 단지·주택형 단위 이미지를 그대로 준다.
경로·코드 실측은 `sources/sh_houseinfo.py` 머리글에 있다.

    cd pipeline
    python scripts/collect_sh_house_assets.py houses                # 서울 전 단지 목록 → data/sh-house/houses.json
    python scripts/collect_sh_house_assets.py match 309467          # 공고 단지 ↔ biznsCd → data/sh-house/{seq}/match.json
    python scripts/collect_sh_house_assets.py assets 309467         # 단지별 보유 이미지 조사 → …/manifest.json
    python scripts/collect_sh_house_assets.py fetch 309467 --only "천왕이펜하우스 3단지"  # 내려받기 → …/img/
    python scripts/collect_sh_house_assets.py load 309467           # DB 적재 + web/public/sh-house 복사

`match`는 공고문 「주택 위치 안내」 표(sh_complex 파서)를 쓴다. 그 쪽 XML이 `data/ish/{seq}/`에 캐시돼
있어야 한다 — 없으면 S3 수집을 먼저 돌린다.

**공개 발행 전에 SH 이용 허락을 받는다.** `/houseinfo/robots.txt`가 자기 경로를 막고 있다(sources 머리글 참조).
산출물은 커밋하지 않는다(CLAUDE.md 커밋 규칙 — `pipeline/data/`).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import asdict
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT / "src"))

from zipgonggo_pipeline.parsers.sh_complex import parse_location_table  # noqa: E402
from zipgonggo_pipeline.sources.sh_houseinfo import SEOUL_SIG, HouseInfoClient, Image  # noqa: E402

OUT_ROOT = PIPELINE_ROOT / "data" / "sh-house"
ISH_CACHE = PIPELINE_ROOT / "data" / "ish"
# PoC 동안 웹이 읽는 자리. 발행 때 스토리지로 옮긴다(0023 주석 참조)
PUBLIC_ROOT = PIPELINE_ROOT.parent / "web" / "public" / "sh-house"
# 지면에 쓸 이미지. 정문·주차장·편의시설은 단지 페이지를 두껍게 하지 못한다.
DEFAULT_KINDS = ("평면도", "전경", "배치도", "실내")
# 조사 단계에서 부를 imgTy. 나머지 코드는 sources.sh_houseinfo.IMG_TYPES 참조
PROBE_IMG_TYPES = ("01", "03", "07")

PAREN_RE = re.compile(r"\([^)]*\)")
STRIP_RE = re.compile(r"[\s\-\[\]·]")
SIDO_RE = re.compile(r"^서울특별시\s*")
UNSAFE_RE = re.compile(r'[\\/:*?"<>|]')
# 실내 사진 이름 앞머리의 주택형: `84A 안방`·`59A1 작은방2번`·`49B 거실욕실`. 뒤에 공백이 있어야 한다 —
# 없으면 `1층 현관` 같은 이름의 「1」을 주택형으로 읽는다
SPLY_LABEL_RE = re.compile(r"^(\d{2,3}[A-Za-z]?\d?)\s")


def _name_key(name: str) -> str:
    """단지명 대조 키. SH주택정보는 이름 뒤에 지구 주석을 단다(`상림마을6-1단지(은평1-8,임대)`)."""
    return STRIP_RE.sub("", PAREN_RE.sub("", name or ""))


def _addr_key(addr: str) -> str:
    return re.sub(r"\s", "", SIDO_RE.sub("", addr or ""))


def cmd_houses(client: HouseInfoClient) -> Path:
    """서울 25개 구 아파트 단지 전수."""
    rows: dict[str, dict] = {}
    for sig in SEOUL_SIG:
        for h in client.houses(sig):
            rows[h.bizns_cd] = asdict(h)
        print(f"  {sig}: 누적 {len(rows)}단지", file=sys.stderr)
    out = OUT_ROOT / "houses.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(rows)}단지 → {out}", file=sys.stderr)
    return out


def _notice_pages(seq: str) -> list[tuple[int, str]]:
    """`data/ish/{seq}/` 캐시의 쪽 XML을 쪽 번호 순으로. 첨부가 여럿이면 쪽수가 가장 많은 것을 쓴다."""
    cache = ISH_CACHE / seq
    if not cache.is_dir():
        raise SystemExit(f"공고 XML 캐시가 없다: {cache} — S3 수집을 먼저 돌린다")
    by_doc: dict[str, list[tuple[int, Path]]] = {}
    for p in cache.glob("*.xml"):
        stem, _, page = p.stem.rpartition("_")
        if page.isdigit():
            by_doc.setdefault(stem, []).append((int(page), p))
    if not by_doc:
        raise SystemExit(f"쪽 XML이 없다: {cache}")
    pages = max(by_doc.values(), key=len)
    return [(n, p.read_text(encoding="utf-8")) for n, p in sorted(pages)]


def cmd_match(seq: str) -> Path:
    """공고 단지 ↔ SH주택정보 biznsCd. 이름 → 주소 순으로 대조한다."""
    houses = json.loads((OUT_ROOT / "houses.json").read_text(encoding="utf-8"))
    by_name: dict[str, str] = {}
    by_addr: dict[str, str] = {}
    for cd, h in houses.items():
        by_name.setdefault(_name_key(h["name"]), cd)
        by_addr.setdefault(_addr_key(h["address"]), cd)

    rows = []
    for c in parse_location_table(_notice_pages(seq)):
        cd = by_name.get(_name_key(c.name))
        how = "이름"
        if not cd:
            cd = by_addr.get(_addr_key(c.road_address))
            how = "주소"
        rows.append({
            "단지명": c.name, "주소": c.road_address, "자치구": c.sigungu,
            "신규": c.is_new, "biznsCd": cd, "대조": how if cd else "실패",
        })

    out = OUT_ROOT / seq / "match.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    hit = [r for r in rows if r["biznsCd"]]
    miss_new = sum(1 for r in rows if not r["biznsCd"] and r["신규"])
    print(f"{len(hit)}/{len(rows)}단지 대조 (실패 {len(rows) - len(hit)}건 중 신규공급 {miss_new}건) → {out}", file=sys.stderr)
    return out


def cmd_assets(seq: str, client: HouseInfoClient) -> Path:
    """대조된 단지마다 어떤 이미지를 갖고 있는지 조사. 내려받지는 않는다."""
    rows = json.loads((OUT_ROOT / seq / "match.json").read_text(encoding="utf-8"))
    targets = [r for r in rows if r["biznsCd"]]
    manifest = []
    for i, r in enumerate(targets, 1):
        cd = r["biznsCd"]
        images: list[Image] = []
        for ty in PROBE_IMG_TYPES:
            images.extend(client.images(cd, ty))
        for sply in client.supply_types(cd):
            images.extend(client.plans(cd, sply))
        manifest.append({"단지명": r["단지명"], "biznsCd": cd, "이미지": [asdict(im) for im in images]})
        kinds = Counter(im.kind for im in images)
        summary = ", ".join(f"{k} {n}" for k, n in kinds.items()) or "없음"
        print(f"  {i}/{len(targets)} {r['단지명']}: {summary}", file=sys.stderr)

    out = OUT_ROOT / seq / "manifest.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    _report(manifest)
    print(f"→ {out}", file=sys.stderr)
    return out


def _report(manifest: list[dict]) -> None:
    n = len(manifest) or 1
    print(f"\n== 단지 {len(manifest)}곳 이미지 보유 ==")
    for kind in DEFAULT_KINDS:
        have = sum(1 for m in manifest if any(im["kind"] == kind for im in m["이미지"]))
        total = sum(1 for m in manifest for im in m["이미지"] if im["kind"] == kind)
        print(f"  {kind:4} 보유 {have:3}단지 ({have * 100 // n:3}%), {total:4}장")


def _leaf(row: dict) -> str:
    """저장 파일명. 종류·주택형을 앞세워 탐색기에서 바로 갈린다."""
    name = "_".join(x for x in (row["kind"], row["sply_ty"], row["orig_name"] or Path(row["url"]).name) if x)
    return UNSAFE_RE.sub("_", name)


def _saved_path(seq: str, complex_name: str, row: dict) -> Path:
    return OUT_ROOT / seq / "img" / UNSAFE_RE.sub("_", complex_name) / _leaf(row)


def _sply_from_label(label: str | None) -> str:
    """실내 사진의 주택형을 이름에서 꺼낸다.

    평면도는 API가 주택형을 따로 주는데 실내 사진은 안 준다 — 대신 이름 앞에 붙여 온다
    (`84A 안방`, `59A1 작은방2번`, `49B 거실욕실`). 이걸 못 꺼내면 지면이 한 단지의 모든 주택형
    사진을 한꺼번에 쏟는다(천왕이펜하우스 3단지: 공급은 84형 하나인데 실내 36장 중 28장이 딴 형).
    """
    m = SPLY_LABEL_RE.match((label or "").strip())
    return m.group(1) if m else ""


def cmd_fetch(seq: str, kinds: tuple[str, ...], client: HouseInfoClient, only: str = "") -> int:
    """manifest의 이미지를 `img/{단지명}/{종류}_{주택형}_{원본명}`으로 내려받는다.

    `only`는 단지명 부분 문자열. 한 공고 전량은 900장이 넘어 눈으로 볼 때는 한 단지씩 끊는 쪽이 낫다.
    """
    manifest = json.loads((OUT_ROOT / seq / "manifest.json").read_text(encoding="utf-8"))
    saved = 0
    for m in manifest:
        if only and only not in m["단지명"]:
            continue
        for row in m["이미지"]:
            if row["kind"] not in kinds:
                continue
            path = _saved_path(seq, m["단지명"], row)
            if path.exists():
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(client.download(Image(**row)))
            saved += 1
    print(f"{saved}장 → {OUT_ROOT / seq / 'img'}", file=sys.stderr)
    return saved


def cmd_load(seq: str) -> int:
    """받아 둔 이미지를 DB(0023)에 넣고 웹이 읽을 자리로 복사한다.

    이미지는 단지(biznsCd)에 붙는다 — 같은 단지가 여러 공고에 되풀이 나온다. 그래서 `sh_house_image`는
    공고를 모르고, `notice_complex.sh_bizns_cd`가 다리를 놓는다.
    파일은 지금 로컬 PoC라 `web/public/sh-house/{biznsCd}/`에 복사한다. 발행할 때 스토리지로 옮긴다.
    """
    import shutil

    from zipgonggo_pipeline.db import connect

    match = json.loads((OUT_ROOT / seq / "match.json").read_text(encoding="utf-8"))
    manifest = json.loads((OUT_ROOT / seq / "manifest.json").read_text(encoding="utf-8"))
    by_code = {m["biznsCd"]: m for m in manifest}

    copied = 0
    rows: list[tuple] = []
    for m in manifest:
        for sort_no, row in enumerate(m["이미지"]):
            src = _saved_path(seq, m["단지명"], row)
            if not src.exists():
                continue  # 아직 안 받은 종류. fetch가 받은 것만 싣는다
            dest = PUBLIC_ROOT / m["biznsCd"] / src.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists() or dest.stat().st_size != src.stat().st_size:
                shutil.copy2(src, dest)
                copied += 1
            rows.append((m["biznsCd"], row["kind"], row["sply_ty"] or _sply_from_label(row["name"]),
                         row["name"] or None, row["url"], src.name, row["bytes"], sort_no))

    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM notice WHERE source_key = %s", (f"ish:{seq}",))
        found = cur.fetchone()
        if not found:
            raise SystemExit(f"공고가 DB에 없다: ish:{seq}")
        notice_id = found["id"]

        # 단지명이 공고 안에서 유일하다는 보장이 없어 이름으로 한 번에 UPDATE하지 않고 행마다 건다
        linked = 0
        for r in match:
            if not r["biznsCd"]:
                continue
            cur.execute(
                "UPDATE notice_complex SET sh_bizns_cd = %s WHERE notice_id = %s AND name = %s",
                (r["biznsCd"], notice_id, r["단지명"]),
            )
            linked += cur.rowcount

        for row in rows:
            cur.execute(
                """INSERT INTO sh_house_image
                     (bizns_cd, kind, sply_ty, label, source_url, file_name, bytes, sort_no)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (bizns_cd, source_url) DO UPDATE
                     SET kind = EXCLUDED.kind, sply_ty = EXCLUDED.sply_ty, label = EXCLUDED.label,
                         file_name = EXCLUDED.file_name, bytes = EXCLUDED.bytes, sort_no = EXCLUDED.sort_no""",
                row,
            )
        conn.commit()

    have = sum(1 for c in by_code if (PUBLIC_ROOT / c).is_dir())
    print(f"단지 연결 {linked}행, 이미지 {len(rows)}행 적재, 파일 {copied}장 복사({have}개 단지) → {PUBLIC_ROOT}", file=sys.stderr)
    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delay", type=float, default=1.0, help="요청 간격(초). 기본 1초")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("houses", help="서울 전 단지 목록을 받는다")
    sub.add_parser("match", help="공고 단지에 biznsCd를 붙인다").add_argument("seq")
    sub.add_parser("assets", help="단지별 보유 이미지를 조사한다").add_argument("seq")
    p_fetch = sub.add_parser("fetch", help="이미지를 내려받는다")
    p_fetch.add_argument("seq")
    p_fetch.add_argument("--kinds", default=",".join(DEFAULT_KINDS), help=f"쉼표 구분. 기본 {','.join(DEFAULT_KINDS)}")
    p_fetch.add_argument("--only", default="", help="단지명 부분 문자열. 한 단지만 받을 때")
    sub.add_parser("load", help="받아 둔 이미지를 DB에 넣고 웹 자리로 복사한다").add_argument("seq")

    args = ap.parse_args()
    if args.cmd == "match":
        cmd_match(args.seq)
        return
    if args.cmd == "load":
        cmd_load(args.seq)
        return

    client = HouseInfoClient(delay_sec=args.delay)
    if args.cmd == "houses":
        cmd_houses(client)
    elif args.cmd == "assets":
        cmd_assets(args.seq, client)
    else:
        cmd_fetch(args.seq, tuple(k.strip() for k in args.kinds.split(",") if k.strip()), client, args.only)
    print(f"(호출 {client.call_count}회)", file=sys.stderr)


if __name__ == "__main__":
    main()
