/**
 * Normalize phone number for matching.
 *
 * Preserves country code to avoid international number collisions.
 * For numbers with 11+ digits starting with country code, keeps the full number.
 * For 10-digit numbers (US/Canada without country code), keeps as-is.
 */
export function normalizePhone(phone: string | null): string {
  if (!phone) return '';

  const digits = phone.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    // US/Canada with country code - normalize to 10 digits
    return digits.slice(1);
  }

  if (digits.length === 10) {
    // US/Canada without country code
    return digits;
  }

  // International or other formats - keep full digits to avoid collisions
  return digits;
}

/**
 * Convert text to URL-friendly slug.
 */
export function slugify(text: string): string {
  // Lowercase and replace spaces with hyphens
  let slug = text.toLowerCase().trim().replace(/ /g, '-');
  // Remove non-alphanumeric characters except hyphens
  slug = slug.replace(/[^a-z0-9-]/g, '');
  // Collapse multiple hyphens
  slug = slug.replace(/-+/g, '-');
  return slug.replace(/^-|-$/g, '');
}

/**
 * Create a safe filename from contact name and identifier.
 * Uses last 4 digits of phone or first 8 chars of email hash for uniqueness.
 */
export function safeFilename(name: string, identifier: string): string {
  const slug = slugify(name);

  let suffix: string;
  if (identifier.includes('@')) {
    // Use first 8 chars of MD5 hash for email
    suffix = simpleHash(identifier.toLowerCase()).slice(0, 8);
  } else {
    const digits = identifier.replace(/\D/g, '');
    suffix = digits.length >= 4 ? digits.slice(-4) : digits;
  }

  return `${slug}-${suffix}`;
}

/**
 * Simple hash function (not cryptographic, just for filename uniqueness)
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
