import { describe, expect, it, vi } from "vitest";
import { ConsoleEmailProvider } from "./console";
import { ResendEmailProvider } from "./resend";
import { resolveEmailProvider } from "./resolve";
import { resetPasswordEmail, verifyEmail } from "./templates";
import type { EmailMessage } from "./types";

const message: EmailMessage = {
  to: "alice@example.com",
  subject: "Hello",
  text: "plain body",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ResendEmailProvider (default transactional sender)", () => {
  it("POSTs the Resend payload with bearer auth", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { id: "mail_123" }));
    const provider = new ResendEmailProvider({
      apiKey: "re_test_key",
      from: "FocusFlow <noreply@example.com>",
      fetchFn,
    });
    const result = await provider.send(message);
    expect(result).toEqual({ id: "mail_123" });
    expect(fetchFn).toHaveBeenCalledOnce();
    const calls = fetchFn.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "FocusFlow <noreply@example.com>",
      to: ["alice@example.com"],
      subject: "Hello",
      text: "plain body",
    });
  });

  it("throws a leak-free EmailError on provider failure", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { error: "bad" }));
    const provider = new ResendEmailProvider({
      apiKey: "re_test_key",
      from: "FocusFlow <noreply@example.com>",
      fetchFn,
    });
    const error: unknown = await provider.send(message).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("EmailError");
    const message_text = (error as Error).message;
    expect(message_text).toContain("401");
    expect(message_text).not.toContain("re_test_key");
    expect(message_text).not.toContain("alice@example.com");
  });

  it("surfaces network failures as EmailError (caller decides non-blocking)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const provider = new ResendEmailProvider({
      apiKey: "re_test_key",
      from: "FocusFlow <noreply@example.com>",
      fetchFn,
    });
    await expect(provider.send(message)).rejects.toMatchObject({
      name: "EmailError",
    });
  });
});

describe("ConsoleEmailProvider (dev fallback: never blocks, never networks)", () => {
  it("logs the recipient + subject without the API key and resolves", async () => {
    const logs: string[] = [];
    const provider = new ConsoleEmailProvider({
      log: (line: string) => logs.push(line),
    });
    await expect(provider.send(message)).resolves.toEqual({ id: "console" });
    expect(logs.join("\n")).toContain("alice@example.com");
  });
});

describe("resolveEmailProvider (env-pluggable, Resend default)", () => {
  it("selects Resend when an API key is configured", () => {
    const provider = resolveEmailProvider({
      EMAIL_API_KEY: "re_live",
      EMAIL_FROM: "FocusFlow <hi@example.com>",
    });
    expect(provider.name).toBe("resend");
  });

  it("falls back to console (with a warning) when Resend is selected but keyless", () => {
    const warnings: string[] = [];
    const provider = resolveEmailProvider(
      {},
      { onWarn: (line: string) => warnings.push(line) },
    );
    expect(provider.name).toBe("console");
    expect(warnings.join("\n")).toMatch(/EMAIL_API_KEY/i);
  });

  it("honours an explicit console provider", () => {
    expect(
      resolveEmailProvider({ EMAIL_PROVIDER: "console" }).name,
    ).toBe("console");
  });

  it("resolves a file outbox for test environments", () => {
    expect(
      resolveEmailProvider({
        EMAIL_PROVIDER: "outbox",
        EMAIL_OUTBOX_DIR: "/tmp/outbox-test",
      }).name,
    ).toBe("outbox");
  });

  it("fails closed on an unknown provider name", () => {
    expect(() =>
      resolveEmailProvider({ EMAIL_PROVIDER: "carrier-pigeon" }),
    ).toThrow(/unknown email provider/i);
  });
});

describe("email templates (English-only, i18n-ready strings)", () => {
  it("builds a verification email with the token link and expiry note", () => {
    const mail = verifyEmail({
      verifyUrl: "https://app.example/verify-email?token=abc",
    });
    expect(mail.subject).toMatch(/verif/i);
    expect(mail.text).toContain("https://app.example/verify-email?token=abc");
    expect(mail.text).toMatch(/24 hours/);
    expect(mail.html).toContain("https://app.example/verify-email?token=abc");
  });

  it("builds a reset email with the token link and a ignore-if-unexpected note", () => {
    const mail = resetPasswordEmail({
      resetUrl: "https://app.example/reset-password?token=xyz",
    });
    expect(mail.subject).toMatch(/reset/i);
    expect(mail.text).toContain("https://app.example/reset-password?token=xyz");
    expect(mail.text).toMatch(/didn.t (ask|request)/i);
  });
});
