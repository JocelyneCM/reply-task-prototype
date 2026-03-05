from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime
from pathlib import Path
import csv

from textblob import TextBlob

try:
    from nltk.sentiment import SentimentIntensityAnalyzer
    SIA = SentimentIntensityAnalyzer()
    VADER_OK = True
except Exception:
    SIA = None
    VADER_OK = False

app = Flask(__name__, static_folder=".", static_url_path="")

CSV_PATH = Path("sentiment_log_web.csv")

FIELDNAMES = [
    "timestamp",
    "medium",
    "input_method",
    "model_choice",
    "prompt_text",
    "reply_text",
    "response_time_seconds",
    "keypress_count",
    "backspace_count",
    "paste_used",
    "correction_manual",
    "notes",
    # TextBlob
    "reply_tb_polarity",
    "reply_tb_subjectivity",
    # VADER
    "reply_vader_compound",
]

def ensure_csv():
    if not CSV_PATH.exists():
        with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=FIELDNAMES)
            w.writeheader()

def analyze_textblob(text: str):
    b = TextBlob(text)
    return float(b.sentiment.polarity), float(b.sentiment.subjectivity)

def analyze_vader(text: str):
    if not SIA:
        return None
    return float(SIA.polarity_scores(text)["compound"])

@app.get("/")
def index():
    return send_from_directory(".", "index.html")

@app.get("/health")
def health():
    return jsonify({"ok": True, "vader_ok": VADER_OK})

@app.post("/analyze")
def analyze():
    data = request.get_json(force=True)
    reply = (data.get("reply_text") or "").strip()

    tb_pol, tb_subj = analyze_textblob(reply) if reply else (0.0, 0.0)
    vader_comp = analyze_vader(reply) if reply else None

    return jsonify({
        "reply_tb_polarity": tb_pol,
        "reply_tb_subjectivity": tb_subj,
        "reply_vader_compound": vader_comp,
        "vader_ok": VADER_OK
    })

@app.post("/log")
def log():
    data = request.get_json(force=True)

    ensure_csv()
    row = {k: data.get(k, "") for k in FIELDNAMES}
    row["timestamp"] = datetime.now().isoformat(timespec="seconds")

    with CSV_PATH.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writerow(row)

    return jsonify({"saved": True, "csv": str(CSV_PATH.resolve())})

if __name__ == "__main__":
    app.run(port=8000, debug=True)