-- +goose Up
-- このセクションの SQL はマイグレーションが適用されたときに実行される
CREATE TABLE ping_timestamp (
    id SERIAL,
    occurred TIMESTAMPTZ NOT NULL
);

-- +goose Down
-- このセクションのSQLは、マイグレーションがロールバックされたときに実行されます。
DROP TABLE ping_timestamp;