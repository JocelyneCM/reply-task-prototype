# Reply Task Prototype

Hi! 🌼

This is a small prototype I built to simulate reply tasks and collect trial data.
The interface mimics **Messenger** and **Email** (with legacy SMS support in older logs) so we can test responses in different communication mediums.

## Active application (current study UI)

The **participant + admin Relay app** lives under **`prototype/`**. That stack serves the research console, CSV logging, session plans, prompt library, and APIs used in ongoing experiments.

**Run the canonical server from the repository root:**

```bash
python -m prototype.server
```

Then open **[http://localhost:8000](http://localhost:8000)** (participant UI) or **[http://localhost:8000/admin](http://localhost:8000/admin)** (research console).

From the admin **Exports** page you can download a **study CSV** (readable columns and register labels, participant rows only) or a **full archive CSV** (same column names as the on-disk log). Raw logging paths and behaviour are unchanged.

### Local lab vs a few remote participants (ngrok)

For everyday lab collection, running Relay locally is enough. If you want a **small number of remote participants** (friends/family/etc.) without changing the architecture, expose the **same** Flask server through an HTTPS tunnel like [ngrok](https://ngrok.com/).

**Before you share a public link**, back up your data folder:

```bash
cp -R prototype/data prototype/data_backup_$(date +%Y%m%d_%H%M%S)
```

**Optional but recommended:** protect admin with a password (participant pages stay open):

```bash
export RELAY_ADMIN_PASSWORD="choose-a-strong-password"
```

Then start Relay and ngrok in two terminals:

```bash
python -m prototype.server
```

```bash
ngrok http 8000
```

Open **admin** on the `https://….ngrok-free.app` URL (not a random local IP), build participant links from there, and share those links with remote participants. In the admin footer, click **Set as team server** so everyone stays on the same host. Admin login uses username **`relay_admin`** and your password from the env var above.

**Participant ID tip** (guidance only, not enforced):
- local/lab: `P001`–`P099`
- remote: `P101+`
- test-only: `P901+`

**Typing** and **Swipe typing** work fine on plain `http://` LAN links. **HTTPS** via ngrok is mainly needed for **voice-to-text on a phone** (we are not focusing on that right now, but ngrok still helps for remote HTTPS access).

Optional quick check once Relay is running:

```bash
python prototype/scripts/check_study_https_mic.py --base https://YOUR.ngrok-host
```

See **Study session** help in admin (? buttons) and **One shared server for the study** for the full checklist.

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

- medium (Messenger / Email; legacy SMS in older rows)
- input method (Typing / Swipe typing / Voice-to-text)
- prompt text, prompt condition (`prompt_formality`), and prompt ID
- reply text and response time
- keystrokes, backspaces, paste/autocomplete flags, and edit-trace summaries
- reply register from the formality model (`formality_label`, confidence, match to prompt)

For analysis I currently use:

- Server-side formality model (text classification on participant replies)
- CSV exports from admin (full or simplified)
- Optional edit-trace JSON sidecars for typing behaviour
- (Legacy `bert_*` sentiment columns remain in the schema but are blank on new rows)

I am still working on:

- Improved text correction tracking
- More consistent analysis normalization
- Merging subjective NASA-TLX ratings with logged task data

The goal is to collect experimental data for our project.

---

## What it does

The web interface lets you:

- simulate replying to messages in Messenger- and Email-style UIs
- run a **Study session** with live task updates for open participant pages
- manage a **prompt library** (formal / informal study prompts)
- track typing behaviour and response time per log row
- classify reply register (formal / informal) with the trained model
- store trial data in CSV format (+ optional edit traces)
- view, filter, chart, and export results in the admin research console

---

## Notes

This is a research prototype and is still evolving.
Some features and outputs may be inconsistent as models and logging are being refined.

---

Feedback welcome! 😊

Jocelyne M, Yusrat A. J. and Jakob Topholt
