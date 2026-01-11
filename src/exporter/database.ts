import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { readdirSync, existsSync } from 'fs';

export const CHAT_DB_PATH = join(homedir(), 'Library/Messages/chat.db');
export const CONTACTS_BASE_PATH = join(homedir(), 'Library/Application Support/AddressBook/Sources');

/**
 * Open the iMessage database in read-only mode
 */
export function openMessagesDb(): Database.Database {
  return new Database(CHAT_DB_PATH, { readonly: true });
}

/**
 * Find all AddressBook database files
 */
export function findContactsDatabases(): string[] {
  if (!existsSync(CONTACTS_BASE_PATH)) {
    return [];
  }

  const databases: string[] = [];

  try {
    const sources = readdirSync(CONTACTS_BASE_PATH);
    for (const source of sources) {
      const dbPath = join(CONTACTS_BASE_PATH, source, 'AddressBook-v22.abcddb');
      if (existsSync(dbPath)) {
        databases.push(dbPath);
      }
    }
  } catch {
    // Ignore errors reading directory
  }

  return databases;
}

/**
 * Open a contacts database in read-only mode
 */
export function openContactsDb(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true });
}
