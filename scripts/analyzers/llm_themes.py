"""
LLM-based theme extraction analyzer using Claude Haiku.

Summarizes conversation themes from a sample of messages using Anthropic's API.
Requires ANTHROPIC_API_KEY environment variable to be set.
"""

import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False


def analyze_llm_themes(messages, sample_size=500, client=None, contact_name=None,
                       total_sent=0, total_received=0, first_date=None, last_date=None,
                       year_filter=None):
    """Analyze conversation themes using Claude Haiku.

    Args:
        messages: List of (text, is_from_me, year, month) tuples
        sample_size: Maximum number of messages to sample for analysis
        client: Optional Anthropic client instance
        contact_name: Name of the contact for personalized summary
        total_sent: Total messages sent to this contact
        total_received: Total messages received from this contact
        first_date: Date of first message (YYYY-MM-DD)
        last_date: Date of last message (YYYY-MM-DD)
        year_filter: Optional year string (e.g., "2024") to filter messages

    Returns:
        Dict with themes, summary, sample_size, and skip_reason, or None if unavailable
    """
    if not HAS_ANTHROPIC:
        return {"skip_reason": "anthropic library not installed"}

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"skip_reason": "ANTHROPIC_API_KEY not set"}

    if not messages:
        return {"skip_reason": "no messages"}

    # Filter to messages with actual content (not just reactions/attachments)
    # Keep year for stratified sampling
    valid_messages = [(text, is_from_me, year) for text, is_from_me, year, _month in messages
                      if text and len(text.strip()) > 3]

    # Filter to specific year if requested
    if year_filter:
        valid_messages = [(text, is_from_me, year) for text, is_from_me, year in valid_messages
                          if str(year) == str(year_filter)]

    if len(valid_messages) < 10:
        return {"skip_reason": f"too few valid messages ({len(valid_messages)} < 10)"}

    # Stratified sampling by year for better coverage across the relationship timeline
    if len(valid_messages) > sample_size:
        # Group messages by year
        by_year = {}
        for msg in valid_messages:
            year = msg[2] or "unknown"
            if year not in by_year:
                by_year[year] = []
            by_year[year].append(msg)

        # Sample proportionally from each year, with a minimum of 5 per year
        sampled = []
        years_sorted = sorted(by_year.keys())
        min_per_year = 5
        remaining_budget = sample_size

        # First pass: guarantee minimum representation from each year
        for year in years_sorted:
            year_msgs = by_year[year]
            take = min(min_per_year, len(year_msgs))
            sampled.extend(random.sample(year_msgs, take))
            remaining_budget -= take

        # Second pass: distribute remaining budget proportionally
        if remaining_budget > 0:
            total_remaining = sum(max(0, len(by_year[y]) - min_per_year) for y in years_sorted)
            if total_remaining > 0:
                for year in years_sorted:
                    year_msgs = by_year[year]
                    already_taken = min(min_per_year, len(year_msgs))
                    available = len(year_msgs) - already_taken
                    if available > 0:
                        proportion = available / total_remaining
                        additional = min(available, int(remaining_budget * proportion))
                        # Sample from messages not already taken
                        remaining_msgs = [m for m in year_msgs if m not in sampled]
                        sampled.extend(random.sample(remaining_msgs, min(additional, len(remaining_msgs))))
    else:
        sampled = valid_messages

    # Strip year from sampled messages for formatting
    sampled = [(text, is_from_me) for text, is_from_me, _year in sampled]

    # Format messages for the prompt
    formatted_messages = []
    for text, is_from_me in sampled:
        prefix = "Me:" if is_from_me else f"{contact_name or 'Them'}:"
        # Truncate very long messages
        truncated = text[:200] + "..." if len(text) > 200 else text
        formatted_messages.append(f"{prefix} {truncated}")

    conversation_sample = "\n".join(formatted_messages)

    # Build context about the conversation
    total_messages = total_sent + total_received
    context_parts = []
    if contact_name:
        context_parts.append(f"Contact name: {contact_name}")
    if year_filter:
        context_parts.append(f"Time period: {year_filter} only")
    if total_messages > 0:
        context_parts.append(f"Total messages: {total_messages:,} ({total_sent:,} sent, {total_received:,} received)")
    if first_date and last_date:
        context_parts.append(f"Conversation period: {first_date} to {last_date}")

    context_block = "\n".join(context_parts) if context_parts else ""

    # Use first name only for a more personal summary
    first_name = contact_name.split()[0] if contact_name else None

    prompt = f"""You are analyzing a sample of text messages from someone's iMessage history with a contact. Write a specific summary that captures what these two people actually talk about and the nature of their relationship.

<context>
{context_block}
</context>

<messages>
{conversation_sample}
</messages>

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{{"themes": ["theme1", "theme2", "theme3"], "summary": "A one-sentence summary."}}

Guidelines for themes:
- Extract 3-5 specific themes that capture what these people actually talk about
- Be specific: instead of "daily life", say "morning coffee routines" or "weekend plans"
- Themes should be 1-4 words each

Guidelines for the summary:
- Write in second person, addressing the user directly (e.g., "You and {first_name or 'this person'}...")
- Be specific - mention concrete topics, inside jokes, or patterns you notice
- Match the tone to the relationship: warm and personal for partners/family/close friends, more neutral for colleagues/acquaintances
- NEVER use "intimate" to describe professional or collegial relationships
- Avoid generic filler like "daily life", "social activities", "mutual support" - be concrete
- One sentence only

Bad examples:
- "Close friends exchanging frequent, informal messages about daily life and social activities." (too generic)
- "You and {first_name or 'them'} share an intimate professional friendship." (mismatched tone)
Good examples:
- "You and {first_name or 'them'} talk about startup ideas, design feedback, and coordinate meetups, with occasional debates about coffee shops." (colleague)
- "You and {first_name or 'them'} share everything from parenting wins to late-night venting sessions, with a running thread of memes and recipe swaps." (close friend/family)
"""

    try:
        import json
        import re

        if client is None:
            client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}]
        )

        # Get raw response text
        if not response.content:
            return {"skip_reason": "empty API response"}
        result_text = response.content[0].text.strip() if response.content[0].text else ""
        if not result_text:
            return {"skip_reason": "empty response text"}

        # Try to extract JSON from markdown code blocks if present
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', result_text)
        if json_match:
            result_text = json_match.group(1).strip()

        # Also try to find JSON object directly
        if not result_text.startswith('{'):
            json_start = result_text.find('{')
            if json_start != -1:
                result_text = result_text[json_start:]

        result = json.loads(result_text)

        return {
            "themes": result.get("themes", [])[:5],
            "summary": result.get("summary", ""),
            "sample_size": len(sampled)
        }

    except Exception as e:
        return {"skip_reason": f"API error: {str(e)}"}


