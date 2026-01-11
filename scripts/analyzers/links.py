"""
Link extraction analyzer - counts URLs shared and aggregates by domain.

Extracts URLs from messages and provides:
- Total links sent vs received
- Top domains with counts
- Per-year breakdown
"""

import os
import sys
from collections import Counter, defaultdict
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils import URL_PATTERN

# Domain normalization map (old domain -> canonical domain)
# Note: www. prefix is already stripped in extract_domain before lookup
DOMAIN_ALIASES = {
    'twitter.com': 'x.com',
    'm.twitter.com': 'x.com',
    'mobile.twitter.com': 'x.com',
    'm.youtube.com': 'youtube.com',
    'youtu.be': 'youtube.com',
    'm.instagram.com': 'instagram.com',
    'm.facebook.com': 'facebook.com',
    'fb.com': 'facebook.com',
    'old.reddit.com': 'reddit.com',
    'm.tiktok.com': 'tiktok.com',
    'vm.tiktok.com': 'tiktok.com',
    'amzn.to': 'amazon.com',
    'gist.github.com': 'github.com',
}


def extract_domain(url):
    """Extract and normalize domain from URL."""
    # Add protocol if missing for proper parsing
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url

    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        # Remove www. prefix if present
        if domain.startswith('www.'):
            domain = domain[4:]

        # Apply domain aliases
        if domain in DOMAIN_ALIASES:
            domain = DOMAIN_ALIASES[domain]

        return domain if domain else None
    except Exception:
        return None


def aggregate_urls(urls, include_raw=False):
    """Aggregate URLs into domain counts.

    Args:
        urls: List of URL strings
        include_raw: If True, include the raw URL list in output

    Returns:
        Dict with total, top_domains, and optionally urls list
    """
    domains = []
    for url in urls:
        domain = extract_domain(url)
        if domain:
            domains.append(domain)

    top = Counter(domains).most_common(10)
    result = {
        "total": len(urls),
        "top_domains": [{"domain": d, "count": c} for d, c in top]
    }

    if include_raw:
        result["urls"] = urls

    return result


def analyze_links(messages):
    """Analyze link sharing for a list of messages.

    Args:
        messages: List of (text, is_from_me, year) tuples

    Returns:
        Dict with link stats per year and overall ("all")
    """
    # Group URLs by year and direction
    by_year = defaultdict(lambda: {"sent": [], "received": []})
    all_sent = []
    all_received = []

    for text, is_from_me, year, _month in messages:
        if not text:
            continue

        urls = URL_PATTERN.findall(text)
        direction = "sent" if is_from_me else "received"

        by_year[year][direction].extend(urls)
        if is_from_me:
            all_sent.extend(urls)
        else:
            all_received.extend(urls)

    results = {}

    # Per-year metrics (include raw URLs for view all feature)
    for year, urls in by_year.items():
        sent_agg = aggregate_urls(urls["sent"], include_raw=True)
        recv_agg = aggregate_urls(urls["received"], include_raw=True)
        if sent_agg["total"] > 0 or recv_agg["total"] > 0:
            results[year] = {
                "sent": sent_agg,
                "received": recv_agg,
            }

    # Overall metrics (include raw URLs for view all feature)
    all_sent_agg = aggregate_urls(all_sent, include_raw=True)
    all_recv_agg = aggregate_urls(all_received, include_raw=True)
    if all_sent_agg["total"] > 0 or all_recv_agg["total"] > 0:
        results["all"] = {
            "sent": all_sent_agg,
            "received": all_recv_agg,
        }

    return results if results else None
