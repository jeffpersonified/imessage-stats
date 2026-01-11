#!/usr/bin/env python3
"""
Tests for export.py - iMessage statistics extraction.

Run with: python -m pytest scripts/test_export.py -v
"""

import sqlite3
import tempfile
import os
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from export import (
    normalize_phone,
    convert_timestamp,
    lookup_contact,
    get_monthly_messages,
    get_time_heatmap,
    get_attachments,
    get_response_stats,
    load_contacts,
    slugify,
    safe_filename,
    APPLE_EPOCH,
)


class TestNormalizePhone:
    """Tests for phone number normalization."""

    def test_us_10_digit(self):
        """US number without country code stays as 10 digits."""
        assert normalize_phone("5551234567") == "5551234567"

    def test_us_with_country_code(self):
        """US +1 country code is stripped to 10 digits."""
        assert normalize_phone("+15551234567") == "5551234567"
        assert normalize_phone("15551234567") == "5551234567"

    def test_us_with_formatting(self):
        """Formatting characters are removed."""
        assert normalize_phone("+1 (555) 123-4567") == "5551234567"
        assert normalize_phone("555-123-4567") == "5551234567"
        assert normalize_phone("(555) 123 4567") == "5551234567"

    def test_international_preserved(self):
        """International numbers keep full digits to avoid collisions."""
        # UK number - 12 digits, should be preserved
        assert normalize_phone("+447911123456") == "447911123456"
        # German number
        assert normalize_phone("+4915123456789") == "4915123456789"

    def test_international_collision_avoided(self):
        """Different international numbers don't collide."""
        uk = normalize_phone("+44 7911 123456")
        us = normalize_phone("+1 791 112 3456")
        # These used to both become "7911123456", now they're different
        assert uk != us

    def test_short_number(self):
        """Short numbers are preserved as-is."""
        assert normalize_phone("12345") == "12345"
        assert normalize_phone("911") == "911"

    def test_empty_and_none(self):
        """Empty/None inputs return empty string."""
        assert normalize_phone("") == ""
        assert normalize_phone(None) == ""


class TestConvertTimestamp:
    """Tests for Apple timestamp conversion."""

    def test_valid_timestamp(self):
        """Valid nanosecond timestamp converts correctly."""
        # 1 day after Apple epoch in nanoseconds
        ts = 86400 * 1e9
        result = convert_timestamp(ts)
        assert result == datetime(2001, 1, 2)

    def test_recent_timestamp(self):
        """Recent timestamp converts to expected date."""
        # Approximately 2024-01-01
        days_since_epoch = (datetime(2024, 1, 1) - APPLE_EPOCH).days
        ts = days_since_epoch * 86400 * 1e9
        result = convert_timestamp(ts)
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 1

    def test_zero_timestamp(self):
        """Zero timestamp returns None."""
        assert convert_timestamp(0) is None

    def test_none_timestamp(self):
        """None timestamp returns None."""
        assert convert_timestamp(None) is None


class TestLookupContact:
    """Tests for contact lookup."""

    def test_phone_lookup(self):
        """Phone number lookup returns name and contact_id."""
        phone_to_contact = {"5551234567": ("John Doe", "db:1")}
        email_to_contact = {}
        name, contact_id = lookup_contact("+1 555 123 4567", phone_to_contact, email_to_contact)
        assert name == "John Doe"
        assert contact_id == "db:1"

    def test_email_lookup(self):
        """Email lookup returns name and contact_id."""
        phone_to_contact = {}
        email_to_contact = {"john@example.com": ("John Doe", "db:2")}
        name, contact_id = lookup_contact("John@Example.com", phone_to_contact, email_to_contact)
        assert name == "John Doe"
        assert contact_id == "db:2"

    def test_unknown_identifier(self):
        """Unknown identifier returns (None, None)."""
        name, contact_id = lookup_contact("unknown@test.com", {}, {})
        assert name is None
        assert contact_id is None

    def test_empty_identifier(self):
        """Empty identifier returns (None, None)."""
        name, contact_id = lookup_contact("", {}, {})
        assert name is None
        assert contact_id is None


class TestSlugify:
    """Tests for slugify function."""

    def test_basic_name(self):
        """Basic name converts to lowercase with hyphens."""
        assert slugify("John Doe") == "john-doe"

    def test_special_characters(self):
        """Special characters are removed."""
        assert slugify("John O'Brien") == "john-obrien"
        assert slugify("María García") == "mara-garca"

    def test_multiple_spaces(self):
        """Multiple spaces collapse to single hyphen."""
        assert slugify("John   Doe") == "john-doe"


class TestSafeFilename:
    """Tests for safe filename generation."""

    def test_phone_filename(self):
        """Phone identifier uses last 4 digits."""
        result = safe_filename("John Doe", "+15551234567")
        assert result == "john-doe-4567"

    def test_email_filename(self):
        """Email identifier uses hash prefix."""
        result = safe_filename("John Doe", "john@example.com")
        assert result.startswith("john-doe-")
        assert len(result.split("-")[-1]) == 8


