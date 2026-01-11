import Database from 'better-sqlite3';
import { ResponseStats } from './types';

// 4 hours in nanoseconds - gap that defines a new conversation
const CONVERSATION_GAP = 4 * 60 * 60 * 1e9;

// 1 hour in nanoseconds - max time to count as a response
const RESPONSE_MAX = 60 * 60 * 1e9;

/**
 * Calculate average response times and conversation starter percentage
 */
export function getResponseStats(db: Database.Database, handleIds: number[]): ResponseStats {
  const defaults: ResponseStats = {
    you_avg_seconds: null,
    them_avg_seconds: null,
    you_start_pct: null,
  };

  if (handleIds.length === 0) return defaults;

  const placeholders = handleIds.map(() => '?').join(',');
  const stmt = db.prepare(`
    SELECT m.date, m.is_from_me
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
    WHERE chj.handle_id IN (${placeholders}) AND c.style = 45
    ORDER BY m.date
  `);

  const rows = stmt.all(...handleIds) as Array<{ date: number | null; is_from_me: number }>;
  const messages = rows.filter(r => r.date !== null) as Array<{ date: number; is_from_me: number }>;

  if (messages.length < 2) return defaults;

  // Calculate response times and conversation starters
  const yourResponseTimes: number[] = [];
  const theirResponseTimes: number[] = [];
  let conversationsYouStarted = 0;
  let conversationsTheyStarted = 0;

  // First message starts the first conversation
  let prevTs = messages[0].date;
  let prevFromMe = messages[0].is_from_me;

  if (prevFromMe) {
    conversationsYouStarted++;
  } else {
    conversationsTheyStarted++;
  }

  for (let i = 1; i < messages.length; i++) {
    const { date: ts, is_from_me: isFromMe } = messages[i];
    const gap = ts - prevTs;

    // Check if this is a new conversation
    if (gap > CONVERSATION_GAP) {
      if (isFromMe) {
        conversationsYouStarted++;
      } else {
        conversationsTheyStarted++;
      }
    } else if (isFromMe !== prevFromMe && gap < RESPONSE_MAX) {
      // This is a response
      const responseSeconds = gap / 1e9;
      if (isFromMe) {
        yourResponseTimes.push(responseSeconds);
      } else {
        theirResponseTimes.push(responseSeconds);
      }
    }

    prevTs = ts;
    prevFromMe = isFromMe;
  }

  // Calculate averages
  const youAvg = yourResponseTimes.length > 0
    ? yourResponseTimes.reduce((a, b) => a + b, 0) / yourResponseTimes.length
    : null;

  const themAvg = theirResponseTimes.length > 0
    ? theirResponseTimes.reduce((a, b) => a + b, 0) / theirResponseTimes.length
    : null;

  const totalConvos = conversationsYouStarted + conversationsTheyStarted;
  const youStartPct = totalConvos > 0 ? conversationsYouStarted / totalConvos : null;

  return {
    you_avg_seconds: youAvg !== null ? Math.round(youAvg) : null,
    them_avg_seconds: themAvg !== null ? Math.round(themAvg) : null,
    you_start_pct: youStartPct !== null ? Math.round(youStartPct * 100) / 100 : null,
  };
}
