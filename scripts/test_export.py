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

from contacts import normalize_phone, load_contacts, lookup_contact
from utils import convert_timestamp, slugify, safe_filename, APPLE_EPOCH
from queries import get_monthly_messages, get_time_heatmap, get_attachments, get_response_stats
from export import main


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
            is_from_me INTEGER,
            text TEXT,
            attributedBody BLOB
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


class TestMainValidation:
    """Tests for main() entry point validation and error handling."""

    def test_missing_database_returns_error(self, tmp_path, monkeypatch):
        """main() returns 1 when database file doesn't exist."""
        # Point to non-existent database
        monkeypatch.setattr(
            "sys.argv",
            ["export.py", "--db", str(tmp_path / "nonexistent.db"), "--output", str(tmp_path)]
        )
        result = main()
        assert result == 1

    def test_valid_database_succeeds(self, mock_imessage_db, tmp_path, monkeypatch):
        """main() succeeds with a valid database."""
        db_path, conn = mock_imessage_db
        conn.close()  # Close the fixture's connection so we don't have lock issues

        monkeypatch.setattr(
            "sys.argv",
            ["export.py", "--db", db_path, "--output", str(tmp_path), "--limit", "10"]
        )
        result = main()
        assert result is None  # main() returns None on success

    def test_missing_contacts_continues_with_warning(self, mock_imessage_db, tmp_path, monkeypatch, capsys):
        """main() continues when contacts directory is missing."""
        db_path, conn = mock_imessage_db
        conn.close()

        monkeypatch.setattr(
            "sys.argv",
            [
                "export.py",
                "--db", db_path,
                "--contacts", str(tmp_path / "nonexistent_contacts"),
                "--output", str(tmp_path),
                "--limit", "10"
            ]
        )
        result = main()
        assert result is None  # Should succeed despite missing contacts

        captured = capsys.readouterr()
        assert "Sources/ directory not found" in captured.out

    def test_corrupted_database_returns_error(self, tmp_path, monkeypatch):
        """main() returns 1 when database is corrupted."""
        # Create a file that isn't a valid SQLite database
        corrupted_db = tmp_path / "corrupted.db"
        corrupted_db.write_text("this is not a database")

        monkeypatch.setattr(
            "sys.argv",
            ["export.py", "--db", str(corrupted_db), "--output", str(tmp_path)]
        )
        result = main()
        assert result == 1

    def test_database_missing_message_table_returns_error(self, tmp_path, monkeypatch):
        """main() returns 1 when database doesn't have message table."""
        # Create a valid SQLite database but without the message table
        empty_db = tmp_path / "empty.db"
        conn = sqlite3.connect(str(empty_db))
        conn.execute("CREATE TABLE other_table (id INTEGER)")
        conn.close()

        monkeypatch.setattr(
            "sys.argv",
            ["export.py", "--db", str(empty_db), "--output", str(tmp_path)]
        )
        result = main()
        assert result == 1


# =============================================================================
# Tests for utils.py
# =============================================================================

from utils import extract_text_from_attributed_body, format_duration, URL_PATTERN


class TestExtractTextFromAttributedBody:
    """Tests for extracting text from attributedBody blobs."""

    def test_none_blob(self):
        """None blob returns None."""
        assert extract_text_from_attributed_body(None) is None

    def test_empty_blob(self):
        """Empty blob returns None."""
        assert extract_text_from_attributed_body(b'') is None

    def test_invalid_blob(self):
        """Invalid blob without marker returns None."""
        assert extract_text_from_attributed_body(b'random data') is None


