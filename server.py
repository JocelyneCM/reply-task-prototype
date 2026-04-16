# server.py
# Reply Task Prototype backend
#
# What this file does:
# 1. Serves the front-end files (index.html, style.css, app.js)
# 2. Provides a simple /health route so the UI can check if the server is running
# 3. Provides /analyze for sentiment analysis with TextBlob + VADER
# 4. Provides /log to save one trial row into a CSV file
#
# Notes:
# - This version analyzes text only.
# - MP3 audio is NOT transcribed here yet.
# - If MP3 is used, the front-end currently sends typed fallback text / placeholder text.

from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime
from pathlib import Path
import csv

# Try to load transformer model for formality classification
try:
    from transformers import AutoTokenizer, AutoModelForSequenceClassification
    import torch
    FORMALITY_OK = True
except Exception as e:
    FORMALITY_OK = False
    print(f"Warning: Formality classifier unavailable: {e}")

# Try to load Llama model for reply generation
try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    LLAMA_OK = True
except Exception as e:
    LLAMA_OK = False
    print(f"Warning: Llama model unavailable: {e}")

# Try to load VADER from nltk
# If it fails, the app still works, but VADER will be unavailable
try:
    from nltk.sentiment import SentimentIntensityAnalyzer
    SIA = SentimentIntensityAnalyzer()
    VADER_OK = True
except Exception:
    SIA = None
    VADER_OK = False

# Serve files from the current folder
app = Flask(__name__, static_folder=".", static_url_path="")

# Formality classifier state
formality_model = None
formality_tokenizer = None

if FORMALITY_OK:
    try:
        print("Loading formality model from ./formality_model...")
        formality_model = AutoModelForSequenceClassification.from_pretrained("./formality_model")
        formality_tokenizer = AutoTokenizer.from_pretrained("./formality_model")
        print("✓ Formality classifier loaded successfully")
    except Exception as e:
        print(f"Warning: Could not load formality model: {e}")
        FORMALITY_OK = False
else:
    print("Formality classifier support disabled: transformers or torch not installed.")

# Llama model for reply generation
llama_model = None
llama_tokenizer = None

if LLAMA_OK:
    try:
        print("Loading Llama model for reply generation...")
        # Use a small Llama model
        model_name = "microsoft/DialoGPT-medium"
        llama_tokenizer = AutoTokenizer.from_pretrained(model_name)
        llama_model = AutoModelForCausalLM.from_pretrained(model_name)
        print("✓ Llama model loaded successfully")
    except Exception as e:
        print(f"Warning: Could not load Llama model: {e}")
        LLAMA_OK = False
else:
    print("Llama model support disabled.")
CSV_PATH = Path("sentiment_log_web.csv")

# CSV columns
# Keep these aligned with what the front-end sends to /log
FIELDNAMES = [
    "timestamp",
    "participant_id",
    "medium",
    "input_method",
    "model_choice",
    "prompt_text",
    "reply_text",
    "prompt_style",
    "reply_style",
    "correction_applied",
    "response_time_seconds",
    "keypress_count",
    "backspace_count",
    "paste_used",
    "correction_manual",
    "notes",
    # Reply sentiment
    "reply_tb_polarity",
    "reply_tb_subjectivity",
    "reply_vader_compound",
    # Formality
    "prompt_formality_label",
    "prompt_formality_confidence",
    "reply_formality_label",
    "reply_formality_confidence",
    "formality_match",
]

def ensure_csv():
    """
    Create the CSV file with headers if it does not exist yet.
    """
    if not CSV_PATH.exists():
        with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
            writer.writeheader()

def classify_formality(text: str):
    """
    Classify formality of text using the trained model.
    Returns a dict with label, confidence, and label_id.
    Returns None if classifier is unavailable.
    """
    if not FORMALITY_OK or not formality_model or not formality_tokenizer:
        return None
    
    try:
        inputs = formality_tokenizer(
            text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=128,
        )
        with torch.no_grad():
            outputs = formality_model(**inputs)

        logits = outputs.logits
        predictions = torch.argmax(logits, dim=-1)
        confidence = torch.softmax(logits, dim=-1)

        label_id = predictions[0].item()
        confidence_score = confidence[0][label_id].item()
        label_names = {0: "informal", 1: "formal"}

        return {
            "label": label_names.get(label_id, f"class_{label_id}"),
            "confidence": float(confidence_score),
            "label_id": label_id,
        }
    except Exception as e:
        print(f"Formality classification error: {e}")
        return None

