/**
 * VPS restore-drill evidence record (issue 19, RUNBOOK §4): a content-free
 * markdown fragment appended to the issue file under `## Comments`. Never
 * carries task titles, notes, or secrets — only dates, actors, targets,
 * check names, and the pass/fail verdict.
 */
export interface DrillEvidenceInput {
  date: string;
  actor: string;
  target: string;
  imageTag: string;
  checks: string[];
  result: "pass" | "fail";
  notes?: string;
}

export function formatDrillEvidence(input: DrillEvidenceInput): string {
  const lines = [
    `- drill: date=${input.date} actor=${input.actor} target=${input.target} image=${input.imageTag} result=${input.result}`,
    ...input.checks.map((check) => `  - check: ${check}`),
  ];
  if (input.notes) {
    lines.push(`  - notes: ${input.notes}`);
  }
  return `${lines.join("\n")}\n`;
}
