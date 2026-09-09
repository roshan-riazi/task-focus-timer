/**
 * Transactional copy (English-only, i18n-ready externalized strings per
 * spec §8.9). Templates take fully-formed URLs so route paths live in one
 * place (the auth service), not in copy.
 */
export interface VerificationTemplate {
  subject: string;
  text: string;
  html: string;
}

export function verifyEmail({ verifyUrl }: { verifyUrl: string }): VerificationTemplate {
  const subject = "Verify your FocusFlow email";
  const text = [
    "Welcome to FocusFlow!",
    "",
    "Confirm this email address to finish securing your account:",
    verifyUrl,
    "",
    "This link expires in 24 hours. You can already use the app — verification just removes the reminder banner.",
    "",
    "If you didn't create a FocusFlow account, you can safely ignore this email.",
  ].join("\n");
  const html = `<p>Welcome to FocusFlow!</p><p><a href="${verifyUrl}">Confirm your email address</a> (expires in 24 hours).</p><p>You can already use the app — verification just removes the reminder banner.</p>`;
  return { subject, text, html };
}

export function resetPasswordEmail({ resetUrl }: { resetUrl: string }): VerificationTemplate {
  const subject = "Reset your FocusFlow password";
  const text = [
    "Someone requested a password reset for this email address.",
    "",
    "Choose a new password here:",
    resetUrl,
    "",
    "This link expires in 1 hour. If you didn't ask for a reset, you can safely ignore this email — your password stays unchanged.",
  ].join("\n");
  const html = `<p>Someone requested a password reset for this email address.</p><p><a href="${resetUrl}">Choose a new password</a> (expires in 1 hour).</p><p>If you didn't ask for a reset, you can safely ignore this email.</p>`;
  return { subject, text, html };
}
