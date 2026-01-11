"""
Semantic topic extraction using embeddings and clustering.

This analyzer uses sentence-transformers to embed messages, clusters them
semantically using HDBSCAN, then uses Claude to generate human-readable
topic labels. Falls back to keyword extraction if no API key is available.

The goal is to produce emotionally resonant labels like "Taco's health journey"
rather than just keywords like "Taco, vet, sick".
"""

import os
import sys
import random
from collections import defaultdict

# Suppress noisy download progress bars BEFORE any imports
# These must be set early to take effect
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

# Lazy imports for heavy dependencies
_model = None
_anthropic_client = None


def _get_embedding_model():
    """Lazy-load the sentence transformer model."""
    global _model
    if _model is None:
        try:
            # Suppress logging
            import logging
            logging.getLogger("sentence_transformers").setLevel(logging.ERROR)
            logging.getLogger("transformers").setLevel(logging.ERROR)
            logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

            from sentence_transformers import SentenceTransformer

            # Use a small, fast model (only ~80MB)
            _model = SentenceTransformer('all-MiniLM-L6-v2')
        except ImportError:
            return None
    return _model


def _get_anthropic_client():
    """Lazy-load the Anthropic client if API key is available."""
    global _anthropic_client
    if _anthropic_client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            return None
        try:
            import anthropic
            _anthropic_client = anthropic.Anthropic(api_key=api_key)
        except ImportError:
            return None
    return _anthropic_client


def _cluster_messages(embeddings, min_cluster_size=10, min_samples=5):
    """Cluster embeddings using HDBSCAN.

    Returns list of cluster labels (-1 means noise/unclustered).
    """
    try:
        from sklearn.cluster import HDBSCAN

        clusterer = HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric='euclidean',
            cluster_selection_method='eom',
        )
        labels = clusterer.fit_predict(embeddings)
        return labels
    except Exception:
        return None


