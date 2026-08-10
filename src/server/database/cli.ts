import { existsSync, rmSync } from "node:fs";
import { loadConfig } from "../config.js";
import { openDatabase } from "./database.js";
import { seedDatabase } from "../../db/seed.js";

const command = process.argv[2];
const config = loadConfig(process.argv.slice(3));
if (command === "reset") {
  for (const suffix of ["", "-shm", "-wal"]) {
    const path = `${config.databasePath}${suffix}`;
    if (existsSync(path)) rmSync(path);
  }
} else if (command !== "seed" && command !== "migrate") {
  throw new Error(
    "Usage: database cli <reset|seed|migrate> [--database-path PATH]",
  );
}
const database = openDatabase(config.databasePath);
if (command === "seed") seedDatabase(database);
database.close();
console.log(
  `Database ${command === "reset" ? "reset" : command === "seed" ? "seeded" : "migrated"}: ${config.databasePath}`,
);