def generate_reply_from_history(conversation):
    """
    Generate a reply using Llama model based on conversation history.
    Conversation is a list of strings like ["Human: ...", "Assistant: ..."]
    """
    if not LLAMA_OK or not llama_model or not llama_tokenizer:
        return "Sorry, reply generation is not available."
    
    try:
        # Join conversation with newlines
        conversation_text = "\n".join(conversation) + "\nHuman:"
        
        inputs = llama_tokenizer.encode(conversation_text + llama_tokenizer.eos_token, return_tensors="pt")
        
        # Generate reply
        with torch.no_grad():
            outputs = llama_model.generate(
                inputs,
                max_length=inputs.shape[1] + 50,
                num_return_sequences=1,
                no_repeat_ngram_size=2,
                do_sample=True,
                top_k=50,
                top_p=0.95,
                temperature=0.7,
                pad_token_id=llama_tokenizer.eos_token_id
            )
        
        reply = llama_tokenizer.decode(outputs[0][inputs.shape[1]:], skip_special_tokens=True).strip()
        return reply
    except Exception as e:
        print(f"Reply generation error: {e}")
        return "Sorry, I couldn't generate a reply."

def analyze_textblob(text: str):
    """
    Return TextBlob polarity + subjectivity for a piece of text.
    polarity: roughly negative to positive
    subjectivity: roughly objective to subjective
    """
    blob = TextBlob(text)
    return float(blob.sentiment.polarity), float(blob.sentiment.subjectivity)

def analyze_vader(text: str):
    """
    Return VADER compound score if VADER is available.
    If not available, return None.
    """
    if not SIA:
        return None
    return float(SIA.polarity_scores(text)["compound"])

@app.get("/")
def index():
    """
    Serve the main page.
    """
    return send_from_directory(".", "index.html")

@app.get("/health")
def health():
    """
    Simple health check for the front-end.
    Lets the UI know the server is running and whether VADER and formality classifier loaded.
    """
    return jsonify({
        "ok": True,
        "vader_ok": VADER_OK,
        "formality_ok": FORMALITY_OK,
        "llama_ok": LLAMA_OK
    })

@app.post("/analyze")
def analyze():
    """
    Analyze prompt and reply text.
    Expected JSON body:
    {
      "prompt_text": "some text",
      "reply_text": "some text"
    }
    """
    data = request.get_json(force=True)
    prompt = (data.get("prompt_text") or "").strip()
    reply = (data.get("reply_text") or "").strip()

    # Analyze reply sentiment
    if reply:
        tb_pol, tb_subj = analyze_textblob(reply)
        vader_comp = analyze_vader(reply)
    else:
        tb_pol, tb_subj = 0.0, 0.0
        vader_comp = None

    # Classify formality
    prompt_formality = classify_formality(prompt) if prompt else None
    reply_formality = classify_formality(reply) if reply else None

    # Compare formality (simple match)
    formality_match = None
    if prompt_formality and reply_formality:
        formality_match = prompt_formality["label"] == reply_formality["label"]

    return jsonify({
        "reply_tb_polarity": tb_pol,
        "reply_tb_subjectivity": tb_subj,
        "reply_vader_compound": vader_comp,
        "vader_ok": VADER_OK,
        "formality_ok": FORMALITY_OK,
        "prompt_formality": prompt_formality,
        "reply_formality": reply_formality,
        "formality_match": formality_match
    })

@app.post("/generate-reply")
def generate_reply_endpoint():
    """
    Generate a reply using Llama.
    Expected JSON: {"conversation": ["Human: ...", "Assistant: ...", ...]}
    """
    data = request.get_json(force=True)
    conversation = data.get("conversation", [])
    
    if not conversation:
        return jsonify({"reply": "Got it.", "llama_ok": LLAMA_OK})
    
    reply = generate_reply_from_history(conversation)
    
    return jsonify({
        "reply": reply,
        "llama_ok": LLAMA_OK
    })

@app.post("/log")
def log():
    """
    Save one trial row to the CSV file.
    The front-end sends a JSON payload with fields matching FIELDNAMES.
    """
    data = request.get_json(force=True)

    ensure_csv()

    # Build a clean row using only the fields we expect
    row = {key: data.get(key, "") for key in FIELDNAMES}

    # Always generate timestamp on the server side
    row["timestamp"] = datetime.now().isoformat(timespec="seconds")

    with CSV_PATH.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writerow(row)

    return jsonify({
        "saved": True,
        "csv": str(CSV_PATH.resolve())
    })

if __name__ == "__main__":
    # debug=True is good for local prototype work
    app.run(port=8000, debug=True)
