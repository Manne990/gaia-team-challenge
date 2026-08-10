import type Database from "better-sqlite3";
import { openDatabase as openSqliteDatabase } from "../../db/database.js";

export { migrate } from "../../db/database.js";

export function openDatabase(path: string): Database.Database {
  const database = openSqliteDatabase(path);
  return database;
}
