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
import sqlite3
import time
from collections import defaultdict
from pathlib import Path

from utils import format_duration, print_progress, convert_timestamp, safe_filename
from contacts import load_contacts, lookup_contact
from queries import (
    get_monthly_messages, get_time_heatmap, get_attachments, get_attachments_by_year,
    get_heatmap_by_year, get_response_stats, get_global_stats, get_global_monthly,
    get_global_heatmap, get_global_attachments, get_global_links, get_yearly_links,
    get_global_emoji, get_yearly_emoji, get_yearly_top_identifiers, get_yearly_data,
)


def main():
    parser = argparse.ArgumentParser(
        description="Export iMessage statistics for visualization"
    )
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Load .env file if python-dotenv is available
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(project_dir, ".env"))
    except ImportError:
        pass  # dotenv not installed, use existing environment variables

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
        default=24,
        help="Number of top contacts to export (default: 24)",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(project_dir, "web", "data"),
        help="Output directory (default: web/data)",
    )
    parser.add_argument(
        "--analyze",
        action="store_true",
        help="Enable AI-powered theme analysis (requires ANTHROPIC_API_KEY)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Number of parallel workers for analysis (default: CPU count)",
    )
    parser.add_argument(
        "--llm-sample-size",
        type=int,
        default=1000,
        help="Max messages to sample per contact for LLM analysis (default: 1000)",
    )
    args = parser.parse_args()

    # Verify database exists
    if not os.path.exists(args.db):
        print(f"Error: Database not found at {args.db}")
        print("")
        print("Copy your iMessage database to this directory:")
        print("  1. Open Finder and press Cmd+Shift+G")
        print("  2. Enter: ~/Library/Messages")
        print("  3. Copy chat.db to this project folder")
        print("")
        print("Or specify a custom path with --db")
        return 1

    # Verify database is readable
    try:
        test_uri = f"file:{args.db}?mode=ro"
        test_conn = sqlite3.connect(test_uri, uri=True, timeout=5)
        test_conn.execute("SELECT 1 FROM message LIMIT 1")
        test_conn.close()
    except sqlite3.OperationalError as e:
        error_msg = str(e).lower()
        if "locked" in error_msg:
            print(f"Error: Database is locked at {args.db}")
            print("\nThe database may be in use by another process.")
            print("Wait a moment and try again, or restart your Mac if the issue persists.")
        else:
            print(f"Error: Cannot read database at {args.db}")
            print(f"SQLite error: {e}")
            print("\nThe file may still be copying. Wait and try again.")
        return 1
    except Exception as e:
        print(f"Error: Cannot read database at {args.db}")
        print(f"Unexpected error: {e}")
        return 1

    print("\nLoading contacts...")
    start_time = time.time()
    if os.path.isdir(args.contacts):
        phone_to_contact, email_to_contact = load_contacts(args.contacts)
        elapsed = format_duration(time.time() - start_time)
        print(f"  Found {len(phone_to_contact)} phone and {len(email_to_contact)} email mappings ({elapsed})")
    else:
        print("  Sources/ directory not found - names won't be matched")
        print("  To fix: Finder > Cmd+Shift+G > ~/Library/Application Support/AddressBook")
        print("         Copy the Sources folder to this project directory")
        phone_to_contact, email_to_contact = {}, {}

    print("\nQuerying iMessage database...")
    start_time = time.time()
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
    elapsed = format_duration(time.time() - start_time)
    print(f"  Found {len(results)} unique conversations ({elapsed})")

    # Group by contact_id (not name!) to avoid merging different people with same name
    print("\nMatching conversations to contacts...")
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
    top_identifiers = {c["identifier"] for c in top_contacts}

    # Find additional contacts needed for yearly top 8 views
    yearly_top_identifiers = get_yearly_top_identifiers(cursor, top_n=8)
    additional_identifiers = yearly_top_identifiers - top_identifiers

    # Find additional contacts from merged list
    additional_contacts = [c for c in merged if c["identifier"] in additional_identifiers]

    # Create output directory
    output_dir = Path(args.output)
    messages_dir = output_dir / "messages"
    messages_dir.mkdir(parents=True, exist_ok=True)

    # Export contacts.json
    total_to_export = len(top_contacts) + len(additional_contacts)
    print(f"\nExporting {len(top_contacts)} contacts...")
    if additional_contacts:
        print(f"  Plus {len(additional_contacts)} additional contacts for yearly top 8")

    contacts_export = []

    # Always import local analyzers (fast, free, no API needed)
    from analyzers.base import get_messages_with_text
    from analyzers import run_analyzers_parallel

    # Local analyzers that always run
    analyzer_names = ["temperature", "links", "profanity", "laughter", "emoji"]

    # LLM theme analysis requires --analyze flag AND API key
    args.use_llm_themes = False
    if args.analyze:
        from analyzers.llm_themes import run_llm_themes_parallel
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("  Warning: ANTHROPIC_API_KEY not set, theme analysis will be skipped")
        else:
            args.use_llm_themes = True
            print(f"  Theme analysis enabled ({args.llm_sample_size} messages sampled per contact)")

    export_start_time = time.time()
    total_messages_processed = 0

    # Combine all contacts for unified processing
    all_contacts = []
    for i, contact in enumerate(top_contacts):
        filename = safe_filename(contact["name"], contact["identifier"])
        all_contacts.append({
            **contact,
            "filename": filename,
            "rank": i + 1,
            "sidebar": True,
            "allow_llm": True,
        })
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

    for contact in additional_contacts:
        filename = safe_filename(contact["name"], contact["identifier"])
        all_contacts.append({
            **contact,
            "filename": filename,
            "rank": None,
            "sidebar": False,
            "allow_llm": False,
        })
        contacts_export.append({
            "name": contact["name"],
            "identifier": contact["identifier"],
            "filename": filename,
            "sent": contact["sent"],
            "received": contact["received"],
            "total": contact["total"],
            "first_date": contact["first_date"],
            "last_date": contact["last_date"],
            "sidebar": False,
        })

    # Phase 1: Gather all contact data (sequential DB access)
    print("  Gathering message data...")
    contact_data_list = []
    contacts_messages = []  # For parallel analysis
    llm_contacts_to_analyze = []  # For parallel LLM analysis

    for i, contact in enumerate(all_contacts):
        print_progress(i + 1, len(all_contacts))
        handle_ids = contact["handle_rowids"]

        contact_data = {
            "name": contact["name"],
            "monthly": get_monthly_messages(cursor, handle_ids),
            "time_heatmap": get_time_heatmap(cursor, handle_ids),
            "heatmap_by_year": get_heatmap_by_year(cursor, handle_ids),
            "attachments": get_attachments(cursor, handle_ids),
            "attachments_by_year": get_attachments_by_year(cursor, handle_ids),
            "response_stats": get_response_stats(cursor, handle_ids),
        }

        # Fetch messages for analysis (always needed for local analyzers)
        messages = get_messages_with_text(cursor, handle_ids)
        total_messages_processed += len(messages)

        contact_data_list.append({
            "contact": contact,
            "data": contact_data,
            "messages": messages,
        })

        # Collect messages for parallel analysis (local analyzers always run)
        if messages:
            contacts_messages.append((i, messages))

        # Collect for LLM theme analysis (only if --analyze flag passed)
        if getattr(args, 'use_llm_themes', False) and messages:
            contact_info = {
                "name": contact["name"],
                "sent": contact["sent"],
                "received": contact["received"],
                "first_date": contact["first_date"],
                "last_date": contact["last_date"],
            }
            llm_contacts_to_analyze.append((i, contact_info, messages))

    # Phase 2: Run local analyzers in parallel (always runs - fast and free)
    analysis_results = {}
    if contacts_messages:
        worker_count = args.workers or os.cpu_count() or 4
        print("\n  Running text analysis...")
        analysis_start = time.time()

        def analysis_progress(completed, total):
            print_progress(completed, total)

        analysis_results = run_analyzers_parallel(
            contacts_messages, analyzer_names,
            max_workers=worker_count,
            progress_callback=analysis_progress
        )
        analysis_elapsed = format_duration(time.time() - analysis_start)
        print(f"  Text analysis complete ({analysis_elapsed})")

    # Phase 3: Write JSON files with local analysis results (before LLM)
    # This allows the server to start while LLM analysis runs in background
    print("\n  Writing contact files...")
    for i, item in enumerate(contact_data_list):
        print_progress(i + 1, len(contact_data_list))
        contact = item["contact"]
        contact_data = item["data"]

        # Add analysis results (local analyzers always run)
        if i in analysis_results:
            contact_data["analysis"] = analysis_results[i]
        else:
            contact_data["analysis"] = {}

        with open(messages_dir / f"{contact['filename']}.json", "w") as f:
            json.dump(contact_data, f)

    export_elapsed = format_duration(time.time() - export_start_time)
    print(f"  Analyzed {total_messages_processed:,} messages across {total_to_export} contacts ({export_elapsed})")

    with open(output_dir / "contacts.json", "w") as f:
        json.dump(contacts_export, f, indent=2)

    # Export global "Everyone" statistics
    print("\nComputing global statistics...")
    global_start_time = time.time()
    print("  Aggregating message totals...")
    global_stats = get_global_stats(cursor)
    global_monthly = get_global_monthly(cursor)
    print("  Building time heatmap...")
    global_heatmap = get_global_heatmap(cursor)
    print("  Counting attachments...")
    global_attachments = get_global_attachments(cursor)
    print("  Extracting link statistics...")
    global_links = get_global_links(cursor)
    yearly_links = get_yearly_links(cursor)
    print("  Extracting emoji statistics...")
    global_emoji = get_global_emoji(cursor)
    yearly_emoji = get_yearly_emoji(cursor)
    print("  Computing per-year breakdowns...")
    yearly_data = get_yearly_data(cursor, global_monthly, contacts_export, yearly_links, yearly_emoji)
    global_elapsed = format_duration(time.time() - global_start_time)
    print(f"  Done ({global_elapsed})")

    years = sorted(yearly_data.keys(), reverse=True)

    # Build all-time top 8 contacts
    all_time_top_contacts = []
    for c in contacts_export[:8]:
        all_time_top_contacts.append({
            "rank": len(all_time_top_contacts) + 1,
            "name": c["name"],
            "filename": c["filename"],
            "total": c["total"],
            "sent": c["sent"],
            "received": c["received"],
        })

    everyone_data = {
        "total_sent": global_stats["total_sent"],
        "total_received": global_stats["total_received"],
        "first_date": global_stats["first_date"],
        "last_date": global_stats["last_date"],
        "years": years,
        "monthly": global_monthly,
        "time_heatmap": global_heatmap,
        "attachments": global_attachments,
        "links": global_links,
        "emoji": global_emoji,
        "by_year": yearly_data,
        "top_contacts": all_time_top_contacts,
    }

    with open(output_dir / "everyone.json", "w") as f:
        json.dump(everyone_data, f)

    conn.close()

    total_messages = global_stats["total_sent"] + global_stats["total_received"]
    total_exported = len(top_contacts) + len(additional_contacts)
    print(f"\nExport complete!")
    print(f"  {total_exported} contacts exported")
    print(f"  {total_messages:,} total messages")

    # Phase 4: Run LLM theme analysis in background (if enabled)
    # This runs after the server starts, updating files incrementally
    filename_by_index = None
    status = None
    if getattr(args, 'use_llm_themes', False) and llm_contacts_to_analyze:
        # Build filename lookup for updating JSON files
        filename_by_index = {i: item["contact"]["filename"] for i, item in enumerate(contact_data_list)}

        # Write initial status file BEFORE _ready so browser sees it on load
        pending_filenames = [filename_by_index[i] for i, _, _ in llm_contacts_to_analyze]
        status = {
            "pending": pending_filenames,
            "completed": [],
            "total": len(pending_filenames),
        }
        with open(output_dir / "_llm_status.json", "w") as f:
            json.dump(status, f)

    # Signal that initial export is done - server can start now
    # Write a marker file that scripts/start watches for
    with open(output_dir / "_ready", "w") as f:
        f.write("ready")
    print("Ready for server...")

    # Continue with LLM analysis if enabled
    if getattr(args, 'use_llm_themes', False) and llm_contacts_to_analyze:
        print("\n  Extracting conversation themes (server is running)...")
        llm_start = time.time()

        def llm_progress(completed, total, contact_name):
            print_progress(completed, total)

        def on_llm_result(contact_index, llm_themes):
            """Update contact JSON and status file when LLM results are ready."""
            filename = filename_by_index[contact_index]
            filepath = messages_dir / f"{filename}.json"

            # Read existing contact data
            with open(filepath, "r") as f:
                contact_data = json.load(f)

            # Add LLM themes
            if "analysis" not in contact_data:
                contact_data["analysis"] = {}
            contact_data["analysis"]["llm_themes"] = llm_themes

            # Write updated contact data
            with open(filepath, "w") as f:
                json.dump(contact_data, f)

            # Update status file
            if filename in status["pending"]:
                status["pending"].remove(filename)
                status["completed"].append(filename)
                with open(output_dir / "_llm_status.json", "w") as f:
                    json.dump(status, f)

        llm_results, llm_skipped = run_llm_themes_parallel(
            llm_contacts_to_analyze,
            sample_size=args.llm_sample_size,
            progress_callback=llm_progress,
            include_yearly=True,
            min_yearly_messages=50,
            on_result_callback=on_llm_result,
        )

        # Remove status file when complete
        status_file = output_dir / "_llm_status.json"
        if status_file.exists():
            status_file.unlink()

        llm_elapsed = format_duration(time.time() - llm_start)
        if llm_skipped:
            print(f"  Theme analysis complete ({len(llm_results)} succeeded, {len(llm_skipped)} skipped, {llm_elapsed})")
            for contact_name, reason in llm_skipped:
                print(f"    Skipped {contact_name}: {reason}")
        else:
            print(f"  Theme analysis complete ({len(llm_results)} contacts, {llm_elapsed})")


if __name__ == "__main__":
    exit(main() or 0)
