"""임대주택 유형 어휘 — db/schema.sql `housing_type` enum과 1:1.

소스(마이홈 API·SH 목록)가 각자 쓰는 표기를 이 enum 값으로 맞추는 건 소스별 매핑표(stages/*)의 몫이고,
여기는 enum 값 자체와 그로부터 파생되는 것(slug 코드·sector)만 둔다.
"""

from __future__ import annotations

# enum 값 → URL slug 코드. slug는 불변(CLAUDE.md 하지 말 것 6)이라 코드를 바꾸면 URL이 바뀐다 — 추가만 한다.
HOUSING_TYPES: dict[str, str] = {
    "행복주택": "haengbok",
    "국민임대": "gungmin",
    "매입임대": "maeip",
    "장기전세": "janggi",
    "통합공공임대": "tonghap",
    "전세임대": "jeonse",
    "든든전세": "deundeun",
    "영구임대": "yeonggu",
    "공공지원민간임대": "mingan",
    "50년임대": "50nyeon",
    "10년임대": "10nyeon",
    "6년임대": "6nyeon",
    "5년임대": "5nyeon",
    "공공기숙사": "gisuksa",
    "재개발임대": "jaegaebal",
    "청년안심주택": "cheongnyeon",
}

# 민간 사업자 공급 유형만 민간임대(rental_sector). 청년안심주택 스크래퍼는 소스에서 고정.
PRIVATE_HOUSING_TYPES = frozenset({"공공지원민간임대"})


class UnmappedHousingType(ValueError):
    """enum에 없는 유형. 호출부가 review_queue에 넣고 건너뛴다."""


def slug_code(housing_type: str) -> str:
    return HOUSING_TYPES[housing_type]


def derive_sector(housing_type: str) -> str:
    """공공임대 / 민간임대."""
    return "민간임대" if housing_type in PRIVATE_HOUSING_TYPES else "공공임대"
