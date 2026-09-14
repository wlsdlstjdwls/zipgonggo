"""SH 매입임대(장기미임대 등) 공고문 「신청자격」 파서 — 순위 두 줄 표와 소득기준표.

실측(2026년 2차 장기미임대 310107·309403 6~8쪽):
- 「2 신청자격」 절에 「대상 | 세부 자격요건」 표: 「1순위 | 도시근로자 가구원수별 가구당 월평균 소득 130% 이하 세대」
  「2순위 | … 130% 초과 세대」. 「※ 동일순위자 경합시 추첨에 의해 순위 결정」 각주에서 끝난다. 3쪽 요약에도 같은 표가 있어 뒤쪽(본문)을 쓴다.
- 「소득 기준 및 산정방법」 절의 「□전년도 도시근로자 가구원수별 가구당 월 평균 소득기준표」: 1~6인 가구 열(1인 +20%, 2인 +10%가 표에 직접),
  「가구당 월평균소득의 130%」 한 줄. 값 칸이 붙어 한 조각으로 읽힌다(「10618958114428631212508112878142」) — 글자 x로 열을 가른다.
청년·신혼부부 매입임대처럼 표 모양이 다른 양식은 None으로 두고 화면이 제도 시드로 후퇴한다.
"""

from __future__ import annotations

import re
from typing import Any

from .sh_eligibility import Line, Seg, _clean, _lines, _squash
from .sh_eligibility_haengbok import NOTE_RE, RANK_RE, parse_income_table

RANK_MAX_L = 160
TABLE_HEADER = ("대상", "세부자격요건")
INCOME_TABLE_TAIL = "소득기준표"


def _find_rank_table(lines: list[Line]) -> tuple[int, int] | None:
    """「대상 | 세부 자격요건」 헤더 줄과 표 끝(순위 줄이 아닌 첫 줄)."""
    hits: list[int] = []
    for i, ln in enumerate(lines):
        keys = [_squash(s.text) for s in ln.segs]
        if len(keys) >= 2 and keys[0] == TABLE_HEADER[0] and keys[1] == TABLE_HEADER[1]:
            hits.append(i)
    if not hits:
        return None
    start = hits[-1]
    end = start + 1
    while end < len(lines) and end - start < 8:
        ln = lines[end]
        if NOTE_RE.match(ln.first()) or not any(RANK_RE.match(s.text.replace(" ", "")) for s in ln.segs if s.l < RANK_MAX_L):
            break
        end += 1
    return start, end


def parse_maeip(pages: list[tuple[int, str]]) -> dict[str, Any] | None:
    lines = _lines(pages)
    span = _find_rank_table(lines)
    if span is None:
        return None
    start, end = span
    rows: list[dict[str, Any]] = []
    for ln in lines[start + 1:end]:
        rank = next((s for s in ln.segs if s.l < RANK_MAX_L and RANK_RE.match(s.text.replace(" ", ""))), None)
        if rank is None:
            continue
        text = " ".join(s.text for s in ln.segs if s is not rank)
        m = re.search(r"(\d+)\s*%\s*(이하|초과)", text)
        rows.append({
            "area": None,
            "rank": int(RANK_RE.match(rank.text.replace(" ", "")).group(1)),
            "income_pct": int(m.group(1)) if m and m.group(2) == "이하" else None,
            "dual_income_pct": None,
            "requirement": _clean(text),
        })
    if not rows:
        return None
    tie = next((_clean(lines[i].first().lstrip("※ ")) for i in range(end, min(end + 3, len(lines))) if NOTE_RE.match(lines[i].first())), None)
    heading = next((i for i, ln in enumerate(lines) if _squash(ln.text()).endswith(INCOME_TABLE_TAIL) and ln.segs[0].l < 200), None)
    income = None
    if heading is not None:
        # parse_income_table은 「▶ 소득기준」 제목 줄을 찾는다 — 표 제목 줄을 그 모양으로 바꿔 넘긴다
        sub = lines[heading:heading + 25]
        top = sub[0]
        fake = Line(top.page, top.y, [Seg(top.segs[0].l, top.segs[0].r, "▶ 소득기준", [], top.y)])
        income = parse_income_table([fake, *sub[1:]])
        if income is not None:
            income["keep_blank"] = False
            for r in income["rows"]:
                r["conditions"] = []   # 이 양식은 조건 열이 없다 — 라벨 조각이 섞여 들어온다
            income["notes"] = [n for n in income["notes"] if "%p" in n][:1]
    pages_used = {ln.page for ln in lines[start:end]} | ({lines[heading].page} if heading is not None else set())
    return {
        "kind": "maeip",
        "source_pages": sorted(pages_used),
        "rank_tables": [{"group": "신청자격", "classes": [], "rows": rows}],
        "bonus_conditions": [],
        "bonus_notes": [],
        "income_matrix": None,
        "asset": None,
        "income_table": income,
        "selection": [{"title": "동일순위 경쟁 시", "rows": [{"group": None, "area": None, "steps": [tie]}], "tie_break": None}] if tie else [],
        "score_tables": [],
        "penalties": None,
        "class_blocks": [],
    }
