"""구청 수요자 맞춤형 공고의 「소재지 | 호수 | 전용면적 | 임대보증금/월임대료 × 소득 계층」 호실표.

정답지: 311549(성북구 도전숙 공실세대, 2026-10-14) 2~3쪽 「주택유형별 규모 및 임대가격」 41호실. 사용자 지적 2026-10-15.

**Synap 미리보기가 아니라 원본 PDF를 pdfplumber로 읽는다.** 미리보기 XML은 잇단 같은 글자를 떨어뜨려
(「13,360,000」 → 「1336000」, 「69,400」 → 「69,40」) 41호실 중 열 곳 넘게 금액을 못 되살렸다. 원본은 글자층이 온전하고
괘선 표라 extract_tables가 칸을 그대로 준다. 세로 병합(소재지 칸)은 None으로 오므로 위 값을 내려 쓴다.

생김새:
- 머리글 두 줄: 「소재지 | 호수 | 전용면적(㎡) | 월평균소득 50%이하 및 자산·자동차 기준 충족 | (병합) | 월평균소득 50%초과 ~100%이하 | (병합)」,
  「- | - | - | 임대보증금 | 월임대료 | 임대보증금 | 월임대료」
- 소재지 칸: 「도전숙 1호\n(보국문로12길 46)\n81317-0009」(이름, 도로명, 관리번호)
- 호수 칸: 「402\n(부부형)」
- 다음 쪽 표는 머리글 없이 이어진다 — 칸 수가 같으면 앞 쪽 역할을 그대로 쓴다

금액은 계층 순서(50% 초과 쪽이 더 비싸다)와 범위로 검산하고, 어긋나면 그 줄 금액을 비운다.
"""

from __future__ import annotations

import io
import logging
import re
from typing import Any

from .sh_location import SEOUL_GU

log = logging.getLogger(__name__)

MAX_PAGES = 10
HO_RE = re.compile(r"^\s*(\d{2,4})\s*호?\s*(?:\((?P<note>[^)]*)\))?")
ROAD_RE = re.compile(r"\(\s*([가-힣0-9]+(?:로|길)(?:\s*\d+[가-힣]?(?:로|길))?\s*\d+(?:-\d+)?)\s*\)")
TIER_RE = re.compile(r"(\d{2,3})\s*%\s*(이하|초과)")
DEPOSIT_RANGE = (1_000_000, 150_000_000)
RENT_RANGE = (20_000, 1_500_000)
AREA_RANGE = (10.0, 120.0)


def _flat(s: str | None) -> str:
    return re.sub(r"\s+", "", s or "")


def _roles(head: list[str | None], sub: list[str | None]) -> dict[str, Any] | None:
    """머리글 두 줄 → 칸 역할. 금액 칸은 (보증금 칸, 임대료 칸, 계층 이름) 묶음."""
    roles: dict[str, Any] = {"money": []}
    tier = None
    for i, (h, s) in enumerate(zip(head, sub)):
        fh, fs = _flat(h), _flat(s)
        if h is not None:
            tier = h
        if fh in ("소재지", "주택명", "주택", "단지명", "위치") or (fh.startswith("소재") and "name" not in roles):
            roles["name"] = i
        elif fh in ("호수", "호실", "동호수") or fh.endswith("호수"):
            roles["ho"] = i
        elif "면적" in fh:
            roles["area"] = i
        elif fs in ("임대보증금", "보증금"):
            roles["money"].append([i, None, tier])
        elif fs in ("월임대료", "임대료") and roles["money"] and roles["money"][-1][1] is None:
            roles["money"][-1][1] = i
    if not {"name", "ho", "area"} <= roles.keys() or not roles["money"] or any(m[1] is None for m in roles["money"]):
        return None
    roles["tiers"] = [_tier_label(m[2], k) for k, m in enumerate(roles["money"])]
    return roles


def _tier_label(text: str | None, k: int) -> str:
    hits = TIER_RE.findall(text or "")
    if not hits:
        return f"계층 {k + 1}"
    return "소득 " + " ".join(f"{n}% {w}" for n, w in hits)


def _won(cell: str | None) -> int | None:
    d = re.sub(r"[^\d]", "", cell or "")
    return int(d) if d else None


def _area(cell: str | None) -> float | None:
    m = re.search(r"\d+(?:\.\d+)?", cell or "")
    if not m:
        return None
    v = float(m.group(0))
    return v if AREA_RANGE[0] <= v <= AREA_RANGE[1] else None


def _place(cell: str) -> tuple[str, str] | None:
    """「도전숙 1호\n(보국문로12길 46)\n81317-0009」 → (이름, 도로명)."""
    m = ROAD_RE.search(cell)
    if not m:
        return None
    name = cell[:m.start()].strip().split("\n")[0].strip()
    # 「장위로 19길 25」처럼 원문 띄어쓰기가 제각각이라 걷고, 건물번호 앞만 띄운다(「보국문로12길 46」)
    road = re.sub(r"(\D)(\d+(?:-\d+)?)$", r"\1 \2", re.sub(r"\s+", "", m.group(1)))
    return (re.sub(r"\s+", " ", name) or road), road


