import { access, constants } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { shell } from 'electron';

export const CHAT_DB_PATH = join(homedir(), 'Library/Messages/chat.db');
export const CONTACTS_PATH = join(homedir(), 'Library/Application Support/AddressBook/Sources');

/**
 * Check if app has Full Disk Access by attempting to read chat.db
 */
export async function checkFullDiskAccess(): Promise<boolean> {
  try {
    await access(CHAT_DB_PATH, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if we can access the Contacts database
 */
export async function checkContactsAccess(): Promise<boolean> {
  try {
    await access(CONTACTS_PATH, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open System Preferences to Full Disk Access settings
 */
export function openSystemPreferences(): void {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
}
