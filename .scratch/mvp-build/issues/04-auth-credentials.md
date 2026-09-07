Status: open
Milestone: 1
Depends on: 02, 03

## Scope

Auth.js v5 credentials: register (normalized unique email, 8-char min),
non-blocking verification email + nag support, login/logout, password reset.
Transactional email via env-pluggable provider (Resend default). Bootstrap
the `user_settings` row with defaults at registration.

## Acceptance

- Full register → use-before-verify → verify → login → reset journey works
  in a test env.

## Validation

- API: register/verify/login/reset flows, settings-row bootstrap, validation
  abuse cases. E2E: first-use journey keyboard-only.

## Comments
