"""
Database query functions for iMessage statistics.

All functions take a cursor and return data structures ready for JSON export.
"""

from collections import defaultdict

from utils import convert_timestamp, extract_text_from_attributed_body, URL_PATTERN


# -----------------------------------------------------------------------------
# Per-contact queries
# -----------------------------------------------------------------------------

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


def get_attachments_by_year(cursor, handle_ids):
    """Get attachment counts by type, grouped by year."""
    if not handle_ids:
        return {}

    placeholders = ",".join("?" * len(handle_ids))
    cursor.execute(f"""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
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
        GROUP BY year, a.mime_type, m.is_from_me
    """, handle_ids)

    yearly = defaultdict(lambda: {
        "photos_sent": 0, "photos_received": 0,
        "videos_sent": 0, "videos_received": 0,
        "audio_sent": 0, "audio_received": 0,
        "gifs_sent": 0, "gifs_received": 0,
    })

    for year, mime_type, is_from_me, count in cursor.fetchall():
        if not year or not mime_type:
            continue
        direction = "sent" if is_from_me else "received"
        if mime_type.startswith("image/gif"):
            yearly[year][f"gifs_{direction}"] += count
        elif mime_type.startswith("image/"):
            yearly[year][f"photos_{direction}"] += count
        elif mime_type.startswith("video/"):
            yearly[year][f"videos_{direction}"] += count
        elif mime_type.startswith("audio/"):
            yearly[year][f"audio_{direction}"] += count

    return dict(yearly)


def get_heatmap_by_year(cursor, handle_ids):
    """Get message counts by day of week and hour, grouped by year."""
    if not handle_ids:
        return {}

    placeholders = ",".join("?" * len(handle_ids))
    cursor.execute(f"""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            CAST(strftime('%w', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as day,
            CAST(strftime('%H', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as hour,
            COUNT(*) as count
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        WHERE chj.handle_id IN ({placeholders}) AND c.style = 45
        GROUP BY year, day, hour
    """, handle_ids)

    yearly = defaultdict(lambda: [[0] * 24 for _ in range(7)])

    for year, day, hour, count in cursor.fetchall():
        if year and day is not None and hour is not None:
            yearly[year][day][hour] = count

    return dict(yearly)


def _compute_response_stats(messages):
    """Compute response stats from a list of (timestamp, is_from_me) tuples.

    Returns dict with you_avg_seconds, them_avg_seconds, you_start_pct, you_end_pct.
    """
    if len(messages) < 2:
        return {"you_avg_seconds": None, "them_avg_seconds": None, "you_start_pct": None, "you_end_pct": None}

    CONVERSATION_GAP = 4 * 60 * 60 * 1e9  # 4 hours in nanoseconds
    RESPONSE_MAX = 60 * 60 * 1e9  # Only count responses within 1 hour as actual responses

    your_response_times = []
    their_response_times = []
    conversations_you_started = 0
    conversations_they_started = 0
    conversations_you_ended = 0
    conversations_they_ended = 0

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
            # The previous sender ended the last conversation
            if prev_from_me:
                conversations_you_ended += 1
            else:
                conversations_they_ended += 1
            # The current sender starts this conversation
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

    # The last message ends the final conversation
    if prev_from_me:
        conversations_you_ended += 1
    else:
        conversations_they_ended += 1

    # Calculate averages
    you_avg = sum(your_response_times) / len(your_response_times) if your_response_times else None
    them_avg = sum(their_response_times) / len(their_response_times) if their_response_times else None

    total_convos = conversations_you_started + conversations_they_started
    you_start_pct = conversations_you_started / total_convos if total_convos > 0 else None

    total_ended = conversations_you_ended + conversations_they_ended
    you_end_pct = conversations_you_ended / total_ended if total_ended > 0 else None

    return {
        "you_avg_seconds": round(you_avg) if you_avg else None,
        "them_avg_seconds": round(them_avg) if them_avg else None,
        "you_start_pct": round(you_start_pct, 2) if you_start_pct is not None else None,
        "you_end_pct": round(you_end_pct, 2) if you_end_pct is not None else None
    }