# Fixtures for database tests

@pytest.fixture
def mock_imessage_db():
    """Create a mock iMessage database with test data."""
    db_path = tempfile.mktemp(suffix=".db")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Create tables
    cursor.executescript("""
        CREATE TABLE handle (
            ROWID INTEGER PRIMARY KEY,
            id TEXT
        );

        CREATE TABLE chat (
            ROWID INTEGER PRIMARY KEY,
            style INTEGER
        );

        CREATE TABLE chat_handle_join (
            chat_id INTEGER,
            handle_id INTEGER
        );

        CREATE TABLE message (
            ROWID INTEGER PRIMARY KEY,
            handle_id INTEGER,
            date INTEGER,
            is_from_me INTEGER
        );

        CREATE TABLE chat_message_join (
            chat_id INTEGER,
            message_id INTEGER
        );

        CREATE TABLE attachment (
            ROWID INTEGER PRIMARY KEY,
            mime_type TEXT
        );

        CREATE TABLE message_attachment_join (
            message_id INTEGER,
            attachment_id INTEGER
        );
    """)

    # Insert test data
    # Handle 1: Phone number
    cursor.execute("INSERT INTO handle (ROWID, id) VALUES (1, '+15551234567')")
    # Chat 1: 1-on-1 conversation (style=45)
    cursor.execute("INSERT INTO chat (ROWID, style) VALUES (1, 45)")
    cursor.execute("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1)")

    # Insert messages spanning multiple months
    # Use Apple epoch nanosecond timestamps
    base_ts = int((datetime(2024, 1, 15) - APPLE_EPOCH).total_seconds() * 1e9)
    month_in_ns = int(30 * 24 * 3600 * 1e9)

    messages = [
        # January 2024: 2 sent, 1 received
        (1, base_ts, 1),
        (2, base_ts + 1000, 1),
        (3, base_ts + 2000, 0),
        # February 2024: 1 sent, 2 received
        (4, base_ts + month_in_ns, 1),
        (5, base_ts + month_in_ns + 1000, 0),
        (6, base_ts + month_in_ns + 2000, 0),
    ]

    for rowid, date, is_from_me in messages:
        cursor.execute(
            "INSERT INTO message (ROWID, handle_id, date, is_from_me) VALUES (?, 1, ?, ?)",
            (rowid, date, is_from_me)
        )
        cursor.execute(
            "INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, ?)",
            (rowid,)
        )

    conn.commit()
    yield db_path, conn
    conn.close()
    os.unlink(db_path)


class TestGetMonthlyMessages:
    """Tests for monthly message aggregation."""

    def test_monthly_aggregation(self, mock_imessage_db):
        """Messages are correctly grouped by month."""
        db_path, conn = mock_imessage_db
        cursor = conn.cursor()

        result = get_monthly_messages(cursor, [1])

        # Should have 2 months
        assert len(result) == 2

        # First month (January 2024)
        jan = next(m for m in result if m["month"] == "2024-01")
        assert jan["sent"] == 2
        assert jan["received"] == 1

        # Second month (February 2024)
        feb = next(m for m in result if m["month"] == "2024-02")
        assert feb["sent"] == 1
        assert feb["received"] == 2

    def test_empty_handles(self, mock_imessage_db):
        """Empty handle list returns empty result."""
        db_path, conn = mock_imessage_db
        cursor = conn.cursor()
        result = get_monthly_messages(cursor, [])
        assert result == []


class TestGetTimeHeatmap:
    """Tests for time heatmap generation."""

    def test_heatmap_dimensions(self, mock_imessage_db):
        """Heatmap has correct 7x24 dimensions."""
        db_path, conn = mock_imessage_db
        cursor = conn.cursor()

        result = get_time_heatmap(cursor, [1])

        assert len(result) == 7  # 7 days
        for day in result:
            assert len(day) == 24  # 24 hours

    def test_empty_handles_returns_zeros(self, mock_imessage_db):
        """Empty handle list returns zeroed heatmap."""
        db_path, conn = mock_imessage_db
        cursor = conn.cursor()

        result = get_time_heatmap(cursor, [])

        assert len(result) == 7
        for day in result:
            assert all(hour == 0 for hour in day)


class TestGetResponseStats:
    """Tests for response time calculations."""

    def test_first_conversation_counted(self, mock_imessage_db):
        """First message is counted as starting a conversation."""
        db_path, conn = mock_imessage_db
        cursor = conn.cursor()

        result = get_response_stats(cursor, [1])

        # Should have a you_start_pct since first message was sent
        assert result["you_start_pct"] is not None

    def test_empty_handles(self, mock_imessage_db):
        """Empty handle list returns None values."""
        db_path, conn = mock_imessage_db
        cursor = conn.cursor()

        result = get_response_stats(cursor, [])

        assert result["you_avg_seconds"] is None
        assert result["them_avg_seconds"] is None
        assert result["you_start_pct"] is None


