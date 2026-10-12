"""SH 매입임대 공고문 본문의 주택 위치 — 주택목록 별첨도 단지 표도 없는 공고의 마지막 수단.

잔여세대·협동조합·두레주택·자립준비청년 공고는 단지가 한두 곳이라 위치가 본문에 짧게 적힌다.
이걸 안 읽어 지도가 빈 공고가 34건이었다(2026-10-12). 양식 셋(실측):

- 대상주택 표(자립준비청년 296598·305240·289048): 대상주택 | 총세대수 | 공급호수 | 유형 | 주택형 …
  대상주택 칸이 「서울특별시강동구상암로41길75-1」 / 「초행지붕천호(천호동27-18)」 두 줄이고, 공급호수는 주택형마다 한 줄씩이다.
- 단지 | 소재지 표(도시형생활주택 308167·296634, 신내의료안심주택 299109): 이름과 주소가 같은 줄이거나 한 줄 어긋난다.
- 라벨 줄(협동조합 306066: 「주택명 …」 / 「주소지 …」, 사당동원룸 306205·신정도시마을 293598: 「위치 …」):
  주택명 라벨이 없으면 공고 제목에서 이름을 딴다(「2026-2차 사당동원룸 잔여세대 …」 → 사당동원룸).

**접수처·센터·본사 주소를 단지로 읽으면 안 된다** — 우편 접수처(구청), 주거안심종합센터 표, 공사 본사(개포로 621)가
본문 곳곳에 있다. 그런 줄은 통째로 버린다.
"""

from __future__ import annotations

import re
from typing import Any

from ..sources.ish import Segment, group_rows, parse_chars, row_segments

SIDO_RE = re.compile(r"^(?:서울특별시|서울시|서울)")
# 공백을 다 지운 주소에서 시군구 | 도로명 | 건물번호. 「신내로 16길 3」처럼 길 이름이 둘로 쪼개진 표기도 붙여 읽는다
# 구 이름은 서울 25개 구만 — 「1인가구」의 「인가구」를 구로 읽은 적이 있다
SEOUL_GU = ("종로구|중구|용산구|성동구|광진구|동대문구|중랑구|성북구|강북구|도봉구|노원구|은평구|서대문구|마포구|양천구|"
            "강서구|구로구|금천구|영등포구|동작구|관악구|서초구|강남구|송파구|강동구")
ROAD_RE = re.compile(rf"(?P<gu>{SEOUL_GU})(?P<road>[가-힣0-9]+?(?:로|길)(?:\d+[가-힣]?(?:로|길))?)(?P<no>\d+(?:-\d+)?)(?![가-힣\d])")
EXCLUDE_RE = re.compile(r"센터|구청|본사|공사|발송|제출|접수|우편|담당|개포로621|청사|주민센터|사무소")
LABEL_NAME = {"주택명", "단지명"}
# 「□ 위 치: 서울특별시 …」는 칸이 「□ 위」 / 「치: …」로 쪼개져 온다 — 줄 전체로 본다(301406)
LABEL_LINE_RE = re.compile(r"^[□○·▣■\s]*(?:주\s*소\s*지?|소\s*재\s*지|위\s*치)\s*[:：]?\s*(?P<value>.+)$")
# 이름 자리에 동 표기(「A동」)·지번(「(송파동18-5)」, 「천호동38-8)」)·시군구·대상 설명(「1~2인」)만 있으면 이름이 아니다
BAD_NAME_RE = re.compile(r"^(?:\(.*|[^(]*\)|[A-Za-z0-9가-힣]{1,3}동|[가-힣]{1,3}구|.*~.*|\d.*)$")
UNITS_RE = re.compile(r"^(\d{1,4})호$")
PAREN_TAIL_RE = re.compile(r"^(?P<name>[^(]+?)\s*\((?P<inner>[^)]*)\)?$")


def _flat(s: str) -> str:
    return re.sub(r"\s+", "", s)


def _mid(s: Segment) -> float:
    return (s.l + s.r) / 2


