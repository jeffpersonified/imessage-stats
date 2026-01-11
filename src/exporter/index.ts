import { openMessagesDb } from './database';
import { loadContacts, lookupContact, ContactMaps } from './contacts';
import { getHandleStats, getMonthlyMessages, getTimeHeatmap, getAttachments } from './messages';
import { getResponseStats } from './response-stats';
import { convertAppleTimestamp, formatDate } from './timestamp-utils';
import { safeFilename } from './phone-utils';
import {
  ExportOptions,
  ExportResult,
  ExportProgress,
  ContactSummary,
  ContactData,
  MergedContact,
} from './types';

/**
 * Run the full export process
 */
export async function runExport(options: ExportOptions): Promise<ExportResult> {
  const { limit, onProgress } = options;

  const report = (progress: ExportProgress) => {
    onProgress?.(progress);
  };

  // Phase 1: Load contacts
  report({
    phase: 'loading-contacts',
    current: 0,
    total: 1,
    message: 'Loading contacts from AddressBook...',
  });

  const contactMaps = loadContacts();
  const totalContacts = contactMaps.phoneToContact.size + contactMaps.emailToContact.size;

  report({
    phase: 'loading-contacts',
    current: 1,
    total: 1,
    message: `Found ${totalContacts} contact entries`,
  });

  // Phase 2: Query iMessage database
  report({
    phase: 'querying-messages',
    current: 0,
    total: 1,
    message: 'Querying iMessage database...',
  });

  const db = openMessagesDb();
  const handleStats = getHandleStats(db);

  report({
    phase: 'querying-messages',
    current: 1,
    total: 1,
    message: `Found ${handleStats.length} conversation handles`,
  });

  // Phase 3: Group by contact ID
  report({
    phase: 'processing-contacts',
    current: 0,
    total: handleStats.length,
    message: 'Processing contacts...',
  });

  const contactsById = new Map<string, MergedContact[]>();
  let processed = 0;

  for (const handle of handleStats) {
    const contactInfo = lookupContact(handle.identifier, contactMaps);

    if (!contactInfo) {
      processed++;
      continue;
    }

    const { name, contactId } = contactInfo;
    const firstDate = formatDate(convertAppleTimestamp(handle.first_msg));
    const lastDate = formatDate(convertAppleTimestamp(handle.last_msg));

    const entry: MergedContact = {
      name,
      identifier: handle.identifier,
      handleRowids: [handle.handle_rowid],
      sent: handle.sent,
      received: handle.received,
      total: handle.sent + handle.received,
      firstDate,
      lastDate,
    };

    const existing = contactsById.get(contactId);
    if (existing) {
      existing.push(entry);
    } else {
      contactsById.set(contactId, [entry]);
    }

    processed++;
    if (processed % 100 === 0) {
      report({
        phase: 'processing-contacts',
        current: processed,
        total: handleStats.length,
        message: `Processing contacts... (${processed}/${handleStats.length})`,
      });
    }
  }

  // Merge multiple identifiers for same contact
  const mergedContacts: MergedContact[] = [];

  for (const entries of contactsById.values()) {
    // Collect all handle rowids
    const handleRowids = entries.flatMap(e => e.handleRowids);

    // Prefer phone over email for primary identifier
    const phoneEntries = entries.filter(e => !e.identifier.includes('@'));
    const identifier = phoneEntries.length > 0 ? phoneEntries[0].identifier : entries[0].identifier;

    const totalSent = entries.reduce((sum, e) => sum + e.sent, 0);
    const totalReceived = entries.reduce((sum, e) => sum + e.received, 0);

    const firstDates = entries.map(e => e.firstDate).filter(Boolean) as string[];
    const lastDates = entries.map(e => e.lastDate).filter(Boolean) as string[];

    mergedContacts.push({
      name: entries[0].name,
      identifier,
      handleRowids,
      sent: totalSent,
      received: totalReceived,
      total: totalSent + totalReceived,
      firstDate: firstDates.length > 0 ? firstDates.sort()[0] : null,
      lastDate: lastDates.length > 0 ? lastDates.sort().reverse()[0] : null,
    });
  }

  // Sort by total and limit
  mergedContacts.sort((a, b) => b.total - a.total);
  const topContacts = mergedContacts.slice(0, limit);

  // Phase 4: Export detailed data for each contact
  const contacts: ContactSummary[] = [];
  const messages: Record<string, ContactData> = {};

  for (let i = 0; i < topContacts.length; i++) {
    const contact = topContacts[i];
    const filename = safeFilename(contact.name, contact.identifier);

    report({
      phase: 'exporting',
      current: i + 1,
      total: topContacts.length,
      message: `Exporting ${contact.name}... (${i + 1}/${topContacts.length})`,
    });

    // Add to contacts list
    contacts.push({
      rank: i + 1,
      name: contact.name,
      identifier: contact.identifier,
      filename,
      sent: contact.sent,
      received: contact.received,
      total: contact.total,
      first_date: contact.firstDate,
      last_date: contact.lastDate,
    });

    // Generate detailed contact data
    const handleIds = contact.handleRowids;
    messages[filename] = {
      name: contact.name,
      monthly: getMonthlyMessages(db, handleIds),
      time_heatmap: getTimeHeatmap(db, handleIds),
      attachments: getAttachments(db, handleIds),
      response_stats: getResponseStats(db, handleIds),
    };
  }

  db.close();

  report({
    phase: 'complete',
    current: topContacts.length,
    total: topContacts.length,
    message: `Exported ${topContacts.length} contacts`,
  });

  return { contacts, messages };
}
