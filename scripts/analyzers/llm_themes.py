"""
LLM-based theme extraction analyzer using Claude Haiku.

Summarizes conversation themes from a sample of messages using Anthropic's API.
Requires ANTHROPIC_API_KEY environment variable to be set.

Uses VADER sentiment analysis for:
1. Sentiment-aware sampling (oversample high-positive messages)
2. Providing sentiment context to the LLM for better relationship understanding
"""

import json
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    HAS_VADER = True
except ImportError:
    HAS_VADER = False


def _stratified_sample_by_year(messages, sample_size):
    """Sample messages with stratification by year.

    Ensures minimum representation from each year, then distributes
    remaining budget proportionally.

    Args:
        messages: List of (text, is_from_me, year) tuples
        sample_size: Target number of messages to sample

    Returns:
        List of sampled messages (same tuple format)
    """
    if len(messages) <= sample_size:
        return list(messages)

    # Group messages by year
    by_year = {}
    for msg in messages:
        year = msg[2] if len(msg) > 2 else "unknown"
        if year not in by_year:
            by_year[year] = []
        by_year[year].append(msg)

    sampled = []
    years_sorted = sorted(by_year.keys())
    min_per_year = 5
    remaining_budget = sample_size

    # First pass: guarantee minimum representation from each year
    for year in years_sorted:
        year_msgs = by_year[year]
        take = min(min_per_year, len(year_msgs), remaining_budget)
        if take > 0:
            sampled.extend(random.sample(year_msgs, take))
            remaining_budget -= take

    # Second pass: distribute remaining budget proportionally
    if remaining_budget > 0:
        sampled_set = set(sampled)  # O(1) lookups instead of O(n)
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
                    remaining_msgs = [m for m in year_msgs if m not in sampled_set]
                    if remaining_msgs and additional > 0:
                        new_samples = random.sample(remaining_msgs, min(additional, len(remaining_msgs)))
                        sampled.extend(new_samples)
                        sampled_set.update(new_samples)

    return sampled


def analyze_llm_themes(messages, sample_size=500, client=None, contact_name=None,
                       total_sent=0, total_received=0, first_date=None, last_date=None,
                       year_filter=None, sentiment_stats=None):
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
        sentiment_stats: Optional dict from sentiment.analyze_sentiment_full() with
            aggregate sentiment statistics to include in prompt context

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

    # Sentiment-aware sampling: oversample high-positive messages to capture emotional moments
    if len(valid_messages) > sample_size:
        if HAS_VADER:
            # Score all messages with VADER sentiment
            analyzer = SentimentIntensityAnalyzer()
            scored_messages = []
            for msg in valid_messages:
                text = msg[0]
                compound = analyzer.polarity_scores(text)['compound']
                scored_messages.append((msg, compound))

            # Partition into sentiment buckets
            high_positive = [(m, s) for m, s in scored_messages if s > 0.5]
            moderate = [(m, s) for m, s in scored_messages if -0.5 <= s <= 0.5]
            negative = [(m, s) for m, s in scored_messages if s < -0.5]

            # Allocate budget: oversample high-positive to capture emotional moments
            # 25% high-positive, 65% moderate, 10% negative (if exists)
            high_pos_budget = int(sample_size * 0.25)
            negative_budget = int(sample_size * 0.10)
            moderate_budget = sample_size - high_pos_budget - negative_budget

            sampled = []

            # Sample from high-positive bucket (stratified by year)
            high_pos_msgs = [m for m, _ in high_positive]
            sampled.extend(_stratified_sample_by_year(high_pos_msgs, min(high_pos_budget, len(high_pos_msgs))))

            # Sample from moderate bucket (stratified by year)
            moderate_msgs = [m for m, _ in moderate]
            remaining_budget = sample_size - len(sampled)
            moderate_take = min(moderate_budget, len(moderate_msgs), remaining_budget)
            sampled.extend(_stratified_sample_by_year(moderate_msgs, moderate_take))

            # Sample from negative bucket if exists (stratified by year)
            if negative:
                negative_msgs = [m for m, _ in negative]
                remaining_budget = sample_size - len(sampled)
                negative_take = min(negative_budget, len(negative_msgs), remaining_budget)
                sampled.extend(_stratified_sample_by_year(negative_msgs, negative_take))

            # Fill any remaining budget from moderate
            if len(sampled) < sample_size and len(moderate_msgs) > moderate_take:
                remaining = sample_size - len(sampled)
                sampled_set = set(sampled)  # O(1) lookups instead of O(n)
                unused = [m for m in moderate_msgs if m not in sampled_set]
                sampled.extend(random.sample(unused, min(remaining, len(unused))))
        else:
            # Fallback to year-stratified sampling if VADER not available
            sampled = _stratified_sample_by_year(valid_messages, sample_size)
    else:
        sampled = valid_messages

    # Strip year from sampled messages for formatting
    sampled = [(text, is_from_me) for text, is_from_me, _year in sampled]

    # Format messages for the prompt
    formatted_messages = []
    for text, is_from_me in sampled:
        prefix = "Me:" if is_from_me else f"{contact_name or 'Them'}:"
        # Truncate very long messages (400 chars to preserve more emotional context)
        truncated = text[:400] + "..." if len(text) > 400 else text
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

    # Add sentiment context if available (from full-corpus VADER analysis)
    if sentiment_stats and 'skip_reason' not in sentiment_stats:
        hp = sentiment_stats.get('highly_positive_pct', 0)
        avg = sentiment_stats.get('avg_compound', 0)
        total_analyzed = sentiment_stats.get('total_analyzed', 0)

        if hp > 10 or avg > 0.2 or avg < -0.1:
            context_parts.append(f"Sentiment analysis (all {total_analyzed:,} messages):")
            context_parts.append(f"  {hp:.0f}% highly positive, avg sentiment: {avg:.2f} (-1 to +1 scale)")
            if hp > 20 and avg > 0.3:
                context_parts.append("  This indicates a very warm, affectionate relationship")
            elif hp > 15 or avg > 0.25:
                context_parts.append("  This suggests a warm, positive relationship")

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
- If sentiment analysis shows high positivity, include themes about emotional connection (e.g., "expressions of love", "emotional support", "daily affection")