def road_address(text: str) -> tuple[str, str] | None:
    """「서울특별시 중랑구 신내로 16길 3」·「중구만리재로27길69(만리동…)」 → ("중랑구", "중랑구 신내로16길 3")."""
    t = SIDO_RE.sub("", _flat(text).lstrip("(□:·"))
    m = ROAD_RE.search(t)
    if not m or m.start() > 2:
        return None
    gu = m.group("gu")
    return gu, f"{gu} {m.group('road')} {m.group('no')}"


def title_name(title: str) -> str | None:
    """공고 제목에서 주택 이름. 「2026-2차 사당동원룸 잔여세대 입주자모집공고(26. 6. 26.)」 → 사당동원룸."""
    t = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", title)
    t = re.sub(r"\d{4}\s*년|\d{4}-\d+\s*차|\d+\s*차", " ", t)
    t = re.split(r"잔여세대|예비입주자|입주자|추가\s*입주자|모집", t)[0]
    t = re.sub(r"\s+", " ", t).strip(" -")
    return t or None


def _rows(pages: list[tuple[int, str]]):
    for page, xml in pages:
        yield page, [row_segments(r) for r in group_rows(parse_chars(xml))]


def _excluded(row: list[Segment]) -> bool:
    return bool(EXCLUDE_RE.search(_flat(" ".join(s.text for s in row))))


# 표 머리글 둘째 줄(「건물 / 최고층수」)이 단지 칸에 걸린다(299109)
HEADER_WORDS = {"최고층수", "건물", "동수", "입주자격", "승강기유무", "소재지", "단지", "단지명", "주택명", "대상주택", "합계"}


def _good(name: str | None) -> str | None:
    if not name or BAD_NAME_RE.match(_flat(name)) or _flat(name) in HEADER_WORDS:
        return None
    return name.strip()


def _complex(name: str | None, gu: str, road: str, page: int, units: int | None = None) -> dict[str, Any]:
    """이름을 못 믿으면 도로명(시군구 뗀 것)을 이름으로 쓴다 — 지어낸 이름보다 낫다."""
    return {"name": _good(name) or road.split(" ", 1)[1], "sido": "서울특별시", "sigungu": gu, "road_address": road, "is_new": False,
            "source_page": page, "complex_code": None, "heating": None, "unit_count": units,
            "min_deposit": None, "min_rent": None, "area_min": None, "area_max": None}


def _target_table(page: int, rows: list[list[Segment]]) -> list[dict[str, Any]]:
    """대상주택 | 총세대수 | 공급호수 표. 주소 줄이 한 주택의 시작이고, 다음 주소 줄 전까지의 공급호수를 더한다."""
    head_i = next((i for i, r in enumerate(rows)
                   if {"대상주택", "공급호수"} <= {_flat(s.text) for s in r}), None)
    if head_i is None:
        return []
    head = {_flat(s.text): _mid(s) for s in rows[head_i]}
    split = (head["대상주택"] + head.get("총세대수", head["공급호수"])) / 2
    supply_x = head["공급호수"]
    blocks: list[dict[str, Any]] = []
    # 이름이 주소보다 먼저 오는 변형(304699: 「신우드림빌[천호동]」 / 「(강동구상암로35길10,」 / 「천호동38-8)」)
    pending: str | None = None
    for r in rows[head_i + 1:]:
        if r and r[0].text.startswith("※"):
            break
        left = [s for s in r if _mid(s) < split]
        for s in left:
            t = s.text.strip()
            ra = road_address(t)
            if ra:
                blocks.append({"gu": ra[0], "road": ra[1], "name": pending if t.startswith("(") else None, "units": 0})
                pending = None
                continue
            m = PAREN_TAIL_RE.match(t)
            name = _good((m.group("name") if m else t).strip())
            if not name:
                continue
            if blocks and blocks[-1]["name"] is None:
                blocks[-1]["name"] = name
            else:
                pending = name
        if blocks:
            for s in r:
                m = UNITS_RE.match(_flat(s.text))
                if m and abs(_mid(s) - supply_x) < abs(_mid(s) - head.get("총세대수", -1e9)):
                    blocks[-1]["units"] += int(m.group(1))
    return [_complex(b["name"], b["gu"], b["road"], page, b["units"] or None)
            for b in blocks]


