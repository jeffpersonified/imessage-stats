import Database from 'better-sqlite3';
import { convertAppleTimestamp, formatDate } from './timestamp-utils';
import {
  ContactSummary,
  AttachmentCounts,
  MonthlyData,
  EveryoneData,
  YearData,
  TopContact,
} from './types';

interface GlobalStats {
  total_sent: number;
  total_received: number;
  first_date: string | null;
  last_date: string | null;
}

/**
 * Get total message counts across all 1-on-1 conversations
 */
export function getGlobalStats(db: Database.Database): GlobalStats {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as total_sent,
      SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as total_received,
      MIN(m.date) as first_msg,
      MAX(m.date) as last_msg
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE c.style = 45
  `).get() as { total_sent: number; total_received: number; first_msg: number; last_msg: number } | undefined;

  if (!row) {
    return { total_sent: 0, total_received: 0, first_date: null, last_date: null };
  }

  return {
    total_sent: row.total_sent || 0,
    total_received: row.total_received || 0,
    first_date: row.first_msg ? formatDate(convertAppleTimestamp(row.first_msg)) : null,
    last_date: row.last_msg ? formatDate(convertAppleTimestamp(row.last_msg)) : null,
  };
}

/**
 * Get monthly message counts across all 1-on-1 conversations
 */
export function getGlobalMonthly(db: Database.Database): MonthlyData[] {
  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as month,
      SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE c.style = 45
    GROUP BY month
    ORDER BY month
  `).all() as { month: string; sent: number; received: number }[];

  return rows
    .filter(row => row.month)
    .map(row => ({
      month: row.month,
      sent: row.sent,
      received: row.received,
    }));
}

/**
 * Get message counts by day of week and hour across all 1-on-1 conversations
 */
export function getGlobalHeatmap(db: Database.Database): number[][] {
  const rows = db.prepare(`
    SELECT
      CAST(strftime('%w', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as day,
      CAST(strftime('%H', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as hour,
      COUNT(*) as count
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE c.style = 45
    GROUP BY day, hour
  `).all() as { day: number; hour: number; count: number }[];

  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const row of rows) {
    if (row.day !== null && row.hour !== null) {
      heatmap[row.day][row.hour] = row.count;
    }
  }
  return heatmap;
}

/**
 * Get attachment counts by type across all 1-on-1 conversations
 */
export function getGlobalAttachments(db: Database.Database): AttachmentCounts {
  const rows = db.prepare(`
    SELECT
      a.mime_type,
      m.is_from_me,
      COUNT(*) as count
    FROM attachment a
    JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
    JOIN message m ON maj.message_id = m.ROWID
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE c.style = 45
    GROUP BY a.mime_type, m.is_from_me
  `).all() as { mime_type: string; is_from_me: number; count: number }[];

  const attachments: AttachmentCounts = {
    photos_sent: 0, photos_received: 0,
    videos_sent: 0, videos_received: 0,
    audio_sent: 0, audio_received: 0,
    gifs_sent: 0, gifs_received: 0,
  };

  for (const row of rows) {
    if (!row.mime_type) continue;
    const direction = row.is_from_me ? 'sent' : 'received';
    if (row.mime_type.startsWith('image/gif')) {
      attachments[`gifs_${direction}` as keyof AttachmentCounts] += row.count;
    } else if (row.mime_type.startsWith('image/')) {
      attachments[`photos_${direction}` as keyof AttachmentCounts] += row.count;
    } else if (row.mime_type.startsWith('video/')) {
      attachments[`videos_${direction}` as keyof AttachmentCounts] += row.count;
    } else if (row.mime_type.startsWith('audio/')) {
      attachments[`audio_${direction}` as keyof AttachmentCounts] += row.count;
    }
  }

  return attachments;
}

/**
 * Get per-year statistics including top contacts and busiest month
 */
