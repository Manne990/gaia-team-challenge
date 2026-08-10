import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/server/db", { recursive: true });
cpSync("src/db/migrations", "dist/server/db/migrations", { recursive: true });
