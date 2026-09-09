-- FocusFlow auth rate limits (issue 05, ADR-0003): DB-backed fixed-window
-- hits table for auth/sensitive mutations (portable; Redis later if needed).
--
-- Assembled by hand in the `prisma migrate diff` style (no shadow DB in this
-- sandbox — same pattern as the 04 migration) and verified from zero under
-- PGlite (real Postgres semantics: full init→04→05 chain applies, table
-- shape + index + window-count query confirmed) plus `prisma validate`;
-- CI's migrate-from-zero job is the final gate. One row per guarded attempt;
-- `key` embeds the endpoint bucket + caller IP only (never emails or user
-- content).

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" UUID NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limit_hits_key_created_idx" ON "rate_limit_hits"("key", "created_at");
