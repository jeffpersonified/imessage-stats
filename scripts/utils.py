"""
Utility functions for iMessage Stats.
"""

import hashlib
import re
import sys
from datetime import datetime, timedelta

APPLE_EPOCH = datetime(2001, 1, 1)

# URL pattern for link extraction (matches http/https URLs and common TLDs)
URL_PATTERN = re.compile(
    r'https?://[^\s<>"\'\]\)]+|'
    r'(?<![/@\w])\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+'
    r'(?:com|org|net|io|co|me|app|dev|ai|tv|edu|gov|uk|de|fr|jp|ca|au|nl|es|it|be|ch|se|no|fi|dk|at|nz|ie|pt|pl|ru|br|mx|in|cn|kr|hk|sg|tw|my|ph|th|vn|id)'
    r'(?:/[^\s<>"\'\]\)]*)?',
    re.IGNORECASE
)


def extract_text_from_attributed_body(blob):
    """Extract the text string from an attributedBody blob.

    The blob is an archived NSMutableAttributedString. The text content
    appears after the NSString class declaration, prefixed with a length byte.
    """
    if not blob:
        return None

    try:
        # Look for the text after NSString marker - there are two variants
        marker1 = b'NSString\x01\x95\x84\x01+'
        marker2 = b'NSString\x01\x94\x84\x01+'

        idx = blob.find(marker1)
        marker_len = len(marker1)
        if idx == -1:
            idx = blob.find(marker2)
            marker_len = len(marker2)
        if idx == -1:
            return None

        start = idx + marker_len
        if start >= len(blob):
            return None

        length_byte = blob[start]

        if length_byte < 0x80:
            text_start = start + 1
            text_length = length_byte
        elif length_byte == 0x81:
            if start + 2 >= len(blob):
                return None
            text_start = start + 3
            text_length = blob[start + 1]
        else:
            return None

        if text_start + text_length > len(blob):
            return None

        text_bytes = blob[text_start:text_start + text_length]
        return text_bytes.decode('utf-8', errors='replace')
    except Exception:
        return None


def format_duration(seconds):
    """Format seconds as human-readable duration."""
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    elif seconds < 60:
        return f"{seconds:.1f}s"
    else:
        mins = int(seconds // 60)
        secs = seconds % 60
        return f"{mins}m {secs:.0f}s"


def print_progress(current, total, width=30):
    """Print a progress bar that updates in place.

    In TTY mode, overwrites the current line. Otherwise, prints at 10% intervals.
    """
    pct = current / total if total > 0 else 0

    # Check if we're in a terminal
    is_tty = sys.stdout.isatty()

    if is_tty:
        filled = int(width * pct)
        bar = "█" * filled + "░" * (width - filled)
        # Use \r to return to start of line, then clear the line
        line = f"\r  [{bar}] {current}/{total}"
        sys.stdout.write(line)
        sys.stdout.flush()
        if current >= total:
            print()  # Move to next line when complete
    else:
        # Non-TTY: only print at 10% intervals to avoid spam
        pct_int = int(pct * 100)
        prev_pct = int(((current - 1) / total) * 100) if current > 1 else -1
        # Print at 0%, 10%, 20%, ... 100%
        if current == 1 or current == total or (pct_int // 10 > prev_pct // 10):
            print(f"  {pct_int}% ({current}/{total})")


def convert_timestamp(ts):
    """Convert Apple's nanosecond timestamp to datetime."""
    if ts is None or ts == 0:
        return None
    try:
        return APPLE_EPOCH + timedelta(seconds=ts / 1e9)
    except (ValueError, OverflowError):
        return None


def slugify(text):
    """Convert text to URL-friendly slug."""
    # Lowercase and replace spaces with hyphens
    slug = text.lower().strip().replace(" ", "-")
    # Remove non-alphanumeric characters except hyphens
    slug = re.sub(r"[^a-z0-9\-]", "", slug)
    # Collapse multiple hyphens
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def safe_filename(name, identifier):
    """Create a safe filename from contact name and identifier."""
    slug = slugify(name)
    # Use last 4 digits of phone or first 8 chars of email hash for uniqueness
    if "@" in identifier:
        suffix = hashlib.md5(identifier.lower().encode()).hexdigest()[:8]
    else:
        digits = re.sub(r"\D", "", identifier)
        suffix = digits[-4:] if len(digits) >= 4 else digits
    return f"{slug}-{suffix}"
