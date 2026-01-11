"""
Question analyzer - measures who asks more questions in a conversation.

Counts messages containing question marks to reveal curiosity balance
and engagement asymmetry between conversation participants.
"""

from collections import defaultdict


def analyze_questions(messages):
    """Analyze question-asking patterns for a list of messages.

    Args:
        messages: List of (text, is_from_me, year, month) tuples, ordered by time

    Returns:
        Dict with question counts per year and overall ("all").
        Each entry has:
        - "sent": number of questions you asked
        - "received": number of questions they asked
    """
    if not messages:
        return None

    # Track per-year data
    by_year = defaultdict(lambda: {"sent": 0, "received": 0})

    # Also track all-time data
    all_data = {"sent": 0, "received": 0}

    for text, is_from_me, year, _month in messages:
        if not text:
            continue

        # Count question marks in this message
        question_count = text.count("?")
        if question_count > 0:
            direction = "sent" if is_from_me else "received"
            by_year[year][direction] += question_count
            all_data[direction] += question_count

    results = {}

    # Per-year results
    for year, data in by_year.items():
        results[year] = data.copy()

    # All-time results
    results["all"] = all_data

    return results if results else None