Guidelines for the summary:
- Write in second person, addressing the user directly (e.g., "You and {first_name or 'this person'}...")
- Be specific - mention concrete topics, inside jokes, or patterns you notice
- Match the tone to the relationship based on the sentiment analysis:
  * If sentiment shows warmth (>15% highly positive, avg > 0.25): This is likely an intimate relationship (partner, spouse, close family). Reflect the love, affection, and emotional depth you observe.
  * If sentiment is moderate: Match tone to the content - friendly for friends, professional for colleagues
  * If sentiment is negative: Note any tension or conflict patterns
- Avoid generic filler like "daily life", "social activities", "mutual support" - be concrete
- One sentence only

Bad examples:
- "Close friends exchanging frequent, informal messages about daily life and social activities." (too generic)
- "You and {first_name or 'them'} share an intimate professional friendship." (mismatched tone)
Good examples:
- "You and {first_name or 'them'} talk about startup ideas, design feedback, and coordinate meetups, with occasional debates about coffee shops." (colleague)
- "You and {first_name or 'them'} share everything from parenting wins to late-night venting sessions, with a running thread of memes and recipe swaps." (close friend/family)
- "You and {first_name or 'them'} share a deeply loving relationship, exchanging daily affirmations, coordinating your lives together, and supporting each other through challenges." (partner/spouse)
"""

    try:
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


def analyze_relationship_evolution(yearly_results, client=None, contact_name=None, sentiment_stats=None):
    """Analyze how a relationship has evolved over time based on yearly analyses.

    Args:
        yearly_results: Dict mapping years to analysis results, e.g.:
            {"2020": {"themes": [...], "summary": "..."}, "2021": {...}, ...}
            (excludes "all" - only individual years)
        client: Optional Anthropic client instance
        contact_name: Name of the contact for personalized summary
        sentiment_stats: Optional dict from sentiment.analyze_sentiment_full() with
            per-year sentiment trends in the 'by_year' field

    Returns:
        Dict with "evolution" sentence, or None if unavailable
    """
    if not HAS_ANTHROPIC:
        return {"skip_reason": "anthropic library not installed"}

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {"skip_reason": "ANTHROPIC_API_KEY not set"}

    # Need at least 2 years of data to analyze evolution
    years = sorted([y for y in yearly_results.keys() if y != "all" and yearly_results[y].get("themes")])
    if len(years) < 2:
        return {"skip_reason": "need at least 2 years of data"}

    # Build a summary of each year's analysis with sentiment data
    yearly_summaries = []
    sentiment_by_year = sentiment_stats.get('by_year', {}) if sentiment_stats else {}

    for year in years:
        data = yearly_results[year]
        themes = data.get("themes", [])
        summary = data.get("summary", "")

        # Add sentiment info if available
        sentiment_line = ""
        if year in sentiment_by_year:
            year_sent = sentiment_by_year[year]
            avg = year_sent.get('avg_compound', 0)
            hp = year_sent.get('highly_positive_pct', 0)
            sentiment_line = f"\n  Sentiment: avg {avg:.2f}, {hp:.0f}% highly positive"

        yearly_summaries.append(f"{year}:\n  Themes: {', '.join(themes)}\n  Summary: {summary}{sentiment_line}")

    yearly_block = "\n\n".join(yearly_summaries)
    first_name = contact_name.split()[0] if contact_name else "this person"
    time_span = f"{years[0]} to {years[-1]}"

    prompt = f"""You are analyzing how a relationship has evolved over time based on yearly conversation summaries and sentiment trends.