def _analyze_llm_worker(args, max_retries=3):
    """Worker function for parallel LLM analysis with retry logic.

    Args:
        args: Tuple of (contact_index, contact_info, messages, sample_size, client, year_filter)
              contact_info is a dict with name, sent, received, first_date, last_date
              year_filter is optional - None for all-time, or a year string like "2024"
        max_retries: Maximum number of retries for rate limit errors

    Returns:
        Tuple of (contact_index, contact_name, year_filter, result)
    """
    contact_index, contact_info, messages, sample_size, client, year_filter = args
    contact_name = contact_info.get("name")

    for attempt in range(max_retries + 1):
        result = analyze_llm_themes(
            messages,
            sample_size=sample_size,
            client=client,
            contact_name=contact_name,
            total_sent=contact_info.get("sent", 0),
            total_received=contact_info.get("received", 0),
            first_date=contact_info.get("first_date"),
            last_date=contact_info.get("last_date"),
            year_filter=year_filter,
        )

        # Check if we got a rate limit error and should retry
        if result and "skip_reason" in result:
            skip_reason = result["skip_reason"]
            if "rate_limit" in skip_reason.lower() or "429" in skip_reason:
                if attempt < max_retries:
                    # Exponential backoff: 2s, 4s, 8s
                    wait_time = 2 ** (attempt + 1)
                    time.sleep(wait_time)
                    continue
        # Success or non-retryable error
        break

    return (contact_index, contact_name, year_filter, result)