def get_response_stats(cursor, handle_ids):
    """Calculate average response times and conversation starter percentage.

    Returns a dict with 'all' for all-time stats and per-year keys (e.g., '2024').
    """
    if not handle_ids:
        return {"all": {"you_avg_seconds": None, "them_avg_seconds": None, "you_start_pct": None}}

    placeholders = ",".join("?" * len(handle_ids))

    # Get all messages ordered by date, with year
    cursor.execute(f"""
        SELECT
            m.date,
            m.is_from_me,
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        WHERE chj.handle_id IN ({placeholders}) AND c.style = 45
        ORDER BY m.date
    """, handle_ids)

    all_messages = []
    messages_by_year = defaultdict(list)

    for ts, is_from_me, year in cursor.fetchall():
        if ts:
            all_messages.append((ts, is_from_me))
            if year:
                messages_by_year[year].append((ts, is_from_me))

    # Compute all-time stats
    result = {"all": _compute_response_stats(all_messages)}

    # Compute per-year stats
    for year, year_messages in messages_by_year.items():
        result[year] = _compute_response_stats(year_messages)

    return result


# -----------------------------------------------------------------------------
# Global queries (across all conversations)
# -----------------------------------------------------------------------------

def get_global_stats(cursor):
    """Get total message counts across all 1-on-1 conversations."""
    cursor.execute("""
        SELECT
            SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as total_sent,
            SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as total_received,
            MIN(m.date) as first_msg,
            MAX(m.date) as last_msg
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
    """)
    row = cursor.fetchone()
    if not row:
        return {"total_sent": 0, "total_received": 0, "first_date": None, "last_date": None}

    first_dt = convert_timestamp(row[2])
    last_dt = convert_timestamp(row[3])
    return {
        "total_sent": row[0] or 0,
        "total_received": row[1] or 0,
        "first_date": first_dt.strftime("%Y-%m-%d") if first_dt else None,
        "last_date": last_dt.strftime("%Y-%m-%d") if last_dt else None,
    }


def get_global_monthly(cursor):
    """Get monthly message counts across all 1-on-1 conversations."""
    cursor.execute("""
        SELECT
            strftime('%Y-%m', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as month,
            SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
        GROUP BY month
        ORDER BY month
    """)
    return [
        {"month": month, "sent": sent, "received": received}
        for month, sent, received in cursor.fetchall()
        if month
    ]


def get_global_heatmap(cursor):
    """Get message counts by day of week and hour across all 1-on-1 conversations."""
    cursor.execute("""
        SELECT
            CAST(strftime('%w', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as day,
            CAST(strftime('%H', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as hour,
            COUNT(*) as count
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
        GROUP BY day, hour
    """)
    heatmap = [[0] * 24 for _ in range(7)]
    for day, hour, count in cursor.fetchall():
        if day is not None and hour is not None:
            heatmap[day][hour] = count
    return heatmap


def get_global_attachments(cursor):
    """Get attachment counts by type across all 1-on-1 conversations."""
    cursor.execute("""
        SELECT
            a.mime_type,
            m.is_from_me,
            COUNT(*) as count
        FROM attachment a
        JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
        JOIN message m ON maj.message_id = m.ROWID
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
        GROUP BY a.mime_type, m.is_from_me
    """)

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


def get_global_links(cursor):
    """Get link counts from message text across all 1-on-1 conversations.

    Extracts text from attributedBody when text column is empty (newer macOS).
    """
    cursor.execute("""
        SELECT
            m.text,
            m.attributedBody,
            m.is_from_me
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
    """)

    links_sent = 0
    links_received = 0

    for text, attr_body, is_from_me in cursor.fetchall():
        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            urls = URL_PATTERN.findall(msg_text)
            if is_from_me:
                links_sent += len(urls)
            else:
                links_received += len(urls)

    return {"links_sent": links_sent, "links_received": links_received}


