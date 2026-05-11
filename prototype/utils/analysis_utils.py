"""
analysis_utils.py
-----------------

NLP and style‑classification utilities used by the Flask backend.

This module wraps:
* Formality model (text classification)
* BERT‑based sentiment from HuggingFace Transformers
* A simple rule‑based style classifier (formal / informal / neutral)

The app still runs if optional models are missing.
In that case we return safe neutral defaults.
"""

from __future__ import annotations

from typing import Dict

try:
    # Use the formality service wrapper implemented separately.
    # Also import the loader so we can ensure the locally-trained HF model
    # (the `formality_model/` folder in the repo) is loaded before
    # predictions are requested.
    from .formality_service import predict_formality, load_model as _load_formality_model
except Exception:
    predict_formality = None
    _load_formality_model = None

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
    Style classifier backed by the trained formality model.

    Returns one of: "formal", "informal" or "neutral". If the
    formality model is unavailable we return "neutral" as a safe default.
    """
    if not text:
        return "neutral"
    if predict_formality is None:
        return "neutral"

    # Ensure the local model is loaded if possible, then predict.
    try:
        if _load_formality_model is not None:
            try:
                _load_formality_model()
            except Exception:
                pass
        res = predict_formality(text)
        label = (res.get("label") or "").strip()
        # Normalize common HF label formats (e.g., LABEL_0) to readable names.
        if label.startswith("LABEL_"):
            mapping = {"formal": "formal", "informal": "informal"}
            return mapping.get(label, label)
        return label or "neutral"
    except Exception:
        return "neutral"


def analyze_full_text(text: str) -> Dict[str, float or str]:
    """
    Convenience helper that returns formality (from the formality model)
    and BERT sentiment metadata for a given text.
    """
    # Formality via the trained model (preferred). Ensure the local
    # `formality_model/` is loaded (if available) before calling the
    # prediction helper so that the model you trained is actually used.
    formality_label = ""
    formality_conf = 0.0
    if predict_formality is not None:
        try:
            # Attempt to eagerly load the locally-trained model. If loading
            # fails (e.g., missing dependencies) we still attempt prediction
            # which may lazily load or raise an error that we catch below.
            if _load_formality_model is not None:
                try:
                    _load_formality_model()
                except Exception:
                    # Don't fail hard here; prediction will handle errors.
                    pass

            res = predict_formality(text)
            formality_label = res.get("label") or ""
            formality_conf = float(res.get("score", 0.0))
        except Exception:
            formality_label = ""
            formality_conf = 0.0

    bert_result = analyze_bert(text)

    return {
        "formality_label": formality_label,
        "formality_confidence": formality_conf,
        "bert_label": bert_result["label"],
        "bert_confidence": bert_result["confidence"],
    }

