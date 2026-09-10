import { EmailError, type EmailMessage, type EmailProvider, type EmailSendResult } from "./types";

export interface ResendOptions {
  apiKey: string;
  from: string;
  fetchFn?: typeof fetch;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Default transactional sender (SYSTEM_DESIGN §3: Resend is the proposed
 * default; any SMTP-compatible provider satisfies the design). Thin fetch
 * wrapper — no SDK dependency — so the provider stays portable to the VPS
 * and local targets. HTTP injected for hermetic tests.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchFn: typeof fetch;

  constructor({ apiKey, from, fetchFn = fetch }: ResendOptions) {
    this.apiKey = apiKey;
    this.from = from;
    this.fetchFn = fetchFn;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await this.fetchFn(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });
    } catch {
      throw new EmailError("Email provider request failed (network).");
    }
    if (!response.ok) {
      // Status-class only: bodies/keys/recipients stay out of logs.
      throw new EmailError(
        `Email provider request failed (status ${response.status}).`,
      );
    }
    const body = (await response.json().catch(() => null)) as {
      id?: string;
    } | null;
    return body?.id ? { id: body.id } : {};
  }
}
