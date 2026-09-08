-- 0013 — 죽어있던 부분 인덱스 살리기
-- idx_notice_apply_end·idx_notice_sido_type가 WHERE publish='published'였는데, notice.publish는 지금
-- 전부 'parsed'라(발행 게이팅은 S8에서 도입 예정) 두 인덱스 모두 단 한 행도 매칭하지 못해 완전히 죽어 있었다.
-- web/src/lib/queries.ts도 publish 필터를 걸지 않는다. 지금은 조건 없이 만들고, S8이 게이팅을 도입하면 그때 다시 좁힌다.
DROP INDEX idx_notice_apply_end;
DROP INDEX idx_notice_sido_type;
CREATE INDEX idx_notice_apply_end ON notice (apply_end_at DESC NULLS LAST);
CREATE INDEX idx_notice_sido_type ON notice (sido, housing_type);