class TestGetAttachments:
    """Tests for attachment counting."""

    def test_empty_handles(self, mock_imessage_db):
        """Empty handle list returns zero counts."""
        db_path, conn = mock_imessage_db
        cursor = conn.cursor()

        result = get_attachments(cursor, [])

        assert result["photos_sent"] == 0
        assert result["photos_received"] == 0
        assert result["videos_sent"] == 0
        assert result["videos_received"] == 0


@pytest.fixture
def mock_contacts_db():
    """Create a mock Contacts database with test data."""
    temp_dir = tempfile.mkdtemp()
    db_dir = os.path.join(temp_dir, "TestAccount")
    os.makedirs(db_dir)
    db_path = os.path.join(db_dir, "AddressBook-v22.abcddb")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Create tables
    cursor.executescript("""
        CREATE TABLE ZABCDRECORD (
            Z_PK INTEGER PRIMARY KEY,
            ZFIRSTNAME TEXT,
            ZLASTNAME TEXT,
            ZORGANIZATION TEXT,
            ZNICKNAME TEXT
        );

        CREATE TABLE ZABCDPHONENUMBER (
            Z_PK INTEGER PRIMARY KEY,
            ZOWNER INTEGER,
            ZFULLNUMBER TEXT
        );

        CREATE TABLE ZABCDEMAILADDRESS (
            Z_PK INTEGER PRIMARY KEY,
            ZOWNER INTEGER,
            ZADDRESS TEXT
        );
    """)

    # Insert contacts - including two with the same name (collision test)
    cursor.execute(
        "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME) VALUES (1, 'John', 'Smith')"
    )
    cursor.execute(
        "INSERT INTO ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) VALUES (1, '+15551111111')"
    )

    # Second John Smith - different person, different phone
    cursor.execute(
        "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME) VALUES (2, 'John', 'Smith')"
    )
    cursor.execute(
        "INSERT INTO ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) VALUES (2, '+15552222222')"
    )

    # Jane with both phone and email
    cursor.execute(
        "INSERT INTO ZABCDRECORD (Z_PK, ZFIRSTNAME, ZLASTNAME) VALUES (3, 'Jane', 'Doe')"
    )
    cursor.execute(
        "INSERT INTO ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER) VALUES (3, '+15553333333')"
    )
    cursor.execute(
        "INSERT INTO ZABCDEMAILADDRESS (ZOWNER, ZADDRESS) VALUES (3, 'jane@example.com')"
    )

    conn.commit()
    conn.close()

    yield temp_dir

    # Cleanup
    import shutil
    shutil.rmtree(temp_dir)


class TestLoadContacts:
    """Tests for contact loading."""

    def test_loads_phone_contacts(self, mock_contacts_db):
        """Phone numbers are loaded with contact IDs."""
        phone_to_contact, email_to_contact = load_contacts(mock_contacts_db)

        assert len(phone_to_contact) == 3
        # First John Smith
        name1, id1 = phone_to_contact.get("5551111111", (None, None))
        assert name1 == "John Smith"
        assert id1 is not None

        # Second John Smith - different contact ID
        name2, id2 = phone_to_contact.get("5552222222", (None, None))
        assert name2 == "John Smith"
        assert id2 is not None
        assert id1 != id2  # Different people!

    def test_loads_email_contacts(self, mock_contacts_db):
        """Emails are loaded with contact IDs."""
        phone_to_contact, email_to_contact = load_contacts(mock_contacts_db)

        name, contact_id = email_to_contact.get("jane@example.com", (None, None))
        assert name == "Jane Doe"
        assert contact_id is not None

    def test_same_person_phone_and_email_share_id(self, mock_contacts_db):
        """Phone and email for same contact have same contact_id."""
        phone_to_contact, email_to_contact = load_contacts(mock_contacts_db)

        _, phone_id = phone_to_contact.get("5553333333", (None, None))
        _, email_id = email_to_contact.get("jane@example.com", (None, None))

        # Same person - IDs should match (same Z_PK)
        assert phone_id is not None
        assert phone_id == email_id


class TestNameCollisionPrevention:
    """Integration tests for name collision prevention."""

    def test_different_people_same_name_not_merged(self, mock_contacts_db):
        """Two different people with the same name stay separate."""
        phone_to_contact, email_to_contact = load_contacts(mock_contacts_db)

        # Get contact IDs for both John Smiths
        name1, id1 = phone_to_contact.get("5551111111", (None, None))
        name2, id2 = phone_to_contact.get("5552222222", (None, None))

        assert name1 == name2 == "John Smith"
        assert id1 != id2  # Critical: different contact IDs


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
