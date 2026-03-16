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

# TextBlob = simple sentiment tool
from textblob import TextBlob

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

# CSV output path
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
]

def ensure_csv():
    """
    Create the CSV file with headers if it does not exist yet.
    """
    if not CSV_PATH.exists():
        with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
            writer.writeheader()

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
    Lets the UI know the server is running and whether VADER loaded.
    """
    return jsonify({
        "ok": True,
        "vader_ok": VADER_OK
    })

@app.post("/analyze")
def analyze():
    """
    Analyze reply text only.
    Expected JSON body:
    {
      "reply_text": "some text"
    }
    """
    data = request.get_json(force=True)
    reply = (data.get("reply_text") or "").strip()

    if reply:
        tb_pol, tb_subj = analyze_textblob(reply)
        vader_comp = analyze_vader(reply)
    else:
        tb_pol, tb_subj = 0.0, 0.0
        vader_comp = None

    return jsonify({
        "reply_tb_polarity": tb_pol,
        "reply_tb_subjectivity": tb_subj,
        "reply_vader_compound": vader_comp,
        "vader_ok": VADER_OK
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
