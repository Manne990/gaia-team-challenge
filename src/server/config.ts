import { resolve } from "node:path";
import { z } from "zod";

export interface RuntimeConfig {
  host: string;
  port: number;
  databasePath: string;
  environment: "development" | "production" | "test";
}

const schema = z.object({
  host: z.string().trim().min(1, "host cannot be empty"),
  port: z.coerce.number().int().min(1).max(65535),
  databasePath: z.string().trim().min(1, "database path cannot be empty"),
  environment: z.enum(["development", "production", "test"]),
});

function argument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Configuration error: ${name} requires a value`);
  return value;
}

export function loadConfig(
  args = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const result = schema.safeParse({
    host: argument(args, "--host") ?? env.NORTHSTAR_HOST ?? "127.0.0.1",
    port: argument(args, "--port") ?? env.NORTHSTAR_PORT ?? "4173",
    databasePath:
      argument(args, "--database-path") ??
      env.NORTHSTAR_DATABASE_PATH ??
      "./data/northstar.sqlite",
    environment: env.NODE_ENV ?? "development",
  });
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => issue.message)
      .join("; ");
    throw new Error(`Configuration error: ${details}`);
  }
  return { ...result.data, databasePath: resolve(result.data.databasePath) };
}
