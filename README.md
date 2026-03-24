# Reply Task Prototype

Hi! 🌼

This is a small prototype I built to simulate reply tasks and collect trial data.
The interface mimics SMS, Email, and Messenger so we can test responses in different communication mediums.

It logs things like:
- medium (SMS / Email / Messenger)
- input method (keyboard or voice)
- prompt
- reply
- response time
- keystrokes
- backspaces
- notes
- sentiment scores

For sentiment analysis I currently use:
- TextBlob
- VADER
- (BERT-based analysis in progress)

I am still working on:
- SVM classifier
- Improved text correction tracking
- More consistent sentiment normalization

The goal is to collect experimental data for our project.

---

## How to run it

1. Open terminal in the project folder
2.  Activate the environment

- Mac:

    source sentiment_env/bin/activate

3. Run the server

    python3 server.py

4. Open in browser

    http://localhost:8000

---

## What it does

The web interface lets you:
- simulate replying to messages
- track typing behavior
- analyze sentiment
- store trial data in CSV format
- View results in an admin dashboard

---
## Notes

This is a research prototype and is still evolving.
Some features and outputs (e.g., sentiment labels) may be inconsistent as models and logging are being refined.
---

Feedback welcome! 😊

Jocelyne M, Yusrat A. J. and Jakob Topholt
