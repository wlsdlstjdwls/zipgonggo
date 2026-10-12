"""S3-SH — SH 공고 첨부 공고문에서 공급 단지 표를 읽어 notice_complex 적재.

    python -m zipgonggo_pipeline.stages.s3_sh_complex [--dry-run] [--limit N] [--slug SLUG]

--cached를 주면 네트워크를 아예 쓰지 않고 pipeline/data/ish/{seq}/ 에 이미 받아 둔 쪽 XML만 다시 읽는다.
파서를 고친 뒤 되돌려 넣을 때 쓴다 — 게시판 본문 마크업이 바뀌어 첨부 링크를 못 찾는 공고도 캐시로는 살아 있다(실측 2026-09-09).

대상: source가 'sh_scrape'·'ish_247'이고 원문이 i-sh.co.kr인 공고(m_241 백필분은 아직 안 태운다). 첨부 미리보기(Synap 뷰어)의 쪽 XML을 1초 간격으로 받고
「주택 위치 안내」 표(단지명·소재지)를 파싱한다. 받은 XML은 pipeline/data/ish/{seq}/ 에 캐시(커밋 금지).
표가 없는 공고(매입임대 등 다른 양식)는 0건으로 기록만 남긴다 — 양식별 파서는 이후 추가.

단지 표와 별개로 공고 단위 사실도 채운다: 「입주자 모집 절차 및 일정」 흐름도의 접수 시작·마감·당첨자 발표,
「공급현황」 표의 전세금 최소·최대와 총 호수. SH 목록에는 이 값들이 없어 상세 페이지가 비어 있었다(2026-09-08).
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import timedelta
from pathlib import Path

from ..config import PIPELINE_ROOT, settings
from ..db import connect
from ..parsers.sh_attach import merge_teukhwa, parse_attachment, teukhwa_facts
from ..parsers.sh_eligibility import parse_eligibility, verify_income_table
from ..parsers.sh_house_list import HouseList, parse_house_list, parse_house_xlsx
from ..parsers.sh_location import HOUSE_DOC_RE, parse_filename_jibun, parse_house_docs, parse_locations
from ..parsers.sh_schedule import parse_schedule
from ..repo import (
    income_base100, income_years, replace_notice_complexes, replace_notice_supply, replace_units, update_notice_attach_facts,
    upsert_notice_eligibility,
)
from ..sources.ish import IshClient, find_attachments, find_downloads, is_missing_page
from ..sources.ish_board import BOARDS, IshBoardClient, find_seq_by_title
from .common import Stats, finish_ingest, stage_main, utc_now

log = logging.getLogger("s3.sh")


def steps_json(sch) -> str | None:
    """흐름도 단계를 notice.schedule_steps(jsonb)에 넣을 문자열로. 단계가 없으면 None(기존 값 유지)."""
    if not sch or not sch.steps:
        return None
    return json.dumps(
        [{"label": s.label, "start": s.start.isoformat(), "end": s.end.isoformat() if s.end else None,
          "start_time": s.start_time, "end_time": s.end_time}
         for s in sch.steps],
        ensure_ascii=False,
    )

STAGE = "S3"
SOURCE = "sh_attach"
CACHE_ROOT = PIPELINE_ROOT / "data" / "ish"
SEQ_RE = re.compile(r"[?&]seq=(\d+)")

# source 제한은 「무더기로 훑을 때」만이다. 게시판 백필분(`ish_board`, 2003년까지 449건)까지
# 자동으로 파싱하면 남의 서버를 며칠 두드리게 된다. 다만 slug을 콕 집어 주면 그건 사람이
# 고른 것이므로 source를 가리지 않는다 — 순찰이 m_241에서 주워 온 신규분이 여기로 온다.
SELECT_SQL = """
SELECT id, slug, title, source_url, posted_at, housing_type::text AS housing_type FROM notice
WHERE source_url LIKE '%%i-sh.co.kr%%'
  AND (%(slug)s::text IS NOT NULL OR source IN ('sh_scrape', 'ish_247'))
  AND (%(slug)s::text IS NULL OR slug = %(slug)s)
