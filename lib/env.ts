import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(value: unknown): Env {
  return envSchema.parse(value);
}
