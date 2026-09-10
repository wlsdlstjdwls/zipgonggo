"""Synap 문서뷰어가 떨어뜨린 글자 되메우기.

i-sh 첨부 미리보기(Synap)의 쪽 XML은 **같은 글자가 잇달아 오면 그 중 하나를 아예 안 그린다**.
사라진 자리는 x 좌표에 글자 하나 폭의 구멍으로 남는다 — 그래서 값을 되메울 수 있다.

실측 2026-09-10(특화형 매입임대 309802·309807 공고문):

| 원문 | 화면 XML | 떨어진 자리 |
|---|---|---|
| `33.86` | `3_.86` | 「33」의 둘째 |
| `50,000` | `5000` | 「000」의 가운데 |
| `36,750,000` | `36,750,0_0` | 「0000」의 셋째 |
| `255,000` | `25_,0_0` | 「55」의 둘째 + 「000」의 가운데 |
| `2026.09.11` | `2026.09.1_` | 「11」의 둘째 |

떨어지는 자리는 **같은 글자가 n번 이어지면 n//2번째(0부터)** 하나다 — 위 다섯 줄이 규칙 하나로 다 설명된다.
되메우기는 규칙을 거꾸로 풀지 않는다. 구멍마다 좌·우 이웃을 복제한 후보를 만들고,
**다시 그렸을 때 화면과 똑같아지는 후보가 하나뿐일 때만** 그 값을 쓴다(`repair`).
후보가 둘 이상이면 None — 틀린 숫자를 싣느니 빈칸이 낫다.

구멍 자리는 글자 x 좌표로 찾는다(`holes_by_x`). 쉼표·마침표는 자리 폭이 달라서 앞자리 기준으로 따로 재고,
되메우기는 구분기호를 뗀 숫자열에만 한다(「36,750,000」의 0 넉 줄은 쉼표를 사이에 두고도 한 덩이다).
"""

from __future__ import annotations

HOLE = "_"
SEPARATORS = ".,"
TOL = 0.45          # 자리 폭의 이만큼 안에서만 구멍으로 인정한다


def drop_positions(text: str) -> list[int]:
    """Synap이 떨어뜨릴 글자 자리(0부터). 같은 글자가 n번 이어지면 n//2번째 하나."""
    out: list[int] = []
    i = 0
    while i < len(text):
        j = i
        while j + 1 < len(text) and text[j + 1] == text[i]:
            j += 1
        n = j - i + 1
        if n >= 2:
            out.append(i + n // 2)
        i = j + 1
    return out


def render(text: str) -> str:
    """원문 → Synap 화면 문자열. 떨어진 자리는 HOLE로 남긴다."""
    drop = set(drop_positions(text))
    return "".join(HOLE if k in drop else c for k, c in enumerate(text))


def repair(observed: str) -> str | None:
    """구멍이 든 화면 문자열 → 원문. 후보가 하나로 안 좁혀지면 None.

    구멍에 들어갈 글자는 반드시 이웃과 같다(그래야 떨어진다). 좌·우 후보를 다 넣어 보고
    다시 그린 결과가 화면과 같은 것만 남긴다.
    """
    if HOLE not in observed:
        return observed
    cands = {observed}
    for idx, ch in enumerate(observed):
        if ch != HOLE:
            continue
        nxt: set[str] = set()
        for c in cands:
            for near in (idx - 1, idx + 1):
                if 0 <= near < len(c) and c[near] != HOLE:
                    nxt.add(c[:idx] + c[near] + c[idx + 1:])
        cands = nxt
    hits = {c for c in cands if HOLE not in c and render(c) == observed}
    return next(iter(hits)) if len(hits) == 1 else None


def _steps(seq: list[tuple[float, str]]) -> tuple[float, float]:
    """(글자 자리 폭, 구분기호 자리 폭). 구멍은 간격을 넓히기만 하므로 최솟값이 곧 한 자리 폭이다."""
    digit_gaps = [b[0] - a[0] for a, b in zip(seq, seq[1:]) if a[1] not in SEPARATORS]
    sep_gaps = [b[0] - a[0] for a, b in zip(seq, seq[1:]) if a[1] in SEPARATORS]
    step = min(digit_gaps) if digit_gaps else 0.0
    return step, (min(sep_gaps) if sep_gaps else step / 2)


def holes_by_x(chars: list[tuple[float, str]]) -> str:
    """(x, 글자) 목록 → 구분기호를 뗀 숫자열. 빈 자리는 HOLE로 채운다.

    글자가 둘 이하거나 자리 폭을 못 재면 구멍을 지어내지 않고 그대로 잇는다.
    """
    seq = sorted(chars)
    text = "".join(c for _, c in seq if c not in SEPARATORS)
    if len(seq) < 3:
        return text
    step, sep_step = _steps(seq)
    if step <= 0:
        return text
    out: list[str] = [] if seq[0][1] in SEPARATORS else [seq[0][1]]
    for prev, cur in zip(seq, seq[1:]):
        own = sep_step if prev[1] in SEPARATORS else step
        extra = (cur[0] - prev[0] - own) / step
        n = round(extra)
        if n > 0 and abs(extra - n) <= TOL:
            out.append(HOLE * n)
        if cur[1] not in SEPARATORS:
            out.append(cur[1])
    return "".join(out)


SLACK_PX = 8.0      # 글자 사이 여백. 이보다 벌어지면 글자가 하나 떨어진 자리다(정상 여백은 0~5)


def repair_text(chars: list[tuple[float, float, str]]) -> str:
    """(x, 너비, 글자) 목록 → 떨어진 글자를 되메운 한 줄.

    흐르는 글줄은 글자 폭이 제각각이라 자리 폭 대신 **여백**으로 구멍을 찾는다.
    주소에서도 글자가 떨어진다(「시흥대로88길」 → 화면 「시흥대로8길」, 309807 실측).
    되메우기가 안 되면 구멍을 지우고 보이는 그대로 돌려준다 — 억지로 채우지 않는다.
    """
    seq = [(l, w, ch) for l, w, ch in sorted(chars) if ch != ""]
    out: list[str] = []
    prev: tuple[float, float] | None = None
    for l, w, ch in seq:
        if prev is not None and l - prev[0] - prev[1] > SLACK_PX:
            out.append(HOLE)
        out.append(ch)
        prev = (l, w)
    text = "".join(out)
    if HOLE not in text:
        return text
    return repair(text) or text.replace(HOLE, "")


def read_number(chars: list[tuple[float, str]]) -> int | None:
    """숫자 칸의 글자들 → 정수. 구멍을 못 메우면 None(값을 지어내지 않는다)."""
    text = holes_by_x(chars)
    if not text or any(c not in "0123456789" + HOLE for c in text):
        return None
    fixed = repair(text)
    return int(fixed) if fixed and fixed.isdigit() else None
