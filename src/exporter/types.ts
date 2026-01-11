/**
 * Progress updates during export
 */
export interface ExportProgress {
  phase: 'loading-contacts' | 'querying-messages' | 'processing-contacts' | 'exporting' | 'complete';
  current: number;
  total: number;
  message: string;
}

/**
 * Options for running an export
 */
export interface ExportOptions {
  limit: number;
  onProgress?: (progress: ExportProgress) => void;
}

/**
 * Contact summary for the contacts list
 */
export interface ContactSummary {
  rank: number;
  name: string;
  identifier: string;
  filename: string;
  sent: number;
  received: number;
  total: number;
  first_date: string | null;
  last_date: string | null;
}

/**
 * Monthly message counts
 */
export interface MonthlyData {
  month: string;
  sent: number;
  received: number;
}

/**
 * Attachment counts by type
 */
export interface AttachmentCounts {
  photos_sent: number;
  photos_received: number;
  videos_sent: number;
  videos_received: number;
  audio_sent: number;
  audio_received: number;
  gifs_sent: number;
  gifs_received: number;
}

/**
 * Response time statistics
 */
export interface ResponseStats {
  you_avg_seconds: number | null;
  them_avg_seconds: number | null;
  you_start_pct: number | null;
}

/**
 * Full contact data with all statistics
 */
export interface ContactData {
  name: string;
  monthly: MonthlyData[];
  time_heatmap: number[][];
  attachments: AttachmentCounts;
  response_stats: ResponseStats;
}

/**
 * Top contact for yearly view
 */
export interface TopContact {
  rank: number;
  name: string;
  filename: string;
  total: number;
  sent: number;
  received: number;
}

/**
 * Per-year data for Everyone view
 */
export interface YearData {
  sent: number;
  received: number;
  monthly: MonthlyData[];
  time_heatmap: number[][];
  attachments: AttachmentCounts;
  top_contacts: TopContact[];
  busiest_month: { month: string; total: number } | null;
}

/**
 * Everyone aggregation data
 */
export interface EveryoneData {
  total_sent: number;
  total_received: number;
  first_date: string | null;
  last_date: string | null;
  years: string[];
  monthly: MonthlyData[];
  time_heatmap: number[][];
  attachments: AttachmentCounts;
  by_year: Record<string, YearData>;
}

/**
 * Result of running an export
 */
export interface ExportResult {
  contacts: ContactSummary[];
  messages: Record<string, ContactData>;
  everyone: EveryoneData;
}

/**
 * Raw handle data from the database query
 */
export interface HandleStats {
  handle_rowid: number;
  identifier: string;
  sent: number;
  received: number;
  first_msg: number | null;
  last_msg: number | null;
}

/**
 * Contact info from AddressBook lookup
 */
export interface ContactInfo {
  name: string;
  contactId: string;
}

/**
 * Merged contact with all identifiers
 */
export interface MergedContact {
  name: string;
  identifier: string;
  handleRowids: number[];
  sent: number;
  received: number;
  total: number;
  firstDate: string | null;
  lastDate: string | null;
}
