import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

/**
 * Testing-library async queries (`findBy*`, `waitFor`) poll on a 1s budget
 * by default. Full-suite parallel runs starve workers on small boxes/CI and
 * trip that budget without any product regression (flaky only under load,
 * never in isolation), so give them headroom. Real hangs still fail — just
 * after 5s instead of 1s.
 */
configure({ asyncUtilTimeout: 5000 });
