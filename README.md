# Reply Task Prototype

Hi! 🌼

This is a small prototype I built to simulate reply tasks and collect trial data.
The interface mimics SMS, Email, and Messenger so we can test responses in different communication mediums.

It logs things like:
- medium (SMS / Email / Messenger)
- input method
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

I am still working on:
- SVM classifier
- text correction tracking

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
- save trials to CSV

This is still a prototype and may change a bit.

Feedback welcome! 😊

Jocelyne M
