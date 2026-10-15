"""「모집개요」 라벨 줄 파서 — 구청이 낸 수요자 맞춤형 매입임대 공고문(도전숙, 은빛주택, 청년창업가/예술인주택).

정답지: 311087(강동구 청년창업가/예술인주택), 311549(성북구 도전숙). 2026-10-15 사용자 지적
「/notice/sh-2026-311549-maeip 내용이 없다」.

이 양식은 SH 흐름도도 단지 표도 없다. 구청마다 조판이 달라 표는 제각각이지만 첫 쪽 「모집개요」는
라벨 줄 꼴이 같다:

    ▢접수기간 : 2026. 10. 21. ~ 10. 28.
    ▢당첨자발표 : 2026. 12. 23.(수) 예정
    ▢공급호수 : 총 41세대
    m 접수기간: 2026. 10. 8.(목) ~ 10. 2.(목) 15:0      ← Synap이 「22」 「00」의 한 글자를 떨어뜨렸다
    m 공급호수: 총 7개소 37호실

흐름도 파서(sh_schedule)가 일정을 못 찾은 공고에만 쓴다. 숫자가 떨어졌을 수 있으므로(parsers/synap_repair)
**요일이 적혀 있으면 요일로 검산**하고, 안 맞으면 한 자리 숫자를 겹쳐 본 후보 중 요일이 맞는 것이 하나일 때만 쓴다.
요일이 없으면 공고일 앞이거나 마감이 시작보다 앞서는 날짜를 버린다. 못 가리면 빈칸으로 둔다.
"""

from __future__ import annotations

import html
import io
import re
import zipfile
from datetime import date, timedelta

from ..sources.ish import group_rows, parse_chars, row_segments
from .sh_schedule import Schedule

WEEKDAYS = "월화수목금토일"
MAX_PAGES = 4

# 연도는 마감 쪽에서 빠지기 일쑤다. 마침표가 딴 줄로 떨어진 조판(「2026 12 30(수)」)도 있어 구분자는 공백이어도 된다
_DATE = (r"(?:(?P<{p}y>20\d{{2}})\s*[.년]?\s+|(?P<{p}y2>20\d{{2}})\s*[.년]\s*)?"
         r"(?P<{p}m>\d{{1,2}})\s*(?:[.월]\s*|\s+)(?P<{p}d>\d{{1,2}})\s*[.일]?\s*(?:\(\s*(?P<{p}w>[월화수목금토일])\s*\))?")
FIRST = _DATE.format(p="a")
SECOND = _DATE.format(p="b")

APPLY_LABEL = r"(?:접수\s*기간|접수\s*일시|신청\s*기간|청약\s*신청|신청\s*접수|서류\s*접수)"
ANNOUNCE_LABEL = r"(?:당첨자\s*발표|발표\s*일시|대상자\s*발표|입주자\s*발표)"
APPLY_RE = re.compile(APPLY_LABEL + r"\s*[:：]\s*" + FIRST + r"\s*[~∼-]\s*" + SECOND)
ANNOUNCE_RE = re.compile(ANNOUNCE_LABEL + r"\s*[:：]\s*" + FIRST)
SUPPLY_RE = re.compile(
    r"(?:공급|모집)\s*(?:호수|세대수?|가구수?|규모)\s*[:：]\s*총?\s*(?:\d+\s*개\s*소\s*,?\s*)?"
    r"(?P<n>\d{1,4})\s*(?:호실|세대|가구|호)"
)
# 머리말에만 호수를 적는 양식(311349 「잔여 세대(2세대)」)
REMAIN_RE = re.compile(r"잔여\s*세대\s*\(\s*(?P<n>\d{1,3})\s*세대\s*\)")


def _candidates(y: int, m: str, d: str) -> list[date]:
    """보이는 숫자 그대로 + 한 자리 숫자를 겹친 꼴(「2」→「22」). Synap은 잇단 같은 글자 중 하나만 떨어뜨린다."""
    ms = [m] + ([m * 2] if len(m) == 1 else [])
    ds = [d] + ([d * 2] if len(d) == 1 else [])
    out = []
    for mm in ms:
        for dd in ds:
            try:
                out.append(date(y, int(mm), int(dd)))
            except ValueError:
                pass
    return out


