"""
Formality model wrapper: loads a HuggingFace-compatible text-classification
model from the `formality_model/` folder and exposes helpers to sanitize
HTML and predict formality labels and confidences.
"""
from typing import List, Dict, Any
import os
import importlib.util

# Keep startup fast: do not import transformers/torch at module import time.
pipeline = None
AutoTokenizer = None
AutoModelForSequenceClassification = None
torch = None
TRANSFORMERS_AVAILABLE = importlib.util.find_spec("transformers") is not None
TORCH_AVAILABLE = importlib.util.find_spec("torch") is not None

try:
    from bs4 import BeautifulSoup
except Exception:
    BeautifulSoup = None

_model = None
_tokenizer = None
_pipeline = None
_device = None


def _ensure_ml_imports():
    """Lazily import heavy ML libraries only when needed."""
    global pipeline, AutoTokenizer, AutoModelForSequenceClassification, torch
    if pipeline is not None and torch is not None:
        return
    if not TRANSFORMERS_AVAILABLE or not TORCH_AVAILABLE:
        raise RuntimeError("transformers/torch are required for formality inference.")
    try:
        from transformers import pipeline as _pipeline_fn, AutoTokenizer as _AutoTokenizer, AutoModelForSequenceClassification as _AutoModel
        import torch as _torch

        pipeline = _pipeline_fn
        AutoTokenizer = _AutoTokenizer
        AutoModelForSequenceClassification = _AutoModel
        torch = _torch
    except Exception as e:
        raise RuntimeError(f"Could not import transformers/torch: {e}")


def _ensure_bs4():
    if BeautifulSoup is None:
        raise RuntimeError("bs4 (beautifulsoup4) is required for HTML sanitization. Install via pip.")


def _get_device():
    global _device
    if _device is None:
        _ensure_ml_imports()
        try:
            _device = 0 if torch.cuda.is_available() else -1
        except Exception:
            _device = -1
    return _device


def load_model(model_dir: str = None) -> None:
    """Load the formality model and tokenizer from `model_dir`.

    If model_dir is None, uses repository-root `formality_model`.
    """
    global _model, _tokenizer, _pipeline
    if _pipeline is not None:
        return
    model_dir = model_dir or os.path.join(os.getcwd(), "formality_model")
    if not os.path.isdir(model_dir):
        # Try relative to project root (one level up from prototype)
        alt = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "formality_model"))
        if os.path.isdir(alt):
            model_dir = alt
        else:
            raise FileNotFoundError(f"Formality model directory not found: {model_dir}")

    _ensure_ml_imports()

    # Use the HF text-classification pipeline which handles tokenizer+model
    device = _get_device()
    try:
        _pipeline = pipeline("text-classification", model=model_dir, tokenizer=model_dir, device=device)
    except Exception as e:
        # Try explicit components if pipeline fails
        try:
            _tokenizer = AutoTokenizer.from_pretrained(model_dir)
            _model = AutoModelForSequenceClassification.from_pretrained(model_dir)
            _pipeline = pipeline("text-classification", model=_model, tokenizer=_tokenizer, device=device)
        except Exception as e2:
            raise RuntimeError(f"Could not load formality model from {model_dir}: {e} / {e2}")


def sanitize_html(text: str) -> str:
    """Strip HTML and return readable plaintext suitable for model input."""
    if not text:
        return ""
    _ensure_bs4()
    soup = BeautifulSoup(text, "html.parser")
    # Remove script/style
    for s in soup(["script", "style"]):
        s.decompose()
    # Get text
    txt = soup.get_text(separator=" ")
    # Collapse whitespace
    return " ".join(txt.split())


def predict_formality(text: str, top_k: int = 1) -> Dict[str, Any]:
    """Predict formality label and confidence for a single text.

    Returns: {"label": str, "score": float, "raw": pipeline_output}
    """
    if _pipeline is None:
        load_model()
    if text is None:
        text = ""
    clean = sanitize_html(text)
    out = _pipeline(clean, top_k=top_k)
    # Pipeline returns list of dicts when top_k>1, else a single dict
    if isinstance(out, list):
        # take top result
        top = out[0]
    else:
        top = out
    # Normalize label names: prefer model.config.id2label mapping if present;
    # otherwise map common HF pipeline labels like "LABEL_0" → trained names.
    raw_label = top.get("label") if isinstance(top, dict) else None
    label_norm = raw_label or ""

    # Try to obtain id2label from the loaded model/pipeline
    id2label = None
    try:
        if _model is not None:
            id2label = getattr(_model.config, "id2label", None)
        elif _pipeline is not None and hasattr(_pipeline, "model"):
            id2label = getattr(_pipeline.model.config, "id2label", None)
    except Exception:
        id2label = None

    if isinstance(label_norm, str) and label_norm.startswith("LABEL_"):
        # LABEL_N format — map using id2label when available, else fallback
        import re

        m = re.match(r"LABEL_(\d+)", label_norm)
        if m:
            idx = int(m.group(1))
            mapped = None
            if id2label and isinstance(id2label, dict):
                mapped = id2label.get(idx) or id2label.get(str(idx))
            if not mapped:
                # Fallback mapping used during training: 0=formal,1=informal
                mapped = {0: "formal", 1: "informal"}.get(idx, label_norm)
            label_norm = mapped

    # Ensure label is a plain string
    label_norm = (label_norm or "").strip()

    return {"label": label_norm, "score": float(top.get("score", 0.0)), "raw": out}


def predict_batch(texts: List[str]) -> List[Dict[str, Any]]:
    if _pipeline is None:
        load_model()
    cleans = [sanitize_html(t) for t in (texts or [])]
    outs = _pipeline(cleans, truncation=True)
    results = []
    for o in outs:
        if isinstance(o, list):
            top = o[0]
        else:
            top = o
        raw_label = top.get("label") if isinstance(top, dict) else None
        label_norm = raw_label or ""

        # Try to get id2label mapping
        id2label = None
        try:
            if _model is not None:
                id2label = getattr(_model.config, "id2label", None)
            elif _pipeline is not None and hasattr(_pipeline, "model"):
                id2label = getattr(_pipeline.model.config, "id2label", None)
        except Exception:
            id2label = None

        if isinstance(label_norm, str) and label_norm.startswith("LABEL_"):
            import re

            m = re.match(r"LABEL_(\d+)", label_norm)
            if m:
                idx = int(m.group(1))
                mapped = None
                if id2label and isinstance(id2label, dict):
                    mapped = id2label.get(idx) or id2label.get(str(idx))
                if not mapped:
                    mapped = {0: "formal", 1: "informal"}.get(idx, label_norm)
                label_norm = mapped

        label_norm = (label_norm or "").strip()
        results.append({"label": label_norm, "score": float(top.get("score", 0.0)), "raw": o})
    return results
