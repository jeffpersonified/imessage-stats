"""
Laughter detector - counts laugh indicators in messages.

Detects text patterns like "haha", "lol", "lmao" and laughing emojis
across multiple languages and internet cultures.
Used to determine who makes the other person laugh more often.
"""

import re
from collections import defaultdict

# Patterns with their display names for reporting
# Each tuple is (regex_pattern, display_name)
_LAUGH_PATTERN_DEFS = [
    # English
    (r'\bha(?:ha)+\b', 'haha'),
    (r'\bah(?:ah)+\b', 'ahaha'),
    (r'\bhe(?:he)+\b', 'hehe'),
    (r'\bhi(?:hi)+\b', 'hihi'),
    (r'\blol\b', 'lol'),
    (r'\blmao\b', 'lmao'),
    (r'\blmfao\b', 'lmfao'),
    (r'\brofl\b', 'rofl'),
    (r'\brotfl\b', 'rotfl'),
    (r'\broflmao\b', 'roflmao'),
    (r'\bteehee\b', 'teehee'),
    (r'\bbwahaha\b', 'bwahaha'),
    (r'\bmuahaha\b', 'muahaha'),
    (r'\bcackle\b', 'cackle'),
    (r'\bwheeze\b', 'wheeze'),
    (r'\blawl\b', 'lawl'),

    # Internet culture
    (r'\bkek\b', 'kek'),
    (r'\btopkek\b', 'topkek'),

    # Spanish
    (r'\bja(?:ja)+\b', 'jaja'),
    (r'\bje(?:je)+\b', 'jeje'),

    # Portuguese/Brazilian
    (r'\bk{3,}\b', 'kkkk'),
    (r'\brs(?:rs)+\b', 'rsrs'),

    # Japanese (4+ w's to avoid matching "www" from URLs)
    (r'(?<!\.)w{4,}(?!\.)', 'wwww'),
    (r'草+', '草'),

    # Indonesian
    (r'\bwkwk(?:wk)*\b', 'wkwk'),

    # Arabic
    (r'\bh{4,}\b', 'hhhh'),

    # Thai (5 = "ha" sound)
    (r'5{3,}', '555'),

    # French
    (r'\bmdr\b', 'mdr'),
    (r'\bptdr\b', 'ptdr'),

    # Russian (both latin and cyrillic)
    (r'\bxaxa\b', 'xaxa'),
    (r'\bхаха\b', 'хаха'),
]

# Compile patterns with their display names
_COMPILED_PATTERNS = [(re.compile(pattern, re.IGNORECASE), name) for pattern, name in _LAUGH_PATTERN_DEFS]

# Laughing emojis (each emoji is its own "pattern")
# Note: 💀 is ambiguous ("I'm dead laughing" vs other uses) but common enough to include
_LAUGH_EMOJIS = ['😂', '🤣', '😆', '😹', '💀']


def count_laughs_in_text(text):
    """Count laugh indicators in a text string.

    Returns:
        Tuple of (total_count, pattern_counts_dict)
        where pattern_counts_dict maps display names to counts
    """
    if not text:
        return 0, {}

    pattern_counts = defaultdict(int)

    # Count text patterns
    for regex, display_name in _COMPILED_PATTERNS:
        matches = regex.findall(text)
        if matches:
            pattern_counts[display_name] += len(matches)

    # Count emojis
    for emoji in _LAUGH_EMOJIS:
        count = text.count(emoji)
        if count > 0:
            pattern_counts[emoji] += count

    total = sum(pattern_counts.values())
    return total, dict(pattern_counts)


def analyze_laughter(messages):
    """Analyze laughter patterns for a list of messages.

    The logic:
    - Laughs in "sent" messages (is_from_me=1) = they made YOU laugh
    - Laughs in "received" messages (is_from_me=0) = YOU made them laugh

    Args:
        messages: List of (text, is_from_me, year, month) tuples

    Returns:
        Dict with laugh counts per year and overall ("all").
        Each entry has:
        - "sent" = laughs in your messages (they made you laugh)
        - "received" = laughs in their messages (you made them laugh)
        - "top_sent" = most common laugh pattern you use
        - "top_received" = most common laugh pattern they use
    """
    # Count by year and direction
    by_year = defaultdict(lambda: {"sent": 0, "received": 0})
    total_sent = 0
    total_received = 0

    # Track pattern frequencies
    patterns_sent_all = defaultdict(int)
    patterns_received_all = defaultdict(int)
    patterns_sent_by_year = defaultdict(lambda: defaultdict(int))
    patterns_received_by_year = defaultdict(lambda: defaultdict(int))

    for text, is_from_me, year, _month in messages:
        if not text:
            continue

        count, pattern_counts = count_laughs_in_text(text)
        if count > 0:
            if is_from_me:
                by_year[year]["sent"] += count
                total_sent += count
                for pattern, cnt in pattern_counts.items():
                    patterns_sent_all[pattern] += cnt
                    patterns_sent_by_year[year][pattern] += cnt
            else:
                by_year[year]["received"] += count
                total_received += count
                for pattern, cnt in pattern_counts.items():
                    patterns_received_all[pattern] += cnt
                    patterns_received_by_year[year][pattern] += cnt

    def get_top_pattern(pattern_counts):
        """Get the most common pattern from a counts dict."""
        if not pattern_counts:
            return None
        return max(pattern_counts.items(), key=lambda x: x[1])[0]

    results = {}

    # Per-year counts with top patterns
    for year, counts in by_year.items():
        if counts["sent"] > 0 or counts["received"] > 0:
            results[year] = {
                "sent": counts["sent"],
                "received": counts["received"],
                "top_sent": get_top_pattern(patterns_sent_by_year[year]),
                "top_received": get_top_pattern(patterns_received_by_year[year]),
            }

    # Overall counts with top patterns
    if total_sent > 0 or total_received > 0:
        results["all"] = {
            "sent": total_sent,
            "received": total_received,
            "top_sent": get_top_pattern(patterns_sent_all),
            "top_received": get_top_pattern(patterns_received_all),
        }

    return results if results else None
