import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

/**
 * Dev/keyless fallback: writes recipient + subject to the server log instead
 * of networking. Registration stays non-blocking everywhere; production sets
 * a real provider key (see .env.example).
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  private readonly log: (line: string) => void;

  constructor({ log = console.warn }: { log?: (line: string) => void } = {}) {
    this.log = log;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.log(
      `[email:console] to=${message.to} subject=${message.subject}`,
    );
    return { id: "console" };
  }
}
