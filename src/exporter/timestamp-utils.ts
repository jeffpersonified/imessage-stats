/**
 * Apple epoch: 2001-01-01 00:00:00 UTC
 * JavaScript Date uses Unix epoch (1970-01-01)
 */
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

/**
 * Convert Apple's nanosecond timestamp to JavaScript Date.
 */
export function convertAppleTimestamp(nanoseconds: number | null): Date | null {
  if (nanoseconds === null || nanoseconds === 0) {
    return null;
  }

  try {
    const milliseconds = nanoseconds / 1e6;
    return new Date(APPLE_EPOCH_MS + milliseconds);
  } catch {
    return null;
  }
}

/**
 * Format a Date as YYYY-MM-DD string.
 */
export function formatDate(date: Date | null): string | null {
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
