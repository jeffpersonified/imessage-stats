"""
Temperature score analyzer - measures conversation "energy" or "warmth".

Combines multiple signals using logarithmic scaling:
- Message length (longer = more effort)
- Emoji density (emojis per 100 chars)
- Exclamation density (! per 100 chars)
- Question density (? per 100 chars)
- Caps ratio (% uppercase in alphabetic chars)

Returns a score from 1-5 where higher = more energetic/warm conversation.
Uses log transforms to spread scores across the full range.
"""

import math
import re
from collections import defaultdict

try:
    import emoji
    HAS_EMOJI = True
except ImportError:
    HAS_EMOJI = False


def count_emojis(text):
    """Count emojis in text."""
    if not HAS_EMOJI:
        # Fallback: count common emoji unicode ranges
        # This catches most common emojis but isn't comprehensive
        emoji_pattern = re.compile(
            "["
            "\U0001F600-\U0001F64F"  # emoticons
            "\U0001F300-\U0001F5FF"  # symbols & pictographs
            "\U0001F680-\U0001F6FF"  # transport & map symbols
            "\U0001F1E0-\U0001F1FF"  # flags
            "\U00002702-\U000027B0"  # dingbats
            "\U0001F900-\U0001F9FF"  # supplemental symbols
            "\U0001FA00-\U0001FA6F"  # chess symbols
            "\U0001FA70-\U0001FAFF"  # symbols extended-a
            "\U00002600-\U000026FF"  # misc symbols
            "]+",
            flags=re.UNICODE
        )
        return len(emoji_pattern.findall(text))

    # Use emoji library for accurate counting
    return sum(1 for c in text if c in emoji.EMOJI_DATA)


def compute_metrics(texts):
    """Compute temperature metrics for a list of message texts."""
    if not texts:
        return None

    total_chars = sum(len(t) for t in texts)
    total_messages = len(texts)

    if total_chars == 0:
        return None

    # Count various signals
    emoji_count = sum(count_emojis(t) for t in texts)
    exclamations = sum(t.count('!') for t in texts)
    questions = sum(t.count('?') for t in texts)

    # Calculate caps ratio (uppercase / total alphabetic)
    alpha_chars = sum(1 for t in texts for c in t if c.isalpha())
    upper_chars = sum(1 for t in texts for c in t if c.isupper())
    caps_ratio = upper_chars / alpha_chars if alpha_chars > 0 else 0

    # Calculate densities
    avg_length = total_chars / total_messages
    emoji_density = (emoji_count / total_chars * 100) if total_chars > 0 else 0
    exclamation_density = (exclamations / total_chars * 100) if total_chars > 0 else 0
    question_density = (questions / total_chars * 100) if total_chars > 0 else 0

    # Weighted composite score (1-5 scale)
    # Uses logarithmic scaling with aggressive multipliers to spread scores
    score = 1.0  # Base score

    # Message length: longer messages = more effort
    # Aggressive scaling: 30 char avg = ~0.7, 60 char = ~1.1, 100 char = ~1.3
    score += min(math.log(1 + avg_length / 20) * 0.9, 1.3)  # Max +1.3 points

    # Emoji density: emojis signal warmth
    # More aggressive: 0.3% = ~0.5, 1% = ~0.9, 2% = ~1.1
    score += min(math.log(1 + emoji_density * 5) * 0.8, 1.2)  # Max +1.2 points

    # Exclamation density: enthusiasm indicator
    # 0.2% = ~0.35, 0.5% = ~0.5, 1% = ~0.6
    score += min(math.log(1 + exclamation_density * 6) * 0.5, 0.7)  # Max +0.7 points

    # Question density: engagement indicator
    # 0.2% = ~0.3, 0.5% = ~0.4, 1% = ~0.55
    score += min(math.log(1 + question_density * 5) * 0.5, 0.6)  # Max +0.6 points

    # Caps ratio: minimal contribution (often noise from autocorrect)
    score += min(caps_ratio * 1.0, 0.2)  # Max +0.2 points

    # Cap at 5
    score = min(score, 5.0)

    return {
        "score": round(score, 1),
        "avg_length": round(avg_length, 1),
        "emoji_density": round(emoji_density, 2),
        "message_count": total_messages,
    }


def analyze_temperature(messages):
    """Analyze temperature for a list of messages.

    Args:
        messages: List of (text, is_from_me, year, month) tuples

    Returns:
        Dict with temperature metrics per year and overall ("all"),
        including time series data for charts:
        - "all" includes "by_year" array for yearly trends
        - Each year includes "by_month" array for monthly trends
    """
    # Group messages by year, month, and direction
    by_year = defaultdict(lambda: {"sent": [], "received": []})
    by_month = defaultdict(lambda: {"sent": [], "received": []})
    all_sent = []
    all_received = []

    for text, is_from_me, year, month in messages:
        if not text:
            continue
        direction = "sent" if is_from_me else "received"
        by_year[year][direction].append(text)
        by_month[month][direction].append(text)
        if is_from_me:
            all_sent.append(text)
        else:
            all_received.append(text)

    results = {}

    # Per-year metrics with monthly breakdown
    for year, texts in by_year.items():
        sent_metrics = compute_metrics(texts["sent"])
        recv_metrics = compute_metrics(texts["received"])
        if sent_metrics or recv_metrics:
            # Build monthly time series for this year
            monthly_data = []
            for month in sorted(by_month.keys()):
                if month.startswith(year):
                    m_sent = compute_metrics(by_month[month]["sent"])
                    m_recv = compute_metrics(by_month[month]["received"])
                    if m_sent or m_recv:
                        monthly_data.append({
                            "month": month,
                            "sent": m_sent["score"] if m_sent else None,
                            "received": m_recv["score"] if m_recv else None,
                        })

            results[year] = {
                "sent": sent_metrics,
                "received": recv_metrics,
                "by_month": monthly_data,
            }

    # Overall metrics with yearly breakdown
    all_sent_metrics = compute_metrics(all_sent)
    all_recv_metrics = compute_metrics(all_received)
    if all_sent_metrics or all_recv_metrics:
        # Build yearly time series
        yearly_data = []
        for year in sorted(by_year.keys()):
            y_sent = compute_metrics(by_year[year]["sent"])
            y_recv = compute_metrics(by_year[year]["received"])
            if y_sent or y_recv:
                yearly_data.append({
                    "year": year,
                    "sent": y_sent["score"] if y_sent else None,
                    "received": y_recv["score"] if y_recv else None,
                })

        results["all"] = {
            "sent": all_sent_metrics,
            "received": all_recv_metrics,
            "by_year": yearly_data,
        }

    return results if results else None
