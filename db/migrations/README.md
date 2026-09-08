# 마이그레이션

## 네이밍

```
NNNN_설명.sql        0001_init.sql · 0002_add_waitlist_index.sql
```

- `NNNN` 4자리 일련번호, 1부터
- 설명은 영문 snake_case
- **한 파일은 한 번만 적용된다.** 이미 적용된 파일은 수정하지 않고 새 파일을 만든다.
  `db/migrate.py --status`가 적용 후 바뀐 파일을 `DRIFT`로 잡는다

## 적용

```powershell
python db\migrate.py            # 미적용 파일 순차 적용
python db\migrate.py --status   # 적용 현황
```

- 접속 문자열: 환경변수 `DATABASE_URL` 또는 `pipeline/.env`의 값. **direct(unpooled)** 문자열을 쓴다
- 이력은 `schema_migrations` 테이블(파일명·sha256·적용시각)
- 한 파일 = 한 트랜잭션. 중간에 실패하면 그 파일 전체가 롤백된다
- psql이 있으면 `psql $env:DATABASE_URL -f .\db\migrations\0001_init.sql`도 되지만 이력이 안 남는다

## `schema.sql`과의 관계

`db/schema.sql`은 **현재 스키마의 전체 모습**이다. 마이그레이션을 새로 추가하면 `schema.sql`도 같이 갱신한다.
신규 환경 구축은 `schema.sql` 한 번, 기존 환경 갱신은 마이그레이션 순차 적용.
`0001_init.sql`은 `schema.sql`과 바이트 단위로 같다.

## 목록

| 파일 | 내용 | 적용 |
|---|---|---|
| `0001_init.sql` | 초기 스키마 — notice · notice_event · raw_snapshot · complex · complex_type · unit · eligibility · waitlist · address_match · review_queue · ingest_log. 마이홈 API 실호출 필드 반영본 | Neon 2026-09-08 |
