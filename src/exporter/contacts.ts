import { findContactsDatabases, openContactsDb } from './database';
import { normalizePhone } from './phone-utils';
import { ContactInfo } from './types';

/**
 * Contact lookup maps
 */
export interface ContactMaps {
  phoneToContact: Map<string, ContactInfo>;
  emailToContact: Map<string, ContactInfo>;
}

/**
 * Load contact name and ID mappings from AddressBook databases.
 *
 * Returns mappings from phone/email to (name, contactId) tuples.
 * The contactId is used to correctly group identifiers belonging to the
 * same contact, avoiding incorrect merges when different people share names.
 */
export function loadContacts(): ContactMaps {
  const phoneToContact = new Map<string, ContactInfo>();
  const emailToContact = new Map<string, ContactInfo>();

  const dbFiles = findContactsDatabases();

  if (dbFiles.length === 0) {
    console.warn('No AddressBook databases found');
    return { phoneToContact, emailToContact };
  }

  for (const dbPath of dbFiles) {
    try {
      const db = openContactsDb(dbPath);

      // Load phone numbers
      const phoneStmt = db.prepare(`
        SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, p.ZFULLNUMBER
        FROM ZABCDRECORD r
        JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
        WHERE p.ZFULLNUMBER IS NOT NULL
      `);

      for (const row of phoneStmt.iterate() as IterableIterator<{
        Z_PK: number;
        ZFIRSTNAME: string | null;
        ZLASTNAME: string | null;
        ZORGANIZATION: string | null;
        ZNICKNAME: string | null;
        ZFULLNUMBER: string;
      }>) {
        const name = buildContactName(row.ZFIRSTNAME, row.ZLASTNAME, row.ZORGANIZATION, row.ZNICKNAME);
        if (!name) continue;

        const normalized = normalizePhone(row.ZFULLNUMBER);
        if (normalized && !phoneToContact.has(normalized)) {
          phoneToContact.set(normalized, {
            name,
            contactId: `${dbPath}:${row.Z_PK}`,
          });
        }
      }

      // Load emails
      const emailStmt = db.prepare(`
        SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, e.ZADDRESS
        FROM ZABCDRECORD r
        JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
        WHERE e.ZADDRESS IS NOT NULL
      `);

      for (const row of emailStmt.iterate() as IterableIterator<{
        Z_PK: number;
        ZFIRSTNAME: string | null;
        ZLASTNAME: string | null;
        ZORGANIZATION: string | null;
        ZNICKNAME: string | null;
        ZADDRESS: string;
      }>) {
        const name = buildContactName(row.ZFIRSTNAME, row.ZLASTNAME, row.ZORGANIZATION, row.ZNICKNAME);
        if (!name) continue;

        const email = row.ZADDRESS.toLowerCase();
        if (!emailToContact.has(email)) {
          emailToContact.set(email, {
            name,
            contactId: `${dbPath}:${row.Z_PK}`,
          });
        }
      }

      db.close();
    } catch (error) {
      console.warn(`Could not read ${dbPath}:`, error);
    }
  }

  return { phoneToContact, emailToContact };
}

/**
 * Build contact name from available fields
 */
function buildContactName(
  firstName: string | null,
  lastName: string | null,
  organization: string | null,
  nickname: string | null
): string | null {
  const parts = [firstName, lastName].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(' ');
  }
  return nickname || organization || null;
}

/**
 * Look up contact info from phone or email identifier
 */
export function lookupContact(
  identifier: string,
  contactMaps: ContactMaps
): ContactInfo | null {
  if (!identifier) return null;

  if (identifier.includes('@')) {
    return contactMaps.emailToContact.get(identifier.toLowerCase()) ?? null;
  }

  return contactMaps.phoneToContact.get(normalizePhone(identifier)) ?? null;
}
