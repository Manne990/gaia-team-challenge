import { existsSync, rmSync } from "node:fs";
import { loadConfig } from "../config.js";
import { openDatabase } from "./database.js";

const command = process.argv[2];
const config = loadConfig(process.argv.slice(3));
if (command === "reset") {
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${config.databasePath}${suffix}`;
    if (existsSync(path)) rmSync(path);
  }
} else if (command !== "seed") {
  throw new Error("Usage: database cli <reset|seed> [--database-path PATH]");
}
const database = openDatabase(config.databasePath);
database
  .prepare("INSERT OR REPLACE INTO system_metadata (key, value) VALUES (?, ?)")
  .run("seed_version", "foundation-v1");
database.close();
console.log(
  `Database ${command === "reset" ? "reset" : "seeded"}: ${config.databasePath}`,
);
