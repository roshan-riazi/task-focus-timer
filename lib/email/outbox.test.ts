import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileOutboxEmailProvider, OUTBOX_FILENAME } from "./outbox";

describe("FileOutboxEmailProvider (E2E mail capture)", () => {
  it("appends one JSON line per mail with recipient, links, and timestamp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "outbox-test-"));
    const now = new Date("2026-09-08T12:00:00.000Z");
    const provider = new FileOutboxEmailProvider(dir, () => now);
    await expect(
      provider.send({
        to: "alice@example.com",
        subject: "Verify",
        text: "link https://app.example/verify-email?token=abc",
      }),
    ).resolves.toEqual({ id: "outbox" });
    const files = readdirSync(dir);
    expect(files).toEqual([OUTBOX_FILENAME]);
    const [line] = readFileSync(join(dir, OUTBOX_FILENAME), "utf8")
      .split("\n")
      .filter(Boolean);
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry).toMatchObject({
      to: "alice@example.com",
      subject: "Verify",
    });
    expect(entry.text).toContain("token=abc");
    expect(entry.at).toBe("2026-09-08T12:00:00.000Z");
  });
});