def get_yearly_links(cursor):
    """Get link counts by year from message text across all 1-on-1 conversations.

    Extracts text from attributedBody when text column is empty (newer macOS).
    """
    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            m.text,
            m.attributedBody,
            m.is_from_me
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
    """)

    yearly_links = defaultdict(lambda: {"links_sent": 0, "links_received": 0})

    for year, text, attr_body, is_from_me in cursor.fetchall():
        if not year:
            continue

        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            urls = URL_PATTERN.findall(msg_text)
            if is_from_me:
                yearly_links[year]["links_sent"] += len(urls)
            else:
                yearly_links[year]["links_received"] += len(urls)

    return dict(yearly_links)


def get_global_emoji(cursor):
    """Get top emojis sent from message text across all 1-on-1 conversations.

    Extracts text from attributedBody when text column is empty (newer macOS).
    Returns top 10 most used emojis sent.
    """
    from analyzers.emoji import extract_emojis
    from collections import Counter

    cursor.execute("""
        SELECT
            m.text,
            m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
          AND m.is_from_me = 1
    """)

    all_emojis = []

    for text, attr_body in cursor.fetchall():
        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            emojis = extract_emojis(msg_text)
            all_emojis.extend(emojis)

    if not all_emojis:
        return {"total": 0, "top": []}

    counts = Counter(all_emojis)
    top = counts.most_common(10)

    return {
        "total": len(all_emojis),
        "top": [{"emoji": e, "count": c} for e, c in top]
    }


def get_yearly_emoji(cursor):
    """Get top emojis sent by year from message text across all 1-on-1 conversations.

    Extracts text from attributedBody when text column is empty (newer macOS).
    Returns top 10 emojis sent per year.
    """
    from analyzers.emoji import extract_emojis
    from collections import Counter

    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            m.text,
            m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
          AND m.is_from_me = 1
    """)

    yearly_emojis = defaultdict(list)

    for year, text, attr_body in cursor.fetchall():
        if not year:
            continue

        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            emojis = extract_emojis(msg_text)
            yearly_emojis[year].extend(emojis)

    result = {}
    for year, emojis in yearly_emojis.items():
        if emojis:
            counts = Counter(emojis)
            top = counts.most_common(10)
            result[year] = {
                "total": len(emojis),
                "top": [{"emoji": e, "count": c} for e, c in top]
            }
        else:
            result[year] = {"total": 0, "top": []}

    return result


def get_global_word_counts(cursor):
    """Get total word counts across all 1-on-1 conversations.

    Extracts text from attributedBody when text column is empty (newer macOS).
    Returns total words sent and received.
    """
    cursor.execute("""
        SELECT
            m.text,
            m.attributedBody,
            m.is_from_me
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
    """)

    words_sent = 0
    words_received = 0

    for text, attr_body, is_from_me in cursor.fetchall():
        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            word_count = len(msg_text.split())
            if is_from_me:
                words_sent += word_count
            else:
                words_received += word_count

    return {
        "words_sent": words_sent,
        "words_received": words_received,
    }


def get_yearly_word_counts(cursor):
    """Get word counts by year across all 1-on-1 conversations.

    Extracts text from attributedBody when text column is empty (newer macOS).
    Returns words sent and received per year.
    """
    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            m.text,
            m.attributedBody,
            m.is_from_me
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
    """)

    yearly_words = defaultdict(lambda: {"words_sent": 0, "words_received": 0})

    for year, text, attr_body, is_from_me in cursor.fetchall():
        if not year:
            continue

        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            word_count = len(msg_text.split())
            if is_from_me:
                yearly_words[year]["words_sent"] += word_count
            else:
                yearly_words[year]["words_received"] += word_count

    return dict(yearly_words)


def get_yearly_top_identifiers(cursor, top_n=8):
    """Get identifiers that appear in any year's top N by message count.

    Returns a set of identifiers that should be exported even if not in the
    overall top contacts, so they can appear in yearly top contact lists.
    """
    cursor.execute("""
        WITH yearly_ranked AS (
            SELECT
                strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
                h.id as identifier,
                COUNT(*) as total,
                ROW_NUMBER() OVER (
                    PARTITION BY strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime'))
                    ORDER BY COUNT(*) DESC
                ) as rank
            FROM message m
            JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
            JOIN chat c ON cmj.chat_id = c.ROWID
            JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
            JOIN handle h ON chj.handle_id = h.ROWID
            WHERE c.style = 45
            GROUP BY year, h.id
        )
        SELECT DISTINCT identifier
        FROM yearly_ranked
        WHERE rank <= ? AND year IS NOT NULL
    """, (top_n,))
    return set(row[0] for row in cursor.fetchall())


def get_global_response_stats(cursor):
    """Calculate global average response times across all 1-on-1 conversations.

    Computes response times per conversation (handle) and returns weighted averages.
    Returns dict with 'all' for all-time stats and per-year keys.
    """
    # Get all messages grouped by handle_id, ordered by date within each handle
    cursor.execute("""
        SELECT
            h.ROWID as handle_rowid,
            m.date,
            m.is_from_me,
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        JOIN handle h ON chj.handle_id = h.ROWID
        WHERE c.style = 45
        ORDER BY h.ROWID, m.date
    """)

    # Group messages by handle
    messages_by_handle = defaultdict(list)
    for handle_rowid, ts, is_from_me, year in cursor.fetchall():
        if ts:
            messages_by_handle[handle_rowid].append((ts, is_from_me, year))

    # Compute response times across all handles
    all_your_response_times = []
    yearly_your_response_times = defaultdict(list)

    RESPONSE_MAX = 60 * 60 * 1e9  # 1 hour in nanoseconds

    for handle_rowid, messages in messages_by_handle.items():
        if len(messages) < 2:
            continue

        prev_ts, prev_from_me, prev_year = messages[0]

        for ts, is_from_me, year in messages[1:]:
            gap = ts - prev_ts

            # Check if this is a response (direction changed) within the max window
            if is_from_me != prev_from_me and gap < RESPONSE_MAX:
                response_seconds = gap / 1e9
                if is_from_me:
                    # Your response
                    all_your_response_times.append(response_seconds)
                    if year:
                        yearly_your_response_times[year].append(response_seconds)

            prev_ts, prev_from_me, prev_year = ts, is_from_me, year

    # Calculate averages
    result = {}

    if all_your_response_times:
        result["all"] = {
            "you_avg_seconds": round(sum(all_your_response_times) / len(all_your_response_times)),
            "response_count": len(all_your_response_times),
        }

    for year, times in yearly_your_response_times.items():
        if times:
            result[year] = {
                "you_avg_seconds": round(sum(times) / len(times)),
                "response_count": len(times),
            }

    return result if result else None


def get_global_laughter(cursor):
    """Count laughter indicators (LOL, haha, etc.) across all 1-on-1 conversations.

    Returns dict with counts per year and overall ('all').
    Only counts sent messages (your LOLs).
    """
    from analyzers.laughter import count_laughs_in_text

    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            m.text,
            m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
          AND m.is_from_me = 1
    """)

    from utils import extract_text_from_attributed_body

    by_year = defaultdict(int)
    total = 0

    for year, text, attr_body in cursor.fetchall():
        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            count, _ = count_laughs_in_text(msg_text)
            if count > 0:
                total += count
                if year:
                    by_year[year] += count

    result = {}
    if total > 0:
        result["all"] = {"count": total}

    for year, count in by_year.items():
        result[year] = {"count": count}

    return result if result else None


