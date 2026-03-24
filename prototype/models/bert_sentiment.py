"""
models/bert_sentiment.py
------------------------

Thin wrapper around a HuggingFace Transformers sentiment model so that the
rest of the backend can use a stable interface, independent of the exact
model being used.

The recommended way to use this module is via utils.analysis_utils, which
already exposes higher‑level helpers. It is kept separate to make it easy
to swap models or add fine‑tuned variants in the future.
"""

from __future__ import annotations

from typing import Dict

try:
  from transformers import pipeline  # type: ignore
except Exception:  # pragma: no cover - dependency may be missing
  pipeline = None  # type: ignore


_PIPELINE = None


def _get_pipeline():
  """
  Lazily construct and cache a sentiment‑analysis pipeline.

  Returns:
    transformers.Pipeline instance, or None if Transformers is unavailable.
  """
  global _PIPELINE
  if _PIPELINE is not None:
    return _PIPELINE
  if pipeline is None:
    return None
  # This model produces 1–5 star ratings, but still works well as an
  # ordinal sentiment signal for research prototypes.
  _PIPELINE = pipeline(
    "sentiment-analysis", model="nlptown/bert-base-multilingual-uncased-sentiment"
  )
  return _PIPELINE


def run_bert_sentiment(text: str) -> Dict[str, float or str]:
  """
  Run BERT sentiment on text and return a structured dict:

      {
        "label": <string>,
        "confidence": <float 0..1>
      }

  If transformers or the model are unavailable, a neutral label with 0.0
  confidence is returned so that downstream code never crashes.
  """
  if not text:
    return {"label": "neutral", "confidence": 0.0}

  pipe = _get_pipeline()
  if pipe is None:
    return {"label": "neutral", "confidence": 0.0}

  try:
    results = pipe(text, truncation=True, max_length=256)
    if not results:
      return {"label": "neutral", "confidence": 0.0}
    r = results[0]
    return {
      "label": str(r.get("label", "neutral")),
      "confidence": float(r.get("score", 0.0)),
    }
  except Exception:  # pragma: no cover - model/runtime specific
    return {"label": "neutral", "confidence": 0.0}

