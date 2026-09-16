"""stages/common.py — run()이 죽어도 ingest_log에 ok=false 한 줄이 남는가.

2026-09-16 이전엔 안 남았다. 마이홈 API가 사흘 연속 ConnectTimeout으로 죽었는데
ingest_log엔 아무 흔적이 없어 콘솔에서 그 회차가 아예 없던 일이 됐다.
"""

import json

import pytest

from zipgonggo_pipeline.stages import common
from zipgonggo_pipeline.stages.common import Stats, stage_main


class FakeCursor:
    def __init__(self, sink: list[tuple]):
        self.sink = sink

    def execute(self, sql, params=None):
        self.sink.append((sql, params))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, sink: list[tuple]):
        self.sink = sink
        self.committed = False

    def cursor(self):
        return FakeCursor(self.sink)

    def commit(self):
        self.committed = True

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Sink:
    """가짜 DB가 받은 것. rows는 실행된 SQL, conns는 열린 커넥션."""

    def __init__(self):
        self.rows: list[tuple] = []
        self.conns: list[FakeConn] = []

    def connect(self) -> FakeConn:
        c = FakeConn(self.rows)
        self.conns.append(c)
        return c


@pytest.fixture
def sink(monkeypatch):
    s = Sink()
    monkeypatch.setattr(common, "connect", s.connect)
    # 크래시 경로가 바깥을 못 건드리게 — 이쪽이 불리면 테스트가 잘못 짜인 것이다
    monkeypatch.setattr(common, "notify_web_revalidate", lambda *a, **k: None)
    return s


def _logged(rows: list[tuple]) -> dict:
    """ingest_log INSERT 한 줄을 골라 message를 풀어 준다."""
    hits = [p for sql, p in rows if "INSERT INTO ingest_log" in sql]
    assert len(hits) == 1, f"ingest_log 줄이 {len(hits)}개"
    stage, source, ok, item_count, message, _started = hits[0]
    return {"stage": stage, "source": source, "ok": ok,
            "item_count": item_count, "message": json.loads(message)}


def test_crash_leaves_a_failed_ingest_log_row(sink):
    def boom(_args):
        raise TimeoutError("timed out")

    code = stage_main("테스트 스테이지", boom, stage="S9", source="test_src", argv=[])

    assert code == 1
    row = _logged(sink.rows)
    assert row["stage"] == "S9" and row["source"] == "test_src"
    assert row["ok"] is False
    assert row["item_count"] == 0
    assert row["message"]["skipped"] == {"stage_crashed": 1}
    assert "TimeoutError: timed out" in row["message"]["errors"][0]


def test_crash_opens_a_fresh_connection(sink):
    """죽은 이유가 커넥션이 끊긴 것일 수 있다 — 스테이지가 쥐던 연결을 다시 쓰면 안 된다."""

    def boom(_args):
        raise RuntimeError("SSL connection has been closed unexpectedly")

    stage_main("테스트", boom, stage="S9", source="test_src", argv=[])
    assert len(sink.conns) == 1 and sink.conns[0].committed


def test_dry_run_crash_writes_nothing(sink):
    def boom(_args):
        raise ValueError("나쁜 값")

    code = stage_main("테스트", boom, stage="S9", source="test_src", argv=["--dry-run"])
    assert code == 1
    assert not sink.rows


def test_crash_log_failure_does_not_mask_exit_code(sink, monkeypatch):
    """기록마저 실패해도 종료코드는 1이고 예외가 새어 나가지 않는다."""

    def dead_connect():
        raise OSError("DB도 죽었다")

    monkeypatch.setattr(common, "connect", dead_connect)
    code = stage_main("테스트", lambda _a: (_ for _ in ()).throw(TimeoutError("x")),
                      stage="S9", source="test_src", argv=[])
    assert code == 1


def test_healthy_run_is_untouched(sink):
    """멀쩡히 끝난 회차는 예전과 같다 — 크래시 줄을 끼워 넣지 않는다."""
    code = stage_main("테스트", lambda _a: Stats(inserted=3), stage="S9", source="test_src", argv=[])
    assert code == 0
    assert not sink.rows
