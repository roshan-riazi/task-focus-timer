-- FocusFlow initial schema (issue 03): spec §10 + §10.2 sound fields.
-- `prisma migrate deploy` from zero builds the full schema repeatably.
-- Prisma-managed tables/indexes first (output of
-- `prisma migrate diff --from-empty --to-schema prisma/schema.prisma`),
-- then database-level CHECK constraints (spec §10.6 "where practical";
-- Prisma 7 does not author CHECKs, so they live here and are covered by
-- prisma/migration.test.ts).

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "IntervalType" AS ENUM ('focus', 'short_break', 'long_break');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('running', 'paused', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "focus_duration_seconds" INTEGER NOT NULL DEFAULT 1500,
    "short_break_seconds" INTEGER NOT NULL DEFAULT 300,
    "long_break_seconds" INTEGER NOT NULL DEFAULT 900,
    "intervals_before_long_break" INTEGER NOT NULL DEFAULT 4,
    "auto_start_breaks" BOOLEAN NOT NULL DEFAULT false,
    "auto_start_focus" BOOLEAN NOT NULL DEFAULT false,
    "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sound_preset" VARCHAR(32) NOT NULL DEFAULT 'chime',
    "sound_volume" INTEGER NOT NULL DEFAULT 80,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "notes" VARCHAR(2000),
    "category" VARCHAR(50),
    "status" "TaskStatus" NOT NULL DEFAULT 'active',
    "position" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timer_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID,
    "task_title_snapshot" VARCHAR(200),
    "category_snapshot" VARCHAR(50),
    "interval_type" "IntervalType" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'running',
    "planned_duration_seconds" INTEGER NOT NULL,
    "actual_duration_seconds" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "expected_end_at" TIMESTAMPTZ(6) NOT NULL,
    "paused_at" TIMESTAMPTZ(6),
    "accumulated_pause_seconds" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "timer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "focus_cycle_state" (
    "user_id" UUID NOT NULL,
    "completed_focus_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "focus_cycle_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "tasks_user_status_position_idx" ON "tasks"("user_id", "status", "position");

-- CreateIndex
CREATE INDEX "timer_sessions_user_started_idx" ON "timer_sessions"("user_id", "started_at");

-- One active (running/paused) session per user (spec §10.6).
-- CreateIndex
CREATE UNIQUE INDEX "timer_sessions_one_active_per_user" ON "timer_sessions"("user_id") WHERE ("status" IN ('running', 'paused'));

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timer_sessions" ADD CONSTRAINT "timer_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timer_sessions" ADD CONSTRAINT "timer_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_cycle_state" ADD CONSTRAINT "focus_cycle_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Duration/state CHECKs (spec §10.6 "where practical"). Ranges mirror the
-- allowed timer settings (spec §6: focus 1–120 min, breaks 1–60 min,
-- long-break cycle 1–10) and sound volume 0–100 (§10.2).
ALTER TABLE "user_settings"
  ADD CONSTRAINT "user_settings_focus_duration_seconds_check" CHECK ("focus_duration_seconds" >= 60 AND "focus_duration_seconds" <= 7200),
  ADD CONSTRAINT "user_settings_short_break_seconds_check" CHECK ("short_break_seconds" >= 60 AND "short_break_seconds" <= 3600),
  ADD CONSTRAINT "user_settings_long_break_seconds_check" CHECK ("long_break_seconds" >= 60 AND "long_break_seconds" <= 3600),
  ADD CONSTRAINT "user_settings_intervals_before_long_break_check" CHECK ("intervals_before_long_break" >= 1 AND "intervals_before_long_break" <= 10),
  ADD CONSTRAINT "user_settings_sound_volume_check" CHECK ("sound_volume" >= 0 AND "sound_volume" <= 100);

ALTER TABLE "timer_sessions"
  ADD CONSTRAINT "timer_sessions_planned_duration_seconds_check" CHECK ("planned_duration_seconds" > 0),
  ADD CONSTRAINT "timer_sessions_actual_duration_seconds_check" CHECK ("actual_duration_seconds" IS NULL OR "actual_duration_seconds" >= 0),
  ADD CONSTRAINT "timer_sessions_accumulated_pause_seconds_check" CHECK ("accumulated_pause_seconds" >= 0),
  ADD CONSTRAINT "timer_sessions_expected_end_after_start_check" CHECK ("expected_end_at" > "started_at"),
  ADD CONSTRAINT "timer_sessions_completed_cancelled_mutually_exclusive_check" CHECK ("completed_at" IS NULL OR "cancelled_at" IS NULL);

ALTER TABLE "focus_cycle_state"
  ADD CONSTRAINT "focus_cycle_state_completed_focus_count_check" CHECK ("completed_focus_count" >= 0);