ORDER BY posted_at DESC, id DESC
LIMIT %(limit)s
"""


# 주소가 공고문이 아니라 별도 첨부에만 있는 양식(신혼·신생아, 청년 매입임대). 요약판은 주소가 없어 상세판을 고른다
HOUSE_LIST_RE = re.compile(r"주택목록|주택안내")


# 공급현황 파서(sh_supply, 장기전세 표용)를 믿지 않는 유형. 공고문에서 단지를 못 찾은 공고에만 해당한다
SUPPLY_TABLE_UNTRUSTED = {"공공기숙사"}


def _sane_schedule(sch, pages, posted, slug):
    """접수일이 공고일보다 앞서면 연도를 잘못 푼 것이다 — 연도 없는 날짜(「115(목)」)를 공고 연도로 읽어서다.
    연말 공고(299475, 2025-12-30)는 접수가 이듬해 1월이라 한 해 뒤로 다시 읽는다. 그래도 앞서면 일정을 버린다
    (310258은 2026-09-17 공고에 접수 2026-01-01이 들어가 있었다). 틀린 날짜보다 빈칸이 낫다."""
    if sch is None or posted is None:
        return sch
    first = sch.apply_start or sch.apply_end
    if first is None or first >= posted - timedelta(days=3):
        return sch
    again = parse_schedule(pages, posted.year + 1)
    again_first = again and (again.apply_start or again.apply_end)
    if again_first and again_first >= posted - timedelta(days=3):
        log.info("%s 일정 연도를 한 해 뒤로 다시 읽음: %s → %s", slug, first, again_first)
        return again
    log.warning("%s 접수일 %s가 공고일 %s보다 앞서 일정을 버린다", slug, first, posted)
    return None


def _xlsx_house_list(client, html: str, seq: str, cached: bool) -> HouseList | None:
    """엑셀 주택목록. 받은 파일은 data/ish/{seq}/list.xlsx.bin — 사내 DRM이 .xlsx를 몇 분 뒤 암호화해서 확장자를 바꿔 둔다."""
    path = CACHE_ROOT / seq / "list.xlsx.bin"
    if cached:
        return parse_house_xlsx(path.read_bytes()) if path.is_file() else None
    dl = next(((n, u) for n, u in find_downloads(html)
               if HOUSE_LIST_RE.search(n) and n.lower().endswith((".xlsx", ".xls"))), None)
    if dl is None:
        return None
    data = client.download(dl[1])
    if not data.startswith(b"PK"):
        log.warning("%s 엑셀 목록이 zip이 아니다(%d바이트) — 건너뛴다", seq, len(data))
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return parse_house_xlsx(data)


def _house_docs(client, atts, seq: str, cached: bool) -> list[tuple[str, list]]:
    """집별 첨부를 받아 (첨부 이름, 쪽들)로. 이름은 다시 읽을 때(--cached) 쓰도록 docs.json에 남긴다."""
    root = CACHE_ROOT / seq
    index_file = root / "docs.json"
    if cached:
        index = json.loads(index_file.read_text(encoding="utf-8")) if index_file.is_file() else {}
        return [(name, list(iter_cached_pages(root / d))) for d, name in index.items() if (root / d).is_dir()]
    out, index = [], {}
    for k, att in enumerate(atts):
        if not HOUSE_DOC_RE.search(att.name) or not att.name.lower().endswith(".pdf"):
            continue
        doc = client.resolve_preview(att.preview_url)
        if doc is None:
            continue
        d = f"doc{k}"
        out.append((att.name, list(client.iter_pages(doc, cache_dir=root / d))))
        index[d] = att.name
    if index:
        root.mkdir(parents=True, exist_ok=True)
        index_file.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    return out


def _cached_doc_names(seq: str) -> list[str]:
    f = CACHE_ROOT / seq / "attachments.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else []


def pick_house_list(atts):
    cands = [a for a in atts if HOUSE_LIST_RE.search(a.name) and a.name.lower().endswith(".pdf") and "요약" not in a.name]
    cands.sort(key=lambda a: "상세" not in a.name)
    return cands[0] if cands else None


def rank_attachments(atts) -> list:
    """읽을 순서대로 첨부. 이름에 '공고'가 든 PDF가 먼저다.

    특화형 매입임대는 **첨부 하나가 주택 한 채**라 여러 개를 다 읽어야 한다(309807은 두 채, 2026-09-10).
    """
    pdfs = [a for a in atts if a.name.lower().endswith(".pdf")]
    ranked = [a for a in pdfs if "공고" in a.name] + [a for a in pdfs if "공고" not in a.name]
    return ranked or list(atts)



def _supply_row(l) -> dict:
    """SupplyLine → notice_supply 컬럼. 「29S」의 S는 주거약자용 표시라 따로 뽑는다."""
    return {
        "complex_name": l.complex_name,
        "supply_type": l.supply_type,
        "accessible": l.supply_type[-1:].upper() == "S",
        "tenant_class": l.tenant_class,
        "income_option": l.income_option,
        "is_new": l.is_new,
        "units_total": l.units_total,
        "units_priority": l.units_priority,
        "units_general": l.units_general,
        "units_reserve": l.units_reserve,
        "deposit": l.deposit,
        "down_payment": l.down_payment,
        "balance": l.balance,
        "rent": l.rent,
        "area_exclusive": l.area_exclusive,
        "area_common": l.area_common,
        "area_etc": l.area_etc,
        "area_total": l.area_total,
        "move_in_from": l.move_in_from,
        "source_page": l.page,
    }


def _jeonse_row(l) -> dict:
    """JeonseLine → notice_supply 컬럼. 장기전세에는 계층 열이 없어 공급대상은 「일반공급」 한 가지다.

    재공급 표에는 「유형」 열(일반·주거약자)이 있다. 계층이 아니라 주택의 성격이라 tenant_class가 아니라
    accessible로 접고, 유형 코드에는 행복주택 양식과 같은 S를 붙인다("59"·"59S") —
    안 붙이면 같은 면적의 일반/주거약자 두 줄이 (공고, 단지, 유형, 계층) 유일키에서 겹쳐 한 줄이 사라진다.
    """
    accessible = bool(l.kind and "주거약자" in l.kind.replace(" ", ""))
    return {
        "complex_name": l.complex_name,
        "supply_type": f"{l.area_type}S" if accessible else l.area_type,
        "accessible": accessible,
        "tenant_class": "일반공급",
        "income_option": None,
        "is_new": l.is_new,
        "units_total": l.units_total,
        "units_priority": l.units_priority,
        "units_general": l.units_general,
        # 재공급은 전원 예비입주자 모집이다("재공급단지는 모두 예비입주자로 모집합니다", 공고문 15·17쪽)
        "units_reserve": None if l.is_new else l.units_total,
        "deposit": l.deposit,
        "down_payment": l.down_payment,
        "balance": l.balance,
        "rent": None,
        "area_exclusive": l.area_exclusive,
        "area_common": l.area_common,
        "area_etc": l.area_etc,
        "area_total": l.area_total,
        "move_in_from": l.move_in_from,
        "source_page": l.page,
    }


def _teukhwa_supply_row(h, tenant_class: str) -> dict:
    """특화형 주택 한 채 → notice_supply 한 줄. 공급유형 코드는 다른 양식과 같이 전용면적 반올림이다."""
    return {
        "complex_name": h.name,
        "supply_type": str(round(h.area_exclusive)) if h.area_exclusive else "0",
        "accessible": False,
        "tenant_class": tenant_class,
        "income_option": None,
        "is_new": True,
        "units_total": h.units,
        "units_priority": None,
        "units_general": h.units,
        "units_reserve": None,
        "deposit": h.deposit,
        # 계약금 10%는 공고문 본문에만 있다("②계약금(보증금10%)필수지참", 4쪽) — 표에 없는 값은 만들지 않는다
        "down_payment": None,
        "balance": None,
        "rent": h.rent,
        "area_exclusive": h.area_exclusive,
        "area_common": h.area_common,
        "area_etc": None,
        "area_total": h.area_total,
        "move_in_from": h.move_in.isoformat() if h.move_in else None,
        "source_page": h.page,
    }


def _teukhwa_unit_rows(houses) -> list[dict]:
    """특화형 주택 → unit 행. 이 양식은 공고 한 건이 호실 한 채라 별첨 목록 없이 여기서 만든다.

    unit은 면적·보증금·임대료가 NOT NULL이다 — Synap 유실로 못 읽은 채는 호실 페이지를 만들지 않는다.
    """
    rows = []
    for h in houses:
        if h.area_exclusive is None or h.deposit is None or h.rent is None:
            log.warning("특화형 %s: 면적·금액이 비어 호실 행을 건너뛴다", h.address)
            continue
        rows.append({
            "complex_code": h.road_address,   # 단지 행과 같은 열쇠 — replace_units가 이걸로 이어 붙인다
            "unit_key": h.room,
            "road_address": h.road_address,
            "complex_name": h.name,
            "building": None,
            "room": h.room,
            "floor": _floor(h.room.replace("호", "")),
            "sido": h.sido,
            "sigungu": h.sigungu,
            "area_m2": h.area_exclusive,
            "deposit": h.deposit,
            "rent": h.rent,
            "deposit_jeonse": None,
            "rent_jeonse": None,
            "deposit_wolse": None,
            "rent_wolse": None,
            "room_layout": h.room_layout,
            "elevator": None,
            "has_elevator": None,
            "seq": None,
            "source_page": h.page,
        })
    return rows


_FLOOR_RE = re.compile(r"^(\d{1,2})\d{2}$")


def _floor(ho: str) -> int | None:
    """호 표기에서 층수. 「0201」→2층, 「1103」→11층. 규칙에 안 맞으면 지어내지 않는다."""
    m = _FLOOR_RE.match(ho)
    if not m:
        return None
    n = int(m.group(1))
    return n if 1 <= n <= 99 else None


# 별첨의 금액 6칸이 한 칸으로 붙어 오면 자릿수가 통째로 이어져 bigint를 넘긴다(실측 2026-09-09: "bigint out of range").
# 임대보증금 상한을 1000억으로 잡고 그 위는 못 읽은 값으로 버린다 — 틀린 숫자를 싣느니 빈칸이 낫다.
MONEY_MAX = 100_000_000_000


def _money(v: int | None) -> int | None:
    return v if v is not None and 0 <= v <= MONEY_MAX else None


def _layout(v: str | None) -> str | None:
    """구조 칸 정리 — 앞에 면적 숫자가 새어 들어오고("66 투룸") 띄어쓰기가 들쭉날쭉하다("분리형 원룸")."""
    if not v:
        return None
    t = re.sub(r"^[\d.,\s]+", "", v)
    t = re.sub(r"\s+", "", t)
    return t or None


def _unit_rows(units) -> list[dict]:
    """호실 목록 → unit 행. unit_key는 공고 안에서만 유일하면 된다.

    「단지코드-동-호」로 잡되, 그래도 겹치는 줄이 남는다(동이 표에 없는 다세대주택에서 같은 호가 두 번 나온다) —
    겹치는 키에만 별첨 연번을 붙인다. 조용히 사라지는 줄이 없어야 한다(실측 2026-09-09: 464건 중 105건이 묻혔다).
    """
    rows = [_unit_row(u) for u in units]
    seen: dict[str, int] = {}
    for r in rows:
        seen[r["unit_key"]] = seen.get(r["unit_key"], 0) + 1
    for r in rows:
        if seen[r["unit_key"]] > 1:
            r["unit_key"] = f"{r['unit_key']}-{r['seq']}"
    return rows


def _unit_row(u) -> dict:
    """UnitRow → unit 컬럼. 승강기는 원문 표기를 남기고 「미설치」만 False로 접는다."""
    return {
        "complex_code": u.code,
        "unit_key": "-".join(x for x in (u.code, u.dong, u.ho) if x),
        "road_address": u.road_address,
        "complex_name": u.building,
        "building": u.dong,
        "room": u.ho,
        "floor": _floor(u.ho),
        "sido": u.sido,
        "sigungu": u.sigungu,
        "area_m2": u.area,
        "deposit": _money(u.deposit),
        "rent": _money(u.rent),
        "deposit_jeonse": _money(u.deposit_jeonse),
        "rent_jeonse": _money(u.rent_jeonse),
        "deposit_wolse": _money(u.deposit_wolse),
        "rent_wolse": _money(u.rent_wolse),
        "room_layout": _layout(u.structure),
        "elevator": u.elevator,
        "has_elevator": None if u.elevator is None else u.elevator != "미설치",
        "seq": u.seq,
        "source_page": u.page,
    }


CACHE_PAGE_RE = re.compile(r"^(?P<fn>.+)_(?P<page>\d+)\.xml$")


def iter_cached_pages(seq_dir: Path):
    """받아 둔 쪽 XML을 쪽번호 순으로. 네트워크를 쓰지 않는다."""
    pages: list[tuple[int, Path]] = []
    for f in seq_dir.glob("*.xml"):
        m = CACHE_PAGE_RE.match(f.name)
        if m:
            pages.append((int(m.group("page")), f))
    for page, f in sorted(pages):
        yield page, f.read_text(encoding="utf-8")


def _recover_url(cur, notice, *, dry_run: bool) -> tuple[str, str] | None:
    """어긋난 i-sh seq를 제목으로 되찾아 notice.source_url까지 고친다. 돌려주는 값은 (URL, seq).

    고쳐 두지 않으면 다음 실행에서 또 게시판을 뒤진다(요청 낭비). 화면의 「원문 보기」 링크도 죽어 있다.
    두 게시판을 차례로 본다 — 매입임대 일부는 m_247에만 있다(sources.ish_board 참고).
    """
    for key in ("241", "247"):
        board = BOARDS[key]
        client = IshBoardClient(board=board, delay_sec=settings().scrape_delay_sec)
        seq = find_seq_by_title(client, notice["title"])
        if seq is None:
            continue
        url = board.view_url.format(seq=seq)
        if not dry_run:
            cur.execute("UPDATE notice SET source_url = %s WHERE id = %s", (url, notice["id"]))
        log.info("%s source_url 고침 → %s", notice["slug"], url)
        return url, seq
    return None


def run(*, dry_run: bool, limit: int, slug: str | None, cached: bool = False) -> Stats:
    cfg = settings()
    client = IshClient(delay_sec=cfg.scrape_delay_sec)
    started = utc_now()
    stats = Stats()

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(SELECT_SQL, {"slug": slug, "limit": limit})
            notices = cur.fetchall()
            stats.fetched_rows = len(notices)
            for n in notices:
                seq_m = SEQ_RE.search(n["source_url"])
                if not seq_m:
                    stats.skip("no_seq")
                    continue
                seq = seq_m.group(1)
                try:
                    if cached:
                        seq_dir = CACHE_ROOT / seq
                        pages = list(iter_cached_pages(seq_dir)) if seq_dir.is_dir() else []
                        if not pages:
                            stats.skip("no_cache")
                            continue
                        att_name = "(캐시)"
                        extras = [list(iter_cached_pages(d)) for d in sorted(seq_dir.glob("att*")) if d.is_dir()]
                    else:
                        url = n["source_url"]
                        html = client.fetch_notice_html(url)
                        if is_missing_page(html):
                            # 포털이 준 seq가 정정공고 때문에 어긋났다. 제목으로 게시판을 뒤져 되찾는다
                            found = _recover_url(cur, n, dry_run=dry_run)
                            if found is None:
                                stats.skip("seq_not_found")
                                continue
                            url, seq = found
                            html = client.fetch_notice_html(url)
                        atts = rank_attachments(find_attachments(html))
                        if atts:
                            (CACHE_ROOT / seq).mkdir(parents=True, exist_ok=True)
                            (CACHE_ROOT / seq / "attachments.json").write_text(
                                json.dumps([a.name for a in atts], ensure_ascii=False), encoding="utf-8")
                        if not atts:
                            stats.skip("no_attachment")
                            log.info("%s 첨부 없음", n["slug"])
                            continue
                        doc = client.resolve_preview(atts[0].preview_url)
                        if doc is None:
                            stats.skip("preview_unresolved")
                            continue
                        att_name = atts[0].name
                        pages = list(client.iter_pages(doc, cache_dir=CACHE_ROOT / seq))
                        extras = []
                    facts = parse_attachment(pages, ref_year=n["posted_at"].year if n["posted_at"] else None)
                    # 신청자격 묶음(장기전세·행복주택·매입임대 양식. 셋 다 아니면 None). 단지 표와 별개라
                    # 파서가 깨져도 단지 적재는 살린다
                    elig = None
                    try:
                        elig = parse_eligibility(pages)
                    except Exception as exc:  # noqa: BLE001
                        log.warning("%s eligibility parse failed: %s", n["slug"], exc)
                    # 특화형은 첨부 하나가 주택 한 채다 — 나머지 첨부까지 읽어 한 공고로 합친다.
                    # 다른 양식은 첨부 하나가 공고문 전체라 첫 첨부만 읽는다(요청 수를 늘리지 않는다)
                    if facts.kind == "teukhwa":
                        if not cached:
                            for k, att in enumerate(atts[1:], 2):
                                doc = client.resolve_preview(att.preview_url)
                                if doc is None:
                                    continue
                                extras.append(list(client.iter_pages(doc, cache_dir=CACHE_ROOT / seq / f"att{k}")))
                        for extra in extras:
                            more = teukhwa_facts(extra)
                            if more is not None:
                                facts = merge_teukhwa(facts, more)
                    # 공고문에 단지가 없으면 별도 첨부 「주택목록」을 읽는다(신혼·신생아 매입임대 310650, 2026-10-12).
                    # 공고문에 이미 단지 표가 있는 양식은 요청을 늘리지 않는다
                    house: HouseList | None = None
                    if not facts.complexes and facts.kind != "teukhwa":
                        list_pages: list = []
                        if cached:
                            list_dir = CACHE_ROOT / seq / "list"
                            list_pages = list(iter_cached_pages(list_dir)) if list_dir.is_dir() else []
                        else:
                            att = pick_house_list(atts)
                            doc = client.resolve_preview(att.preview_url) if att else None
                            if doc is not None:
                                list_pages = list(client.iter_pages(doc, cache_dir=CACHE_ROOT / seq / "list"))
                        house = parse_house_list(list_pages) if list_pages else None
                        # PDF 목록이 없으면 엑셀 목록(미리보기가 안 돼 원본을 받는다, 290219)
                        if not (house and house.complexes):
                            house = _xlsx_house_list(client, html if not cached else "", seq, cached) or house
                        # 목록 첨부가 없으면 공고문 본문의 호실 목록(미리내집 293061 48쪽~)을 같은 파서로 읽는다
                        if not (house and house.complexes) and n["housing_type"] == "매입임대":
                            house = parse_house_list(pages)
                        if house and house.complexes:
                            facts.kind = "house_list"
                            facts.complexes = house.complexes
                            # 금액 칸 없는 목록(장기미임대)은 호수만 준다 — 공고문에서 읽은 금액은 살린다
                            facts.totals = {**facts.totals, **{k: v for k, v in house.totals.items() if v is not None}}
                        else:
                            house = None
                        # 그래도 단지가 없으면 공고문 본문의 위치(대상주택 표, 단지/소재지 표, 「위치」 줄)를 읽는다.
                        # 잔여세대·협동조합·자립준비청년 공고의 지도가 여기서 생긴다(2026-10-12)
                        # 검증한 건 매입임대 공고 34건뿐이라 다른 유형엔 걸지 않는다
                        if not facts.complexes and n["housing_type"] == "매입임대":
                            locs = parse_locations(pages, n["title"])
                            if not locs:
                                # 집마다 따로 붙은 첨부(공공한옥 주택현황, 위국헌신 팸플릿, 다자녀 주택안내)
                                docs = _house_docs(client, atts if not cached else [], seq, cached)
                                locs = parse_house_docs(docs, n["title"])
                            if not locs:
                                # 두레주택: 주소가 평면도 첨부 이름에만 지번으로 있다
                                names = [a.name for a in atts] if not cached else _cached_doc_names(seq)
                                locs = parse_filename_jibun(names, pages, n["title"])
                            if locs:
                                facts.kind = "location"
                                facts.complexes = locs
                    kind, rows, units = facts.kind, facts.complexes, facts.units
                    supply_rows = [_supply_row(l) for l in facts.supply_lines] + [_jeonse_row(l) for l in facts.jeonse_lines]
                    if facts.kind == "teukhwa":
                        supply_rows = [_teukhwa_supply_row(h, facts.tenant_class) for h in facts.teukhwa_houses]
                        units = []   # unit 행은 별첨 주택목록(UnitRow)이 아니라 아래에서 따로 만든다
                except Exception as exc:  # noqa: BLE001
                    stats.error("fetch_error", n["slug"], exc)
                    continue
                stats.groups += 1
                sch, sup = facts.schedule, facts.supply
                if facts.kind == "none" and sup is not None and n["housing_type"] in SUPPLY_TABLE_UNTRUSTED:
                    # 공급현황 파서(장기전세 표용)가 기숙사 호실 별첨을 읽으면 109만 원을 1억 900만 원, 31호를 5,938호로 낸다
                    # (310258, 2026-10-12). 이 유형에선 공고 단위 금액과 호수를 싣지 않는다
                    log.warning("%s %s 공급현황 요약을 버린다(%s~%s, %s호)", n["slug"], n["housing_type"],
                                sup.min_deposit, sup.max_deposit, sup.unit_total)
                    sup = facts.supply = None
                    facts.totals = {}
                sch = _sane_schedule(sch, pages, n["posted_at"], n["slug"]) if facts.kind != "teukhwa" else sch
                log.info(
                    "%s: %d쪽 · %s · 단지 %d건 · 호실 %d건 · 공급 %d건 · 자격 %s · 일정 %s · 전세금 %s (%s)",
                    n["slug"], len(pages), kind, len(rows), len(house.units) if house else len(units), len(supply_rows),
                    (f"{elig.kind} {len(elig.class_blocks)}계층" if elig.class_blocks
                     else f"{elig.kind} {len(elig.rank_tables)}표/{len(elig.selection)}선정/{len(elig.score_tables)}배점") if elig else "없음",
                    f"{sch.apply_start}~{sch.apply_end}" if sch else "없음",
                    f"{sup.min_deposit}~{sup.max_deposit}({sup.unit_total}호)" if sup else "없음",
                    att_name,
                )
                if sch:
                    stats.skip("schedule")
                if sup:
                    stats.skip("supply")
                if supply_rows:
                    stats.skip("supply_lines")
                if elig is not None:
                    stats.skip("eligibility")
                if not rows and not sch and not sup and not supply_rows and elig is None:
                    stats.skip("no_table")
                    continue
                stats.skip(f"kind:{kind}")
                if dry_run:
                    stats.updated += 1
                    continue
                cur.execute("SAVEPOINT nc")
                try:
                    if rows:
                        replace_notice_complexes(cur, n["id"], rows)
                        stats.inserted += len(rows)
                    # 호실 행은 단지 행 다음에 — notice_complex_id를 단지코드로 찾는다.
                    # 파서는 예전부터 읽고 있었는데 적재를 안 해 unit이 0건이었다(실측 2026-09-09)
                    if units:
                        replace_units(cur, n["id"], _unit_rows(units))
                    elif facts.kind == "teukhwa":
                        replace_units(cur, n["id"], _teukhwa_unit_rows(facts.teukhwa_houses))
                    elif house is not None:
                        replace_units(cur, n["id"], house.units)
                    # 공급현황 줄은 단지 행 다음에 넣는다 — complex_id를 같은 공고의 단지에서 이름으로 찾는다
                    replace_notice_supply(cur, n["id"], supply_rows)
                    update_notice_attach_facts(
                        cur, n["id"],
                        apply_start_at=sch.apply_start if sch else None,
                        apply_start_tm=sch.apply_start_time if sch else None,
                        apply_end_tm=sch.apply_end_time if sch else None,
                        apply_end_at=sch.apply_end if sch else None,
                        announce_at=sch.announce if sch else None,
                        schedule_steps=steps_json(sch),
                        **facts.totals,
                    )
                    if elig is not None:
                        # 소득표는 100% 기준액으로 검산한 뒤에만 금액을 싣는다(Synap 글자 유실)
                        verified = False
                        if elig.income_table is not None:
                            # 공고는 「통계청 발표 전년도」 값을 쓴다 — 2026년 공고는 2025년 통계. 연초 공고는 그 전 해일 수 있어
                            # 한 해 더 앞선 기준액으로 한 번 더 대본다. 검산이 통과한 연도를 base_year로 싣는다(화면 라벨)
                            years = income_years(cur)
                            posted_year = n["posted_at"].year if n["posted_at"] else None
                            candidates = [y for y in ((posted_year - 1, posted_year - 2) if posted_year else ()) if y in years] or years[:1]
                            checked = None
                            for base_year in candidates:
                                checked = verify_income_table(elig.income_table, income_base100(cur, base_year))
                                checked["base_year"] = base_year
                                if checked["verified"]:
                                    break
                            elig.income_table = checked
                            verified = checked["verified"]
                            if not verified:
                                log.warning("%s 소득표 검산 실패(통계 %s년): %s", n["slug"], checked["base_year"], checked["mismatches"][:3])
                        upsert_notice_eligibility(cur, n["id"], source=SOURCE, source_pages=elig.source_pages,
                                                  data=elig.as_json(), verified=verified)
                    cur.execute("RELEASE SAVEPOINT nc")
                    stats.updated += 1
                    conn.commit()
                except Exception as exc:  # noqa: BLE001
                    cur.execute("ROLLBACK TO SAVEPOINT nc")
                    stats.error("db_error", n["slug"], exc)
            if not dry_run:
                finish_ingest(cur, stage=STAGE, source=SOURCE, stats=stats, started=started, calls=client.call_count)
                conn.commit()
    finally:
        conn.close()
    return stats


def _add_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--slug", default=None, help="공고 1건만")
    ap.add_argument("--cached", action="store_true", help="네트워크 없이 받아 둔 쪽 XML만 다시 읽는다")


def main(argv: list[str] | None = None) -> int:
    return stage_main(
        "S3 SH 첨부 공고문 단지 표 수집",
        lambda a: run(dry_run=a.dry_run, limit=a.limit, slug=a.slug, cached=a.cached),
        add_args=_add_args,
        stage=STAGE, source=SOURCE,
        argv=argv,
    )


if __name__ == "__main__":
    sys.exit(main())
