import Database from 'better-sqlite3';
export declare function getDb(): Database.Database;
export declare function applyMigrations(d: Database.Database): void;
export declare function initDb(): void;