def _pick(y: int, m: str, d: str, w: str | None) -> date | None:
    cands = _candidates(y, m, d)
    if not cands:
        return None
    if w is None:
        # 요일로 검산할 길이 없다 — 보이는 그대로만(겹친 후보는 지어낸 값이 된다)
        return cands[0] if (m, d) == (str(cands[0].month), str(cands[0].day)) else None
    hit = [c for c in cands if WEEKDAYS[c.weekday()] == w]
    return hit[0] if len(hit) == 1 else None


def _lines(pages: list[tuple[int, str]]):
    for page, xml in pages[:MAX_PAGES]:
        for row in group_rows(parse_chars(xml)):
            yield page, " ".join(s.text for s in row_segments(row))


def hwpx_lines(data: bytes) -> list[str]:
    """hwpx(zip) 본문 문단 → 글줄. Synap 미리보기가 hwpx를 못 여는 공고(311349 은빛주택)용.
    표 칸도 문단이라 라벨과 값이 딴 줄로 갈리기도 하지만, 「접수일시 : …」처럼 한 문단에 쓴 줄은 그대로 읽힌다."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = sorted(n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n))
        out: list[str] = []
        for n in names:
            xml = z.read(n).decode("utf-8", "replace")
            for para in re.findall(r"<hp:p\b.*?</hp:p>", xml, flags=re.S):
                text = "".join(re.findall(r"<hp:t\b[^>]*>(.*?)</hp:t>", para, flags=re.S))
                text = html.unescape(re.sub(r"<[^>]+>", "", text)).strip()
                if text:
                    out.append(text)
    return out


def parse_overview(pages: list[tuple[int, str]], posted: date | None) -> tuple[Schedule | None, int | None]:
    """Synap 쪽 XML → (일정, 공급호수). 읽은 게 없으면 (None, None)."""
    return parse_overview_lines(_lines(pages), posted)


def parse_overview_lines(lines, posted: date | None) -> tuple[Schedule | None, int | None]:
    """(쪽, 글줄) 또는 글줄 목록 → (일정, 공급호수)."""
    start = end = announce = None
    page_hit: int | None = None
    supply: int | None = None
    floor = posted - timedelta(days=3) if posted else None
    year0 = posted.year if posted else None
    for item in lines:
        page, text = item if isinstance(item, tuple) else (None, item)
        if start is None and (m := APPLY_RE.search(text)):
            y = _year(m, "a") or year0
            if y:
                s = _pick(y, m["am"], m["ad"], m["aw"])
                ey = _year(m, "b") or y
                e = _pick(ey, m["bm"], m["bd"], m["bw"])
                # 연말 공고의 이듬해 마감(12. 28. ~ 1. 8.)만 해를 넘긴다 — 같은 달에서 앞선 날은 글자가 떨어진 것이다
                if e and s and e < s and not _year(m, "b") and e.month < s.month:
                    e = _pick(ey + 1, m["bm"], m["bd"], m["bw"])
                if s and floor and s < floor:
                    s = None
                if e and s and e < s:
                    e = None
                if s or e:
                    start, end, page_hit = s, e, page
        if announce is None and (m := ANNOUNCE_RE.search(text)):
            y = _year(m, "a") or year0
            a = _pick(y, m["am"], m["ad"], m["aw"]) if y else None
            if a and (floor is None or a >= floor):
                announce = a
                page_hit = page_hit or page
        if supply is None and (m := SUPPLY_RE.search(text) or REMAIN_RE.search(text)):
            supply = int(m["n"]) or None
    if announce and (end or start) and announce < (end or start):
        announce = None
    sch = Schedule(apply_start=start, apply_end=end, announce=announce, page=page_hit) if (start or end or announce) else None
    return sch, supply


def _year(m: re.Match, p: str) -> int | None:
    y = m[f"{p}y"] or m[f"{p}y2"]
    return int(y) if y else None