def _site_table(page: int, rows: list[list[Segment]]) -> list[dict[str, Any]]:
    """단지 | 소재지 표. 소재지 칸의 주소마다 단지 칸에서 가장 가까운 줄(같은 줄 → 위 → 아래)의 이름을 붙인다."""
    head_i = next((i for i, r in enumerate(rows)
                   if any(_flat(s.text) in ("단지", "단지명") for s in r) and any(_flat(s.text) == "소재지" for s in r)), None)
    if head_i is None:
        return []
    head = {_flat(s.text): _mid(s) for s in rows[head_i]}
    name_x = head.get("단지", head.get("단지명"))
    site_x = head["소재지"]
    body: list[list[Segment]] = []
    for r in rows[head_i + 1:]:
        if r and r[0].text.lstrip().startswith(("▣", "■", "※")):
            break
        body.append(r)

    def name_at(i: int) -> str | None:
        if not 0 <= i < len(body):
            return None
        for s in body[i]:
            t = s.text.strip()
            if abs(_mid(s) - name_x) < abs(_mid(s) - site_x) and re.search(r"[가-힣]", t) \
                    and _good(t) and not road_address(t):
                return t
        return None

    out = []
    used: set[int] = set()
    for i, r in enumerate(body):
        for s in r:
            if abs(_mid(s) - site_x) > abs(_mid(s) - name_x):
                continue
            ra = road_address(s.text)
            if not ra and i + 1 < len(body) and re.search(r"(?:로|길)$", s.text.strip()):
                # 「강남구 밤고개로21길」 / 「56」처럼 건물번호만 다음 줄로 넘어간 칸(296634)
                # 사이에 이름 줄이 끼면 두 줄 아래다(「강남구 밤고개로21길」 / 「율현리엔파크 … 5층」 / 「56」)
                below = [x for k in (i + 1, i + 2) if k < len(body) for x in body[k]
                         if re.fullmatch(r"\d+(?:-\d+)?", x.text.strip())
                         and abs(_mid(x) - site_x) <= abs(_mid(x) - name_x)]
                if below:
                    ra = road_address(s.text + " " + below[0].text)
            if not ra:
                continue
            j = next((k for k in (i, i - 1, i + 1) if k not in used and name_at(k)), None)
            name = name_at(j) if j is not None else None
            if j is not None:
                used.add(j)
            out.append(_complex(name, ra[0], ra[1], page))
    return out


def _labels(page: int, rows: list[list[Segment]], title: str) -> list[dict[str, Any]]:
    """「주택명 X」 / 「주소지 Y」, 또는 「위치 Y」 줄. 주택명이 없으면 제목에서 이름을 딴다."""
    out = []
    for i, r in enumerate(rows):
        if not r or _excluded(r):
            continue
        m = LABEL_LINE_RE.match(" ".join(s.text for s in r))
        if not m:
            continue
        ra = road_address(m.group("value"))
        if not ra:
            continue
        name = None
        for k in range(max(0, i - 3), i):
            if rows[k] and _flat(rows[k][0].text) in LABEL_NAME and len(rows[k]) > 1:
                name = rows[k][1].text.strip()
        out.append(_complex(name or title_name(title), ra[0], ra[1], page))
    return out


def parse_locations(pages: list[tuple[int, str]], title: str) -> list[dict[str, Any]]:
    """앞쪽 25쪽에서 주택 위치를 찾는다. 표가 있으면 표, 없으면 라벨 줄. 같은 주소는 한 번만."""
    found: list[dict[str, Any]] = []
    for kind in (_target_table, _site_table):
        for page, rows in _rows(pages[:25]):
            found += kind(page, rows)
        if found:
            break
    if not found:
        for page, rows in _rows(pages[:25]):
            found += _labels(page, rows, title)
    seen: set[str] = set()
    out = []
    for c in found:
        if c["road_address"] in seen:
            continue
        seen.add(c["road_address"])
        out.append(c)
    return out
