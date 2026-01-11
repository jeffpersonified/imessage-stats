import { open } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { shell } from 'electron';

export const CHAT_DB_PATH = join(homedir(), 'Library/Messages/chat.db');
export const CONTACTS_PATH = join(homedir(), 'Library/Application Support/AddressBook/Sources');

/**
 * Check if app has Full Disk Access by attempting to read chat.db
 * We must actually open and read the file (not just check access) to trigger
 * macOS to add the app to the Full Disk Access list in System Settings.
 */
export async function checkFullDiskAccess(): Promise<boolean> {
  let fileHandle;
  try {
    fileHandle = await open(CHAT_DB_PATH, 'r');
    // Read a single byte to confirm we have actual read access
    const buffer = Buffer.alloc(1);
    await fileHandle.read(buffer, 0, 1, 0);
    return true;
  } catch {
    return false;
  } finally {
    await fileHandle?.close();
  }
}

/**
 * Check if we can access the Contacts database
 */
export async function checkContactsAccess(): Promise<boolean> {
  try {
    // Try to open the directory to trigger macOS permission registration
    const dirHandle = await open(CONTACTS_PATH, 'r');
    await dirHandle.close();
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
