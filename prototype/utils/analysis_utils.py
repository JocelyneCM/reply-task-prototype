"""
analysis_utils.py
-----------------

NLP and style‑classification utilities used by the Flask backend.

This module wraps:
* TextBlob sentiment (polarity + subjectivity)
* VADER sentiment (compound score)
* BERT‑based sentiment from HuggingFace Transformers
* A simple rule‑based style classifier (formal / informal / neutral)

The app still runs if optional models are missing.
In that case we return safe neutral defaults.
"""

from __future__ import annotations

from typing import Dict, Tuple

from textblob import TextBlob

try:
    from nltk.sentiment import SentimentIntensityAnalyzer

    _vader_analyzer = SentimentIntensityAnalyzer()
    VADER_AVAILABLE: bool = True
except Exception:  # pragma: no cover - environment‑dependent
    _vader_analyzer = None
    VADER_AVAILABLE = False

try:
    from transformers import pipeline  # type: ignore

    # Use a common sentiment model and reuse it once loaded.
    _bert_pipeline = pipeline(
        "sentiment-analysis", model="nlptown/bert-base-multilingual-uncased-sentiment"
    )
    BERT_AVAILABLE: bool = True
except Exception:  # pragma: no cover - environment‑dependent
    _bert_pipeline = None
    BERT_AVAILABLE = False


def analyze_textblob(text: str) -> Tuple[float, float]:
    """
    Run TextBlob sentiment analysis on the given text.

    Returns:
        (polarity, subjectivity)
    """
    if not text:
        return 0.0, 0.0
    blob = TextBlob(text)
    sentiment = blob.sentiment
    return float(sentiment.polarity), float(sentiment.subjectivity)


def analyze_vader(text: str) -> float:
    """
    Run VADER sentiment analysis and return the compound score.

    Returns:
        float in the range [-1, 1].
        0.0 is returned if VADER is unavailable or the text is empty.
    """
    if not text or not VADER_AVAILABLE or _vader_analyzer is None:
        return 0.0
    scores = _vader_analyzer.polarity_scores(text)
    return float(scores.get("compound", 0.0))


def analyze_bert(text: str) -> Dict[str, float or str]:
    """
    Run BERT‑based sentiment classification using HuggingFace Transformers.

    Returns a dictionary:
        {
          "label": <string>,
          "confidence": <float 0..1>
        }

    If BERT is unavailable, the label "neutral" with confidence 0.0 is used.
    """
    if not text or not BERT_AVAILABLE or _bert_pipeline is None:
        return {"label": "neutral", "confidence": 0.0}

    try:
        results = _bert_pipeline(text, truncation=True, max_length=256)
        if not results:
            return {"label": "neutral", "confidence": 0.0}
        result = results[0]
        label = str(result.get("label", "neutral"))
        score = float(result.get("score", 0.0))
        return {"label": label, "confidence": score}
    except Exception:  # pragma: no cover - model/runtime dependent
        # If anything goes wrong at runtime we still return a neutral label.
        return {"label": "neutral", "confidence": 0.0}


def classify_style(text: str) -> str:
    """
    Simple rule‑based style classifier.

    Returns:
        "formal", "informal" or "neutral".

    The heuristics are intentionally transparent and interpretable for
    research use; they rely on simple pattern checks that can be extended
    later if desired.
    """
    if not text:
        return "neutral"

    t = text.strip()
    lower = t.lower()

    # Simple cues for formality
    formal_markers = [
        "dear ",
        "sincerely",
        "regards",
        "kind regards",
        "best regards",
        "to whom it may concern",
        "i am writing",
        "thank you for your consideration",
    ]
    informal_markers = [
        "hey ",
        "hi ",
        "yo ",
        "lol",
        "omg",
        "btw",
        "gonna",
        "wanna",
        "kinda",
        "sorta",
        "haha",
        "😂",
        "😅",
        "😊",
        "❤️",
        "thx",
        "u ",
        "you guys",
    ]

    # Contractions are a weak cue of informality in English.
    contractions = ["n't", " I'm", " you're", " we're", " they've", " can't", "won't"]

    # Count markers
    formal_score = 0
    informal_score = 0

    for marker in formal_markers:
        if marker in lower:
            formal_score += 2
    for marker in informal_markers:
        if marker in lower:
            informal_score += 2
    for c in contractions:
        if c.lower() in lower:
            informal_score += 1

    # Punctuation cues
    if "!!" in t or "??" in t or "!" in t[-3:]:
        informal_score += 1
    if t.endswith(".") and len(t.split()) > 10:
        formal_score += 1

    if formal_score >= informal_score + 2:
        return "formal"
    if informal_score >= formal_score + 2:
        return "informal"

    return "neutral"


def analyze_full_text(text: str) -> Dict[str, float or str]:
    """
    Convenience helper that runs all sentiment analyses on a piece of text
    and returns a single, well‑named dictionary.
    """
    polarity, subjectivity = analyze_textblob(text)
    vader_compound = analyze_vader(text)
    bert_result = analyze_bert(text)

    return {
        "textblob_polarity": polarity,
        "textblob_subjectivity": subjectivity,
        "vader_compound": vader_compound,
        "bert_label": bert_result["label"],
        "bert_confidence": bert_result["confidence"],
    }

