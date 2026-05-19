# Reply Task Prototype

Hi! 🌼

This is a small prototype I built to simulate reply tasks and collect trial data.
The interface mimics SMS, Email, and Messenger so we can test responses in different communication mediums.

## Active application (current study UI)

The **participant + admin Relay app** lives under **`prototype/`**. That stack serves the dashboards, CSV logging, and APIs used in ongoing experiments.

**Run the canonical server from the repository root:**

```bash
python -m prototype.server
```

Then open **[http://localhost:8000](http://localhost:8000)** (participant UI) or **[http://localhost:8000/admin](http://localhost:8000/admin)** (research console).

From the admin **Exports** page you can download a **study CSV** (readable columns and register labels, participant rows only) or a **full archive CSV** (same column names as the on-disk log). Raw logging paths and behaviour are unchanged.

### Phone voice-to-text (HTTPS)

Mobile browsers usually **block the microphone** on `http://192.168.x.x:8000`. For **voice-to-text** on a participant phone, use an **HTTPS** URL (e.g. [ngrok](https://ngrok.com/)) pointing at the same Flask port.

1. Start Relay: `python -m prototype.server` (use `--host=0.0.0.0` if phones are on the same Wi‑Fi).
2. In another terminal: `ngrok http 8000`
3. Open **admin** at the `https://….ngrok-free.app` URL (not the LAN IP).
4. In **Study session**, build the participant link with **Voice-to-text** and copy it to the phone.
5. Verify: `python prototype/scripts/check_study_https_mic.py --base https://YOUR.ngrok-host`

**Typing** and **Swipe typing** can still use a plain `http://` LAN link. See **Study session → Phone microphone** in admin for full steps.

Use a virtual environment if you prefer (example):

```bash
python3 -m venv .venv
source .venv/bin/activate   # macOS / Linux
pip install -r prototype/requirements.txt
python -m prototype.server
```

### Legacy / alternate stack (repository root)

The repository root also contains an **older Flask + static page** bundle (`server.py`, `index.html`, `app.js`, `style.css`). That path is **not** the active study UI unless your team explicitly still uses it. Prefer `python -m prototype.server` unless you have confirmed otherwise.

---

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

For analysis I currently use:

- Server-side formality model (text classification)
- (BERT-based analysis available as an auxiliary signal)

I am still working on:

- Improved text correction tracking
- More consistent analysis normalization

The goal is to collect experimental data for our project.

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
