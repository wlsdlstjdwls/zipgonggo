"""SH 공고 단지 → SH주택정보 이미지(평면도·전경·배치도·실내) 붙이기. PoC.

왜 이 길인가: 공고문 PDF 안에는 도면이 없다(제51차 64쪽 전수 확인, 도면 0장). 공고문은 12·19·49·56쪽에서
「전자팸플릿·SH주택정보 참조」로 넘기고, 그 참조처의 API가 단지·주택형 단위 이미지를 그대로 준다.
경로·코드 실측은 `sources/sh_houseinfo.py` 머리글에 있다.

    cd pipeline
    python scripts/collect_sh_house_assets.py houses                # 서울 전 단지 목록 → data/sh-house/houses.json
    python scripts/collect_sh_house_assets.py houses --rent-ty 20,30  # 매입 다가구·원룸까지 (실측 2026-09-21: 3,331단지)
    python scripts/collect_sh_house_assets.py match 309467          # 공고 단지 ↔ biznsCd → data/sh-house/{seq}/match.json
    python scripts/collect_sh_house_assets.py assets 309467         # 단지별 보유 이미지 조사 → …/manifest.json
    python scripts/collect_sh_house_assets.py fetch 309467 --only "천왕이펜하우스 3단지"  # 내려받기 → …/img/
    python scripts/collect_sh_house_assets.py load 309467           # DB 적재 + web/public/sh-house 복사
    python scripts/collect_sh_house_assets.py link-all              # 다른 공고의 같은 단지에도 biznsCd 연결

`match`는 DB의 `notice_complex` 행(공고 수집이 넣은 것)을 대조한다 — 공고문을 다시 읽지 않는다.

**매입임대는 이름으로 못 붙인다.** SH 쪽 이름이 「다가구매입임대(강동구)」로 구마다 하나라서다.
주소(도로명+건물번호)로만 붙인다 — 강동구 실측 26/26(2026-09-21). 가진 그림도 아파트와 다르다:
전경 2~3장과 **imgTy 08**이다. 08은 API가 「기타」라 부르지만 이름이 「1층」·「2~3층」·「101동 2~4층」인
**층별 건축도면**이다. 아파트에는 평면도가 따로 있으니 08을 안 봤고, 매입에는 그게 유일한 도면이다.

**공개 발행 전에 SH 이용 허락을 받는다.** `/houseinfo/robots.txt`가 자기 경로를 막고 있다(sources 머리글 참조).
산출물은 커밋하지 않는다(CLAUDE.md 커밋 규칙 — `pipeline/data/`).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, replace
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT / "src"))

from zipgonggo_pipeline.sources.sh_houseinfo import SEOUL_SIG, HouseInfoClient, Image  # noqa: E402

OUT_ROOT = PIPELINE_ROOT / "data" / "sh-house"
ISH_CACHE = PIPELINE_ROOT / "data" / "ish"
# PoC 동안 웹이 읽는 자리. 발행 때 스토리지로 옮긴다(0023 주석 참조)
PUBLIC_ROOT = PIPELINE_ROOT.parent / "web" / "public" / "sh-house"
# 지면에 쓸 이미지. 정문·주차장·편의시설은 단지 페이지를 두껍게 하지 못한다.
DEFAULT_KINDS = ("평면도", "층별 도면", "전경", "배치도", "실내")
# 조사 단계에서 부를 imgTy. 나머지 코드는 sources.sh_houseinfo.IMG_TYPES 참조
PROBE_IMG_TYPES = ("01", "03", "07")
# 매입(다가구·원룸)은 03·07이 비고 08에 층별 도면이 있다. 주택형 목록도 빈 배열이라 평면도 질의를 걸 것이 없다
MAEIP_IMG_TYPES = ("01", "08")
# 「기타」로 실려 오는 08을 지면에서 부를 이름. 아파트의 08(진짜 기타)에는 이 이름을 붙이지 않는다
MAEIP_PLAN_KIND = "층별 도면"
APARTMENT_TY = "10"
RENT_TY_NAMES = {"10": "아파트", "20": "매입다가구", "30": "매입원룸"}

PAREN_RE = re.compile(r"\([^)]*\)")
# 밑줄도 지운다 — SH는 `공덕SK리더스뷰_2단지`, 공고문은 `공덕SK리더스뷰2단지`
STRIP_RE = re.compile(r"[\s\-_\[\]·]")
# 같은 뜻을 다르게 적는 것들. 왼쪽을 오른쪽으로 접는다(대조 키에서만)
NAME_ALIASES = (("VIEW", "뷰"), ("이편한세상", "e편한세상"), ("아파트", ""))
SIDO_RE = re.compile(r"^서울특별시\s*")
UNSAFE_RE = re.compile(r'[\\/:*?"<>|]')
# 실내 사진 이름 앞머리의 주택형: `84A 안방`·`59A1 작은방2번`·`49B 거실욕실`. 뒤에 공백이 있어야 한다 —
# 없으면 `1층 현관` 같은 이름의 「1」을 주택형으로 읽는다
SPLY_LABEL_RE = re.compile(r"^(\d{2,3}[A-Za-z]?\d?)\s")


def _name_key(name: str) -> str:
    """단지명 대조 키. SH주택정보는 이름 뒤에 지구 주석을 단다(`상림마을6-1단지(은평1-8,임대)`)."""
    key = STRIP_RE.sub("", PAREN_RE.sub("", name or "")).upper()
    for src, dst in NAME_ALIASES:
        key = key.replace(src.upper(), dst.upper())
    return key


def _addr_key(addr: str) -> str:
    """주소 대조 키. 공고문은 뒤에 `(공덕동 공덕 SK 리더스뷰)` 같은 주석을 달고, SH는 `1단지(101동…)`를 단다 —
    괄호를 통째로 지운다. 번지 뒤 `-`는 남긴다(115-8과 1158은 다른 집)."""
    return re.sub(r"\s", "", PAREN_RE.sub("", SIDO_RE.sub("", addr or "")))


def cmd_houses(client: HouseInfoClient, rent_tys: tuple[str, ...]) -> Path:
    """서울 25개 구 단지 전수. 받은 유형만 새로 긁고 나머지는 이미 받아 둔 것을 그대로 둔다.

    아파트(10)와 매입(20·30)은 한 파일에 같이 산다 — `rent_ty` 칸으로 갈린다. 이름 인덱스는
    아파트만 쓴다(`_house_index`): 매입 이름은 구마다 하나라 이름으로는 아무 집도 못 가린다.
    """
    out = OUT_ROOT / "houses.json"
    rows: dict[str, dict] = {}
    if out.exists():
        rows = json.loads(out.read_text(encoding="utf-8"))
        for cd, h in rows.items():
            h.setdefault("rent_ty", APARTMENT_TY)  # 매입을 알기 전에 받아 둔 것은 전부 아파트다
    for rent_ty in rent_tys:
        before = len(rows)
        for sig in SEOUL_SIG:
            for h in client.houses(sig, rent_ty=rent_ty):
                rows[h.bizns_cd] = {**asdict(h), "rent_ty": rent_ty}
            print(f"  {RENT_TY_NAMES.get(rent_ty, rent_ty)} {sig}: 누적 {len(rows)}단지", file=sys.stderr)
        print(f"== {RENT_TY_NAMES.get(rent_ty, rent_ty)}: {len(rows) - before}단지 늘었다", file=sys.stderr)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    kinds = Counter(h.get("rent_ty", APARTMENT_TY) for h in rows.values())
    print(f"{len(rows)}단지 ({', '.join(f'{RENT_TY_NAMES.get(k, k)} {n}' for k, n in sorted(kinds.items()))}) → {out}", file=sys.stderr)
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


def _house_index() -> tuple[dict[str, str], dict[str, str]]:
    houses = json.loads((OUT_ROOT / "houses.json").read_text(encoding="utf-8"))
    by_name: dict[str, str] = {}
    by_addr: dict[str, str] = {}
    for cd, h in houses.items():
        # 매입 단지 이름은 「다가구매입임대(강동구)」 하나뿐이라 이름 인덱스에 넣으면 구 전체가 한 코드로 붙는다
        if h.get("rent_ty", APARTMENT_TY) == APARTMENT_TY:
            by_name.setdefault(_name_key(h["name"]), cd)
        by_addr.setdefault(_addr_key(h["address"]), cd)
    return by_name, by_addr


def _rent_ty_index() -> dict[str, str]:
    """biznsCd → rentTy. assets가 어느 imgTy를 물어볼지 이걸로 가른다."""
    houses = json.loads((OUT_ROOT / "houses.json").read_text(encoding="utf-8"))
    return {cd: h.get("rent_ty", APARTMENT_TY) for cd, h in houses.items()}


def _lookup(by_name: dict[str, str], by_addr: dict[str, str], name: str, addr: str) -> tuple[str | None, str]:
    """이름 → 주소 순. (biznsCd, 대조 방법)"""
    cd = by_name.get(_name_key(name))
    if cd:
        return cd, "이름"
    cd = by_addr.get(_addr_key(addr))
    return cd, ("주소" if cd else "실패")


def _db_complexes(seq: str) -> list[dict]:
    """DB의 공고 단지 행. load가 이 이름으로 UPDATE하므로 대조도 같은 이름을 써야 한다.

    예전엔 `parse_location_table`로 공고문을 다시 읽었는데, 행복주택 공고(309337)는 「주택 위치 안내」 표가
    없어 0건이 나왔다 — 단지 62곳이 DB엔 다른 파서로 이미 들어 있는데도. DB가 정본이다.
    """
    from zipgonggo_pipeline.db import connect

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT nc.name, nc.road_address, nc.sigungu, nc.is_new
                 FROM notice_complex nc JOIN notice n ON n.id = nc.notice_id
                WHERE n.source_key = %s ORDER BY nc.id""",
            (f"ish:{seq}",),
        )
        rows = cur.fetchall()
    if not rows:
        raise SystemExit(f"DB에 공고 단지가 없다: ish:{seq} — 공고 수집을 먼저 돌린다")
    return rows


