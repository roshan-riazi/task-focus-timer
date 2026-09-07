Status: resolved
Type: grilling

## Question

Decide the alarm-sound options: single fixed chime (current spec) vs. a set
of selectable built-in presets vs. custom uploads; whether a volume control
is included; and whether focus-end, break-end, and attention-needed moments
get distinct tones.

Constrain to MVP: tiny footprint, no licensing burden, works with the
existing sound on/off + notification settings, persisted per user.

## Answer

- 3–4 built-in WebAudio-synthesized presets (default `chime`) with in-settings
  preview; no audio assets, no custom uploads in MVP.
- Persisted volume 0–100 (default 80); distinct focus-end vs break-end patterns.
- Reflected in PRODUCT_SPEC (§8.6 sounds, §8.7 settings, §10.2 user_settings),
  SYSTEM_DESIGN (§4 alarms), TEST_STRATEGY (mapping tests + manual audible
  check), prototype `settings.html`.
