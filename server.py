"""server.py
Reply Task Prototype backend (cleaned merge)

Provides:
- static file serving for the front-end
- /health for basic health checks
- /analyze for sentiment + formality scoring
- /generate-reply for optional LLM reply generation
- /log to append trial rows to a CSV

This file is defensive about optional dependencies (TextBlob, VADER, transformers).
"""

from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime
from pathlib import Path
import csv

# TextBlob and VADER removed — sentiment analysis is not used.

try:
    import torch
    from transformers import AutoTokenizer, AutoModelForSequenceClassification, AutoModelForCausalLM
    TRANSFORMERS_OK = True
except Exception as e:
    TRANSFORMERS_OK = False

# Try to load formality model from local folder `formality_model/` if available
FORMALITY_OK = False
tokenizer_formality = None
model_formality = None
MODEL_DIR = Path("formality_model")
if TRANSFORMERS_OK and MODEL_DIR.exists():
    try:
        tokenizer_formality = AutoTokenizer.from_pretrained(str(MODEL_DIR))
        model_formality = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR))
        FORMALITY_OK = True
        print("Loaded formality model from ./formality_model/")
    except Exception as e:
        print(f"Warning: failed to load formality model: {e}")
        tokenizer_formality = None
        model_formality = None
        FORMALITY_OK = False

# Optional LLM (for /generate-reply). Deferred load to avoid heavy downloads at import-time.
LLAMA_OK = False
llama_tokenizer = None
llama_model = None
llama_model_name = "microsoft/DialoGPT-medium"

def ensure_llama_loaded():
    """Load the reply-generation model on first use. Returns True if available."""
    global LLAMA_OK, llama_model, llama_tokenizer
    if LLAMA_OK:
        return True
    if not TRANSFORMERS_OK:
        return False
    try:
        llama_tokenizer = AutoTokenizer.from_pretrained(llama_model_name)
        llama_model = AutoModelForCausalLM.from_pretrained(llama_model_name)
        LLAMA_OK = True
        print(f"Loaded reply generation model: {llama_model_name}")
        return True
    except Exception as e:
        print(f"Info: reply generation model not available: {e}")
        return False

app = Flask(__name__, static_folder=".", static_url_path="")

CSV_PATH = Path("sentiment_log_web.csv")

# Fields expected in CSV rows (keep in sync with front-end payload)
FIELDNAMES = [
    "timestamp",
    "participant_id",
    "medium",
    "input_method",
    "model_choice",
    "prompt_text",
    "reply_text",
    "llm_reply_text",
    "final_text",
    "prompt_style",
    "reply_style",
    "correction_applied",
    "response_time_seconds",
    "keypress_count",
    "backspace_count",
    "paste_used",
    "correction_manual",
    "notes",
    # (TextBlob/VADER removed - no sentiment columns)
    # Formality
    "prompt_formality_label",
    "prompt_formality_confidence",
    "reply_formality_label",
    "reply_formality_confidence",
    "llm_reply_formality_label",
    "llm_reply_formality_confidence",
    "final_formality_label",
    "final_formality_confidence",
    "formality_mismatch",
]


def ensure_csv():
    if not CSV_PATH.exists():
        with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=FIELDNAMES)
            w.writeheader()

def classify_formality_single(text: str):
    """Classify a single text string and return {label, confidence} or {None, None} if unavailable."""
    if not FORMALITY_OK or not text:
        return {"label": None, "confidence": None}

    try:
        inputs = tokenizer_formality([text], return_tensors="pt", padding=True, truncation=True, max_length=128)
        with torch.no_grad():
            outputs = model_formality(**inputs)

        logits = outputs.logits
        probs = torch.softmax(logits, dim=-1).cpu().numpy()
        pred = int(probs.argmax(axis=-1)[0])

        # Try to read id2label from model config, otherwise fallback to conventional mapping
        id2label = getattr(model_formality.config, "id2label", None)
        label_name = None
        if id2label and isinstance(id2label, dict):
            label_name = id2label.get(pred) or id2label.get(str(pred))

        if not label_name:
            # Fallback: trained mapping used during training: 0=formal,1=informal
            label_name = "formal" if pred == 0 else "informal"

        confidence = float(probs[0, pred])
        return {"label": label_name, "confidence": confidence}
    except Exception as e:
        print(f"Formality classification error: {e}")
        return {"label": None, "confidence": None}


def generate_reply_from_history(conversation):
    # Load the LLM on demand to avoid heavy startup costs
    if not ensure_llama_loaded():
        return ""
    try:
        conversation_text = "\n".join(conversation) + "\nHuman:"
        inputs = llama_tokenizer.encode(conversation_text + (llama_tokenizer.eos_token or ""), return_tensors="pt")
        with torch.no_grad():
            outputs = llama_model.generate(
                inputs,
                max_length=inputs.shape[1] + 60,
                num_return_sequences=1,
                no_repeat_ngram_size=2,
                do_sample=True,
                top_k=50,
                top_p=0.95,
                temperature=0.7,
                pad_token_id=llama_tokenizer.eos_token_id,
            )
        reply = llama_tokenizer.decode(outputs[0][inputs.shape[1]:], skip_special_tokens=True).strip()
        return reply
    except Exception as e:
        print(f"Reply generation error: {e}")
        return ""


@app.get("/")
def index():
    return send_from_directory(".", "index.html")


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "formality_ok": FORMALITY_OK,
        "llama_ok": LLAMA_OK,
    })


@app.post("/analyze")
def analyze():
    data = request.get_json(force=True) or {}
    prompt = (data.get("prompt_text") or "").strip()
    reply = (data.get("reply_text") or "").strip()
    llm_reply = (data.get("llm_reply_text") or "").strip()
    final_text = (data.get("final_text") or "").strip()
    prompt_form = classify_formality_single(prompt) if prompt else {"label": None, "confidence": None}
    reply_form = classify_formality_single(reply) if reply else {"label": None, "confidence": None}
    llm_form = classify_formality_single(llm_reply) if llm_reply else {"label": None, "confidence": None}
    final_form = classify_formality_single(final_text) if final_text else {"label": None, "confidence": None}

    formality_mismatch = None
    if prompt_form["label"] is not None and reply_form["label"] is not None:
        formality_mismatch = prompt_form["label"] != reply_form["label"]

    return jsonify({
        "formality_ok": FORMALITY_OK,
        "prompt_formality_label": prompt_form["label"],
        "prompt_formality_confidence": prompt_form["confidence"],
        "reply_formality_label": reply_form["label"],
        "reply_formality_confidence": reply_form["confidence"],
        "llm_reply_formality_label": llm_form["label"],
        "llm_reply_formality_confidence": llm_form["confidence"],
        "final_formality_label": final_form["label"],
        "final_formality_confidence": final_form["confidence"],
        "formality_mismatch": formality_mismatch,
    })


@app.post("/generate-reply")
def generate_reply():
    data = request.get_json(force=True) or {}
    conversation = data.get("conversation") or []
    if not isinstance(conversation, list):
        conversation = []
    reply = generate_reply_from_history(conversation)
    return jsonify({"reply": reply})


@app.post("/log")
def log():
    data = request.get_json(force=True) or {}
    ensure_csv()
    row = {k: data.get(k, "") for k in FIELDNAMES}
    row["timestamp"] = datetime.now().isoformat(timespec="seconds")
    with CSV_PATH.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writerow(row)
    return jsonify({"saved": True, "csv": str(CSV_PATH.resolve())})


if __name__ == "__main__":
    app.run(port=8000, debug=True)
