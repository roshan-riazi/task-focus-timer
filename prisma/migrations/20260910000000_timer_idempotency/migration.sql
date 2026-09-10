-- Timer finalize idempotency keys (issue 10, SYSTEM_DESIGN §6).
-- One row per (user_id, client-sent Idempotency-Key) on
-- complete/cancel/skip-break: the unique constraint arbitrates concurrent
-- same-key finalizes (the loser replays the winner), and both FKs keep the
-- account-deletion purge story (spec §8.1: keys vanish with the user and
-- the session). `key` stays quoted throughout: it is a reserved word in
-- Postgres outside identifiers.

CREATE TABLE "timer_idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "session_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timer_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timer_idempotency_keys_user_key_unique" ON "timer_idempotency_keys"("user_id", "key");

CREATE INDEX "timer_idempotency_keys_user_created_idx" ON "timer_idempotency_keys"("user_id", "created_at");

ALTER TABLE "timer_idempotency_keys" ADD CONSTRAINT "timer_idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timer_idempotency_keys" ADD CONSTRAINT "timer_idempotency_keys_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "timer_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
