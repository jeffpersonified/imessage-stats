"""
Message style analyzer - analyzes how people write messages.

Calculates:
- Average message length (words) per direction
- Messages per turn (burst behavior) - how many messages someone sends
  before the other person responds
"""

from collections import defaultdict


def analyze_message_style(messages):
    """Analyze message writing style for a list of messages.

    Args:
        messages: List of (text, is_from_me, year, month) tuples, ordered by time

    Returns:
        Dict with style metrics per year and overall ("all").
        Each entry has:
        - "sent": metrics for your messages
        - "received": metrics for their messages

        Each direction has:
        - "avg_length": average word count per message
        - "avg_per_turn": average messages sent per turn (before other responds)
        - "total_messages": total message count
        - "total_words": total word count
    """
    if not messages:
        return None

    # Track per-year data
    by_year = defaultdict(lambda: {
        "sent": {"lengths": [], "turn_counts": []},
        "received": {"lengths": [], "turn_counts": []},
    })

    # Also track all-time data
    all_data = {
        "sent": {"lengths": [], "turn_counts": []},
        "received": {"lengths": [], "turn_counts": []},
    }

    # Process messages to calculate lengths and turn counts
    # A "turn" is a sequence of consecutive messages from the same sender
    current_turn_sender = None
    current_turn_count = 0
    current_turn_year = None

    for text, is_from_me, year, _month in messages:
        direction = "sent" if is_from_me else "received"
        # Count words instead of characters - more intuitive for users
        length = len(text.split()) if text else 0

        # Track message length
        by_year[year][direction]["lengths"].append(length)
        all_data[direction]["lengths"].append(length)

        # Track turns (consecutive messages from same sender)
        if is_from_me == current_turn_sender:
            # Same sender, continuing the turn
            current_turn_count += 1
        else:
            # New sender - record the previous turn if there was one
            if current_turn_sender is not None and current_turn_count > 0:
                prev_direction = "sent" if current_turn_sender else "received"
                by_year[current_turn_year][prev_direction]["turn_counts"].append(current_turn_count)
                all_data[prev_direction]["turn_counts"].append(current_turn_count)

            # Start new turn
            current_turn_sender = is_from_me
            current_turn_count = 1
            current_turn_year = year

    # Don't forget the last turn
    if current_turn_sender is not None and current_turn_count > 0:
        prev_direction = "sent" if current_turn_sender else "received"
        by_year[current_turn_year][prev_direction]["turn_counts"].append(current_turn_count)
        all_data[prev_direction]["turn_counts"].append(current_turn_count)

    def compute_metrics(data):
        """Compute final metrics from collected data."""
        result = {}
        for direction in ["sent", "received"]:
            lengths = data[direction]["lengths"]
            turn_counts = data[direction]["turn_counts"]

            if lengths:
                total_words = sum(lengths)
                avg_length = total_words / len(lengths)
                avg_per_turn = sum(turn_counts) / len(turn_counts) if turn_counts else 1.0

                result[direction] = {
                    "avg_length": round(avg_length, 1),
                    "avg_per_turn": round(avg_per_turn, 2),
                    "total_messages": len(lengths),
                    "total_words": total_words,
                }
            else:
                result[direction] = {
                    "avg_length": 0,
                    "avg_per_turn": 1.0,
                    "total_messages": 0,
                    "total_words": 0,
                }

        return result

    results = {}

    # Per-year results
    for year, data in by_year.items():
        results[year] = compute_metrics(data)

    # All-time results
    results["all"] = compute_metrics(all_data)

    return results if results else None
