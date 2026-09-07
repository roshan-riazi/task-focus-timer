import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const workflowPath = join(root, ".github", "workflows", "ci.yml");

function readWorkflow(): string {
  return readFileSync(workflowPath, "utf8");
}

function readPkg(): { scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
}

function jobBlock(workflow: string, jobId: string): string {
  const start = workflow.indexOf(`\n  ${jobId}:`);
  expect(start, `expected CI job '${jobId}' to exist`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z][\w-]*:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("CI gates (issue 02, slice 1: core workflow)", () => {
  it("defines a CI workflow that runs on pull requests", () => {
    expect(
      existsSync(workflowPath),
      "expected .github/workflows/ci.yml to exist",
    ).toBe(true);
    expect(readWorkflow()).toContain("pull_request");
  });

  it("runs typecheck, lint, and vitest gates", () => {
    const workflow = readWorkflow();
    expect(workflow).toContain("typecheck");
    expect(workflow).toContain("lint");
    // Vitest gate: either an explicit job name or the pnpm test invocation.
    expect(workflow.includes("vitest") || workflow.includes("pnpm test")).toBe(
      true,
    );
  });

  it("is fail-closed: no continue-on-error escape hatches", () => {
    expect(readWorkflow()).not.toContain("continue-on-error: true");
  });
});

describe("CI gates (issue 02, slice 2: audit + migrate from zero)", () => {
  it("runs a dependency audit gate", () => {
    const workflow = readWorkflow();
    expect(workflow).toContain("audit");
    expect(workflow.includes("pnpm audit") || workflow.includes("pnpm run audit")).toBe(
      true,
    );
    const pkg = readPkg();
    expect(pkg.scripts?.["audit"], "expected package.json audit script").toMatch(
      /pnpm audit|npm audit/,
    );
    expect(pkg.scripts?.["audit"]).not.toContain("|| true");
  });

  it("migrates a test Postgres from zero with prisma migrate deploy", () => {
    const workflow = readWorkflow();
    expect(workflow).toContain("prisma migrate deploy");
    expect(workflow).not.toContain("prisma migrate dev");
    expect(workflow).not.toContain("prisma db push");
    // Ephemeral Postgres service (pinned 16 to match compose) with health check.
    expect(workflow).toContain("postgres:16");
    expect(workflow).toContain("pg_isready");
    expect(workflow).toContain("DATABASE_URL");
  });

  it("ships a Prisma schema plus a baseline migration so deploy has something to apply", () => {
    expect(
      existsSync(join(root, "prisma", "schema.prisma")),
      "expected prisma/schema.prisma to exist",
    ).toBe(true);
    const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
    expect(schema).toContain('provider = "postgresql"');
    // Prisma 6 reads the URL from schema.prisma; Prisma 7 moved it to
    // prisma.config.ts (see prisma docs "config-datasource"). Accept either —
    // the major-version call belongs to issue 03 (data layer), not this gate.
    const configPath = join(root, "prisma.config.ts");
    const urlWired =
      schema.includes("DATABASE_URL") ||
      (existsSync(configPath) &&
        readFileSync(configPath, "utf8").includes("DATABASE_URL"));
    expect(urlWired).toBe(true);
    const migrationsDir = join(root, "prisma", "migrations");
    expect(existsSync(migrationsDir)).toBe(true);
    const entries = readdirSync(migrationsDir, { withFileTypes: true });
    const hasMigrationSql = entries.some(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(migrationsDir, entry.name, "migration.sql")),
    );
    expect(hasMigrationSql).toBe(true);
  });
});

describe("CI gates (issue 02, slice 3: playwright + gitleaks + dependabot)", () => {
  it("runs a Playwright e2e gate with browsers installed", () => {
    const workflow = readWorkflow();
    expect(workflow).toContain("playwright");
    expect(
      workflow.includes("playwright test") ||
        workflow.includes("test:e2e"),
    ).toBe(true);
    expect(workflow).toContain("playwright install");
    const pkg = readPkg();
    expect(
      pkg.scripts?.["test:e2e"],
      "expected package.json test:e2e script",
    ).toMatch(/playwright test/);
    expect(pkg.scripts?.["test:e2e"]).not.toContain("|| true");
  });

  it("ships a Playwright config plus a smoke spec over the public HTTP seam", () => {
    expect(existsSync(join(root, "playwright.config.ts"))).toBe(true);
    const config = readFileSync(join(root, "playwright.config.ts"), "utf8");
    expect(config).toContain("chromium");
    expect(
      existsSync(join(root, "e2e", "smoke.spec.ts")),
      "expected e2e/smoke.spec.ts to exist",
    ).toBe(true);
    const smoke = readFileSync(join(root, "e2e", "smoke.spec.ts"), "utf8");
    expect(smoke).toContain("/api/health");
  });

  it("migrates the DB before Vitest so integration tests have a schema", () => {
    // TEST_STRATEGY §2: API tests run against a real DB prepared with
    // `prisma migrate deploy`. The vitest job must apply migrations itself
    // instead of assuming another job did.
    const vitestJob = jobBlock(readWorkflow(), "vitest");
    expect(vitestJob).toContain("postgres:16");
    expect(vitestJob).toContain("prisma migrate deploy");
  });

  it("generates the Prisma client before typechecking (fresh installs have none)", () => {
    // v7 does not auto-generate on install: without this step the typecheck
    // job fails on `lib/db.ts` with TS2305 (proven by CI run 34171055167).
    const typecheckJob = jobBlock(readWorkflow(), "typecheck");
    expect(typecheckJob).toContain("prisma generate");
  });

  it("runs a Gitleaks secret-scan gate with no escape hatches", () => {
    const workflow = readWorkflow();
    expect(workflow).toContain("gitleaks");
    // v2 runs on Node 20, removed from GitHub runners 2026-09-16: v3+ only.
    expect(workflow).toContain("gitleaks-action@v3");
    expect(workflow).not.toContain("gitleaks-action@v2");
    expect(workflow).not.toContain("|| true");
    // The action auto-detects ./gitleaks.toml at the repo root.
    expect(existsSync(join(root, "gitleaks.toml"))).toBe(true);
  });

  it("enables Dependabot for npm, GitHub Actions, and Docker", () => {
    const dependabotPath = join(root, ".github", "dependabot.yml");
    expect(existsSync(dependabotPath)).toBe(true);
    const dependabot = readFileSync(dependabotPath, "utf8");
    expect(dependabot).toContain("npm");
    expect(dependabot).toContain("github-actions");
    expect(dependabot).toContain("docker");
    expect(dependabot).toContain("weekly");
  });
});
