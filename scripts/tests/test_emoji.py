"""
Tests for emoji extraction and analysis.

Run with: cd scripts && python -m pytest tests/test_emoji.py -v
"""

import pytest
from analyzers.emoji import extract_emojis, analyze_emoji, EMOJI_PATTERN


class TestExtractEmojis:
    """Test emoji extraction from text."""

    def test_simple_emoji(self):
        """Extract single emoji from text."""
        assert extract_emojis("Hello 👍 world") == ["👍"]

    def test_multiple_emojis(self):
        """Extract multiple emojis from text."""
        assert extract_emojis("Great 😀😁😂 job!") == ["😀", "😁", "😂"]

    def test_emoji_at_boundaries(self):
        """Extract emojis at start and end of text."""
        assert extract_emojis("👋 Hello world 🌍") == ["👋", "🌍"]

    def test_no_emojis(self):
        """Return empty list when no emojis present."""
        assert extract_emojis("Hello world") == []

    def test_empty_string(self):
        """Handle empty string."""
        assert extract_emojis("") == []

    def test_none_input(self):
        """Handle None input."""
        assert extract_emojis(None) == []

    # ZWJ (Zero Width Joiner) sequences
    def test_family_emoji(self):
        """Extract family emoji as single unit."""
        result = extract_emojis("Family 👨‍👩‍👧‍👦 emoji")
        assert len(result) == 1
        assert result[0] == "👨‍👩‍👧‍👦"

    def test_man_technologist(self):
        """Extract man technologist emoji as single unit."""
        result = extract_emojis("Developer 👨‍💻 here")
        assert len(result) == 1
        assert result[0] == "👨‍💻"

    def test_woman_health_worker(self):
        """Extract woman health worker emoji as single unit."""
        result = extract_emojis("Doctor 👩‍⚕️ here")
        assert len(result) == 1
        assert result[0] == "👩‍⚕️"

    def test_man_running(self):
        """Extract man running emoji as single unit."""
        result = extract_emojis("Running 🏃‍♂️ fast")
        assert len(result) == 1
        assert result[0] == "🏃‍♂️"

    def test_woman_shrugging(self):
        """Extract woman shrugging emoji as single unit."""
        result = extract_emojis("IDK 🤷‍♀️ maybe")
        assert len(result) == 1
        assert result[0] == "🤷‍♀️"

    # Skin tone modifiers
    def test_thumbs_up_with_skin_tone(self):
        """Extract emoji with skin tone modifier as single unit."""
        result = extract_emojis("Good 👍🏽 work")
        assert len(result) == 1
        assert result[0] == "👍🏽"

    def test_woman_with_skin_tone_and_zwj(self):
        """Extract complex emoji with skin tone and ZWJ."""
        result = extract_emojis("Person 🤷🏼‍♀️ here")
        assert len(result) == 1
        assert result[0] == "🤷🏼‍♀️"

    # Variation selectors
    def test_heart_with_variation_selector(self):
        """Extract heart with variation selector."""
        result = extract_emojis("Love ❤️ you")
        assert len(result) == 1
        assert "❤" in result[0]  # Should contain the heart

    def test_checkmark_with_variation_selector(self):
        """Extract checkmark with variation selector."""
        result = extract_emojis("Done ✅ here")
        assert len(result) == 1

    # Flags
    def test_flag_emoji(self):
        """Extract flag emoji (two regional indicators)."""
        result = extract_emojis("USA 🇺🇸 flag")
        assert len(result) == 1
        assert result[0] == "🇺🇸"

    def test_multiple_flags(self):
        """Extract multiple flag emojis."""
        result = extract_emojis("🇺🇸🇬🇧🇫🇷")
        assert len(result) == 3
        assert result == ["🇺🇸", "🇬🇧", "🇫🇷"]

    # Keycaps
    def test_keycap_emoji(self):
        """Extract keycap emoji."""
        result = extract_emojis("Number 1️⃣ here")
        assert len(result) == 1

    # Edge cases
    def test_emoji_only_message(self):
        """Extract from emoji-only message."""
        result = extract_emojis("😀")
        assert result == ["😀"]

    def test_emoji_surrounded_by_text(self):
        """Extract emoji surrounded by words."""
        result = extract_emojis("I😊love😊this")
        assert result == ["😊", "😊"]

    def test_mixed_complex_emojis(self):
        """Extract mix of simple and complex emojis."""
        result = extract_emojis("Hi 👋 I'm a 👨‍💻 and I ❤️ coding 🚀")
        assert len(result) == 4