export function getYearlyData(
  db: Database.Database,
  globalMonthly: MonthlyData[],
  contacts: ContactSummary[]
): Record<string, YearData> {
  // Build lookup from identifier to contact
  const contactByIdentifier = new Map<string, ContactSummary>();
  for (const c of contacts) {
    contactByIdentifier.set(c.identifier, c);
  }

  // Query yearly message counts per identifier
  const yearlyContactRows = db.prepare(`
    SELECT
      strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
      h.id as identifier,
      SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
    JOIN handle h ON chj.handle_id = h.ROWID
    WHERE c.style = 45
    GROUP BY year, h.id
  `).all() as { year: string; identifier: string; sent: number; received: number }[];

  // Group by year
  const yearlyContacts = new Map<string, Array<{ identifier: string; sent: number; received: number; total: number }>>();
  for (const row of yearlyContactRows) {
    if (!row.year) continue;
    if (!yearlyContacts.has(row.year)) {
      yearlyContacts.set(row.year, []);
    }
    yearlyContacts.get(row.year)!.push({
      identifier: row.identifier,
      sent: row.sent,
      received: row.received,
      total: row.sent + row.received,
    });
  }

  // Query yearly heatmaps
  const yearlyHeatmapRows = db.prepare(`
    SELECT
      strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
      CAST(strftime('%w', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as day,
      CAST(strftime('%H', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as hour,
      COUNT(*) as count
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE c.style = 45
    GROUP BY year, day, hour
  `).all() as { year: string; day: number; hour: number; count: number }[];

  const yearlyHeatmaps = new Map<string, number[][]>();
  for (const row of yearlyHeatmapRows) {
    if (!row.year || row.day === null || row.hour === null) continue;
    if (!yearlyHeatmaps.has(row.year)) {
      yearlyHeatmaps.set(row.year, Array.from({ length: 7 }, () => Array(24).fill(0)));
    }
    yearlyHeatmaps.get(row.year)![row.day][row.hour] = row.count;
  }

  // Query yearly attachments
  const yearlyAttachmentRows = db.prepare(`
    SELECT
      strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
      a.mime_type,
      m.is_from_me,
      COUNT(*) as count
    FROM attachment a
    JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
    JOIN message m ON maj.message_id = m.ROWID
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE c.style = 45
    GROUP BY year, a.mime_type, m.is_from_me
  `).all() as { year: string; mime_type: string; is_from_me: number; count: number }[];

  const yearlyAttachments = new Map<string, AttachmentCounts>();
  for (const row of yearlyAttachmentRows) {
    if (!row.year || !row.mime_type) continue;
    if (!yearlyAttachments.has(row.year)) {
      yearlyAttachments.set(row.year, {
        photos_sent: 0, photos_received: 0,
        videos_sent: 0, videos_received: 0,
        audio_sent: 0, audio_received: 0,
        gifs_sent: 0, gifs_received: 0,
      });
    }
    const att = yearlyAttachments.get(row.year)!;
    const direction = row.is_from_me ? 'sent' : 'received';
    if (row.mime_type.startsWith('image/gif')) {
      att[`gifs_${direction}` as keyof AttachmentCounts] += row.count;
    } else if (row.mime_type.startsWith('image/')) {
      att[`photos_${direction}` as keyof AttachmentCounts] += row.count;
    } else if (row.mime_type.startsWith('video/')) {
      att[`videos_${direction}` as keyof AttachmentCounts] += row.count;
    } else if (row.mime_type.startsWith('audio/')) {
      att[`audio_${direction}` as keyof AttachmentCounts] += row.count;
    }
  }

  // Group global monthly by year
  const monthlyByYear = new Map<string, MonthlyData[]>();
  for (const m of globalMonthly) {
    const year = m.month.substring(0, 4);
    if (!monthlyByYear.has(year)) {
      monthlyByYear.set(year, []);
    }
    monthlyByYear.get(year)!.push(m);
  }

  // Build yearly data
  const byYear: Record<string, YearData> = {};
  const years = Array.from(yearlyContacts.keys()).sort().reverse();

  for (const year of years) {
    const contactsForYear = yearlyContacts.get(year) || [];
    contactsForYear.sort((a, b) => b.total - a.total);

    // Get top 8 contacts that exist in our export
    const topContacts: TopContact[] = [];
    for (const c of contactsForYear) {
      if (topContacts.length >= 8) break;
      const exported = contactByIdentifier.get(c.identifier);
      if (exported) {
        topContacts.push({
          rank: topContacts.length + 1,
          name: exported.name,
          filename: exported.filename,
          total: c.total,
          sent: c.sent,
          received: c.received,
        });
      }
    }

    // Calculate yearly totals
    const yearMonthly = monthlyByYear.get(year) || [];
    const yearSent = yearMonthly.reduce((sum, m) => sum + m.sent, 0);
    const yearReceived = yearMonthly.reduce((sum, m) => sum + m.received, 0);

    // Find busiest month
    let busiestMonth: { month: string; total: number } | null = null;
    if (yearMonthly.length > 0) {
      const busiest = yearMonthly.reduce((max, m) =>
        (m.sent + m.received) > (max.sent + max.received) ? m : max
      );
      busiestMonth = {
        month: busiest.month,
        total: busiest.sent + busiest.received,
      };
    }

    byYear[year] = {
      sent: yearSent,
      received: yearReceived,
      monthly: yearMonthly,
      time_heatmap: yearlyHeatmaps.get(year) || Array.from({ length: 7 }, () => Array(24).fill(0)),
      attachments: yearlyAttachments.get(year) || {
        photos_sent: 0, photos_received: 0,
        videos_sent: 0, videos_received: 0,
        audio_sent: 0, audio_received: 0,
        gifs_sent: 0, gifs_received: 0,
      },
      top_contacts: topContacts,
      busiest_month: busiestMonth,
    };
  }

  return byYear;
}

/**
 * Generate complete "Everyone" data for global view
 */
export function generateEveryoneData(
  db: Database.Database,
  contacts: ContactSummary[]
): EveryoneData {
  const globalStats = getGlobalStats(db);
  const globalMonthly = getGlobalMonthly(db);
  const globalHeatmap = getGlobalHeatmap(db);
  const globalAttachments = getGlobalAttachments(db);
  const yearlyData = getYearlyData(db, globalMonthly, contacts);

  const years = Object.keys(yearlyData).sort().reverse();

  return {
    total_sent: globalStats.total_sent,
    total_received: globalStats.total_received,
    first_date: globalStats.first_date,
    last_date: globalStats.last_date,
    years,
    monthly: globalMonthly,
    time_heatmap: globalHeatmap,
    attachments: globalAttachments,
    by_year: yearlyData,
  };
}
