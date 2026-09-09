"""도로명주소 문자열 → 조회키. 순수 함수 — 네트워크·DB 없음.

공고문에서 온 주소는 표기가 제각각이다. 시도가 빠지고(notice_complex.road_address는 시군구부터),
건물명·동호수가 뒤에 붙고, 괄호로 법정동이 달린다. 여기서 그 껍데기를 벗겨
행안부 요약DB가 쓰는 (도로명, 지하여부, 건물본번, 건물부번) 네 값만 남긴다.

    서울특별시 종로구 자하문로 94              → (서울특별시, 종로구, 자하문로, False, 94, 0)
    강남구 논현로28길 12-3, 101동 501호        → (None, 강남구, 논현로28길, False, 12, 3)
    경기도 수원시 장안구 정조로 940 (영화동)    → (경기도, 수원시 장안구, 정조로, False, 940, 0)
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# 정식 시도명. 요약DB의 시도명 칸 값과 같아야 한다
SIDO = (
    "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시",
    "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도",
    "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도",
)
# 공고문이 흔히 쓰는 축약·구표기 → 정식명
_SIDO_ALIAS = {
    "서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
    "광주": "광주광역시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
    "세종시": "세종특별자치시", "경기": "경기도", "강원": "강원특별자치도", "강원도": "강원특별자치도",
    "충북": "충청북도", "충남": "충청남도", "전북": "전북특별자치도", "전라북도": "전북특별자치도",
    "전남": "전라남도", "경북": "경상북도", "경남": "경상남도", "제주": "제주특별자치도", "제주도": "제주특별자치도",
}
_SIDO_ALIAS.update({s: s for s in SIDO})

# 건물번호 — "94" · "94-3" · "지하94" · "지하 94-3"
_NUM = re.compile(r"^(?P<main>\d{1,5})(?:-(?P<sub>\d{1,5}))?$")
# 도로명은 대로/로/길로 끝난다. 숫자 접미(논현로28길)도 이 안에 들어온다
_ROAD_TAIL = re.compile(r"(?:대로|로|길)\d*(?:번길|번가길)?$")
# 도로명을 띄어 쓴 표기의 뒤 토막 — "인하로 100번길"의 "100번길"
_NUMBERED_TAIL = re.compile(r"^\d{1,4}(?:번길|번가길|길)$")
# 도로명과 건물번호를 붙여 쓴 표기 — "강서로18길121-18". 뒤가 숫자로 끝날 때만 가른다
_GLUED = re.compile(r"^(?P<road>.+?(?:대로|로|길))(?P<num>\d{1,5}(?:-\d{1,5})?)$")
# 지번주소의 법정동 — "시흥동" · "휘경동" · "종로1가" · "월곡리"
_DONG = re.compile(r"^[가-힣]+\d*(?:동|가|리)$")


@dataclass(frozen=True)
class RoadKey:
    """요약DB 조회키. sido·sigungu는 있으면 동명이도로를 가려내는 데 쓴다."""

    road_name: str
    underground: bool
    main_no: int
    sub_no: int
    sido: str | None = None
    sigungu: str | None = None


def normalize_sido(token: str) -> str | None:
    return _SIDO_ALIAS.get(token.strip())


def _is_road_name(token: str) -> bool:
    return bool(_ROAD_TAIL.search(token))


def parse_road_address(text: str | None) -> RoadKey | None:
    """도로명주소 한 줄에서 조회키를 뽑는다. 도로명+건물번호를 못 찾으면 None."""
    if not text:
        return None
    # 괄호 법정동·쉼표 뒤 동호수는 버린다. 전각 하이픈·물결도 맞춘다
    head = re.split(r"[,(（]", text, maxsplit=1)[0]
    head = head.replace("–", "-").replace("—", "-").replace("−", "-")
    tokens = _expand(head.split())
    if len(tokens) < 2:
        return None

    for i in range(1, len(tokens)):
        raw = tokens[i]
        underground = False
        if raw.startswith("지하"):
            underground, raw = True, raw[2:]
        m = _NUM.match(raw)
        if not m:
            continue
        # 바로 앞은 도로명, 또는 "지하"가 따로 떨어진 토큰
        road_idx = i - 1
        if tokens[road_idx] == "지하" and road_idx > 0:
            underground, road_idx = True, road_idx - 1
        if not _is_road_name(tokens[road_idx]):
            continue
        # "인하로 100번길 3"처럼 띄어 쓴 표기는 도로명 한 덩어리로 붙인다
        road_name = tokens[road_idx]
        if _NUMBERED_TAIL.match(road_name) and road_idx > 0 and _is_road_name(tokens[road_idx - 1]):
            road_idx -= 1
            road_name = tokens[road_idx] + road_name
        sido, sigungu = _split_region(tokens[:road_idx])
        return RoadKey(
            road_name=road_name,
            underground=underground,
            main_no=int(m.group("main")),
            sub_no=int(m.group("sub") or 0),
            sido=sido,
            sigungu=sigungu,
        )
    return None


def _expand(tokens: list[str]) -> list[str]:
    """도로명과 건물번호를 붙여 쓴 토큰을 둘로 가른다. SH 공고문에 이 표기가 섞여 온다."""
    out: list[str] = []
    for t in tokens:
        if not t:
            continue
        m = _GLUED.match(t)
        out.extend([m.group("road"), m.group("num")] if m else [t])
    return out


def parse_dong(text: str | None) -> tuple[str | None, str | None, str] | None:
    """지번주소에서 (시도, 시군구, 법정동)만 건진다. 요약DB 출입구정보에는 지번이 없어 동 중심이 마지막 수단이다.

        금천구 시흥동 108-3            → (None, 금천구, 시흥동)
        강남구 일원동 741 래미안…      → (None, 강남구, 일원동)
    """
    if not text:
        return None
    head = re.split(r"[,(（]", text, maxsplit=1)[0]
    tokens = [t for t in head.split() if t]
    for i, t in enumerate(tokens):
        if i and _DONG.match(t) and not _is_road_name(t):
            sido, sigungu = _split_region(tokens[:i])
            if sigungu:
                return sido, sigungu, t
    return None


def _split_region(tokens: list[str]) -> tuple[str | None, str | None]:
    """앞머리 토큰을 시도와 시군구로 가른다. 시군구는 '수원시 장안구'처럼 두 토막일 수 있다."""
    if not tokens:
        return None, None
    sido = normalize_sido(tokens[0])
    rest = tokens[1:] if sido else tokens
    return sido, (" ".join(rest) or None)
