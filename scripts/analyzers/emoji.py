"""
Emoji usage analyzer - extracts and counts emojis from messages.

Provides:
- Top emojis sent vs received
- Total emoji counts
- Per-year breakdown
"""

import re
from collections import Counter, defaultdict

# Regex pattern to match complete emoji sequences including:
# - ZWJ (Zero Width Joiner) sequences like 👨‍💻, 👩‍❤️‍👨
# - Skin tone modifiers like 👍🏽
# - Variation selectors for emoji presentation
# - Flag sequences (two regional indicators)
# - Keycap sequences like 1️⃣

# Unicode ranges for base emoji characters
_EMOJI_RANGES = (
    r'\U0001F300-\U0001F5FF'  # Misc Symbols and Pictographs
    r'\U0001F600-\U0001F64F'  # Emoticons
    r'\U0001F680-\U0001F6FF'  # Transport and Map
    r'\U0001F900-\U0001F9FF'  # Supplemental Symbols
    r'\U0001FA00-\U0001FAFF'  # Extended-A
    r'\U00002600-\U000027BF'  # Misc symbols + Dingbats
    r'\U0001F000-\U0001F0FF'  # Mahjong + Playing cards
)

# Build the complete pattern
EMOJI_PATTERN = re.compile(
    # Flags: two regional indicator symbols (like 🇺🇸)
    r'[\U0001F1E0-\U0001F1FF]{2}'
    # Keycaps: digit/symbol + optional VS + combining enclosing keycap
    r'|[\d#*]\uFE0F?\u20E3'
    # Standard emoji with possible modifiers and ZWJ sequences
    r'|[' + _EMOJI_RANGES + r']'
    # Optional skin tone modifier
    r'[\U0001F3FB-\U0001F3FF]?'
    # Optional variation selector (for emoji presentation)
    r'\uFE0F?'
    # Zero or more ZWJ sequences
    r'(?:'
        r'\u200D'  # Zero Width Joiner
        r'[' + _EMOJI_RANGES + r'\u2640\u2642\u2695\u2696\u2708]'  # Next emoji or gender/profession symbol
        r'[\U0001F3FB-\U0001F3FF]?'  # Optional skin tone
        r'\uFE0F?'  # Optional variation selector
    r')*',
    flags=re.UNICODE
)


def extract_emojis(text):
    """Extract all emojis from text as a list."""
    if not text:
        return []
    return EMOJI_PATTERN.findall(text)


def aggregate_emojis(emoji_list, top_n=10):
    """Aggregate a list of emojis into counts and top emojis.

    Args:
        emoji_list: List of emoji strings
        top_n: Number of top emojis to return

    Returns:
        Dict with total count and top emojis list
    """
    if not emoji_list:
        return {"total": 0, "top": []}

    counts = Counter(emoji_list)
    top = counts.most_common(top_n)

    return {
        "total": len(emoji_list),
        "top": [{"emoji": e, "count": c} for e, c in top]
    }


def analyze_emoji(messages):
    """Analyze emoji usage for a list of messages.

    Args:
        messages: List of (text, is_from_me, year, month) tuples

    Returns:
        Dict with emoji stats per year and overall ("all").
        Each entry has:
        - "sent": {total, top} for emojis you sent
        - "received": {total, top} for emojis they sent
    """
    # Group emojis by year and direction
    by_year = defaultdict(lambda: {"sent": [], "received": []})
    all_sent = []
    all_received = []

    for text, is_from_me, year, _month in messages:
        if not text:
            continue

        emojis = extract_emojis(text)
        if not emojis:
            continue

        direction = "sent" if is_from_me else "received"
        by_year[year][direction].extend(emojis)

        if is_from_me:
            all_sent.extend(emojis)
        else:
            all_received.extend(emojis)

    results = {}

    # Per-year metrics
    for year, emojis in by_year.items():
        sent_agg = aggregate_emojis(emojis["sent"])
        recv_agg = aggregate_emojis(emojis["received"])
        if sent_agg["total"] > 0 or recv_agg["total"] > 0:
            results[year] = {
                "sent": sent_agg,
                "received": recv_agg,
            }

    # Overall metrics
    all_sent_agg = aggregate_emojis(all_sent)
    all_recv_agg = aggregate_emojis(all_received)
    if all_sent_agg["total"] > 0 or all_recv_agg["total"] > 0:
        results["all"] = {
            "sent": all_sent_agg,
            "received": all_recv_agg,
        }

    return results if results else None
