"""S5 — 마이홈 단지정보·대기현황 API → complex · complex_type · waitlist · notice.complex_code.

    python -m zipgonggo_pipeline.stages.s5_complex [--dry-run] [--all] [--skip-waitlist] [--page-size N]

**왜 이 스테이지가 필요했나.** 마이홈 API로 들어온 공고 328건은 자식 표가 한 줄도 없었다
(공급현황 0 · 단지 0 · 자격 0). LH는 robots.txt가 첨부 경로(`lhFile.do`)를 막아 S3이 공고문을 못 연다
(docs/data-sources.md 6절). 그래서 그 지면들은 목록 필드만 실은 얇은 지면이었고,
구글 서치콘솔이 「크롤링됨 — 현재 색인이 생성되지 않음」으로 밀어냈다(2026-09-17 실측 12장 중 8장).

첨부를 못 여는 대신 **개방 API 두 개로 단지 쪽 사실을 붙인다.**

| API | 주는 것 | 행 단위 |
|---|---|---|
| 단지정보 15110581 (HWSPR04) | 준공일·세대수·주차·구조·승강기·난방, 형별 면적과 기본 보증금/임대료 | 단지 × 형 |
| 대기현황 15108378 (HWSPR03) | 형별 입주대기자 수·퇴거 건수 | 단지 × 형 × 추첨단위 |

## 호출 계획

단지정보는 **brtcCode·signguCode가 필수**라 시군구마다 한 번씩 부른다. 전국 250여 개를 다 도는 대신
**공고의 PNU가 가리키는 시군구만** 훑는다(기본 78개). PNU 앞 5자리가 법정동코드의 시도+시군구라
코드표 없이 공고에서 바로 얻는다. `--all`을 주면 받은 단지를 전부 적재한다(기본은 공고가 가리키는 PNU만).

대기현황은 brtcCode만 필수라 시도 17회. 역시 우리가 적재한 단지 코드에 해당하는 행만 남긴다.

## 함정

1. **(단지, 유형, 형명)은 유일키가 아니다.** 같은 형이 동·라인마다 전용면적만 조금 다른 행으로 여러 번 온다
   (울산구영1 51형 → 51.79 / 51.84 / 51.92㎡, 금액은 동일). 금액이 같으면 한 줄로 합쳐 면적을 범위로 적고,
   금액이 다르면 실제로 다른 공급 조건이라 줄을 나눈다. 자연키는 0031이 금액까지 넣어 다시 걸었다.
2. **한 PNU에 단지가 여럿이다**(5,900개 중 745개). 공고 유형으로 먼저 좁히고, 그래도 여럿이면
   단지명 유사도로 고른다 — **1등이 2등을 확실히 앞설 때만.** 못 고르면 `notice.complex_code`를
   비워 둔다. 아무거나 고르면 지면에 남의 단지 임대료가 실린다.
3. **1페이지(1000행)를 넘는 시군구가 있다**(창원 의창 1,250행 등). 매입임대가 물건마다 한 단지라 많다.
   iter_pages로 끝까지 받는다.
4. **주차 0은 「주차장 없음」이 아니라 「안 들어옴」인 단지가 많다.** 0은 NULL로 넣는다.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ..config import settings
from ..db import connect
from ..housing import HOUSING_TYPES
from ..normalize import money, nz, parse_date, today_kst
from ..repo import link_notice_complex_codes, upsert_complex_types, upsert_complexes, upsert_waitlist
from ..sources.myhome import COMPLEX_LIST, WAITLIST, MyHomeClient
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s5")

STAGE = "S5"
SOURCE = "myhome_api"


# ── 순수 변환 ─────────────────────────────────────────────────


def sigungu_codes(pnus: list[str]) -> list[tuple[str, str]]:
    """PNU 앞 5자리 = 법정동코드의 시도(2)+시군구(3). 코드표 없이 공고에서 호출 대상을 얻는다."""
    seen = {p[:5] for p in pnus if p and len(p) >= 5 and p[:5].isdigit()}
    return sorted((c[:2], c[2:5]) for c in seen)


def _area(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def _ymd(value: Any) -> date | None:
    s = nz(value)
    return parse_date(s) if s else None


def complex_slug(name: str, code: str) -> str:
    """/complex/{단지명}-{단지코드}. 식별자는 한글 그대로 두고 공백·괄호만 정리한다(docs/url-structure.md)."""
    clean = "".join(ch for ch in (name or "").strip() if ch not in "()[]<>#?&/\\%\"'")
    clean = "-".join(clean.split()) or "단지"
    return f"{clean}-{code}"


def map_complex(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """같은 hsmpSn 행 묶음 → complex 1행.

    제원 네 값(난방·구조·승강기·주차)은 단지 안에서 갈리지 않는다(실측 946단지 전부) — 첫 값을 쓴다.
    세대수만 유형 블록마다 하나씩 다르게 오는 단지가 있어 최대값을 쓴다.
    """
    head = rows[0]
    code = str(head["hsmpSn"])
    name = nz(head.get("hsmpNm")) or code
    types = Counter(nz(r.get("suplyTyNm")) for r in rows if nz(r.get("suplyTyNm")) in HOUSING_TYPES)
    return {
        "slug": complex_slug(name, code),
        "complex_code": code,
        "name": name,
        "agency": nz(head.get("insttNm")) or "미상",
        "housing_type": types.most_common(1)[0][0] if types else None,
        "road_address": nz(head.get("rnAdres")),
        "pnu": nz(head.get("pnu")),
        "sido": nz(head.get("brtcNm")) or "전국",
        "sido_code": nz(head.get("brtcCode")),
        "sigungu": nz(head.get("signguNm")) or "",
        "sigungu_code": nz(head.get("signguCode")),
        "household_cnt": max((int(r.get("hshldCo") or 0) for r in rows), default=0) or None,
        "completed_on": _ymd(head.get("competDe")),
        "heating": nz(head.get("heatMthdDetailNm")),
        "building_style": nz(head.get("buldStleNm")),
        "elevator": nz(head.get("elvtrInstlAtNm")),
        # 0은 「주차장 없음」이 아니라 「안 들어옴」인 단지가 많다
        "parking_cnt": money(head.get("parkngCo"), zero_is_null=True),
        "raw": head,
    }


def map_complex_types(code: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """같은 hsmpSn 행 묶음 → complex_type N행. 자연키는 (유형, 형명, 기본 보증금, 기본 월임대료)."""
    grouped: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        htype = nz(r.get("suplyTyNm"))
        key = (
            htype if htype in HOUSING_TYPES else None,
            nz(r.get("styleNm")) or "",
            money(r.get("bassRentGtn"), zero_is_null=False),
            money(r.get("bassMtRntchrg"), zero_is_null=False),
        )
        grouped[key].append(r)

    out: list[dict[str, Any]] = []
    for (htype, style, deposit, rent), group in grouped.items():
        excl = sorted(a for a in (_area(r.get("suplyPrvuseAr")) for r in group) if a is not None)
        comm = sorted(a for a in (_area(r.get("suplyCmnuseAr")) for r in group) if a is not None)
        out.append({
            "complex_code": code,
            "style_name": style,
            "housing_type": htype,
            "house_type": nz(group[0].get("houseTyNm")),
            "exclusive_area": excl[0] if excl else None,
            "exclusive_area_max": excl[-1] if len(excl) > 1 and excl[-1] != excl[0] else None,
            "common_area": comm[0] if comm else None,
            "common_area_max": comm[-1] if len(comm) > 1 and comm[-1] != comm[0] else None,
            "base_deposit": deposit,
            "base_rent": rent,
            "conversion_deposit_limit": money(group[0].get("bassCnvrsGtnLmt"), zero_is_null=True),
            "row_count": len(group),
            "raw": group[0],
        })
    out.sort(key=lambda t: (t["exclusive_area"] or 0, t["style_name"]))
    return out


def map_waitlist(rows: list[dict[str, Any]], surveyed_on: date) -> list[dict[str, Any]]:
    """대기현황 행 → waitlist 행. 자연키가 겹치는 행은 **합친다.**

    같은 (단지, 유형, 형, 추첨단위)가 대기자 수만 다른 행으로 두세 번 온다(서울 3,778행 중 19키).
    예: 서울가좌 행복주택 16형(사초생) → 대기 8/퇴거 17 과 대기 0/퇴거 44.
    회차가 다른 별개 예비명부인데 **API에 그걸 가릴 필드가 없다**(기준일도 회차번호도 안 준다).

    그래서 지면이 말할 수 있는 건 「이 형을 기다리는 사람이 모두 몇인가」뿐이다 — 합을 싣는다.
    합친 원문은 raw.rows에 그대로 남겨 나중에 회차를 가릴 필드가 생기면 되짚을 수 있게 한다.
    """
    grouped: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        htype = nz(row.get("suplyTyNm"))
        key = (
            str(row["hsmpSn"]),
            htype if htype in HOUSING_TYPES else None,
            nz(row.get("styleNm")) or "",
            nz(row.get("drwtUnit")) or "",
        )
        grouped[key].append(row)

    out: list[dict[str, Any]] = []
    for (code, htype, style, unit), group in grouped.items():
        head = group[0]
        out.append({
            "complex_code": code,
            "agency": nz(head.get("rtsInsttNm")),
            "complex_name": nz(head.get("hsmpNm")),
            "road_address": nz(head.get("rnAdres")),
            "sido": nz(head.get("brtcNm")),
            "sigungu": nz(head.get("signguNm")),
            "housing_type": htype,
            "house_type": nz(head.get("houseTyNm")),
            "style_name": style,
            "draw_unit": unit,
            "waiting_cnt": sum(int(r.get("waitCo") or 0) for r in group),
            "vacated_cnt": sum(int(r.get("trmnatCo") or 0) for r in group),
            "surveyed_on": surveyed_on,
            "raw": {"rows": group},
        })
    return out


@dataclass
class Match:
    """공고 → 단지 좁히기 결과."""
    links: list[tuple[str, str]] = field(default_factory=list)   # (notice slug, complex_code)
    reasons: Counter = field(default_factory=Counter)
    ambiguous: list[str] = field(default_factory=list)


_NAME_NOISE = ("주공", "휴먼시아", "아파트", "단지", "타운", " ")

# 이름으로 고를 때의 문턱 둘. 낮추면 엉뚱한 단지를 집고, 높이면 못 잇는다.
# **틀리게 잇는 쪽이 못 잇는 쪽보다 나쁘다** — 지면에 남의 단지 임대료가 실린다.
NAME_MIN = 0.55        # 1등이 이만큼은 닮아야 한다
NAME_MARGIN = 0.15     # 1등이 2등보다 이만큼 앞서야 한다. 붙으면 사람도 못 고르는 것이다


def _name_key(name: str | None) -> str:
    s = name or ""
    for w in _NAME_NOISE:
        s = s.replace(w, "")
    return s


def _best_by_name(notice_name: str | None, pool: dict[str, list[dict[str, Any]]]) -> str | None:
    """이름이 가장 닮은 단지 하나. 1·2등이 비슷하면 None — 「청주산남2-1」이 그런 자리다.

    공고명 「영구임대주택 (청주산남2-1)」에 단지 후보가 「청주산남2-1 주거복지동」(0.519)과
    「산남주공2-1단지」(0.500) 둘이었다. 부분 문자열 포함으로 고르면 뒤엣것이 이긴다 —
    공고명 안에 「산남2-1」이 들어 있다는 이유만으로. 실제로 어느 쪽인지는 이 이름들로 알 수 없다.
    """
    k = _name_key(notice_name)
    if not k:
        return None
    scored = sorted(
        ((SequenceMatcher(None, k, _name_key(nz(rs[0].get("hsmpNm")))).ratio(), code) for code, rs in pool.items()),
        reverse=True,
    )
    if scored[0][0] < NAME_MIN:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < NAME_MARGIN:
        return None
    return scored[0][1]


# 이름으로 고른 단지가 공고와 세대수가 이만큼 어긋나면 안 잇는다(배수).
# 세대수는 같은 단지라도 곧잘 다르다 — 공고는 단지 전체를, API 행은 그 유형분만 세는 일이 흔하다
# (원주흥업2 990 vs 794, 담양백동2 580 vs 460). 그래서 **엄격한 일치를 요구하면 멀쩡한 연결이 다 날아간다.**
# 대신 자릿수가 다른 수준만 걸러 낸다: 익산부송1단지(1,582세대)에 「익산부송1 증축 주거복지동」(112세대)이
# 이름 점수로 뽑혔던 자리가 그런 곳이다. 후보가 하나뿐일 땐 보지 않는다 — 고를 다른 답이 없다.
HOUSEHOLD_RATIO_MAX = 3.0


def _household_plausible(notice_total: int | None, rows: list[dict[str, Any]]) -> bool:
    got = max((int(r.get("hshldCo") or 0) for r in rows), default=0)
    if not notice_total or not got:
        return True
    lo, hi = min(notice_total, got), max(notice_total, got)
    return hi / lo <= HOUSEHOLD_RATIO_MAX


def match_notices(
    notices: list[tuple[str, str, str, str | None, int | None]],
    complexes: dict[str, list[dict[str, Any]]],
) -> Match:
    """(slug, pnu, housing_type, complex_name, total_household) 목록을 단지 코드에 잇는다.

    PNU만으로는 못 가린다 — 한 필지에 단지가 여럿인 PNU가 12.6%다. 공고 공급유형으로 좁히고,
    그래도 여럿이면 단지명으로 한 번 더 좁힌 뒤 세대수로 제정신인지 본다. 끝내 하나가 아니면 **잇지 않는다.**
    """
    by_pnu: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(dict)
    for code, rows in complexes.items():
        pnu = nz(rows[0].get("pnu"))
        if pnu:
            by_pnu[pnu][code] = rows

    m = Match()
    for slug, pnu, htype, cname, households in notices:
        cands = by_pnu.get(pnu or "")
        if not cands:
            m.reasons["단지_없음"] += 1
            continue
        typed = {c: rs for c, rs in cands.items() if any(nz(r.get("suplyTyNm")) == htype for r in rs)}
        pool = typed or cands
        if len(pool) > 1:
            best = _best_by_name(cname, pool)
            if best and not _household_plausible(households, pool[best]):
                m.reasons["세대수_어긋남"] += 1
                m.ambiguous.append(f"{slug}(세대수)")
                continue
            if best:
                pool = {best: pool[best]}
        if len(pool) != 1:
            m.reasons["후보_여럿"] += 1
            m.ambiguous.append(f"{slug}({len(pool)}곳)")
            continue
        m.links.append((slug, next(iter(pool))))
        m.reasons["연결" if typed else "연결_유형불일치"] += 1
    return m


# ── 실행 ───────────────────────────────────────────────────────


def _fetch_complex_rows(client: MyHomeClient, codes: list[tuple[str, str]], max_pages: int | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i, (brtc, signgu) in enumerate(codes, 1):
        got = 0
        for _, body in client.iter_pages(*COMPLEX_LIST, max_pages=max_pages, brtcCode=brtc, signguCode=signgu):
            rows.extend(body["item"])
            got += len(body["item"])
        log.debug("단지정보 %s%s %d행 (%d/%d)", brtc, signgu, got, i, len(codes))
    return rows


def _fetch_waitlist_rows(client: MyHomeClient, sidos: list[str], max_pages: int | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for brtc in sidos:
        got = 0
        for _, body in client.iter_pages(*WAITLIST, max_pages=max_pages, brtcCode=brtc):
            rows.extend(body["item"])
            got += len(body["item"])
        log.debug("대기현황 %s %d행", brtc, got)
    return rows


def run(*, dry_run: bool, max_pages: int | None, page_size: int, keep_all: bool, skip_waitlist: bool) -> Stats:
    cfg = settings()
    client = MyHomeClient(cfg.data_go_kr_key, delay_sec=cfg.scrape_delay_sec, page_size=page_size)
    started = utc_now()
    stats = Stats()

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT slug, pnu, housing_type::text AS housing_type, complex_name, total_household FROM notice"
                " WHERE pnu IS NOT NULL AND pnu <> '' ORDER BY slug"
            )
            notices = [(r["slug"], r["pnu"], r["housing_type"], r["complex_name"], r["total_household"])
                       for r in cur.fetchall()]
    wanted_pnu = {n[1] for n in notices}
    codes = sigungu_codes([n[1] for n in notices])
    log.info("공고 %d건 · 시군구 %d곳", len(notices), len(codes))

    api_rows = _fetch_complex_rows(client, codes, max_pages)
    stats.fetched_rows = len(api_rows)

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in api_rows:
        if keep_all or nz(r.get("pnu")) in wanted_pnu:
            grouped[str(r["hsmpSn"])].append(r)
        else:
            stats.skip("공고_밖_단지")
    stats.groups = len(grouped)

    complexes = [map_complex(rows) for rows in grouped.values()]
    types = [t for code, rows in grouped.items() for t in map_complex_types(code, rows)]
    matched = match_notices(notices, grouped)
    log.info("단지 %d · 형 %d · 연결 %d %s", len(complexes), len(types), len(matched.links), dict(matched.reasons))

    waits: list[dict[str, Any]] = []
    if not skip_waitlist and grouped:
        sidos = sorted({c["sido_code"] for c in complexes if c["sido_code"]})
        wait_rows = _fetch_waitlist_rows(client, sidos, max_pages)
        today = today_kst()
        mine = [r for r in wait_rows if str(r.get("hsmpSn")) in grouped]
        waits = map_waitlist(mine, today)
        log.info("대기현황 %d행 중 우리 단지 %d행 → %d줄", len(wait_rows), len(mine), len(waits))

    if dry_run:
        stats.updated = len(complexes)
        return stats

    with connect() as conn:
        with conn.cursor() as cur:
            stats.inserted = upsert_complexes(cur, complexes)
            stats.updated = upsert_complex_types(cur, types)
            linked = link_notice_complex_codes(cur, matched.links, [n[0] for n in notices])
            waited = upsert_waitlist(cur, waits) if waits else 0
            finish_ingest(
                cur, stage=STAGE, source=SOURCE, stats=stats, started=started,
                calls=client.call_count, complexes=len(complexes), types=len(types),
                linked=linked, waitlist=waited,
                match=dict(matched.reasons), ambiguous=matched.ambiguous[:20],
            )
        conn.commit()
    log.info("적재 완료 — 단지 %d · 형 %d · 공고 연결 %d · 대기 %d", len(complexes), len(types), linked, waited)
    return stats


def _add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--page-size", type=int, default=1000)
    ap.add_argument("--all", dest="keep_all", action="store_true",
                    help="공고가 안 가리키는 단지까지 전부 적재 (기본은 공고 PNU에 걸린 단지만)")
    ap.add_argument("--skip-waitlist", action="store_true", help="대기현황 API를 부르지 않는다")


def main(argv: list[str] | None = None) -> int:
    return stage_main(
        "S5 마이홈 단지정보·대기현황 수집",
        lambda a: run(dry_run=a.dry_run, max_pages=a.max_pages, page_size=a.page_size,
                      keep_all=a.keep_all, skip_waitlist=a.skip_waitlist),
        add_args=_add_args,
        stage=STAGE, source=SOURCE,
        argv=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
