import { describe, expect, it } from "vitest";
import { formatDrillEvidence } from "./drill-evidence";
import { CANARY_TASK_NOTES, CANARY_TASK_TITLE } from "@/tests/canary";

describe("formatDrillEvidence (VPS restore-drill record)", () => {
  it("records date, actor, target, checks, and result with no user content", () => {
    const record = formatDrillEvidence({
      date: "2026-09-19",
      actor: "owner",
      target: "vps-docker",
      imageTag: "abc1234",
      checks: [
        "migrate deploy clean on isolated DB",
        "history spot query returns seeded rows",
        "analytics spot query aggregates seeded minutes",
        "/api/health 200 with db:up",
      ],
      result: "pass",
    });
    expect(record).toContain("2026-09-19");
    expect(record).toContain("owner");
    expect(record).toContain("vps-docker");
    expect(record).toContain("abc1234");
    expect(record).toContain("pass");
    for (const check of [
      "migrate deploy clean",
      "history spot query",
      "analytics spot query",
      "/api/health 200",
    ]) {
      expect(record).toContain(check);
    }
    expect(record).not.toContain(CANARY_TASK_TITLE);
    expect(record).not.toContain(CANARY_TASK_NOTES);
  });

  it("marks failed drills explicitly so a pass is never inferred", () => {
    const record = formatDrillEvidence({
      date: "2026-09-19",
      actor: "owner",
      target: "vps-docker",
      imageTag: "abc1234",
      checks: ["migrate deploy clean on isolated DB"],
      result: "fail",
      notes: "restore refused: live DATABASE_URL guard tripped (expected).",
    });
    expect(record).toContain("fail");
    expect(record).not.toMatch(/result:\s*pass/i);
  });
});
