import type { DatabaseSync } from 'node:sqlite';

export const defaultDatabasePath: string;
export function openDatabase(filename?: string): DatabaseSync;
export function migrate(db: DatabaseSync): void;
export function resetDatabase(filename?: string): DatabaseSync;
export function seedDatabase(db: DatabaseSync): void;
export function resetAndSeed(filename?: string): DatabaseSync;