class TestFormatDuration:
    """Tests for duration formatting."""

    def test_milliseconds(self):
        """Sub-second durations show in milliseconds."""
        assert format_duration(0.5) == "500ms"
        assert format_duration(0.001) == "1ms"
        assert format_duration(0.999) == "999ms"

    def test_seconds(self):
        """Durations under a minute show in seconds."""
        assert format_duration(1.0) == "1.0s"
        assert format_duration(30.5) == "30.5s"
        assert format_duration(59.9) == "59.9s"

    def test_minutes_and_seconds(self):
        """Durations over a minute show in minutes and seconds."""
        assert format_duration(60) == "1m 0s"
        assert format_duration(90) == "1m 30s"
        assert format_duration(125) == "2m 5s"


class TestURLPattern:
    """Tests for URL extraction pattern."""

    def test_http_url(self):
        """HTTP URLs are matched."""
        text = "Check this out: http://example.com/page"
        urls = URL_PATTERN.findall(text)
        assert len(urls) == 1
        assert "example.com" in urls[0]

    def test_https_url(self):
        """HTTPS URLs are matched."""
        text = "Secure link: https://example.com/path?query=1"
        urls = URL_PATTERN.findall(text)
        assert len(urls) == 1
        assert "example.com" in urls[0]

    def test_domain_without_protocol(self):
        """Bare domains with common TLDs are matched."""
        text = "Visit example.com for more info"
        urls = URL_PATTERN.findall(text)
        assert len(urls) == 1
        assert urls[0] == "example.com"

    def test_multiple_urls(self):
        """Multiple URLs in text are all matched."""
        text = "Check https://google.com and https://github.com"
        urls = URL_PATTERN.findall(text)
        assert len(urls) == 2

    def test_no_urls(self):
        """Text without URLs returns empty list."""
        text = "No links here, just text."
        urls = URL_PATTERN.findall(text)
        assert len(urls) == 0


# =============================================================================
# Tests for analyzers
# =============================================================================

from analyzers.temperature import count_emojis, compute_metrics, analyze_temperature
from analyzers.links import extract_domain, aggregate_urls, analyze_links
from analyzers.profanity import count_profanity_in_text


class TestCountEmojis:
    """Tests for emoji counting."""

    def test_no_emojis(self):
        """Text without emojis returns 0."""
        assert count_emojis("Hello world") == 0

    def test_single_emoji(self):
        """Single emoji is counted."""
        result = count_emojis("Hello 👋")
        assert result >= 1

    def test_multiple_emojis(self):
        """Multiple emojis are counted."""
        # Fallback regex groups consecutive emojis as one match,
        # so test with separated emojis for consistent behavior
        result = count_emojis("Great 🎉 job 👏 done 🔥")
        assert result >= 3

    def test_empty_string(self):
        """Empty string returns 0."""
        assert count_emojis("") == 0


class TestComputeMetrics:
    """Tests for temperature metrics computation."""

    def test_empty_list(self):
        """Empty list returns None."""
        assert compute_metrics([]) is None

    def test_empty_strings(self):
        """List of empty strings returns None."""
        assert compute_metrics([""]) is None

    def test_basic_metrics(self):
        """Basic messages produce valid metrics."""
        texts = ["Hello there!", "How are you?", "I'm doing great 😊"]
        result = compute_metrics(texts)
        assert result is not None
        assert "score" in result
        assert 1.0 <= result["score"] <= 5.0
        assert "avg_length" in result
        assert "emoji_density" in result
        assert "message_count" in result
        assert result["message_count"] == 3

    def test_high_energy_messages(self):
        """High-energy messages have higher scores."""
        low_energy = compute_metrics(["ok", "yes", "no"])
        high_energy = compute_metrics([
            "WOW this is AMAZING!!!",
            "I can't believe it!!! 🎉🎉🎉",
            "This is the best day ever! 😍😍"
        ])
        assert high_energy["score"] > low_energy["score"]