<context>
Contact: {contact_name or "Unknown"}
Time span: {time_span}
</context>

<yearly_analyses>
{yearly_block}
</yearly_analyses>

Based on how the conversation themes, sentiment, and nature have changed from {years[0]} to {years[-1]}, write ONE sentence describing how this relationship has evolved over time.

Guidelines:
- Write in second person, addressing the user directly (e.g., "Your relationship with {first_name}...")
- Focus on the trajectory or trend: has it deepened, become more casual, shifted focus, stayed consistent, etc.
- Consider both thematic changes AND emotional trajectory (sentiment trends)
- If sentiment has increased over time, note the growing warmth/closeness
- Be specific about what changed (topics, tone, emotional depth)
- Don't just list what was discussed each year - synthesize the overall arc
- Keep it to one clear, insightful sentence

Examples of good evolution sentences:
- "Your relationship with {first_name} has deepened from casual work chat into a genuine friendship, with more personal sharing and inside jokes emerging over time."
- "Over the years, your conversations with {first_name} have shifted from frequent social planning to more sporadic but meaningful check-ins."
- "Your bond with {first_name} has grown stronger over time, with increasing emotional warmth and more intimate sharing as the years have passed."

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{{"evolution": "Your evolution sentence here."}}"""

    try:
        if client is None:
            client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}]
        )

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
            "evolution": result.get("evolution", "")
        }

    except Exception as e:
        return {"skip_reason": f"API error: {str(e)}"}


def _analyze_llm_worker(args, max_retries=3):
    """Worker function for parallel LLM analysis with retry logic.

    Args:
        args: Tuple of (contact_index, contact_info, messages, sample_size, client, year_filter)
              contact_info is a dict with name, sent, received, first_date, last_date, sentiment_stats
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
            sentiment_stats=contact_info.get("sentiment_stats"),
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
    contact_info_by_idx = {}  # Store contact_info for evolution analysis
    for idx, contact_info, messages in contacts_to_analyze:
        contact_info_by_idx[idx] = contact_info
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

            # When all work for a contact is done, generate evolution analysis and call callback
            if completed_per_contact[contact_index] == items_per_contact[contact_index]:
                if contact_index in results:
                    contact_results = results[contact_index]
                    # Generate evolution analysis if we have 2+ yearly analyses
                    if include_yearly:
                        yearly_keys = [k for k in contact_results.keys() if k != "all" and contact_results[k].get("themes")]
                        if len(yearly_keys) >= 2:
                            contact_info = contact_info_by_idx.get(contact_index, {})
                            evolution_result = analyze_relationship_evolution(
                                contact_results,
                                client=client,
                                contact_name=contact_info.get("name"),
                                sentiment_stats=contact_info.get("sentiment_stats")
                            )
                            if evolution_result and "evolution" in evolution_result:
                                contact_results["evolution"] = evolution_result["evolution"]
                    if on_result_callback:
                        on_result_callback(contact_index, contact_results)

            if progress_callback:
                progress_callback(i + 1, total, contact_name)

    # If not including yearly, flatten results to just the all-time analysis
    if not include_yearly:
        results = {idx: data.get("all", {}) for idx, data in results.items()}

    return results, skipped
