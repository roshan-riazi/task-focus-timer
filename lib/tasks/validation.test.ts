import { describe, expect, it } from "vitest";
import {
  createTaskSchema,
  listTasksQuerySchema,
  reorderTasksSchema,
  taskIdParamSchema,
  updateTaskSchema,
} from "./validation";

/**
 * Seam 1 (unit, hermetic): Zod input boundary for the Task API.
 *
 * Every expectation below is an independent literal from the spec —
 * title 1–200 after trimming, notes ≤2000, category ≤50 (PRODUCT_SPEC
 * §8.2), never recomputed from the implementation.
 */
describe("createTaskSchema", () => {
  it("trims the title and accepts optional notes/category", () => {
    const parsed = createTaskSchema.parse({
      title: "  Write report  ",
      notes: "Draft first",
      category: "work",
    });
    expect(parsed).toEqual({
      title: "Write report",
      notes: "Draft first",
      category: "work",
    });
  });

  it("rejects blank, overlong, and missing titles", () => {
    expect(() => createTaskSchema.parse({ title: "" })).toThrow();
    expect(() => createTaskSchema.parse({ title: "   " })).toThrow();
    expect(() => createTaskSchema.parse({})).toThrow();
    expect(() =>
      createTaskSchema.parse({ title: "x".repeat(201) }),
    ).toThrow();
    expect(() =>
      createTaskSchema.parse({ title: "x".repeat(200) }),
    ).not.toThrow();
  });

  it("rejects overlong notes and category", () => {
    expect(() =>
      createTaskSchema.parse({ title: "ok", notes: "n".repeat(2001) }),
    ).toThrow();
    expect(() =>
      createTaskSchema.parse({ title: "ok", notes: "n".repeat(2000) }),
    ).not.toThrow();
    expect(() =>
      createTaskSchema.parse({ title: "ok", category: "c".repeat(51) }),
    ).toThrow();
    expect(() =>
      createTaskSchema.parse({ title: "ok", category: "c".repeat(50) }),
    ).not.toThrow();
  });

  it("treats empty-string notes/category as absent", () => {
    const parsed = createTaskSchema.parse({
      title: "ok",
      notes: "",
      category: "",
    });
    expect(parsed.notes).toBeUndefined();
    expect(parsed.category).toBeUndefined();
  });
});

describe("updateTaskSchema", () => {
  it("accepts a partial edit and trims the title", () => {
    expect(updateTaskSchema.parse({ title: "  New  " })).toEqual({
      title: "New",
    });
  });

  it("rejects an empty patch and overlong fields", () => {
    expect(() => updateTaskSchema.parse({})).toThrow();
    expect(() => updateTaskSchema.parse({ title: "   " })).toThrow();
    expect(() =>
      updateTaskSchema.parse({ notes: "n".repeat(2001) }),
    ).toThrow();
    expect(() =>
      updateTaskSchema.parse({ category: "c".repeat(51) }),
    ).toThrow();
  });

  it("accepts archiving via status but never completion (use /complete)", () => {    expect(updateTaskSchema.parse({ status: "archived" })).toEqual({
      status: "archived",
    });
    expect(updateTaskSchema.parse({ status: "active" })).toEqual({
      status: "active",
    });
    expect(() => updateTaskSchema.parse({ status: "completed" })).toThrow();
  });

  it("accepts explicit null to clear notes/category (issue 08 edit)", () => {
    expect(updateTaskSchema.parse({ notes: null })).toEqual({ notes: null });
    expect(updateTaskSchema.parse({ category: null })).toEqual({
      category: null,
    });
  });
});

describe("listTasksQuerySchema", () => {
  it("defaults to the active list with a page of 50", () => {
    expect(listTasksQuerySchema.parse({})).toEqual({
      status: "active",
      limit: 50,
      cursor: undefined,
    });
  });

  it("accepts every documented filter and a string limit from searchParams", () => {
    expect(
      listTasksQuerySchema.parse({ status: "completed", limit: "25" }),
    ).toMatchObject({ status: "completed", limit: 25 });
    expect(
      listTasksQuerySchema.parse({ status: "archived", limit: 10 }),
    ).toMatchObject({ status: "archived", limit: 10 });
    expect(
      listTasksQuerySchema.parse({ status: "all", limit: "100" }),
    ).toMatchObject({ status: "all", limit: 100 });
  });

  it("rejects unknown statuses and out-of-range limits", () => {
    expect(() => listTasksQuerySchema.parse({ status: "deleted" })).toThrow();
    expect(() => listTasksQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => listTasksQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => listTasksQuerySchema.parse({ limit: "many" })).toThrow();
  });
});

describe("reorderTasksSchema", () => {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();

  it("accepts an ordered id list", () => {
    expect(reorderTasksSchema.parse({ taskIds: [a, b] })).toEqual({
      taskIds: [a, b],
    });
  });

  it("rejects empty, duplicated, non-UUID, and oversized lists", () => {
    expect(() => reorderTasksSchema.parse({ taskIds: [] })).toThrow();
    expect(() =>
      reorderTasksSchema.parse({ taskIds: [a, a] }),
    ).toThrow();
    expect(() => reorderTasksSchema.parse({ taskIds: ["nope"] })).toThrow();
    expect(() =>
      reorderTasksSchema.parse({ taskIds: Array(201).fill(a) }),
    ).toThrow();
  });
});

describe("taskIdParamSchema", () => {
  it("accepts UUIDs and rejects anything else", () => {
    const id = crypto.randomUUID();
    expect(taskIdParamSchema.parse(id)).toBe(id);
    expect(() => taskIdParamSchema.parse("nope")).toThrow();
    expect(() => taskIdParamSchema.parse("")).toThrow();
  });
});