def get_global_profanity(cursor):
    """Count profanity across all 1-on-1 conversations.

    Returns dict with counts per year and overall ('all'), including top swear words.
    Only counts sent messages (your swearing).
    """
    from analyzers.profanity import _load_wordlist, count_profanity_in_text

    wordlist = _load_wordlist()
    if not wordlist:
        return None

    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            m.text,
            m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
          AND m.is_from_me = 1
    """)

    from utils import extract_text_from_attributed_body

    by_year = defaultdict(int)
    total = 0

    # Track word frequencies
    words_all = defaultdict(int)
    words_by_year = defaultdict(lambda: defaultdict(int))

    for year, text, attr_body in cursor.fetchall():
        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            count, word_counts = count_profanity_in_text(msg_text, wordlist)
            if count > 0:
                total += count
                if year:
                    by_year[year] += count
                for word, cnt in word_counts.items():
                    words_all[word] += cnt
                    if year:
                        words_by_year[year][word] += cnt

    result = {}
    if total > 0:
        # Get top 5 words overall
        top_words = sorted(words_all.items(), key=lambda x: x[1], reverse=True)[:5]
        result["all"] = {
            "count": total,
            "top_words": [{"word": w, "count": c} for w, c in top_words],
        }

    for year, count in by_year.items():
        # Get top 5 words for this year
        year_top = sorted(words_by_year[year].items(), key=lambda x: x[1], reverse=True)[:5]
        result[year] = {
            "count": count,
            "top_words": [{"word": w, "count": c} for w, c in year_top],
        }

    return result if result else None


def get_global_questions(cursor):
    """Count questions asked across all 1-on-1 conversations.

    Returns dict with counts per year and overall ('all').
    Only counts sent messages (your questions).
    """
    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            m.text,
            m.attributedBody
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
          AND m.is_from_me = 1
    """)

    from utils import extract_text_from_attributed_body

    by_year = defaultdict(int)
    total = 0

    for year, text, attr_body in cursor.fetchall():
        # Prefer text column, fall back to extracting from attributedBody
        msg_text = text if text and text.strip() else None
        if not msg_text and attr_body:
            msg_text = extract_text_from_attributed_body(attr_body)

        if msg_text:
            question_count = msg_text.count("?")
            if question_count > 0:
                total += question_count
                if year:
                    by_year[year] += question_count

    result = {}
    if total > 0:
        result["all"] = {"count": total}

    for year, count in by_year.items():
        result[year] = {"count": count}

    return result if result else None


