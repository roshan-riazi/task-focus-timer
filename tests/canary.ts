/**
 * Shared canary fixtures for issue-06 scrub assertions (TEST_STRATEGY §1:
 * `CANARY_TASK_TITLE`-style sentinels standing in for user-authored task
 * content). Import these — never redefine them — so every seam asserts
 * against identical strings.
 */
export const CANARY_TASK_TITLE = "CANARY_TASK_TITLE_6_observability";
export const CANARY_TASK_NOTES = "CANARY_TASK_NOTES_6_observability_secret";

import { Writable } from "node:stream";

/** In-memory pino destination so tests can assert on emitted log lines. */
export function captureStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { chunks, stream };
}
