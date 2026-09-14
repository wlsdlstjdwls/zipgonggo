"""SH 장기전세 공고문 「신청자격」 파서 — 소득기준·신청순위 표, 출생자녀 가산, 자산 기준, 소득표,
동일순위 경쟁 시 선정 순서, 가감점 배점표.

전부 Synap XML 글자 좌표로 읽는다. 공고문의 표는 세로 병합 칸이 많아 줄 단위 텍스트로는 어느 칸의 값인지
알 수 없다(「60㎡이하」 라벨은 네 순위 줄의 한가운데에 한 번만 찍힌다). 그래서 칸의 x 범위와 y 거리로 되묶는다.

실측(제51차 장기전세 309467, 2026-09-14):
- 6~7쪽 「소득기준 및 신청순위」: 「○ 공사 건설형(일반 주거약자) 서울리츠3호」 「○ 매입형(일반공급)」 「○ 매입형(우선공급)」
  세 표. 열은 신청면적(x<150) | 순위(x<215) | 소득기준(%가 든 칸, x<390) | 소득 외 기준(x≥390).
  면적 라벨은 병합 칸 한가운데, 「60㎡초과」+「85㎡이하」처럼 두 줄로 나뉜다. 소득 칸도 순위 둘에 걸쳐 병합된다.
- 7쪽 「출생자녀에 따른 소득 및 자산요건 가산 적용」 ①②③ 조건 + 「소득 가산 적용」 표(기본 | ① | ②③ | 맞벌이).
- 8쪽 「자산 가산 적용」 표(총자산·자동차 × 기본 | ① | ②③), 「가구원수별 가구당 월평균소득 표」(% × 1~6인).
  소득표는 Synap 글자 유실이 있어(90% 줄) 구멍 난 칸은 None으로 두고 stage가 100% 기준액으로 검산·보충한다.
- 30~31쪽 「동일순위 경쟁 시 입주자 선정 기준」: 「➜ 일반공급(일반)」 「➜ 일반공급(주거약자)」 「➜ 우선공급」 세 표
  (글머리는 차수마다 다르다 — 51차 ➜, 49차 사설 영역 글자·▶. BULLET_RE).
  열은 구분(x<182: 유형 + 면적) | 선정순서(화살표로 이어진 단계) | 비고(x ≥ 비고 헤더 - 60, 표 전체에 걸친 병합 칸).
- 31~32쪽 「가감점 배점표」: 5점~1점 표(일반공급(일반)·우선공급), 3점~1점 표(주거약자), 감점표(가·나·다).
  항목은 ①~⑤ 표시로 시작하고 칸 글은 두 줄(「7년 이상」/「10년 미만」)로 흩어진다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..sources.ish import Char, group_rows, parse_chars, row_center_y

AREA_RE = re.compile(r"^\d+㎡\s*(?:이하|초과|미만|이상)$")
RANK_RE = re.compile(r"^(\d)\s*순위$")
PCT_RE = re.compile(r"(\d+)\s*%")
POINT_RE = re.compile(r"^(\d+)\s*점$")
MINUS_POINT_RE = re.compile(r"^-\s*(\d+)\s*점$")
ITEM_RE = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]")
HOUSEHOLD_RE = re.compile(r"^(\d)인가구$")
BULLET_RE = re.compile(r"^[➜▶►-]")   # 표 이름 글머리. 51차 ➜, 49차는 사설 영역 글자()와 ▶
MANWON_RE = re.compile(r"^([\d,]+)\s*만원")

RANK_HEADING = "소득기준 및 신청순위"
BONUS_HEADING = "출생자녀에 따른 소득 및 자산요건 가산 적용"   # 6쪽 「※ 출생자녀에 따른 소득 가산은 …」 각주와 구분
INCOME_BONUS_HEADING = "소득 가산 적용"
ASSET_BONUS_HEADING = "자산 가산 적용"
INCOME_TABLE_HEADING = "가구원수별 가구당 월평균소득 표"
SELECTION_HEADING = "동일순위 경쟁 시 입주자 선정 기준"
SCORE_HEADING = "감점 배점표"
SCORE_END_HEADINGS = ("감점 항목 기재 요령", "가점 항목 기재 요령")   # 49·50차는 「* 가점 항목 기재 요령」
PENALTY_HEADING = "감점 기준"

# 열 경계(px). 6~7쪽 순위 표 실측 — 면적 79~145, 순위 153~207, 소득 241~371, 소득 외 399~708
AREA_MAX_L = 150
RANK_MAX_L = 215
PCT_MAX_L = 390
REQ_MIN_L = 390
LABEL_MAX_L = 178      # 선정 기준 표의 구분 열(x 63~171). 단계 글은 181부터 시작한다
REMARK_PAD = 60        # 비고 열 = 비고 헤더 왼쪽 끝 - 이만큼
AREA_MERGE_PX = 25     # 「60㎡초과」/「85㎡이하」 두 줄 라벨
PAIR_PX = 30           # 소득 칸의 「(맞벌이: n%)」 줄은 바로 위 기본 % 줄과 한 칸
SELECTION_GAP = 15     # 선정 표에서 줄 사이가 이보다 벌어지면 다른 칸
SCORE_GAP = 19         # 배점표는 칸 글이 두 줄이라 줄 간격이 17~18까지 간다
SCORE_ITEM_GAP = 10    # ①~⑤ 표시가 있는 줄은 새 항목 — 단 바로 위(10px 안)에 칸 글이 먼저 온 경우는 같은 항목
SCORE_ITEM_MIN_L = 185
SCORE_ITEM_MAX_L = 428
SCORE_COL_HALF = 30
HEADING_LEAD = 6       # 제목 줄에서 제목 앞에 올 수 있는 글자 수(「06|」「➜」「*」)
PAGE_STRIDE = 2000     # 쪽 높이(1121)보다 크게 — y = 쪽 × STRIDE + 쪽 안 y
HEADER_PX = 95         # 쪽 머리글 y(80.7) 아래, 본문 첫 줄(121) 위
FOOTER_PX = 1050       # 쪽 번호 y(1062) 위
SCORE_NOTE_END_W = 400 # 배점표 아래 「※ ③사회취약계층의 …」 각주는 폭이 넓다(529). 칸 안의 ※ 주석은 210
GROUP_MIN_L = 110      # 배점표 구분 열(일반공급/우선공급)은 x 127~180. 그 왼쪽 「가점 기준」은 표 이름
GROUP_JOIN_PX = 22     # 선정 표 구분 열의 병합 칸 라벨(「공사」「건설형」「서울」「리츠3호」) 조각 사이 간격
GROUP_JOIN_SHORT_PX = 40   # 짧은 조각(4자 이하)끼리는 더 벌어져도 한 라벨 — 50차는 「건설형」과 「서울」 사이가 34
LABEL_JOIN_PX = 12     # %줄 바로 위아래(9px)에 놓인 신청자 라벨·감점 라벨 조각은 그 줄의 것


@dataclass
class Seg:
    l: float
    r: float
    text: str
    chars: list[Char] = field(default_factory=list)
    y: float = 0.0

    @property
    def cx(self) -> float:
        return (self.l + self.r) / 2


@dataclass
class Line:
    page: int
    y: float
    segs: list[Seg]

    def text(self) -> str:
        return " ".join(s.text for s in self.segs)

    def first(self) -> str:
        return self.segs[0].text if self.segs else ""


@dataclass
class Eligibility:
    source_pages: list[int]
    rank_tables: list[dict[str, Any]]
    bonus_conditions: list[str]
    bonus_notes: list[str]
    income_matrix: dict[str, Any] | None
    asset: dict[str, Any] | None
    income_table: dict[str, Any] | None
    selection: list[dict[str, Any]]
    score_tables: list[dict[str, Any]]
    penalties: dict[str, Any] | None

    def as_json(self) -> dict[str, Any]:
        return {
            "source_pages": self.source_pages,
            "rank_tables": self.rank_tables,
            "bonus_conditions": self.bonus_conditions,
            "bonus_notes": self.bonus_notes,
            "income_matrix": self.income_matrix,
            "asset": self.asset,
            "income_table": self.income_table,
            "selection": self.selection,
            "score_tables": self.score_tables,
            "penalties": self.penalties,
        }


# ── 글자 → 줄 → 칸 ──────────────────────────────────────────


def _meaningful(text: str) -> bool:
    return bool(re.search(r"[0-9A-Za-z가-힣㎡%①②③④⑤→]", text))


def _segments(row: list[Char], gap: float) -> list[Seg]:
    segs: list[Seg] = []
    cur: Seg | None = None
    prev_r: float | None = None
    for c in sorted(row, key=lambda c: c.l):
        if cur is None or (prev_r is not None and c.l - prev_r > gap):
            if not c.ch.strip():
                continue
            cur = Seg(c.l, c.r, c.ch, [c])
            segs.append(cur)
        else:
            cur.text += c.ch
            cur.r = c.r
            cur.chars.append(c)
        prev_r = c.r
    out = []
    for s in segs:
        s.text = re.sub(r"\s+", " ", s.text).strip()
        if s.text and _meaningful(s.text):
            out.append(s)
    return out


def _lines(pages: list[tuple[int, str]], gap: float = 14.0) -> list[Line]:
    out: list[Line] = []
    for page, xml in pages:
        for row in group_rows(parse_chars(xml)):
            y = row_center_y(row)
            if y < HEADER_PX or y > FOOTER_PX:
                continue   # 쪽 머리(「제51차 장기전세주택 입주자모집」)·꼬리(쪽 번호)
            y += page * PAGE_STRIDE   # 문서 전체 y — 쪽이 바뀌면 줄 간격이 크게 벌어져 다른 칸으로 읽힌다
            segs = _segments(row, gap)
            if segs:
                for sg in segs:
                    sg.y = y
                out.append(Line(page, y, segs))
    return out


def _find(lines: list[Line], needle: str, start: int = 0) -> int | None:
    """제목 줄 찾기. 목차(3쪽 「6 동일순위 경쟁시 입주자 선정기준 30」)는 쪽 번호로 끝나므로 건너뛴다."""
    for i in range(start, len(lines)):
        text = lines[i].text()
        # 제목은 줄 머리(「06 |」「➜」「*」 뒤)에 온다. 본문 속 인용(29쪽 「…“6 동일순위 경쟁 시 입주자 선정기준”에 의함」)은 뒤쪽
        if 0 <= _squash(text).find(needle) <= HEADING_LEAD and not re.search(r"\d\s*$", text):
            return i
    return None


def _is_bullet(text: str) -> bool:
    return bool(BULLET_RE.match(text))


def _squash(text: str) -> str:
    return re.sub(r"[\s・·]", "", text)


# ── 표기 정리 ───────────────────────────────────────────────


def _clean(text: str) -> str:
    """Synap이 떨어뜨린 마침표·가운뎃점을 되살리고 화면 표기 규칙(가운뎃점 금지)에 맞춘다."""
    t = text
    t = re.sub(r"(20\d{2})(\d)(\d{2})(?=\s*(?:이후|이전))", r"\1.\2.\3.", t)   # 2023328 이후 → 2023.3.28. 이후
    t = re.sub(r"(?<![\d.])(\d)(\d)순위", r"\1,\2순위", t)                    # 12순위 미해당자 → 1,2순위
    t = re.sub(r"(\d)\s*[・·]\s*(\d)", r"\1,\2", t)                             # 1・2순위 → 1,2순위
    t = t.replace("・", " ").replace("·", " ")
    t = re.sub(r"(?<=[가-힣])(\d+%)", r" \1", t)                               # 월평균소득70% → 월평균소득 70%
    t = re.sub(r"(\d+%)\s*(이하|초과)(?=\d)", r"\1 \2 ", t)                     # 70%초과105%이하
    t = re.sub(r"(\d+%)(이하|초과)", r"\1 \2", t)                                # 70%이하 → 70% 이하
    t = re.sub(r"(\d+㎡)(이하|초과|미만|이상)(?=\d)", r"\1 \2 ", t)             # 85㎡초과102㎡이하 → 85㎡ 초과 102㎡ 이하
    t = re.sub(r"(\d+㎡)(이하|초과|미만|이상)", r"\1 \2", t)                    # 60㎡이하 → 60㎡ 이하
    for a, b in SPACING:
        t = t.replace(a, b)
    t = re.sub(r"^([가-하])\.?\s*(?=당첨자)", r"\1. ", t)                       # 감점표 「가 당첨자…」 → 「가. 당첨자…」
    t = re.sub(r"\s+", " ", t).strip(" ,.")
    return t


# Synap이 지운 띄어쓰기 중 화면에 자주 나오는 것만 되살린다(표 머리말·비고)
SPACING = (
    ("당첨자발표일기준가목및나목이외의장기전세주택임대차계약사실이있는경우", "당첨자 발표일 기준 가목 및 나목 이외의 장기전세주택 임대차계약 사실이 있는 경우"),
    ("배점동일할경우", "배점 동일할 경우"),
    ("미성년자녀수가", "미성년자녀 수가"),
    ("가구원수별가구당", "가구원수별 가구당"),
    ("(청약저축)순위", "(청약저축) 순위"),
    ("(청약예금)순위", "(청약예금) 순위"),
)


def _pct(text: str) -> int | None:
    m = PCT_RE.search(text)
    return int(m.group(1)) if m else None


def _manwon(text: str) -> int | None:
    m = MANWON_RE.match(text.replace(" ", ""))
    return int(m.group(1).replace(",", "")) if m else None


# ── 6~7쪽 소득기준·신청순위 표 ──────────────────────────────


def _merge_area_labels(labels: list[tuple[float, str]]) -> list[tuple[float, str]]:
    """「60㎡초과」(y=700) + 「85㎡이하」(y=717) → (708.5, "60㎡초과 85㎡이하")."""
    out: list[tuple[float, str]] = []
    for y, text in labels:
        if out and y - out[-1][0] <= AREA_MERGE_PX and re.search(r"(초과|이상)$", out[-1][1]) and re.search(r"(이하|미만)$", text):
            py, ptext = out.pop()
            out.append(((py + y) / 2, f"{ptext} {text}"))
        else:
            out.append((y, text))
    return out


def _nearest(y: float, centers: list[float]) -> int:
    return min(range(len(centers)), key=lambda i: abs(centers[i] - y))


def _parse_rank_table(lines: list[Line]) -> dict[str, Any]:
    heading = _clean(lines[0].text().lstrip("○ ").strip())
    body = [ln for ln in lines[1:] if not re.search(r"소득\s*기준$|^신청면적|^\(가구원수별|소득\s*외\s*기준", ln.first())
            and "(가구원수별" not in ln.first()]
    # 우선공급 표 — 순위 없이 계층 헤더(고령자 | 장애인 …)가 있다
    classes: list[str] = []
    for ln in lines[1:]:
        if "우선공급 자격기준" in ln.text():
            continue
        if any(s.l > 330 and s.text in ("고령자", "장애인") for s in ln.segs):
            classes = [_clean(s.text) for s in ln.segs if s.l > 330]
            body = [b for b in body if b is not ln]
            break

    area_lines = [(ln.y, ln.segs[0].text.replace(" ", "")) for ln in body
                  if ln.segs[0].l < AREA_MAX_L and AREA_RE.match(ln.segs[0].text.replace(" ", ""))]
    labels = _merge_area_labels(area_lines)
    centers = [y for y, _ in labels]
    if not centers:
        return {"group": heading, "classes": classes, "rows": []}

    blocks: list[dict[str, list]] = [{"ranks": [], "req": [], "pct": []} for _ in labels]
    for ln in body:
        rank_seg = next((s for s in ln.segs if s.l < RANK_MAX_L and RANK_RE.match(s.text.replace(" ", ""))), None)
        pct_segs = [s for s in ln.segs if s.l < PCT_MAX_L and "%" in s.text]
        req_segs = [s for s in ln.segs if s.l >= REQ_MIN_L]
        if rank_seg is None and not pct_segs and not req_segs:
            continue
        b = blocks[_nearest(ln.y, centers)]
        if rank_seg is not None:
            b["ranks"].append((ln.y, int(RANK_RE.match(rank_seg.text.replace(" ", "")).group(1))))
        for s in pct_segs:
            b["pct"].append((ln.y, s.text))
        if req_segs:
            b["req"].append((ln.y, " ".join(s.text for s in req_segs), rank_seg is not None))

    rows: list[dict[str, Any]] = []
    for (_, area), b in zip(labels, blocks):
        # 소득 칸: 「(맞벌이: n%)」 줄은 바로 위 기본 % 줄과 한 칸
        cells: list[dict[str, Any]] = []
        for y, text in sorted(b["pct"]):
            if "맞벌이" in text and cells and y - cells[-1]["y"] <= PAIR_PX:
                cells[-1]["dual"] = _pct(text)
            elif "맞벌이" in text:
                cells.append({"y": y, "base": None, "dual": _pct(text)})
            else:
                cells.append({"y": y, "base": _pct(text), "dual": None})
        ranks = sorted(b["ranks"])
        if not ranks:
            # 우선공급처럼 순위 없는 표 — 면적 한 줄
            cell = cells[0] if cells else {"base": None, "dual": None}
            rows.append({"area": _clean(area), "rank": None, "income_pct": cell["base"], "dual_income_pct": cell["dual"],
                         "requirement": _clean(" ".join(t for _, t, _ in sorted(b["req"]))) or None})
            continue
        # 소득 외 기준: 순위 줄이 새 묶음을 연다(글이 없는 순위 줄도 — 85㎡초과 1순위). 첫 순위 줄보다 위의 글은 첫 순위 것
        cur = ranks[0][1]
        req_by_rank = {r: [] for _, r in ranks}
        events = sorted([(y, "rank", r) for y, r in ranks] + [(y, "req", t) for y, t, _ in b["req"]])
        for y, kind, val in events:
            if kind == "rank":
                cur = val
            else:
                req_by_rank[cur].append(val)
        for y, r in ranks:
            cell = cells[_nearest(y, [c["y"] for c in cells])] if cells else {"base": None, "dual": None}
            rows.append({"area": _clean(area), "rank": r, "income_pct": cell["base"], "dual_income_pct": cell["dual"],
                         "requirement": _clean(" ".join(req_by_rank[r])) or None})
    return {"group": heading, "classes": classes, "rows": rows}


def parse_rank_tables(lines: list[Line]) -> tuple[list[dict[str, Any]], list[int]]:
    start = _find(lines, _squash(RANK_HEADING))
    if start is None:
        return [], []
    end = _find(lines, _squash(BONUS_HEADING), start + 1) or len(lines)
    span = lines[start + 1:end]
    tables: list[list[Line]] = []
    for ln in span:
        if ln.first().startswith("○"):
            tables.append([ln])
        elif tables:
            tables[-1].append(ln)
    out = [_parse_rank_table(t) for t in tables]
    return [t for t in out if t["rows"]], sorted({ln.page for ln in span})


# ── 7쪽 출생자녀 가산 조건 + 소득 가산 표 ───────────────────


def parse_bonus(lines: list[Line]) -> tuple[list[str], list[str], dict[str, Any] | None]:
    start = _find(lines, _squash(BONUS_HEADING))
    if start is None:
        return [], [], None
    conds: list[str] = []
    notes: list[str] = []
    i = start + 1
    while i < len(lines) and _squash(INCOME_BONUS_HEADING) not in _squash(lines[i].text()):
        t = lines[i].text()
        if ITEM_RE.match(t):
            conds.append(_clean(t))
        elif t.startswith("※") or t.startswith("*"):
            notes.append(_clean(t.lstrip("※* ")))
        i += 1
    matrix = _parse_bonus_matrix(lines, i) if i < len(lines) else None
    return conds, notes, matrix


def _header_columns(ln: Line, names: tuple[str, ...]) -> list[tuple[str, float]]:
    cols: list[tuple[str, float]] = []
    for s in ln.segs:
        key = _squash(s.text)
        for n in names:
            if key.startswith(_squash(n)):
                cols.append((n, s.cx))
                break
    return cols


def _parse_bonus_matrix(lines: list[Line], start: int) -> dict[str, Any] | None:
    names = ("기본", "①에 해당 시", "② ③에 해당 시", "맞벌이")
    cols: list[tuple[str, float]] = []
    rows: list[dict[str, Any]] = []
    area_frags: list[tuple[float, str]] = []
    applicant_frags: list[tuple[float, str]] = []   # 49·50차는 「공사 건설형」/「1・2순위 신청자」가 %줄 위아래 딴 줄
    for ln in lines[start + 1:start + 16]:
        if not cols:
            cols = _header_columns(ln, names)
            if len(cols) >= 3:
                continue
            cols = []
            continue
        pct_segs = [s for s in ln.segs if PCT_RE.fullmatch(s.text.replace(" ", "").rstrip("이하"))
                    or re.fullmatch(r"\d+%", s.text.replace(" ", ""))]
        label_segs = [s for s in ln.segs if s not in pct_segs]
        for s in label_segs:
            key = s.text.replace(" ", "")
            if re.fullmatch(r"\d+㎡(?:이하|초과|미만|이상)?|이하|초과|미만|이상", key):
                area_frags.append((ln.y, key))
            else:
                applicant_frags.append((ln.y, s.text))
        if len(pct_segs) >= 3:
            vals: dict[str, int | None] = {n: None for n, _ in cols}
            centers = [c for _, c in cols]
            for s in pct_segs:
                vals[cols[_nearest(s.cx, centers)][0]] = _pct(s.text)
            rows.append({"y": ln.y, "applicant": "", "pcts": [vals[n] for n, _ in cols]})
        elif rows and not pct_segs and not label_segs:
            break
    if not rows:
        return None
    # 면적 라벨: 조각(「60㎡」+「이하」)을 완성될 때까지 이어 붙이고, y 범위에 드는 줄에 준다
    areas: list[tuple[float, float, str]] = []
    buf: list[tuple[float, str]] = []
    for y, frag in sorted(area_frags):
        buf.append((y, frag))
        joined = "".join(f for _, f in buf)
        if re.fullmatch(r"\d+㎡(?:이하|초과|미만|이상)", joined):
            areas.append((buf[0][0], buf[-1][0], joined))
            buf = []
    for r in rows:
        y = r.pop("y")
        r["applicant"] = _clean(" ".join(t for fy, t in applicant_frags if abs(fy - y) <= LABEL_JOIN_PX))
        hit = next((a for a in areas if a[0] - 12 <= y <= a[1] + 12), None)
        if hit is None and areas:
            hit = min(areas, key=lambda a: min(abs(a[0] - y), abs(a[1] - y)))
        r["area"] = _clean(re.sub(r"㎡", "㎡ ", hit[2])) if hit else None
    return {"columns": [n for n, _ in cols], "rows": [{"area": r["area"], "applicant": r["applicant"], "pcts": r["pcts"]} for r in rows]}


# ── 8쪽 자산 가산 표 ────────────────────────────────────────


def parse_asset(lines: list[Line]) -> dict[str, Any] | None:
    start = _find(lines, _squash(ASSET_BONUS_HEADING))
    if start is None:
        return None
    names = ("기본", "①에 해당 시", "② ③에 해당 시")
    cols: list[tuple[str, float]] = []
    rows: list[dict[str, Any]] = []
    for ln in lines[start + 1:start + 10]:
        if not cols:
            c = _header_columns(ln, names)
            if len(c) >= 3:
                cols = c
            continue
        label = next((s for s in ln.segs if s.text in ("총자산", "자동차")), None)
        if label is None:
            if rows:
                break
            continue
        vals: dict[str, int | None] = {n: None for n, _ in cols}
        centers = [c for _, c in cols]
        for s in ln.segs:
            v = _manwon(s.text)
            if v is not None:
                vals[cols[_nearest(s.cx, centers)][0]] = v
        rows.append({"label": label.text, "values_man": [vals[n] for n, _ in cols]})
    return {"columns": [n for n, _ in cols], "rows": rows} if rows else None


# ── 8쪽 가구원수별 월평균소득 표 ───────────────────────────


def parse_income_table(lines: list[Line]) -> dict[str, Any] | None:
    """% 줄 × 가구원수 열. 글자 하나하나를 가장 가까운 % 줄(y)과 가구원수 열(x)에 넣고 x순으로 잇는다.

    줄 단위로 읽으면 안 되는 이유: 90% 줄은 숫자가 두 줄(t=573·574)로 갈라져 있고, 쉼표는 아예 딴 줄(583)에 찍힌다.
    떨어진 글자는 그대로 빠진 채 읽힌다(「839428」← 8,394,285) — 검산(verify_income_table)이 가려낸다.
    """
    start = _find(lines, _squash(INCOME_TABLE_HEADING))
    if start is None:
        return None
    households: list[tuple[int, float]] = []
    pct_rows: list[tuple[int, float]] = []
    span: list[Line] = []
    for ln in lines[start + 1:start + 60]:
        if not households:
            hh = [(int(HOUSEHOLD_RE.match(s.text.replace(" ", "")).group(1)), s.cx)
                  for s in ln.segs if HOUSEHOLD_RE.match(s.text.replace(" ", ""))]
            if len(hh) >= 3:
                households = hh
            continue
        m = re.fullmatch(r"(\d+)%", ln.segs[0].text.replace(" ", ""))
        if m and ln.segs[0].l < 160:
            pct_rows.append((int(m.group(1)), ln.y))
        elif pct_rows and ln.y - pct_rows[-1][1] > 45:
            break
        span.append(ln)
    if not households or not pct_rows:
        return None
    row_ys = [y for _, y in pct_rows]
    col_xs = [x for _, x in households]
    digits: dict[tuple[int, int], list[tuple[float, str]]] = {}
    for ln in span:
        for sg in ln.segs:
            if sg.l < 160:
                continue   # % 라벨 열
            for c in sg.chars:
                if c.ch not in "0123456789":
                    continue
                ri = _nearest(ln.y, row_ys)
                if abs(row_ys[ri] - ln.y) > 8:
                    continue
                ci = _nearest(c.l + c.w / 2, col_xs)
                digits.setdefault((ri, ci), []).append((c.l, c.ch))
    rows = []
    for ri, (pct, _) in enumerate(pct_rows):
        won: list[int | None] = []
        for ci in range(len(households)):
            ds = sorted(digits.get((ri, ci), []))
            won.append(int("".join(ch for _, ch in ds)) if ds else None)
        rows.append({"pct": pct, "won": won})
    return {"households": [h for h, _ in households], "rows": rows}


def _subsequence(short: str, long: str) -> bool:
    it = iter(long)
    return all(ch in it for ch in short)


def verify_income_table(table: dict[str, Any], base100: dict[int, int]) -> dict[str, Any]:
    """읽힌 칸을 100% 기준액 × %(반올림)와 대조한다.

    공고문 소득표는 통계청 100% 기준액에 비율을 곱해 만든다(70% 1인 2,669,354 = 3,813,363 × 0.7).
    - 같으면 clean. 읽힌 숫자열이 기댓값의 부분열이면(글자가 떨어진 것) hole. 그 밖은 mismatch.
    - mismatch가 없고 clean이 6칸 이상이면 verified — 구멍과 빈칸을 기댓값으로 채운다.
    - 하나라도 어긋나면 손대지 않는다. 틀린 금액을 싣느니 빈칸이 낫다.
    """
    mismatches: list[dict[str, Any]] = []
    clean = holes = 0
    for r in table["rows"]:
        for h, v in zip(table["households"], r["won"]):
            if v is None or h not in base100:
                continue
            expect = int(base100[h] * r["pct"] / 100 + 0.5)
            if expect == v:
                clean += 1
            elif _subsequence(str(v), str(expect)):
                holes += 1
            else:
                mismatches.append({"pct": r["pct"], "household": h, "read": v, "expected": expect})
    verified = clean >= 6 and not mismatches
    rows = []
    for r in table["rows"]:
        won = list(r["won"])
        if verified:
            won = [int(base100[h] * r["pct"] / 100 + 0.5) if h in base100 else v for h, v in zip(table["households"], won)]
        else:
            # 검산 못 한 표는 구멍 난 칸을 비운다 — 「839428」 같은 틀린 숫자를 그대로 내보내지 않는다
            won = [v if (v is not None and h in base100 and int(base100[h] * r["pct"] / 100 + 0.5) == v) else None
                   for h, v in zip(table["households"], won)]
        rows.append({"pct": r["pct"], "won": won})
    return {**table, "rows": rows, "verified": verified, "clean": clean, "holes": holes, "mismatches": mismatches}


# ── 30~31쪽 동일순위 경쟁 시 선정 기준 ──────────────────────


def _split_arrows(seg: Seg) -> list[Seg]:
    """「도시근로자 가구원수별 가구당 →」처럼 화살표가 글에 붙어 한 조각이면 화살표를 떼어 제 x 자리에 둔다.
    안 떼면 이 조각의 x 범위가 아래 줄 「월평균소득 …」과 겹쳐 한 칸으로 묶이고 화살표가 엉뚱한 데서 끊는다."""
    if "→" not in seg.text or seg.text == "→":
        return [seg]
    parts = re.split(r"(→)", seg.text)
    total = sum(len(p) for p in parts) or 1
    width = seg.r - seg.l
    out: list[Seg] = []
    x = seg.l
    for ptext in parts:
        w = width * len(ptext) / total
        if ptext.strip():
            out.append(Seg(x, x + w, ptext.strip(), [], seg.y))
        x += w
    return out


def _cells_by_x(segs: list[Seg]) -> list[str]:
    """x가 겹치는 조각은 한 칸(세로로 흩어진 글). 칸을 x순으로, 칸 안은 y순으로 잇는다."""
    cols: list[list[Seg]] = []
    segs = [p for s in segs for p in _split_arrows(s)]
    for s in sorted(segs, key=lambda s: s.l):
        for col in cols:
            if s.l < max(c.r for c in col) - 4 and s.r > min(c.l for c in col) + 4:
                col.append(s)
                break
        else:
            cols.append([s])
    cols.sort(key=lambda col: min(c.l for c in col))
    return [" ".join(c.text for c in sorted(col, key=lambda c: c.y)) for col in cols]


def _steps(cells: list[str]) -> list[str]:
    text = " ".join(cells)
    parts = [p.strip(" *") for p in re.split(r"→", text)]
    return [_clean(p) for p in parts if _meaningful(p)]


def _parse_selection_table(lines: list[Line]) -> dict[str, Any] | None:
    title = _clean(BULLET_RE.sub("", lines[0].text()).strip())
    header = next((ln for ln in lines[1:] if any(s.text == "비고" for s in ln.segs)), None)
    if header is None:
        return None
    remark_l = next(s.l for s in header.segs if s.text == "비고") - REMARK_PAD
    body = [ln for ln in lines[lines.index(header) + 1:]]

    groups: list[tuple[float, float, str]] = []   # 구분 열의 유형 라벨(병합 칸) — y 범위
    last_frag = ""
    # 면적 라벨이 있는 표(일반공급)만 구분 칸이 여러 행에 걸친다. 우선공급 표는 구분 = 행 라벨이라 줄을 잇지 않는다
    # (50차는 「국가유공자 등」과 「장애인」이 22px 간격 — 병합 칸 조각 간격과 같다)
    has_areas = any(AREA_RE.match(s.text.replace(" ", "")) for ln in body for s in ln.segs if s.l < LABEL_MAX_L)
    remarks: list[tuple[float, str]] = []
    rows_src: list[tuple[float, list[Seg], list[str]]] = []   # (y, 단계 조각, 면적 라벨)
    for ln in body:
        label = [s for s in ln.segs if s.l < LABEL_MAX_L]
        step = [s for s in ln.segs if LABEL_MAX_L <= s.l < remark_l]
        remark = [s for s in ln.segs if s.l >= remark_l]
        for s in remark:
            remarks.append((ln.y, s.text))
        areas = [s.text.replace(" ", "") for s in label if AREA_RE.match(s.text.replace(" ", ""))]
        for s in label:
            if not AREA_RE.match(s.text.replace(" ", "")):
                # 병합 칸 라벨은 짧은 조각이 세로로 이어진다. 우선공급 표의 「국가유공자 등」「장애인」은 행 라벨이라 안 잇는다
                join = GROUP_JOIN_SHORT_PX if len(_squash(last_frag)) <= 4 and len(_squash(s.text)) <= 4 else GROUP_JOIN_PX
                if groups and has_areas and ln.y - groups[-1][1] <= join:
                    y0, _, t = groups.pop()
                    groups.append((y0, ln.y, f"{t} {s.text}"))
                else:
                    groups.append((ln.y, ln.y, s.text))
                last_frag = s.text
        if step or areas:
            rows_src.append((ln.y, step, areas))

    # 줄 사이가 SELECTION_GAP보다 벌어지면 다른 칸
    clusters: list[dict[str, Any]] = []
    for y, step, areas in rows_src:
        if clusters and y - clusters[-1]["y_max"] <= SELECTION_GAP:
            c = clusters[-1]
            c["y_max"] = y
            c["segs"].extend(step)
            c["areas"].extend(areas)
        else:
            clusters.append({"y_min": y, "y_max": y, "segs": list(step), "areas": list(areas)})
    for c in clusters:
        c["y"] = (c["y_min"] + c["y_max"]) / 2

    labeled = [c for c in clusters if c["areas"]]
    if labeled:
        rows_c: list[dict[str, Any]] = [dict(c, segs=list(c["segs"])) for c in labeled]
        for c in clusters:
            if c["areas"]:
                continue
            tgt = rows_c[_nearest(c["y"], [r["y"] for r in rows_c])]
            tgt["segs"].extend(c["segs"])
    else:
        rows_c = clusters

    rows: list[dict[str, Any]] = []
    for c in rows_c:
        segs = sorted(c["segs"], key=lambda s: (s.l, s.y))
        # 세로로 흩어진 한 칸의 글을 잇되, 다른 묶음(위 표의 단계 → 아래 단계)은 y순을 지킨다
        steps = _steps(_cells_by_x_grouped(segs))
        group = _group_for(c["y"], groups, body_top=body[0].y - 10 if body else header.y)
        rows.append({"group": _clean(group) if group else None, "area": _clean(" ".join(c["areas"])) or None, "steps": steps})
    tie = _clean(" ".join(t for _, t in sorted(remarks)))
    return {"title": title, "rows": rows, "tie_break": tie or None}


def _cells_by_x_grouped(segs: list[Seg]) -> list[str]:
    """단계 조각을 y가 크게 벌어지는 곳에서 묶음으로 나눈 뒤 묶음마다 x순 칸으로 편다.
    한 행이 두 국면(70% 이하 → … / 남은 주택 있을 시 70% 초과 → …)일 때 국면 순서를 지키기 위해서다."""
    ordered = sorted(segs, key=lambda s: s.y)
    bunches: list[list[Seg]] = []
    for s in ordered:
        if bunches and s.y - max(x.y for x in bunches[-1]) <= SELECTION_GAP:
            bunches[-1].append(s)
        else:
            bunches.append([s])
    out: list[str] = []
    for b in bunches:
        if out:
            out.append("→")   # 국면 경계 — 「배점합산」 뒤에 화살표 없이 다음 국면이 이어진다
        out.extend(_cells_by_x(b))
    return out


def _group_for(y: float, groups: list[tuple[float, float, str]], *, body_top: float) -> str | None:
    """병합 칸 라벨은 칸 한가운데 놓인다 → 칸 아랫변 = 2 × 라벨 중심 − 칸 윗변. 첫 칸 윗변은 표 몸통 위.
    라벨 사이 중간점으로 가르면 49·50차 「85㎡ 초과」(건설형 마지막 행)가 매입형으로 넘어간다 — 매입형 라벨이 두 줄뿐이라 중심이 높다."""
    if not groups:
        return None
    top = body_top
    for y0, y1, t in groups[:-1]:
        bottom = 2 * (y0 + y1) / 2 - top
        if y < bottom:
            return t
        top = bottom
    return groups[-1][2]


def parse_selection(lines: list[Line]) -> tuple[list[dict[str, Any]], list[int]]:
    start = _find(lines, _squash(SELECTION_HEADING))
    if start is None:
        return [], []
    end = _find(lines, _squash(SCORE_HEADING), start + 1) or len(lines)
    span = lines[start + 1:end]
    tables: list[list[Line]] = []
    for ln in span:
        f = ln.first()
        if _is_bullet(f):
            tables.append([ln])
        elif tables:
            if f.startswith("*") or f.startswith("※"):
                tables.append([])   # 표 아래 각주 — 표 끝
                continue
            if tables[-1]:
                tables[-1].append(ln)
    out = [t for t in (_parse_selection_table(t) for t in tables if t) if t and t["rows"]]
    return out, sorted({ln.page for ln in span})


# ── 31~32쪽 가감점 배점표 ───────────────────────────────────


def _parse_score_block(lines: list[Line], header: Line, points: list[tuple[int, float]]) -> dict[str, Any]:
    centers = [c for _, c in points]
    group_segs: list[tuple[float, str]] = []
    items: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    prev_y: float | None = None
    for ln in lines:
        if ln is header:
            continue
        label = [s for s in ln.segs if SCORE_ITEM_MIN_L <= s.l < SCORE_ITEM_MAX_L]
        has_marker = any(ITEM_RE.match(s.text) for s in label)
        gap = None if prev_y is None else ln.y - prev_y
        if cur is None or (gap is not None and (gap > SCORE_GAP or (has_marker and gap > SCORE_ITEM_GAP))):
            if cur is not None:
                items.append(cur)
            cur = {"label": [], "notes": [], "cells": [[] for _ in points], "note_open": False}
        prev_y = ln.y
        for s in ln.segs:
            if s.l < SCORE_ITEM_MIN_L:
                if s.l >= GROUP_MIN_L:
                    group_segs.append((ln.y, s.text))
                continue
            if s.l < SCORE_ITEM_MAX_L and s.cx < centers[0] - SCORE_COL_HALF:
                _label_or_note(cur, s.text)
                continue
            i = _nearest(s.cx, centers)
            if abs(s.cx - centers[i]) <= SCORE_COL_HALF + 8:
                if _meaningful(s.text) or s.text == "-":
                    cur["cells"][i].append(s.text)
            else:
                _label_or_note(cur, s.text)
    if cur is not None:
        items.append(cur)
    out_items = []
    for it in items:
        if not it["label"]:
            continue
        cells = [_clean(" ".join(c)) if c else "" for c in it["cells"]]
        out_items.append({"label": _clean(" ".join(it["label"])), "cells": cells,
                          "note": _clean(" ".join(it["notes"]).lstrip("※ ")) or None})
    return {"group": _join_groups(group_segs), "points": [p for p, _ in points], "items": out_items}


def _join_groups(segs: list[tuple[float, str]]) -> str | None:
    """구분 열의 세로 병합 칸 — 「일반공급」「(일반)」(17px)은 한 칸, 35px 떨어진 「우선공급」은 다른 칸."""
    groups: list[str] = []
    prev_y: float | None = None
    for y, text in sorted(segs):
        if prev_y is not None and y - prev_y <= 25:
            groups[-1] = groups[-1] + ("" if text.startswith("(") else " ") + text
        else:
            groups.append(text)
        prev_y = y
    return " | ".join(_clean(g) for g in groups) or None


def _label_or_note(cur: dict[str, Any], text: str) -> None:
    """「※ 만30세 미만의 미혼신청자는 무주택기간」 다음 줄의 「점수 없음」은 주석의 뒷부분이지 항목 이름이 아니다."""
    if text.startswith("※"):
        cur["note_open"] = True
        cur["notes"].append(text)
    elif cur["note_open"]:
        cur["notes"].append(text)
    else:
        cur["label"].append(text)


def parse_scores(lines: list[Line]) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[int]]:
    start = _find(lines, _squash(SCORE_HEADING))
    if start is None:
        return [], None, []
    end = next((e for e in (_find(lines, _squash(h), start + 1) for h in SCORE_END_HEADINGS) if e is not None), len(lines))
    span = _relines(lines[start + 1:end], gap=10.0)
    # 표 헤더(5점 4점 …)마다 블록. 블록은 다음 헤더·감점 헤더·「※」 각주에서 끝난다
    blocks: list[list[Line]] = []
    penalty_start: int | None = None
    open_block = False
    for i, ln in enumerate(span):
        pts = [(int(POINT_RE.match(s.text.replace(" ", "")).group(1)), s.cx) for s in ln.segs if POINT_RE.match(s.text.replace(" ", ""))]
        if len(pts) >= 3:
            blocks.append([ln])
            open_block = True
            continue
        if _squash(PENALTY_HEADING) in _squash(ln.text()) and any("감점 점수" in s.text for s in ln.segs):
            penalty_start = i
            break
        if ln.first().startswith("※") and ln.segs[0].r - ln.segs[0].l > SCORE_NOTE_END_W:
            open_block = False   # 표 아래 각주 — 표 끝(칸 안의 짧은 ※ 주석과 폭으로 가른다)
        elif open_block:
            blocks[-1].append(ln)
    tables = []
    for b in blocks:
        header = b[0]
        pts = [(int(POINT_RE.match(s.text.replace(" ", "")).group(1)), s.cx) for s in header.segs if POINT_RE.match(s.text.replace(" ", ""))]
        t = _parse_score_block(b[1:], header, pts)
        if t["items"]:
            tables.append(t)
    penalties = _parse_penalties(span[penalty_start + 1:]) if penalty_start is not None else None
    return tables, penalties, sorted({ln.page for ln in span})


def _parse_penalties(lines: list[Line]) -> dict[str, Any] | None:
    rows: list[dict[str, Any]] = []
    notes: list[str] = []
    pending: list[tuple[float, str]] = []   # 「-n점」보다 먼저 온 라벨 조각(49·50차 「다. … 있는」 / -2점 / 「경우」 세 줄)
    for ln in lines:
        f = ln.first()
        pt = next((s for s in ln.segs if MINUS_POINT_RE.match(s.text.replace(" ", ""))), None)
        label = " ".join(s.text for s in ln.segs if s is not pt and s.l >= SCORE_ITEM_MIN_L)
        if pt is not None:
            parts = [t for y, t in pending if ln.y - y <= LABEL_JOIN_PX] + ([label] if label else [])
            pending = []
            rows.append({"label": _clean(" ".join(parts)), "points": -int(MINUS_POINT_RE.match(pt.text.replace(" ", "")).group(1)), "y": ln.y})
        elif f.startswith("※"):
            notes.append(_clean(ln.text().lstrip("※ ")))
        elif f.startswith(("*", "○")) or _is_bullet(f):
            if rows:
                break
        elif label and ln.segs[0].l >= SCORE_ITEM_MIN_L:
            if notes and rows:
                notes[-1] = _clean(notes[-1] + " " + ln.text())
            elif rows and ln.y - rows[-1]["y"] <= LABEL_JOIN_PX:
                rows[-1]["label"] = _clean(rows[-1]["label"] + " " + label)
            else:
                pending.append((ln.y, label))
    for r in rows:
        r.pop("y")
    return {"rows": rows, "notes": notes} if rows else None


def _relines(lines: list[Line], gap: float) -> list[Line]:
    """같은 줄을 더 좁은 칸 간격으로 다시 나눈다(배점표는 각주와 칸 글 사이가 11px뿐)."""
    out: list[Line] = []
    for ln in lines:
        chars = [c for s in ln.segs for c in s.chars]
        segs = _segments(chars, gap)
        for sg in segs:
            sg.y = ln.y
        out.append(Line(ln.page, ln.y, segs))
    return out


# ── 입구 ────────────────────────────────────────────────────


def parse_eligibility(pages: list[tuple[int, str]]) -> Eligibility | None:
    """공고문 쪽 XML 목록 → 신청자격 묶음. 「소득기준 및 신청순위」 표가 없으면 None(다른 양식)."""
    lines = _lines(pages)
    rank_tables, p1 = parse_rank_tables(lines)
    if not rank_tables:
        return None
    conds, notes, matrix = parse_bonus(lines)
    asset = parse_asset(lines)
    income = parse_income_table(lines)
    selection, p2 = parse_selection(lines)
    scores, penalties, p3 = parse_scores(lines)
    bonus_page = _find(lines, _squash(BONUS_HEADING))
    pages_used = set(p1) | set(p2) | set(p3)
    if bonus_page is not None:
        pages_used.add(lines[bonus_page].page)
    for key in (ASSET_BONUS_HEADING, INCOME_TABLE_HEADING):
        i = _find(lines, _squash(key))
        if i is not None:
            pages_used.add(lines[i].page)
    return Eligibility(
        source_pages=sorted(pages_used),
        rank_tables=rank_tables,
        bonus_conditions=conds,
        bonus_notes=notes,
        income_matrix=matrix,
        asset=asset,
        income_table=income,
        selection=selection,
        score_tables=scores,
        penalties=penalties,
    )
