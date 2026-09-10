import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

export const OUTBOX_FILENAME = "outbox.jsonl";

export interface OutboxEntry extends EmailMessage {
  at: string;
}

/**
 * File-outbox sender for test environments (E2E only): appends every mail as
 * one JSON line so specs can follow emailed links deterministically — the
 * Mailpit pattern without extra infrastructure. Env-gated
 * (`EMAIL_PROVIDER=outbox`); never the production default.
 */
export class FileOutboxEmailProvider implements EmailProvider {
  readonly name = "outbox";
  private readonly dir: string;
  private readonly now: () => Date;

  constructor(dir: string, now: () => Date = () => new Date()) {
    this.dir = dir;
    this.now = now;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    await mkdir(this.dir, { recursive: true });
    const entry: OutboxEntry = {
      ...message,
      at: this.now().toISOString(),
    };
    await appendFile(
      join(this.dir, OUTBOX_FILENAME),
      `${JSON.stringify(entry)}\n`,
      "utf8",
    );
    return { id: "outbox" };
  }
}
