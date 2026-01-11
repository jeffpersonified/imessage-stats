#!/usr/bin/env python3
"""
Export iMessage statistics to JSON for the web visualization.

Usage:
    python export.py                    # Use default paths
    python export.py --limit 50         # Export top 50 contacts
    python export.py --db ~/Desktop/chat.db --contacts ~/Desktop/Sources
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
from glob import glob
from pathlib import Path

APPLE_EPOCH = datetime(2001, 1, 1)


def normalize_phone(phone):
    """Normalize phone number for matching.

    Preserves country code to avoid international number collisions.
    For numbers with 11+ digits starting with country code, keeps the full number.
    For 10-digit numbers (US/Canada without country code), keeps as-is.
    """
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 11 and digits.startswith("1"):
        # US/Canada with country code - normalize to 10 digits
        return digits[1:]
    if len(digits) == 10:
        # US/Canada without country code
        return digits
    # International or other formats - keep full digits to avoid collisions
    return digits


def convert_timestamp(ts):
    """Convert Apple's nanosecond timestamp to datetime."""
    if ts is None or ts == 0:
        return None
    try:
        return APPLE_EPOCH + timedelta(seconds=ts / 1e9)
    except (ValueError, OverflowError):
        return None


def load_contacts(contacts_dir):
    """Load contact name and ID mappings from AddressBook databases.

    Returns mappings from phone/email to (name, contact_id) tuples.
    The contact_id is used to correctly group identifiers belonging to the
    same contact, avoiding incorrect merges when different people share names.
    """
    phone_to_contact = {}  # normalized_phone -> (name, contact_id)
    email_to_contact = {}  # email -> (name, contact_id)

    db_files = glob(os.path.join(contacts_dir, "*/AddressBook-v22.abcddb"))
    if not db_files:
        print(f"Warning: No AddressBook databases found in {contacts_dir}")
        return phone_to_contact, email_to_contact

    for db_path in db_files:
        try:
            uri = f"file:{db_path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True)
            cursor = conn.cursor()

            # Phone numbers - include Z_PK as unique contact identifier
            cursor.execute("""
                SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, p.ZFULLNUMBER
                FROM ZABCDRECORD r
                JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
                WHERE p.ZFULLNUMBER IS NOT NULL
            """)
            for contact_id, first, last, org, nick, phone in cursor.fetchall():
                name = " ".join(p for p in [first, last] if p) or nick or org
                if name:
                    normalized = normalize_phone(phone)
                    if normalized and normalized not in phone_to_contact:
                        phone_to_contact[normalized] = (name, f"{db_path}:{contact_id}")

            # Emails - include Z_PK as unique contact identifier
            cursor.execute("""
                SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, e.ZADDRESS
                FROM ZABCDRECORD r
                JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
                WHERE e.ZADDRESS IS NOT NULL
            """)
            for contact_id, first, last, org, nick, email in cursor.fetchall():
                name = " ".join(p for p in [first, last] if p) or nick or org
                if name and email.lower() not in email_to_contact:
                    email_to_contact[email.lower()] = (name, f"{db_path}:{contact_id}")

            conn.close()
        except Exception as e:
            print(f"Warning: Could not read {db_path}: {e}")

    return phone_to_contact, email_to_contact


def lookup_contact(identifier, phone_to_contact, email_to_contact):
    """Look up contact info (name, contact_id) from phone or email.

    Returns (name, contact_id) tuple or (None, None) if not found.
    """
    if not identifier:
        return None, None
    if "@" in identifier:
        return email_to_contact.get(identifier.lower(), (None, None))
    return phone_to_contact.get(normalize_phone(identifier), (None, None))


def get_monthly_messages(cursor, handle_ids):
    """Get monthly message counts for a set of handle IDs.

    Uses local time for consistent month boundaries with user's timezone.
    """
    if not handle_ids:
        return []

    placeholders = ",".join("?" * len(handle_ids))
    # Use SQLite to compute year-month in local time for consistency
    cursor.execute(f"""
        SELECT
            strftime('%Y-%m', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as month,
            m.is_from_me
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        WHERE chj.handle_id IN ({placeholders}) AND c.style = 45
    """, handle_ids)

    monthly = defaultdict(lambda: {"sent": 0, "received": 0})
    for month, is_from_me in cursor.fetchall():
        if month:
            if is_from_me:
                monthly[month]["sent"] += 1
            else:
                monthly[month]["received"] += 1

    return [
        {"month": m, "sent": d["sent"], "received": d["received"]}
        for m, d in sorted(monthly.items())
    ]


