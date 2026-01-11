"""
Base utilities for message content analysis.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils import extract_text_from_attributed_body


def get_messages_with_text(cursor, handle_ids):
    """Fetch message text for analysis.

    Returns a list of (text, is_from_me, year, month) tuples for all messages
    with non-empty text content. Extracts text from attributedBody when
    the text column is empty (common in newer macOS versions).

    The month field is in "YYYY-MM" format for per-month analysis.
    """
    if not handle_ids:
        return []

    placeholders = ",".join("?" * len(handle_ids))
    cursor.execute(f"""
        SELECT
            m.text,
            m.attributedBody,
            m.is_from_me,
            strftime('%Y', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as year,
            strftime('%Y-%m', datetime(m.date/1000000000, 'unixepoch', '+31 years', 'localtime')) as month
        FROM message m
        JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        JOIN chat c ON cmj.chat_id = c.ROWID
        JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
        WHERE chj.handle_id IN ({placeholders})
          AND c.style = 45
        ORDER BY m.date
    """, handle_ids)

    results = []
    for text, attr_body, is_from_me, year, month in cursor.fetchall():
        # Prefer text column, fall back to extracting from attributedBody
        if text and text.strip():
            results.append((text, is_from_me, year, month))
        elif attr_body:
            extracted = extract_text_from_attributed_body(attr_body)
            if extracted and extracted.strip():
                results.append((extracted, is_from_me, year, month))

    return results


def _analyze_contact_worker(args):
    """Worker function for parallel contact analysis.

    Args:
        args: Tuple of (contact_index, messages, analyzer_names)

    Returns:
        Tuple of (contact_index, analysis_results)
    """
    contact_index, messages, analyzer_names = args

    # Import analyzers lazily in worker process
    from analyzers import (
        analyze_temperature, analyze_links, analyze_profanity,
        analyze_laughter, analyze_semantic_topics
    )

    # "keywords" uses semantic topics (embeddings + clustering + optional LLM)
    analyzer_map = {
        "temperature": analyze_temperature,
        "links": analyze_links,
        "profanity": analyze_profanity,
        "laughter": analyze_laughter,
        "keywords": analyze_semantic_topics,
    }

    results = {}
    for name in analyzer_names:
        analyzer_fn = analyzer_map.get(name)
        if analyzer_fn:
            try:
                results[name] = analyzer_fn(messages)
            except Exception:
                results[name] = None

    return (contact_index, results)


def run_analyzers_parallel(contacts_messages, analyzer_names, max_workers=None, progress_callback=None):
    """Run analyzers across multiple contacts in parallel using multiprocessing.

    Args:
        contacts_messages: List of (contact_index, messages) tuples
        analyzer_names: List of analyzer names to run
        max_workers: Max number of worker processes (default: CPU count)
        progress_callback: Optional callback(completed, total) for progress reporting

    Returns:
        Dict mapping contact_index to analysis results
    """
    import os
    from concurrent.futures import ProcessPoolExecutor, as_completed

    if max_workers is None:
        max_workers = os.cpu_count() or 4

    # Prepare work items
    work_items = [
        (idx, messages, analyzer_names)
        for idx, messages in contacts_messages
    ]

    results = {}
    total = len(work_items)

    # Use ProcessPoolExecutor for CPU-bound work
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_analyze_contact_worker, item) for item in work_items]

        for i, future in enumerate(as_completed(futures)):
            contact_index, analysis = future.result()
            results[contact_index] = analysis

            if progress_callback:
                progress_callback(i + 1, total)

    return results
