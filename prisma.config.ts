import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // DATABASE_URL is required for migrate/deploy; empty fallback keeps
    // offline commands (validate, generate, format) working without a DB.
    url: process.env.DATABASE_URL ?? "",
  },
});