class TestAnalyzeTemperature:
    """Tests for temperature analyzer."""

    def test_empty_messages(self):
        """Empty message list returns empty dict or None."""
        result = analyze_temperature([])
        assert result is None or result == {}

    def test_messages_grouped_by_year(self):
        """Messages are grouped by year."""
        messages = [
            ("Hello!", 1, "2023", "2023-01"),
            ("Hi there!", 0, "2023", "2023-02"),
            ("How are you?", 1, "2024", "2024-01"),
        ]
        result = analyze_temperature(messages)
        assert result is not None
        assert "2023" in result
        assert "2024" in result
        assert "all" in result


class TestExtractDomain:
    """Tests for domain extraction."""

    def test_basic_url(self):
        """Basic HTTP URL extracts domain."""
        assert extract_domain("http://example.com/path") == "example.com"

    def test_https_url(self):
        """HTTPS URL extracts domain."""
        assert extract_domain("https://secure.example.com") == "secure.example.com"

    def test_www_stripped(self):
        """www. prefix is stripped."""
        assert extract_domain("https://www.example.com") == "example.com"

    def test_url_without_protocol(self):
        """URL without protocol still extracts domain."""
        assert extract_domain("example.com/page") == "example.com"

    def test_twitter_to_x(self):
        """twitter.com normalizes to x.com."""
        assert extract_domain("https://twitter.com/user") == "x.com"
        assert extract_domain("https://m.twitter.com/user") == "x.com"

    def test_youtube_shortlink(self):
        """youtu.be normalizes to youtube.com."""
        assert extract_domain("https://youtu.be/abc123") == "youtube.com"


class TestAggregateUrls:
    """Tests for URL aggregation."""

    def test_empty_list(self):
        """Empty URL list returns zero total."""
        result = aggregate_urls([])
        assert result["total"] == 0
        assert result["top_domains"] == []

    def test_counts_urls(self):
        """URLs are counted correctly."""
        urls = [
            "https://example.com/1",
            "https://example.com/2",
            "https://other.com/1",
        ]
        result = aggregate_urls(urls)
        assert result["total"] == 3
        assert len(result["top_domains"]) == 2

    def test_include_raw_option(self):
        """include_raw adds urls list to result."""
        urls = ["https://example.com"]
        result = aggregate_urls(urls, include_raw=True)
        assert "urls" in result
        assert result["urls"] == urls

        result_no_raw = aggregate_urls(urls, include_raw=False)
        assert "urls" not in result_no_raw


class TestAnalyzeLinks:
    """Tests for link analyzer."""

    def test_empty_messages(self):
        """Empty message list returns None."""
        result = analyze_links([])
        assert result is None

    def test_messages_without_links(self):
        """Messages without links returns None."""
        messages = [
            ("Hello!", 1, "2023", "2023-01"),
            ("No links here", 0, "2023", "2023-02"),
        ]
        result = analyze_links(messages)
        assert result is None

    def test_messages_with_links(self):
        """Messages with links are counted correctly."""
        messages = [
            ("Check out https://example.com", 1, "2023", "2023-01"),
            ("Cool site: https://github.com", 0, "2023", "2023-02"),
        ]
        result = analyze_links(messages)
        assert result is not None
        assert "2023" in result
        assert "all" in result
        assert result["all"]["sent"]["total"] == 1
        assert result["all"]["received"]["total"] == 1


class TestCountProfanityInText:
    """Tests for profanity counting."""

    def test_empty_text(self):
        """Empty text returns 0."""
        count, words = count_profanity_in_text("", {"bad"})
        assert count == 0
        assert words == {}

    def test_no_profanity(self):
        """Clean text returns 0."""
        count, words = count_profanity_in_text("Hello world, nice day!", {"bad", "word"})
        assert count == 0

    def test_profanity_counted(self):
        """Profane words are counted."""
        count, words = count_profanity_in_text("This is bad and bad again", {"bad"})
        assert count == 2
        assert words == {"bad": 2}

    def test_case_insensitive(self):
        """Matching is case-insensitive."""
        count, words = count_profanity_in_text("BAD Bad bad", {"bad"})
        assert count == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
