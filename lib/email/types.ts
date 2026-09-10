export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSendResult {
  id?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Provider failures: message carries status-class only, never keys or PII. */
export class EmailError extends Error {
  override name = "EmailError";
}
