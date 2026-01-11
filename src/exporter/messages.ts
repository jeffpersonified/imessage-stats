import Database from 'better-sqlite3';
import { HandleStats, MonthlyData, AttachmentCounts } from './types';

/**
 * Get all handles with message statistics
 */
export function getHandleStats(db: Database.Database): HandleStats[] {
  const stmt = db.prepare(`
    SELECT
      h.ROWID as handle_rowid,
      h.id as identifier,
      SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received,
      MIN(m.date) as first_msg,
      MAX(m.date) as last_msg
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
    JOIN handle h ON chj.handle_id = h.ROWID
    WHERE c.style = 45
    GROUP BY h.id
    ORDER BY (sent + received) DESC
  `);

  return stmt.all() as HandleStats[];
}

/**
 * Get monthly message counts for a set of handle IDs
 */
export function getMonthlyMessages(db: Database.Database, handleIds: number[]): MonthlyData[] {
  if (handleIds.length === 0) return [];

  const placeholders = handleIds.map(() => '?').join(',');
  const stmt = db.prepare(`
    SELECT
      strftime('%Y-%m', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as month,
      m.is_from_me
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
    WHERE chj.handle_id IN (${placeholders}) AND c.style = 45
  `);

  const rows = stmt.all(...handleIds) as Array<{ month: string | null; is_from_me: number }>;

  // Aggregate by month
  const monthly = new Map<string, { sent: number; received: number }>();
  for (const row of rows) {
    if (!row.month) continue;
    const current = monthly.get(row.month) ?? { sent: 0, received: 0 };
    if (row.is_from_me) {
      current.sent++;
    } else {
      current.received++;
    }
    monthly.set(row.month, current);
  }

  return Array.from(monthly.entries())
    .map(([month, data]) => ({ month, sent: data.sent, received: data.received }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Get message counts by day of week and hour for a heatmap
 */
export function getTimeHeatmap(db: Database.Database, handleIds: number[]): number[][] {
  if (handleIds.length === 0) {
    return Array.from({ length: 7 }, () => Array(24).fill(0));
  }

  const placeholders = handleIds.map(() => '?').join(',');
  const stmt = db.prepare(`
    SELECT
      CAST(strftime('%w', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as day,
      CAST(strftime('%H', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as hour,
      COUNT(*) as count
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
    WHERE chj.handle_id IN (${placeholders}) AND c.style = 45
    GROUP BY day, hour
  `);

  const rows = stmt.all(...handleIds) as Array<{ day: number | null; hour: number | null; count: number }>;

  // Initialize 7x24 grid (days x hours)
  const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const row of rows) {
    if (row.day !== null && row.hour !== null) {
      heatmap[row.day][row.hour] = row.count;
    }
  }

  return heatmap;
}

/**
 * Get attachment counts by type
 */
export function getAttachments(db: Database.Database, handleIds: number[]): AttachmentCounts {
  const defaults: AttachmentCounts = {
    photos_sent: 0,
    photos_received: 0,
    videos_sent: 0,
    videos_received: 0,
    audio_sent: 0,
    audio_received: 0,
    gifs_sent: 0,
    gifs_received: 0,
  };

  if (handleIds.length === 0) return defaults;

  const placeholders = handleIds.map(() => '?').join(',');
  const stmt = db.prepare(`
    SELECT
      a.mime_type,
      m.is_from_me,
      COUNT(*) as count
    FROM attachment a
    JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
    JOIN message m ON maj.message_id = m.ROWID
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
    WHERE chj.handle_id IN (${placeholders}) AND c.style = 45
    GROUP BY a.mime_type, m.is_from_me
  `);

  const rows = stmt.all(...handleIds) as Array<{ mime_type: string | null; is_from_me: number; count: number }>;

  const attachments = { ...defaults };

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
