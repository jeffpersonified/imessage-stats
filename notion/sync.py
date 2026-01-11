#!/usr/bin/env python3
"""
Sync iMessage stats to a Notion database.

Prerequisites:
1. Create a Notion integration at https://www.notion.so/my-integrations
2. Create an empty database in Notion (the script will add the required columns)
3. Share the database with your integration
4. Copy notion/.env.example to notion/.env and fill in your values

Usage:
    ./scripts/notion
"""

import json
import os
import sys
from pathlib import Path

try:
    import requests
    from dotenv import load_dotenv
except ImportError:
    print("Error: Missing dependencies. Run this script with: ./scripts/notion")
    sys.exit(1)

# Load .env file from notion/ directory
load_dotenv(Path(__file__).parent / ".env")


def get_config():
    """Get configuration from environment variables."""
    api_key = os.environ.get("NOTION_API_KEY")
    database_id = os.environ.get("NOTION_DATABASE_ID")

    if not api_key:
        print("Error: NOTION_API_KEY environment variable not set")
        print("\nGet your API key from https://www.notion.so/my-integrations")
        sys.exit(1)

    if not database_id:
        print("Error: NOTION_DATABASE_ID environment variable not set")
        print("\nFind the database ID in your Notion database URL:")
        print("  https://notion.so/workspace/DATABASE_ID?v=...")
        sys.exit(1)

    return api_key, database_id


def load_contacts():
    """Load contacts from the exported JSON."""
    data_dir = Path(__file__).parent.parent / "web" / "data"
    contacts_file = data_dir / "contacts.json"

    if not contacts_file.exists():
        print(f"Error: {contacts_file} not found")
        print("Run './scripts/build' first to generate the data")
        sys.exit(1)

    with open(contacts_file) as f:
        return json.load(f)


def ensure_properties(api_key, database_id):
    """Add required properties to the database if they don't exist."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }

    # Required properties (title property is handled separately)
    # Order: Name, Total, Received, Sent, Ratio, First, Last, Phone/Email
    required = {
        "Total": {
            "formula": {"expression": 'prop("Sent") + prop("Received")'}
        },
        "Received": {"number": {"format": "number"}},
        "Sent": {"number": {"format": "number"}},
        "Ratio": {
            "formula": {
                "expression": 'if(prop("Received") == 0, 0, round(prop("Sent") / prop("Received") * 100) / 100)'
            }
        },
        "First": {"date": {}},
        "Last": {"date": {}},
        "Phone/Email": {"rich_text": {}},
    }

    # Get current database schema
    response = requests.get(
        f"https://api.notion.com/v1/databases/{database_id}",
        headers=headers,
    )
    if response.status_code != 200:
        print(f"Error fetching database: {response.status_code}")
        print(response.text)
        sys.exit(1)

    data = response.json()
    current = data.get("properties", {})

    # Find the title property (might not be named "Name")
    title_prop = None
    for name, prop in current.items():
        if prop.get("type") == "title":
            title_prop = name
            break

    # Find missing properties
    missing = {}
    for name, config in required.items():
        if name not in current:
            missing[name] = config

    if missing:
        print("Setting up database properties...")
        response = requests.patch(
            f"https://api.notion.com/v1/databases/{database_id}",
            headers=headers,
            json={"properties": missing},
        )
        if response.status_code != 200:
            print(f"Error adding properties: {response.status_code}")
            print(response.text)
            sys.exit(1)
        print(f"  Added: {', '.join(missing.keys())}")

    # Return the title property name so create_page can use it
    return title_prop or "Name"


def get_existing_pages(api_key, database_id):
    """Get all existing pages in the database."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }

    pages = []
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    has_more = True
    start_cursor = None

    while has_more:
        payload = {}
        if start_cursor:
            payload["start_cursor"] = start_cursor

        response = requests.post(url, headers=headers, json=payload)
        if response.status_code != 200:
            print(f"Error querying database: {response.status_code}")
            print(response.text)
            sys.exit(1)

        data = response.json()
        pages.extend(data.get("results", []))
        has_more = data.get("has_more", False)
        start_cursor = data.get("next_cursor")

    return pages


def delete_page(api_key, page_id):
    """Archive a page."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }
    url = f"https://api.notion.com/v1/pages/{page_id}"
    requests.patch(url, headers=headers, json={"archived": True})


def create_page(api_key, database_id, contact, title_prop="Name"):
    """Create a new page for a contact."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }

    properties = {
        title_prop: {"title": [{"text": {"content": contact["name"]}}]},
        "Phone/Email": {"rich_text": [{"text": {"content": contact["identifier"]}}]},
        "Sent": {"number": contact["sent"]},
        "Received": {"number": contact["received"]},
    }

    if contact.get("first_date"):
        properties["First"] = {"date": {"start": contact["first_date"]}}
    if contact.get("last_date"):
        properties["Last"] = {"date": {"start": contact["last_date"]}}

    payload = {
        "parent": {"database_id": database_id},
        "properties": properties,
    }

    response = requests.post(
        "https://api.notion.com/v1/pages",
        headers=headers,
        json=payload,
    )

    return response.status_code == 200


def main():
    api_key, database_id = get_config()
    contacts = load_contacts()

    print(f"Loaded {len(contacts)} contacts")

    # Ensure database has required properties
    title_prop = ensure_properties(api_key, database_id)

    # Delete existing pages
    print("Clearing existing pages...")
    existing = get_existing_pages(api_key, database_id)
    for page in existing:
        delete_page(api_key, page["id"])
    print(f"  Deleted {len(existing)} pages")

    # Create new pages
    print("Creating pages...")
    created = 0
    for i, contact in enumerate(contacts):
        if create_page(api_key, database_id, contact, title_prop):
            created += 1
        if (i + 1) % 10 == 0:
            print(f"  {i + 1}/{len(contacts)}...")

    print(f"\nDone! Created {created} pages")


if __name__ == "__main__":
    main()