def get_time_heatmap(cursor, handle_ids):
    """Get message counts by day of week and hour for a heatmap.

    Uses local time for accurate "when you text" visualization.
    """
    if not handle_ids:
        return [[0] * 24 for _ in range(7)]

    placeholders = ",".join("?" * len(handle_ids))
    cursor.execute(f"""
        SELECT
            CAST(strftime('%w', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as day,
            CAST(strftime('%H', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as hour,
            COUNT(*) as count
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        WHERE chj.handle_id IN ({placeholders}) AND c.style = 45
        GROUP BY day, hour
    """, handle_ids)

    # Initialize 7x24 grid (days x hours)
    heatmap = [[0] * 24 for _ in range(7)]
    for day, hour, count in cursor.fetchall():
        if day is not None and hour is not None:
            heatmap[day][hour] = count

    return heatmap


def get_attachments(cursor, handle_ids):
    """Get attachment counts by type."""
    if not handle_ids:
        return {
            "photos_sent": 0, "photos_received": 0,
            "videos_sent": 0, "videos_received": 0,
            "audio_sent": 0, "audio_received": 0,
            "gifs_sent": 0, "gifs_received": 0,
        }

    placeholders = ",".join("?" * len(handle_ids))
    cursor.execute(f"""
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
        WHERE chj.handle_id IN ({placeholders}) AND c.style = 45
        GROUP BY a.mime_type, m.is_from_me
    """, handle_ids)

    attachments = {
        "photos_sent": 0, "photos_received": 0,
        "videos_sent": 0, "videos_received": 0,
        "audio_sent": 0, "audio_received": 0,
        "gifs_sent": 0, "gifs_received": 0,
    }

    for mime_type, is_from_me, count in cursor.fetchall():
        if not mime_type:
            continue
        direction = "sent" if is_from_me else "received"
        if mime_type.startswith("image/gif"):
            attachments[f"gifs_{direction}"] += count
        elif mime_type.startswith("image/"):
            attachments[f"photos_{direction}"] += count
        elif mime_type.startswith("video/"):
            attachments[f"videos_{direction}"] += count
        elif mime_type.startswith("audio/"):
            attachments[f"audio_{direction}"] += count

    return attachments


def get_response_stats(cursor, handle_ids):
    """Calculate average response times and conversation starter percentage."""
    if not handle_ids:
        return {"you_avg_seconds": None, "them_avg_seconds": None, "you_start_pct": None}

    placeholders = ",".join("?" * len(handle_ids))

    # Get all messages ordered by date
    cursor.execute(f"""
        SELECT m.date, m.is_from_me
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        WHERE chj.handle_id IN ({placeholders}) AND c.style = 45
        ORDER BY m.date
    """, handle_ids)

    messages = [(ts, is_from_me) for ts, is_from_me in cursor.fetchall() if ts]

    if len(messages) < 2:
        return {"you_avg_seconds": None, "them_avg_seconds": None, "you_start_pct": None}

    # Calculate response times and conversation starters
    CONVERSATION_GAP = 4 * 60 * 60 * 1e9  # 4 hours in nanoseconds
    RESPONSE_MAX = 60 * 60 * 1e9  # Only count responses within 1 hour as actual responses

    your_response_times = []
    their_response_times = []
    conversations_you_started = 0
    conversations_they_started = 0

    # The first message starts the first conversation
    prev_ts, prev_from_me = messages[0]
    if prev_from_me:
        conversations_you_started += 1
    else:
        conversations_they_started += 1

    for ts, is_from_me in messages[1:]:
        gap = ts - prev_ts

        # Check if this is a new conversation
        if gap > CONVERSATION_GAP:
            if is_from_me:
                conversations_you_started += 1
            else:
                conversations_they_started += 1
        # Otherwise, check if this is a response
        elif is_from_me != prev_from_me and gap < RESPONSE_MAX:
            response_seconds = gap / 1e9
            if is_from_me:
                your_response_times.append(response_seconds)
            else:
                their_response_times.append(response_seconds)

        prev_ts, prev_from_me = ts, is_from_me

    # Calculate averages
    you_avg = sum(your_response_times) / len(your_response_times) if your_response_times else None
    them_avg = sum(their_response_times) / len(their_response_times) if their_response_times else None

    total_convos = conversations_you_started + conversations_they_started
    you_start_pct = conversations_you_started / total_convos if total_convos > 0 else None

    return {
        "you_avg_seconds": round(you_avg) if you_avg else None,
        "them_avg_seconds": round(them_avg) if them_avg else None,
        "you_start_pct": round(you_start_pct, 2) if you_start_pct is not None else None
    }


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