def cmd_match(seq: str) -> Path:
    """공고 단지 ↔ SH주택정보 biznsCd. 이름 → 주소 순으로 대조한다."""
    by_name, by_addr = _house_index()
    rows = []
    for c in _db_complexes(seq):
        cd, how = _lookup(by_name, by_addr, c["name"], c["road_address"] or "")
        rows.append({
            "단지명": c["name"], "주소": c["road_address"], "자치구": c["sigungu"],
            "신규": bool(c["is_new"]), "biznsCd": cd, "대조": how,
        })

    out = OUT_ROOT / seq / "match.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    hit = [r for r in rows if r["biznsCd"]]
    miss_new = sum(1 for r in rows if not r["biznsCd"] and r["신규"])
    print(f"{len(hit)}/{len(rows)}단지 대조 (실패 {len(rows) - len(hit)}건 중 신규공급 {miss_new}건) → {out}", file=sys.stderr)
    for r in rows:
        if not r["biznsCd"]:
            print(f"  실패: {r['단지명']} | {r['주소']}", file=sys.stderr)
    return out


def cmd_link_all() -> int:
    """SH 공고 전체의 단지 행에 biznsCd를 붙인다(DB만, 요청 없음).

    이미지는 단지에 붙는데 연결(`notice_complex.sh_bizns_cd`)은 load가 그 공고 행에만 걸었다. 그래서
    같은 공덕SK리더스뷰가 제50차·2025년 3차 공고에선 사진이 없었다. 한 번 받은 단지는 어느 공고에서든 보이게.
    """
    from zipgonggo_pipeline.db import connect

    by_name, by_addr = _house_index()
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT nc.id, nc.name, nc.road_address FROM notice_complex nc JOIN notice n ON n.id = nc.notice_id
                WHERE n.source_key LIKE 'ish:%%' AND nc.sh_bizns_cd IS NULL"""
        )
        rows = cur.fetchall()
        linked = 0
        for r in rows:
            cd, _ = _lookup(by_name, by_addr, r["name"], r["road_address"] or "")
            if cd:
                cur.execute("UPDATE notice_complex SET sh_bizns_cd = %s WHERE id = %s", (cd, r["id"]))
                linked += 1
        conn.commit()
    print(f"미연결 {len(rows)}행 중 {linked}행 연결", file=sys.stderr)
    return linked


def cmd_assets(seq: str, client: HouseInfoClient) -> Path:
    """대조된 단지마다 어떤 이미지를 갖고 있는지 조사. 내려받지는 않는다."""
    rows = json.loads((OUT_ROOT / seq / "match.json").read_text(encoding="utf-8"))
    targets = [r for r in rows if r["biznsCd"]]
    rent_ty = _rent_ty_index()
    manifest = []
    for i, r in enumerate(targets, 1):
        cd = r["biznsCd"]
        images: list[Image] = []
        if rent_ty.get(cd, APARTMENT_TY) == APARTMENT_TY:
            for ty in PROBE_IMG_TYPES:
                images.extend(client.images(cd, ty))
            for sply in client.supply_types(cd):
                images.extend(client.plans(cd, sply))
        else:
            # 매입은 08(「기타」)이 층별 건축도면이다. 이름을 여기서 갈아 둬야 지면 탭이 「기타」가 안 된다
            for ty in MAEIP_IMG_TYPES:
                for im in client.images(cd, ty):
                    images.append(replace(im, kind=MAEIP_PLAN_KIND) if im.kind == "기타" else im)
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


def _leaves(images: list[dict]) -> list[str]:
    """한 단지 안에서 겹치지 않는 저장 이름들. 같은 이름이 두 번 오면 뒤엣것에 번호를 단다 —
    매입임대 한 단지가 「주차계획도.PNG」를 두 장 갖고 있었다(2026-09-21). 이름이 같으면 한 장이 다른 장을
    덮어써 지면에 같은 그림이 두 번 뜬다. 차례가 정해져 있으니 fetch와 load가 같은 이름을 얻는다."""
    seen: Counter = Counter()
    out = []
    for row in images:
        leaf = _leaf(row)
        seen[leaf] += 1
        if seen[leaf] > 1:
            stem, dot, ext = leaf.rpartition(".")
            leaf = f"{stem}_{seen[leaf]}{dot}{ext}" if dot else f"{leaf}_{seen[leaf]}"
        out.append(leaf)
    return out


def _saved_path(seq: str, complex_name: str, leaf: str) -> Path:
    return OUT_ROOT / seq / "img" / UNSAFE_RE.sub("_", complex_name) / leaf


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
        for row, leaf in zip(m["이미지"], _leaves(m["이미지"])):
            if row["kind"] not in kinds:
                continue
            path = _saved_path(seq, m["단지명"], leaf)
            if path.exists():
                continue
            # 같은 단지가 여러 공고에 나온다(매입임대 재고가 그렇다). 이미 웹 자리에 있는 그림은 다시 받지 않는다 —
            # DB 행도 단지에 붙어 있어 이 공고의 load가 건너뛰어도 지면에는 그대로 나온다
            if (PUBLIC_ROOT / m["biznsCd"] / leaf).exists():
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
        for sort_no, (row, leaf) in enumerate(zip(m["이미지"], _leaves(m["이미지"]))):
            src = _saved_path(seq, m["단지명"], leaf)
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
    p_houses = sub.add_parser("houses", help="서울 전 단지 목록을 받는다")
    p_houses.add_argument("--rent-ty", default=APARTMENT_TY,
                          help=f"쉼표 구분. {' | '.join(f'{k} {v}' for k, v in RENT_TY_NAMES.items())}. 기본 {APARTMENT_TY}")
    sub.add_parser("match", help="공고 단지에 biznsCd를 붙인다").add_argument("seq")
    sub.add_parser("assets", help="단지별 보유 이미지를 조사한다").add_argument("seq")
    p_fetch = sub.add_parser("fetch", help="이미지를 내려받는다")
    p_fetch.add_argument("seq")
    p_fetch.add_argument("--kinds", default=",".join(DEFAULT_KINDS), help=f"쉼표 구분. 기본 {','.join(DEFAULT_KINDS)}")
    p_fetch.add_argument("--only", default="", help="단지명 부분 문자열. 한 단지만 받을 때")
    sub.add_parser("load", help="받아 둔 이미지를 DB에 넣고 웹 자리로 복사한다").add_argument("seq")
    sub.add_parser("link-all", help="SH 공고 전체 단지 행에 biznsCd를 붙인다(DB만)")

    args = ap.parse_args()
    if args.cmd == "match":
        cmd_match(args.seq)
        return
    if args.cmd == "load":
        cmd_load(args.seq)
        return
    if args.cmd == "link-all":
        cmd_link_all()
        return

    client = HouseInfoClient(delay_sec=args.delay)
    if args.cmd == "houses":
        cmd_houses(client, tuple(t.strip() for t in args.rent_ty.split(",") if t.strip()))
    elif args.cmd == "assets":
        cmd_assets(args.seq, client)
    else:
        cmd_fetch(args.seq, tuple(k.strip() for k in args.kinds.split(",") if k.strip()), client, args.only)
    print(f"(호출 {client.call_count}회)", file=sys.stderr)


if __name__ == "__main__":
    main()