class TestAnalyzeEmoji:
    """Test emoji analysis function."""

    def test_basic_analysis(self):
        """Test basic emoji analysis with sent/received split."""
        messages = [
            ("Hello 😊", 1, "2024", "2024-01"),
            ("Hi 😊😊", 0, "2024", "2024-01"),
            ("Bye 👋", 1, "2024", "2024-01"),
        ]
        result = analyze_emoji(messages)

        assert "all" in result
        assert "2024" in result

        # Check sent emojis
        sent = result["all"]["sent"]
        assert sent["total"] == 2  # 😊 + 👋

        # Check received emojis
        received = result["all"]["received"]
        assert received["total"] == 2  # 😊😊

    def test_yearly_breakdown(self):
        """Test emoji analysis with yearly breakdown."""
        messages = [
            ("Hello 😊", 1, "2023", "2023-06"),
            ("Hi 😊", 1, "2024", "2024-01"),
            ("Bye 👋", 0, "2024", "2024-01"),
        ]
        result = analyze_emoji(messages)

        assert "2023" in result
        assert "2024" in result
        assert "all" in result

        # 2023 should only have sent emoji
        assert result["2023"]["sent"]["total"] == 1
        assert result["2023"]["received"]["total"] == 0

        # 2024 should have both
        assert result["2024"]["sent"]["total"] == 1
        assert result["2024"]["received"]["total"] == 1

    def test_top_emojis_ordering(self):
        """Test that top emojis are ordered by count."""
        messages = [
            ("👍👍👍", 1, "2024", "2024-01"),
            ("😊😊", 1, "2024", "2024-01"),
            ("🎉", 1, "2024", "2024-01"),
        ]
        result = analyze_emoji(messages)

        top = result["all"]["sent"]["top"]
        assert len(top) == 3
        assert top[0]["emoji"] == "👍"
        assert top[0]["count"] == 3
        assert top[1]["emoji"] == "😊"
        assert top[1]["count"] == 2

    def test_empty_messages(self):
        """Test analysis with empty message list."""
        result = analyze_emoji([])
        assert result is None

    def test_no_emojis_in_messages(self):
        """Test analysis when messages have no emojis."""
        messages = [
            ("Hello", 1, "2024", "2024-01"),
            ("Hi there", 0, "2024", "2024-01"),
        ]
        result = analyze_emoji(messages)
        assert result is None


class TestEmojiPattern:
    """Test the emoji regex pattern directly."""

    def test_pattern_matches_simple_emoji(self):
        """Pattern matches simple emoji."""
        assert EMOJI_PATTERN.search("😀") is not None

    def test_pattern_matches_zwj_sequence(self):
        """Pattern matches ZWJ sequence as single match."""
        text = "👨‍💻"
        matches = EMOJI_PATTERN.findall(text)
        assert len(matches) == 1
        assert matches[0] == "👨‍💻"

    def test_pattern_does_not_match_regular_text(self):
        """Pattern does not match regular text."""
        assert EMOJI_PATTERN.search("Hello world") is None

    def test_pattern_does_not_split_compound_emoji(self):
        """Pattern extracts compound emoji as single unit."""
        text = "🏃‍♂️"
        matches = EMOJI_PATTERN.findall(text)
        assert len(matches) == 1
        # Should not have male sign as separate match
        assert "♂" not in [m for m in matches if len(m) == 1]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
