# 마이그레이션

## 네이밍

```
NNNN_설명.sql        0001_init.sql · 0002_add_waitlist_index.sql
```

- `NNNN` 4자리 일련번호, 1부터
- 설명은 영문 snake_case
- **한 파일은 한 번만 적용된다.** 이미 적용된 파일은 수정하지 않고 새 파일을 만든다

## 적용

```powershell
psql $env:DATABASE_URL -f .\db\migrations\0001_init.sql
```

## `schema.sql`과의 관계

`db/schema.sql`은 **현재 스키마의 전체 모습**이다. 마이그레이션을 새로 추가하면 `schema.sql`도 같이 갱신한다.
신규 환경 구축은 `schema.sql` 한 번, 기존 환경 갱신은 마이그레이션 순차 적용.

## 목록

| 파일 | 내용 |
|---|---|
| `0001_init.sql` | 초기 스키마 — notice · complex · unit · eligibility · waitlist · address_match · raw_snapshot · review_queue · ingest_log |