def main():
    parser = argparse.ArgumentParser(
        description="Export iMessage statistics for visualization"
    )
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parser.add_argument(
        "--db",
        default=os.path.join(project_dir, "chat.db"),
        help="Path to iMessage database (default: ./chat.db)",
    )
    parser.add_argument(
        "--contacts",
        default=os.path.join(project_dir, "Sources"),
        help="Path to Contacts sources directory (default: ./Sources)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Number of top contacts to export (default: 100)",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(project_dir, "web", "data"),
        help="Output directory (default: web/data)",
    )
    args = parser.parse_args()

    # Verify database exists
    if not os.path.exists(args.db):
        print(f"Error: Database not found at {args.db}")
        print("\nCopy your iMessage database to the project folder:")
        print("  1. Open Finder → Go → Go to Folder → ~/Library/Messages")
        print("  2. Copy chat.db to this project folder")
        print("\nOr specify a custom path with --db")
        return 1

    print("Loading contacts...")
    phone_to_contact, email_to_contact = load_contacts(args.contacts)
    print(f"  Found {len(phone_to_contact)} phone and {len(email_to_contact)} email mappings")

    print("Querying iMessage database...")
    uri = f"file:{args.db}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    cursor = conn.cursor()

    # Query using correct join pattern (through chat relationships)
    # This correctly counts sent messages which have handle_id=0
    # Fetch all results - we filter and limit after grouping by contact_id
    cursor.execute("""
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
    """)

    results = cursor.fetchall()
    print(f"  Found {len(results)} handles")

    # Group by contact_id (not name!) to avoid merging different people with same name
    print("Processing contacts...")
    contacts_by_id = defaultdict(list)

    for handle_rowid, identifier, sent, received, first_ts, last_ts in results:
        name, contact_id = lookup_contact(identifier, phone_to_contact, email_to_contact)
        if not name or not contact_id:
            continue

        first_dt = convert_timestamp(first_ts)
        last_dt = convert_timestamp(last_ts)

        contacts_by_id[contact_id].append({
            "handle_rowid": handle_rowid,
            "identifier": identifier,
            "name": name,
            "sent": sent,
            "received": received,
            "first_date": first_dt.strftime("%Y-%m-%d") if first_dt else None,
            "last_date": last_dt.strftime("%Y-%m-%d") if last_dt else None,
        })

    # Merge multiple identifiers for the same contact (prefer phone over email)
    merged = []
    for contact_id, entries in contacts_by_id.items():
        handle_rowids = [e["handle_rowid"] for e in entries]
        phone_entries = [e for e in entries if "@" not in e["identifier"]]
        identifier = phone_entries[0]["identifier"] if phone_entries else entries[0]["identifier"]
        # All entries for a contact_id share the same name
        name = entries[0]["name"]

        total_sent = sum(e["sent"] for e in entries)
        total_received = sum(e["received"] for e in entries)
        first_dates = [e["first_date"] for e in entries if e["first_date"]]
        last_dates = [e["last_date"] for e in entries if e["last_date"]]

        merged.append({
            "name": name,
            "identifier": identifier,
            "handle_rowids": handle_rowids,
            "sent": total_sent,
            "received": total_received,
            "total": total_sent + total_received,
            "first_date": min(first_dates) if first_dates else None,
            "last_date": max(last_dates) if last_dates else None,
        })

    # Sort and limit
    merged.sort(key=lambda x: x["total"], reverse=True)
    top_contacts = merged[:args.limit]

    # Create output directory
    output_dir = Path(args.output)
    messages_dir = output_dir / "messages"
    messages_dir.mkdir(parents=True, exist_ok=True)

    # Export contacts.json
    print(f"Exporting {len(top_contacts)} contacts...")
    contacts_export = []
    for i, contact in enumerate(top_contacts):
        filename = safe_filename(contact["name"], contact["identifier"])
        contacts_export.append({
            "rank": i + 1,
            "name": contact["name"],
            "identifier": contact["identifier"],
            "filename": filename,
            "sent": contact["sent"],
            "received": contact["received"],
            "total": contact["total"],
            "first_date": contact["first_date"],
            "last_date": contact["last_date"],
        })

        # Export detailed contact data
        handle_ids = contact["handle_rowids"]
        contact_data = {
            "name": contact["name"],
            "monthly": get_monthly_messages(cursor, handle_ids),
            "time_heatmap": get_time_heatmap(cursor, handle_ids),
            "attachments": get_attachments(cursor, handle_ids),
            "response_stats": get_response_stats(cursor, handle_ids),
        }
        with open(messages_dir / f"{filename}.json", "w") as f:
            json.dump(contact_data, f)

    with open(output_dir / "contacts.json", "w") as f:
        json.dump(contacts_export, f, indent=2)

    conn.close()

    print(f"\nDone! Exported {len(top_contacts)} contacts to {output_dir}")


if __name__ == "__main__":
    exit(main() or 0)
