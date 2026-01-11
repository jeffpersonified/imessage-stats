"""
Sentiment analyzer using VADER for full-corpus analysis.

Analyzes ALL messages locally (fast, no API cost) to compute aggregate
sentiment statistics that inform the LLM analysis.

VADER (Valence Aware Dictionary and sEntiment Reasoner) is specifically
tuned for social media text - handles emojis, slang, capitalization, etc.
"""

from collections import defaultdict

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    HAS_VADER = True
except ImportError:
    HAS_VADER = False


def analyze_sentiment_full(messages):
    """Analyze sentiment for ALL messages (fast, local).

    Args:
        messages: List of (text, is_from_me, year, month) tuples

    Returns:
        Dict with aggregate sentiment stats:
        {
            'total_analyzed': int,
            'highly_positive_pct': float,  # compound > 0.5
            'positive_pct': float,         # compound 0.05 to 0.5
            'neutral_pct': float,          # compound -0.05 to 0.05
            'negative_pct': float,         # compound < -0.05
            'avg_compound': float,         # -1 to 1
            'by_year': {
                '2024': {'avg_compound': float, 'highly_positive_pct': float},
                ...
            },
            'sent': {...},     # Same structure for sent messages only
            'received': {...}, # Same structure for received messages only
        }
    """
    if not HAS_VADER:
        return {'skip_reason': 'vaderSentiment not installed'}

    if not messages:
        return {'skip_reason': 'no messages'}

    analyzer = SentimentIntensityAnalyzer()

    # Overall stats
    stats = _create_stats_tracker()
    sent_stats = _create_stats_tracker()
    received_stats = _create_stats_tracker()

    for text, is_from_me, year, _month in messages:
        if not text or len(text.strip()) < 3:
            continue

        scores = analyzer.polarity_scores(text)
        compound = scores['compound']

        # Update overall stats
        _update_stats(stats, compound, year)

        # Update sent/received stats
        if is_from_me:
            _update_stats(sent_stats, compound, year)
        else:
            _update_stats(received_stats, compound, year)

    return {
        **_finalize_stats(stats),
        'sent': _finalize_stats(sent_stats),
        'received': _finalize_stats(received_stats),
    }


def _create_stats_tracker():
    """Create a stats tracking dict."""
    return {
        'highly_positive': 0,
        'positive': 0,
        'neutral': 0,
        'negative': 0,
        'compound_sum': 0,
        'by_year': defaultdict(lambda: {'sum': 0, 'count': 0, 'high_pos': 0}),
    }


def _update_stats(stats, compound, year):
    """Update stats tracker with a message's compound score."""
    # Bucket the message
    if compound > 0.5:
        stats['highly_positive'] += 1
    elif compound > 0.05:
        stats['positive'] += 1
    elif compound > -0.05:
        stats['neutral'] += 1
    else:
        stats['negative'] += 1

    stats['compound_sum'] += compound

    # Per-year tracking
    if year:
        stats['by_year'][year]['sum'] += compound
        stats['by_year'][year]['count'] += 1
        if compound > 0.5:
            stats['by_year'][year]['high_pos'] += 1


def _finalize_stats(stats):
    """Convert tracker to final stats dict."""
    total = stats['highly_positive'] + stats['positive'] + stats['neutral'] + stats['negative']

    if total == 0:
        return {
            'total_analyzed': 0,
            'highly_positive_pct': 0,
            'positive_pct': 0,
            'neutral_pct': 0,
            'negative_pct': 0,
            'avg_compound': 0,
            'by_year': {},
        }

    return {
        'total_analyzed': total,
        'highly_positive_pct': stats['highly_positive'] / total * 100,
        'positive_pct': stats['positive'] / total * 100,
        'neutral_pct': stats['neutral'] / total * 100,
        'negative_pct': stats['negative'] / total * 100,
        'avg_compound': stats['compound_sum'] / total,
        'by_year': {
            year: {
                'avg_compound': data['sum'] / data['count'] if data['count'] else 0,
                'highly_positive_pct': data['high_pos'] / data['count'] * 100 if data['count'] else 0,
                'count': data['count'],
            }
            for year, data in stats['by_year'].items()
        },
    }
