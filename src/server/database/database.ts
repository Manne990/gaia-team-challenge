import type Database from "better-sqlite3";
import {
  migrate,
  openDatabase as openSqliteDatabase,
} from "../../db/database.js";

export function openDatabase(path: string): Database.Database {
  const database = openSqliteDatabase(path);
  migrate(database);
  return database;
}