def get_yearly_data(cursor, global_monthly, contacts_export, yearly_links=None, yearly_emoji=None, yearly_word_counts=None):
    """Get per-year statistics including top contacts and busiest month."""
    if yearly_links is None:
        yearly_links = {}
    if yearly_emoji is None:
        yearly_emoji = {}
    if yearly_word_counts is None:
        yearly_word_counts = {}
    # Build a lookup from identifier to contact export data
    contact_by_identifier = {}
    for c in contacts_export:
        contact_by_identifier[c["identifier"]] = c

    # Query yearly message counts per identifier
    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            h.id as identifier,
            SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        JOIN handle h ON chj.handle_id = h.ROWID
        WHERE c.style = 45
        GROUP BY year, h.id
    """)

    # Group by year
    yearly_contacts = defaultdict(list)
    for year, identifier, sent, received in cursor.fetchall():
        if year:
            yearly_contacts[year].append({
                "identifier": identifier,
                "sent": sent,
                "received": received,
                "total": sent + received,
            })

    # Query yearly heatmaps
    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            CAST(strftime('%w', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as day,
            CAST(strftime('%H', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) AS INTEGER) as hour,
            COUNT(*) as count
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
        GROUP BY year, day, hour
    """)

    yearly_heatmaps = defaultdict(lambda: [[0] * 24 for _ in range(7)])
    for year, day, hour, count in cursor.fetchall():
        if year and day is not None and hour is not None:
            yearly_heatmaps[year][day][hour] = count

    # Query yearly attachments
    cursor.execute("""
        SELECT
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            a.mime_type,
            m.is_from_me,
            COUNT(*) as count
        FROM attachment a
        JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
        JOIN message m ON maj.message_id = m.ROWID
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE c.style = 45
        GROUP BY year, a.mime_type, m.is_from_me
    """)

    yearly_attachments = defaultdict(lambda: {
        "photos_sent": 0, "photos_received": 0,
        "videos_sent": 0, "videos_received": 0,
        "audio_sent": 0, "audio_received": 0,
        "gifs_sent": 0, "gifs_received": 0,
    })
    for year, mime_type, is_from_me, count in cursor.fetchall():
        if not year or not mime_type:
            continue
        direction = "sent" if is_from_me else "received"
        if mime_type.startswith("image/gif"):
            yearly_attachments[year][f"gifs_{direction}"] += count
        elif mime_type.startswith("image/"):
            yearly_attachments[year][f"photos_{direction}"] += count
        elif mime_type.startswith("video/"):
            yearly_attachments[year][f"videos_{direction}"] += count
        elif mime_type.startswith("audio/"):
            yearly_attachments[year][f"audio_{direction}"] += count

    # Group global monthly by year
    monthly_by_year = defaultdict(list)
    for m in global_monthly:
        year = m["month"][:4]
        monthly_by_year[year].append(m)

    # Build yearly data
    by_year = {}
    for year in sorted(yearly_contacts.keys(), reverse=True):
        # Get top 8 contacts that exist in our export
        contacts_for_year = yearly_contacts[year]
        contacts_for_year.sort(key=lambda x: x["total"], reverse=True)

        top_contacts = []
        for c in contacts_for_year:
            if len(top_contacts) >= 8:
                break
            # Check if this identifier is in our exported contacts
            exported = contact_by_identifier.get(c["identifier"])
            if exported:
                top_contacts.append({
                    "rank": len(top_contacts) + 1,
                    "name": exported["name"],
                    "filename": exported["filename"],
                    "total": c["total"],
                    "sent": c["sent"],
                    "received": c["received"],
                })

        # Calculate yearly totals
        year_monthly = monthly_by_year.get(year, [])
        year_sent = sum(m["sent"] for m in year_monthly)
        year_received = sum(m["received"] for m in year_monthly)

        # Find busiest month
        busiest_month = None
        if year_monthly:
            busiest = max(year_monthly, key=lambda m: m["sent"] + m["received"])
            busiest_month = {
                "month": busiest["month"],
                "total": busiest["sent"] + busiest["received"],
            }

        by_year[year] = {
            "sent": year_sent,
            "received": year_received,
            "monthly": year_monthly,
            "time_heatmap": yearly_heatmaps[year],
            "attachments": yearly_attachments[year],
            "links": yearly_links.get(year, {"links_sent": 0, "links_received": 0}),
            "emoji": yearly_emoji.get(year, {"total": 0, "top": []}),
            "words": yearly_word_counts.get(year, {"words_sent": 0, "words_received": 0}),
            "top_contacts": top_contacts,
            "busiest_month": busiest_month,
        }

    return by_year
