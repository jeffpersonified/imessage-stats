#!/usr/bin/env python3
"""
Export iMessage statistics to JSON for the web visualization.

Usage:
    python export.py                    # Use default paths
    python export.py --limit 50         # Export top 50 contacts
    python export.py --db ~/Desktop/chat.db --contacts ~/Desktop/Sources
"""

import argparse
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
    """Normalize phone number to last 10 digits for matching."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if len(digits) >= 10:
        return digits[-10:]
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
    """Load contact name mappings from AddressBook databases."""
    phone_to_name = {}
    email_to_name = {}

    db_files = glob(os.path.join(contacts_dir, "*/AddressBook-v22.abcddb"))
    if not db_files:
        print(f"Warning: No AddressBook databases found in {contacts_dir}")
        return phone_to_name, email_to_name

    for db_path in db_files:
        try:
            uri = f"file:{db_path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True)
            cursor = conn.cursor()

            # Phone numbers
            cursor.execute("""
                SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, p.ZFULLNUMBER
                FROM ZABCDRECORD r
                JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
                WHERE p.ZFULLNUMBER IS NOT NULL
            """)
            for first, last, org, nick, phone in cursor.fetchall():
                name = " ".join(p for p in [first, last] if p) or nick or org
                if name:
                    normalized = normalize_phone(phone)
                    if normalized and normalized not in phone_to_name:
                        phone_to_name[normalized] = name

            # Emails
            cursor.execute("""
                SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME, e.ZADDRESS
                FROM ZABCDRECORD r
                JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
                WHERE e.ZADDRESS IS NOT NULL
            """)
            for first, last, org, nick, email in cursor.fetchall():
                name = " ".join(p for p in [first, last] if p) or nick or org
                if name and email.lower() not in email_to_name:
                    email_to_name[email.lower()] = name

            conn.close()
        except Exception as e:
            print(f"Warning: Could not read {db_path}: {e}")

    return phone_to_name, email_to_name


def lookup_name(identifier, phone_to_name, email_to_name):
    """Look up contact name from phone or email."""
    if not identifier:
        return None
    if "@" in identifier:
        return email_to_name.get(identifier.lower())
    return phone_to_name.get(normalize_phone(identifier))


def get_monthly_messages(cursor, handle_ids):
    """Get monthly message counts for a set of handle IDs."""
    placeholders = ",".join("?" * len(handle_ids))
    cursor.execute(f"""
        SELECT m.date, m.is_from_me
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        WHERE chj.handle_id IN ({placeholders}) AND c.style = 45
    """, handle_ids)

    monthly = defaultdict(lambda: {"sent": 0, "received": 0})
    for date_ts, is_from_me in cursor.fetchall():
        dt = convert_timestamp(date_ts)
        if dt:
            month = dt.strftime("%Y-%m")
            if is_from_me:
                monthly[month]["sent"] += 1
            else:
                monthly[month]["received"] += 1

    return [
        {"month": m, "sent": d["sent"], "received": d["received"]}
        for m, d in sorted(monthly.items())
    ]


def safe_filename(identifier):
    """Create a safe filename from phone/email."""
    return re.sub(r"[^\w\-.]", "_", identifier)


def main():
    parser = argparse.ArgumentParser(
        description="Export iMessage statistics for visualization"
    )
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parser.add_argument(
        "--db",
        default=os.path.join(script_dir, "chat.db"),
        help="Path to iMessage database (default: ./chat.db)",
    )
    parser.add_argument(
        "--contacts",
        default=os.path.join(script_dir, "Sources"),
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
        default=os.path.join(os.path.dirname(__file__), "web", "data"),
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
    phone_to_name, email_to_name = load_contacts(args.contacts)
    print(f"  Found {len(phone_to_name)} phone and {len(email_to_name)} email mappings")

    print("Querying iMessage database...")
    uri = f"file:{args.db}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    cursor = conn.cursor()

    # Query using correct join pattern (through chat relationships)
    # This correctly counts sent messages which have handle_id=0
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
        LIMIT ?
    """, (args.limit * 2,))  # Get extra to have enough after merging

    results = cursor.fetchall()
    print(f"  Found {len(results)} contacts")

    # Group by name and merge duplicates
    print("Processing contacts...")
    contacts_by_name = defaultdict(list)

    for handle_rowid, identifier, sent, received, first_ts, last_ts in results:
        name = lookup_name(identifier, phone_to_name, email_to_name)
        if not name:
            continue

        first_dt = convert_timestamp(first_ts)
        last_dt = convert_timestamp(last_ts)

        contacts_by_name[name].append({
            "handle_rowid": handle_rowid,
            "identifier": identifier,
            "sent": sent,
            "received": received,
            "first_date": first_dt.strftime("%Y-%m-%d") if first_dt else None,
            "last_date": last_dt.strftime("%Y-%m-%d") if last_dt else None,
        })

    # Merge duplicates (prefer phone over email)
    merged = []
    for name, entries in contacts_by_name.items():
        handle_rowids = [e["handle_rowid"] for e in entries]
        phone_entries = [e for e in entries if "@" not in e["identifier"]]
        identifier = phone_entries[0]["identifier"] if phone_entries else entries[0]["identifier"]

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
        filename = safe_filename(contact["identifier"])
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

        # Export monthly data
        monthly = get_monthly_messages(cursor, contact["handle_rowids"])
        with open(messages_dir / f"{filename}.json", "w") as f:
            json.dump({"name": contact["name"], "monthly": monthly}, f)

    with open(output_dir / "contacts.json", "w") as f:
        json.dump(contacts_export, f, indent=2)

    conn.close()

    print(f"\nDone! Exported {len(top_contacts)} contacts to {output_dir}")


if __name__ == "__main__":
    exit(main() or 0)