def _get_representative_messages(texts, labels, n_per_cluster=15):
    """Get representative messages for each cluster.

    Returns dict mapping cluster_id to list of representative messages.
    """
    clusters = defaultdict(list)
    for text, label in zip(texts, labels):
        if label >= 0:  # Skip noise (-1)
            clusters[label].append(text)

    # Sample representative messages from each cluster
    representatives = {}
    for cluster_id, messages in clusters.items():
        # Take a sample, preferring longer messages (more context)
        sorted_msgs = sorted(messages, key=len, reverse=True)
        # Mix of longest and random for diversity
        top_long = sorted_msgs[:n_per_cluster // 2]
        rest = sorted_msgs[n_per_cluster // 2:]
        if rest:
            sampled = random.sample(rest, min(len(rest), n_per_cluster - len(top_long)))
        else:
            sampled = []
        representatives[cluster_id] = top_long + sampled

    return representatives, {k: len(v) for k, v in clusters.items()}


def _label_cluster_with_llm(messages, client):
    """Use Claude to generate a human-readable topic label for a cluster.

    Returns a short (2-5 word) evocative label.
    """
    # Truncate messages to avoid token limits
    sample_texts = []
    total_chars = 0
    for msg in messages[:15]:
        if total_chars + len(msg) > 2000:
            break
        sample_texts.append(f"- {msg}")
        total_chars += len(msg)

    messages_text = "\n".join(sample_texts)

    try:
        response = client.messages.create(
            model="claude-3-5-haiku-latest",
            max_tokens=50,
            messages=[{
                "role": "user",
                "content": f"""Here are sample messages from a conversation cluster. Generate a SHORT, evocative topic label (2-5 words) that captures what these conversations are about. Be specific and memorable - the label should make someone think "Oh yeah, that's what we talked about!"

Examples of good labels:
- "Taco's health scare"
- "Planning the Hawaii trip"
- "Late night philosophy"
- "Wedding venue drama"
- "Job interview prep"

Messages:
{messages_text}

Respond with ONLY the topic label, nothing else."""
            }]
        )
        label = response.content[0].text.strip()
        # Clean up any quotes or punctuation
        label = label.strip('"\'').strip()
        # Limit length
        if len(label) > 40:
            label = label[:37] + "..."
        return label
    except Exception as e:
        return None


def _label_cluster_with_keywords(messages):
    """Fallback: extract keywords from cluster messages.

    Uses simple frequency analysis when no LLM is available.
    """
    from collections import Counter
    import re

    # Simple stopwords
    stopwords = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
        'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
        'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who',
        'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
        'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'same',
        'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there',
        'then', 'once', 'if', 'about', 'into', 'through', 'during', 'before',
        'after', 'above', 'below', 'between', 'under', 'again', 'further',
        'yeah', 'yes', 'no', 'ok', 'okay', 'like', 'got', 'get', 'going',
        'know', 'think', 'want', 'need', 'see', 'come', 'go', 'make', 'take',
        'lol', 'haha', 'omg', 'im', "i'm", "don't", "didn't", "won't", "can't",
        'gonna', 'wanna', 'gotta', 'really', 'actually', 'probably', 'maybe',
    }

    # Count words
    word_counts = Counter()
    for msg in messages:
        words = re.findall(r'\b[a-zA-Z]{3,}\b', msg.lower())
        for word in words:
            if word not in stopwords:
                word_counts[word] += 1

    # Get top words
    top_words = [word for word, _ in word_counts.most_common(3)]
    if top_words:
        return " & ".join(top_words).title()
    return "General chat"


def extract_semantic_topics(texts, use_llm=True, max_topics=8, min_cluster_size=8):
    """Extract semantic topics from a list of message texts.

    Args:
        texts: List of message strings
        use_llm: Whether to use Claude for labeling (requires ANTHROPIC_API_KEY)
        max_topics: Maximum number of topics to return
        min_cluster_size: Minimum messages to form a cluster

    Returns:
        List of {"label": str, "count": int} dicts, sorted by count descending.
        Returns empty list if clustering fails or not enough messages.
    """
    if not texts or len(texts) < min_cluster_size * 2:
        return []

    model = _get_embedding_model()
    if model is None:
        return []

    # Filter out very short messages (likely greetings/reactions)
    meaningful_texts = [t for t in texts if t and len(t.split()) >= 3]
    if len(meaningful_texts) < min_cluster_size * 2:
        # Fall back to including shorter messages
        meaningful_texts = [t for t in texts if t and len(t.split()) >= 2]

    if len(meaningful_texts) < min_cluster_size * 2:
        return []

    # Sample if too many messages (for speed)
    if len(meaningful_texts) > 3000:
        meaningful_texts = random.sample(meaningful_texts, 3000)

    # Embed messages
    try:
        embeddings = model.encode(meaningful_texts, show_progress_bar=False)
    except Exception:
        return []

    # Cluster
    labels = _cluster_messages(
        embeddings,
        min_cluster_size=min_cluster_size,
        min_samples=max(3, min_cluster_size // 2)
    )
    if labels is None:
        return []

    # Get representative messages per cluster
    representatives, cluster_sizes = _get_representative_messages(meaningful_texts, labels)

    if not representatives:
        return []

    # Sort clusters by size
    sorted_clusters = sorted(cluster_sizes.items(), key=lambda x: -x[1])[:max_topics]

    # Label each cluster
    client = _get_anthropic_client() if use_llm else None

    results = []
    for cluster_id, count in sorted_clusters:
        msgs = representatives[cluster_id]

        if client:
            label = _label_cluster_with_llm(msgs, client)
            if not label:
                label = _label_cluster_with_keywords(msgs)
        else:
            label = _label_cluster_with_keywords(msgs)

        results.append({
            "label": label,
            "count": count,
        })

    return results


def analyze_semantic_topics(messages, sample_size=2000):
    """Analyze semantic topics for a list of messages.

    Args:
        messages: List of (text, is_from_me, year, month) tuples
        sample_size: Max messages to process per direction per year

    Returns:
        Dict with topics per year and overall ("all").
        Each entry has "sent" and "received" lists of topic labels.
    """
    model = _get_embedding_model()
    if model is None:
        return None

    # Check if LLM is available
    use_llm = os.environ.get("ANTHROPIC_API_KEY") is not None

    # Group messages by year and direction
    by_year = defaultdict(lambda: {"sent": [], "received": []})
    all_sent = []
    all_received = []

    for text, is_from_me, year, _month in messages:
        if not text:
            continue
        direction = "sent" if is_from_me else "received"
        by_year[year][direction].append(text)
        if is_from_me:
            all_sent.append(text)
        else:
            all_received.append(text)

    results = {}

    # Per-year topics
    for year, texts in by_year.items():
        sent_texts = texts["sent"]
        recv_texts = texts["received"]

        # Sample if too many
        if len(sent_texts) > sample_size:
            sent_texts = random.sample(sent_texts, sample_size)
        if len(recv_texts) > sample_size:
            recv_texts = random.sample(recv_texts, sample_size)

        # Use smaller clusters for per-year (less data)
        sent_topics = extract_semantic_topics(sent_texts, use_llm=use_llm, min_cluster_size=5)
        recv_topics = extract_semantic_topics(recv_texts, use_llm=use_llm, min_cluster_size=5)

        if sent_topics or recv_topics:
            results[year] = {
                "sent": sent_topics,
                "received": recv_topics,
            }

    # Overall topics (combine all years)
    if len(all_sent) > sample_size:
        all_sent = random.sample(all_sent, sample_size)
    if len(all_received) > sample_size:
        all_received = random.sample(all_received, sample_size)

    all_sent_topics = extract_semantic_topics(all_sent, use_llm=use_llm)
    all_recv_topics = extract_semantic_topics(all_received, use_llm=use_llm)

    if all_sent_topics or all_recv_topics:
        results["all"] = {
            "sent": all_sent_topics,
            "received": all_recv_topics,
        }

    return results if results else None