def parse_custom_pdf(data: bytes, title: str) -> dict[str, Any] | None:
    """{"complexes", "units", "totals", "tiers"} 또는 None."""
    import pdfplumber

    gu_m = re.search(SEOUL_GU, title)
    if not gu_m:
        return None
    gu = gu_m.group(0)
    roles: dict[str, Any] | None = None
    ncols = 0
    parsed: list[dict[str, Any]] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for pno, page in enumerate(pdf.pages[:MAX_PAGES], 1):
            for table in page.extract_tables():
                start = 0
                found = None
                for i in range(len(table) - 1):
                    found = _roles(table[i], table[i + 1])
                    if found:
                        start = i + 2
                        break
                if found:
                    roles, ncols = found, len(table[0])
                elif roles is None or len(table[0]) != ncols:
                    continue
                place: tuple[str, str] | None = None
                for row in table[start:]:
                    cell = row[roles["name"]]
                    if cell:
                        place = _place(cell)
                    hm = HO_RE.match(row[roles["ho"]] or "")
                    if place is None or not hm:
                        continue
                    prices = [(_won(row[d]), _won(row[r])) for d, r, _t in roles["money"]]
                    prices = [(d if d and DEPOSIT_RANGE[0] <= d <= DEPOSIT_RANGE[1] else None,
                               r if r and RENT_RANGE[0] <= r <= RENT_RANGE[1] else None) for d, r in prices]
                    full = [p for p in prices if None not in p]
                    if len(full) >= 2 and any(b[0] < a[0] or b[1] < a[1] for a, b in zip(full, full[1:])):
                        log.warning("수요자맞춤 호실표 %s %s호: 계층 금액 순서가 어긋나 비운다 %s", place[0], hm.group(1), prices)
                        prices = [(None, None)] * len(prices)
                    parsed.append({"name": place[0], "road": f"{gu} {place[1]}", "ho": hm.group(1),
                                   "note": hm.group("note"), "area": _area(row[roles["area"]]),
                                   "prices": prices, "page": pno})
    if not parsed:
        return None
    return _rows_out(parsed, roles["tiers"] if roles else [], gu)


def _rows_out(parsed: list[dict[str, Any]], tiers: list[str], gu: str) -> dict[str, Any]:
    units: list[dict[str, Any]] = []
    # 8호와 9호처럼 이름이 다른 동이 한 지번에 서기도 한다 — 이름까지 묶어 키로 쓴다
    by: dict[tuple[str, str], dict[str, Any]] = {}
    for p in parsed:
        base = next((t for t in p["prices"] if None not in t), (None, None))
        c = by.setdefault((p["name"], p["road"]), {
            "name": p["name"], "sido": "서울특별시", "sigungu": gu, "road_address": p["road"], "is_new": False,
            "source_page": p["page"], "complex_code": None, "heating": None, "unit_count": 0,
            "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None})
        c["unit_count"] += 1
        for key, v, f in (("min_deposit", base[0], min), ("min_rent", base[1], min),
                          ("area_min", p["area"], min), ("area_max", p["area"], max)):
            if v is not None:
                c[key] = v if c[key] is None else f(c[key], v)
        if p["area"] is None or base[0] is None:
            continue
        units.append({
            "complex_code": None, "nc_name": p["name"], "nc_road": p["road"],
            "unit_key": f"{_flat(p['name'])}-{p['ho']}",
            "road_address": p["road"], "complex_name": p["name"], "building": None, "room": p["ho"],
            "floor": int(p["ho"][:-2]) if p["ho"][:-2].isdigit() else None,
            "sido": "서울특별시", "sigungu": gu, "area_m2": p["area"],
            "deposit": base[0], "rent": base[1],
            "deposit_jeonse": None, "rent_jeonse": None, "deposit_wolse": None, "rent_wolse": None,
            "price_tiers": [{"label": t, "deposit": d, "rent": r} for t, (d, r) in zip(tiers, p["prices"])],
            # 「(부부형)」은 방 꼴이 아니라 입주 대상이지만 호실 표에 따로 둘 칸이 없어 방 꼴 자리에 싣는다
            "room_layout": p["note"] or None, "elevator": None, "has_elevator": None,
            "seq": len(units) + 1, "source_page": p["page"],
        })
    deps = [t["deposit"] for u in units for t in u["price_tiers"] if t["deposit"]]
    rents = [t["rent"] for u in units for t in u["price_tiers"] if t["rent"]]
    return {
        "complexes": list(by.values()), "units": units, "tiers": tiers,
        "totals": {"min_deposit": min(deps, default=None), "max_deposit": max(deps, default=None),
                   "min_rent": min(rents, default=None), "max_rent": max(rents, default=None),
                   "supply_count": len(parsed)},
    }