def run_llm_themes_parallel(contacts_to_analyze, sample_size=500, max_workers=2,
                             progress_callback=None, include_yearly=False, min_yearly_messages=50,
                             on_result_callback=None):
    """Run LLM theme analysis across multiple contacts in parallel.

    Args:
        contacts_to_analyze: List of (contact_index, contact_info, messages) tuples
            contact_info is a dict with: name, sent, received, first_date, last_date
        sample_size: Max messages to sample per contact
        max_workers: Max number of concurrent API calls (default: 2, to avoid rate limits)
        progress_callback: Optional callback(completed, total, contact_name) for progress
        include_yearly: If True, also generate per-year analysis for each contact
        min_yearly_messages: Minimum messages in a year to generate yearly analysis
        on_result_callback: Optional callback(contact_index, results_for_contact) called
            each time a contact's full results are ready (all years complete).
            results_for_contact is {"all": {...}, "2024": {...}, ...}

    Returns:
        Tuple of (results_dict, skipped_list) where:
            results_dict: Dict mapping contact_index to LLM analysis results
                If include_yearly=True, results have structure:
                {"all": {...}, "2024": {...}, "2023": {...}, ...}
                If include_yearly=False, results are just the all-time analysis dict
            skipped_list: List of (contact_name, skip_reason) for contacts that were skipped
    """
    if not HAS_ANTHROPIC:
        return {}, [("all", "anthropic library not installed")]

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {}, [("all", "ANTHROPIC_API_KEY not set")]

    # Create a shared client for all workers (thread-safe)
    client = anthropic.Anthropic(api_key=api_key)

    # Prepare work items - one for all-time analysis per contact
    work_items = []
    items_per_contact = {}  # Track how many work items per contact
    for idx, contact_info, messages in contacts_to_analyze:
        # All-time analysis (year_filter=None)
        work_items.append((idx, contact_info, messages, sample_size, client, None))
        items_per_contact[idx] = 1

        # Per-year analysis if requested
        if include_yearly:
            # Count messages per year
            year_counts = {}
            for msg in messages:
                year = msg[2] if len(msg) > 2 else None
                if year:
                    year_counts[year] = year_counts.get(year, 0) + 1

            # Add work items for years with sufficient messages
            for year, count in year_counts.items():
                if count >= min_yearly_messages:
                    work_items.append((idx, contact_info, messages, sample_size, client, str(year)))
                    items_per_contact[idx] += 1

    results = {}  # contact_index -> {"all": {...}, "2024": {...}, ...}
    completed_per_contact = {idx: 0 for idx in items_per_contact}
    skipped = []
    total = len(work_items)

    # Use ThreadPoolExecutor for I/O-bound API calls
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_analyze_llm_worker, item): item for item in work_items}

        for i, future in enumerate(as_completed(futures)):
            contact_index, contact_name, year_filter, result = future.result()
            period_key = year_filter if year_filter else "all"

            if result and "themes" in result:
                # Successful analysis
                if contact_index not in results:
                    results[contact_index] = {}
                results[contact_index][period_key] = result
            elif result and "skip_reason" in result:
                # Only log skipped for all-time analysis (not yearly)
                if period_key == "all":
                    skipped.append((contact_name, result["skip_reason"]))

            # Track completion per contact
            completed_per_contact[contact_index] += 1

            # Call on_result_callback when all work for a contact is done
            if on_result_callback and completed_per_contact[contact_index] == items_per_contact[contact_index]:
                if contact_index in results:
                    on_result_callback(contact_index, results[contact_index])

            if progress_callback:
                progress_callback(i + 1, total, contact_name)

    # If not including yearly, flatten results to just the all-time analysis
    if not include_yearly:
        results = {idx: data.get("all", {}) for idx, data in results.items()}

    return results, skipped
