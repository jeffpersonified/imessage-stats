"""
Profanity counter - counts profane words in messages using a word list.

Uses whole-word matching to avoid false positives.
Word list is fetched from https://github.com/zautumnz/profane-words and cached locally.
"""

import json
import re
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path

# Cache the word list in memory
_PROFANE_WORDS = None

# URL for the profane words list
_WORDLIST_URL = "https://raw.githubusercontent.com/zautumnz/profane-words/master/words.json"


def _get_cache_path():
    """Get the path to the cached word list file."""
    # Store in .cache/ at the project root
    project_root = Path(__file__).parent.parent.parent
    cache_dir = project_root / ".cache"
    cache_dir.mkdir(exist_ok=True)
    return cache_dir / "profane_words.json"


def _fetch_wordlist():
    """Fetch the word list from GitHub and cache it locally."""
    cache_path = _get_cache_path()

    try:
        print(f"Fetching profane words list from GitHub...")
        with urllib.request.urlopen(_WORDLIST_URL, timeout=10) as response:
            data = response.read()
            # Validate it's valid JSON
            words = json.loads(data)
            # Save to cache
            cache_path.write_bytes(data)
            print(f"Cached word list to {cache_path}")
            return words
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as e:
        print(f"Warning: Could not fetch profane words list: {e}")
        return None


def _load_wordlist():
    """Load and cache the profane words list."""
    global _PROFANE_WORDS
    if _PROFANE_WORDS is not None:
        return _PROFANE_WORDS

    cache_path = _get_cache_path()
    words = None

    # Try to load from cache first
    if cache_path.exists():
        try:
            with open(cache_path) as f:
                words = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass  # Cache is corrupted, will re-fetch

    # If not cached, fetch from GitHub
    if words is None:
        words = _fetch_wordlist()

    if words:
        # Normalize to lowercase and create a set for fast lookup
        _PROFANE_WORDS = set(w.lower().strip() for w in words if w.strip())
    else:
        _PROFANE_WORDS = set()

    return _PROFANE_WORDS


def count_profanity_in_text(text, wordlist):
    """Count profane words in a text string and return word counts.

    Returns:
        Tuple of (total_count, word_counts_dict)
    """
    # Extract words (alphanumeric sequences)
    words = re.findall(r'\b\w+\b', text.lower())
    word_counts = defaultdict(int)
    for w in words:
        if w in wordlist:
            word_counts[w] += 1
    return sum(word_counts.values()), dict(word_counts)


def analyze_profanity(messages):
    """Analyze profanity usage for a list of messages.

    Args:
        messages: List of (text, is_from_me, year) tuples

    Returns:
        Dict with profanity counts per year and overall ("all"),
        including top words per direction for each year
    """
    wordlist = _load_wordlist()
    if not wordlist:
        return None

    # Count by year and direction
    by_year = defaultdict(lambda: {"sent": 0, "received": 0})
    total_sent = 0
    total_received = 0

    # Track word frequencies for top words (overall)
    words_sent = defaultdict(int)
    words_received = defaultdict(int)

    # Track word frequencies per year
    words_by_year_sent = defaultdict(lambda: defaultdict(int))
    words_by_year_received = defaultdict(lambda: defaultdict(int))

    for text, is_from_me, year, _month in messages:
        if not text:
            continue

        count, word_counts = count_profanity_in_text(text, wordlist)
        if count > 0:
            direction = "sent" if is_from_me else "received"
            by_year[year][direction] += count
            if is_from_me:
                total_sent += count
                for word, cnt in word_counts.items():
                    words_sent[word] += cnt
                    words_by_year_sent[year][word] += cnt
            else:
                total_received += count
                for word, cnt in word_counts.items():
                    words_received[word] += cnt
                    words_by_year_received[year][word] += cnt

    results = {}

    # Per-year counts with top words
    for year, counts in by_year.items():
        if counts["sent"] > 0 or counts["received"] > 0:
            # Get top 5 words for each direction for this year
            year_top_sent = sorted(
                words_by_year_sent[year].items(), key=lambda x: x[1], reverse=True
            )[:5]
            year_top_received = sorted(
                words_by_year_received[year].items(), key=lambda x: x[1], reverse=True
            )[:5]

            results[year] = {
                "sent": counts["sent"],
                "received": counts["received"],
                "top_sent": [{"word": w, "count": c} for w, c in year_top_sent],
                "top_received": [{"word": w, "count": c} for w, c in year_top_received],
            }

    # Overall counts with top words
    if total_sent > 0 or total_received > 0:
        # Get top 5 words for each direction
        top_sent = sorted(words_sent.items(), key=lambda x: x[1], reverse=True)[:5]
        top_received = sorted(words_received.items(), key=lambda x: x[1], reverse=True)[:5]

        results["all"] = {
            "sent": total_sent,
            "received": total_received,
            "top_sent": [{"word": w, "count": c} for w, c in top_sent],
            "top_received": [{"word": w, "count": c} for w, c in top_received],
        }

    return results if results else None
