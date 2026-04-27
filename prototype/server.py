"""
server.py
---------

Flask backend for the reply‑writing research prototype.

Responsibilities:
* Serve separate participant and admin UIs.
* Accept text and audio replies from participants.
 * Run NLP analysis (formality model, BERT sentiment, rule‑based style).
* Transcribe audio replies with Whisper (if available).
* Log all trials into CSV files under data/logs and data/participants.
* Expose JSON APIs used by the admin dashboard for filtering and CSV download.

The code is written to be production‑quality for a prototype:
* All critical paths are guarded with try/except so the app does not crash
  if optional models are unavailable (e.g., BERT, Whisper).
* Optional components clearly report their availability in /api/health.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import csv
import json
import os
from collections import Counter, defaultdict

from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    render_template,
    request,
    send_file,
)
# Use package-relative imports when running as `python -m prototype.server`.
# This keeps imports deterministic when the package is imported by tests.
from .utils.logging_utils import (
    ensure_base_directories,
    get_global_log_path,
    log_trial_row,
    log_run_row,
    load_logs_for_admin,
    list_participants_with_data,
)
from .utils.analysis_utils import (
    analyze_full_text,
    BERT_AVAILABLE,
)
from .utils.audio_utils import (
    AUDIO_DIR,
    transcribe_audio_file,
    WHISPER_AVAILABLE,
    FFMPEG_AVAILABLE,
    WHISPER_ERROR,
)


BASE_DIR = Path(__file__).resolve().parent
ensure_base_directories(BASE_DIR)

# Voice prompt files for participant UI (flat folders only; no subpaths).
VOICE_PROMPT_SUFFIXES = frozenset({".mp3", ".wav", ".m4a", ".ogg", ".webm"})

# Demo-safe prompt library for participant text media + researcher control.
# This is intentionally in-memory (non-persistent) for meeting stability.
TEXT_PROMPT_LIBRARY: List[Dict[str, str]] = [
    {
        "id": "prompt_001",
        "sms": "Hi! Can you help me with something today?",
        "messenger": "Hey! Can you help me with something today?",
        "email_from": "someone@example.com",
        "email_subject": "Quick question",
        "email_body": "Hi! Can you help me with something today?",
    },
    {
        "id": "prompt_002",
        "sms": "Can you quickly review this plan before 5?",
        "messenger": "Could you glance at this plan before 5?",
        "email_from": "teammate@example.com",
        "email_subject": "Quick plan review",
        "email_body": "Hi! Could you review this plan and share feedback before 5 PM?",
    },
    {
        "id": "prompt_003",
        "sms": "Are you free to help me prep for tomorrow?",
        "messenger": "Any chance you can help me prep for tomorrow?",
        "email_from": "colleague@example.com",
        "email_subject": "Preparation help",
        "email_body": "Hello, are you available to help me prepare for tomorrow's meeting?",
    },
]
NEXT_TEXT_PROMPT_ID: Optional[str] = None
NEXT_TEXT_PROMPT_CUSTOM: Optional[Dict[str, str]] = None


def _pick_prompt_by_id(prompt_id: str) -> Optional[Dict[str, str]]:
    for p in TEXT_PROMPT_LIBRARY:
        if p.get("id") == prompt_id:
            return p
    return None


def _pick_text_prompt_bundle(consume_override: bool) -> Dict[str, str]:
    """Return one text prompt bundle. Can consume one one-shot admin override."""
    global NEXT_TEXT_PROMPT_ID, NEXT_TEXT_PROMPT_CUSTOM
    prompt: Optional[Dict[str, str]] = None
    source = "random"
    if NEXT_TEXT_PROMPT_CUSTOM:
        prompt = dict(NEXT_TEXT_PROMPT_CUSTOM)
        source = "admin_custom_next"
        if consume_override:
            NEXT_TEXT_PROMPT_CUSTOM = None
    elif NEXT_TEXT_PROMPT_ID:
        prompt = _pick_prompt_by_id(NEXT_TEXT_PROMPT_ID)
        if prompt is not None:
            source = "admin_selected_next"
        if consume_override:
            NEXT_TEXT_PROMPT_ID = None
    if prompt is None:
        # Stable fallback if random fails for any reason.
        import random

        prompt = random.choice(TEXT_PROMPT_LIBRARY) if TEXT_PROMPT_LIBRARY else None
    if not prompt:
        return {
            "id": "prompt_default",
            "sms": "Hi! Can you help me with something today?",
            "messenger": "Hey! Can you help me with something today?",
            "email_from": "someone@example.com",
            "email_subject": "Quick question",
            "email_body": "Hi! Can you help me with something today?",
            "source": source,
        }
    out = dict(prompt)
    out["source"] = source
    return out


def derive_prompt_metadata(prompt_text: str) -> Dict[str, str]:
    """
    Simple prompt tags for admin review.
    This is rule-based so we can swap in a model later.
    """
    text = (prompt_text or "").strip()
    lower = text.lower()

    # Determine formality using the trained model (preferred).
    formality = ""
    try:
        formality = analyze_full_text(text).get("formality_label", "") if text else ""
    except Exception:
        formality = ""
    tone = "neutral"
    seriousness = "medium"

    if any(k in lower for k in ["urgent", "asap", "immediately", "before 5", "deadline"]):
        tone = "urgent"
        seriousness = "high"
    elif any(k in lower for k in ["sorry", "apolog", "regret"]):
        tone = "apologetic"
    elif any(k in lower for k in ["dear", "regards", "sincerely"]):
        tone = "professional"
    elif any(k in lower for k in ["hello", "hi", "hey", "thank", "please"]):
        tone = "friendly"
    elif any(k in lower for k in ["meeting", "review", "prepare", "plan"]):
        tone = "serious"
        seriousness = "high"

    if any(k in lower for k in ["quick", "small", "tiny", "short"]) and seriousness != "high":
        seriousness = "low"
    elif len(text.split()) > 18 and seriousness != "high":
        seriousness = "high"

    return {
        "prompt_tone": tone,
        "prompt_seriousness": seriousness,
        "prompt_formality": formality,
    }


def normalize_bert_label(raw_label: str) -> str:
    """
    Keep one stable BERT label set for admin display.
    """
    s = (raw_label or "").strip().lower()
    if not s:
        return "ok"
    if "unavailable" in s or s == "ok":
        return "ok"
    if "positive" in s:
        return "positive"
    if "negative" in s:
        return "negative"
    if "neutral" in s:
        return "neutral"
    import re

    m = re.search(r"([1-5])\s*star", s)
    if m:
        n = int(m.group(1))
        if n <= 2:
            return "negative"
        if n == 3:
            return "neutral"
        return "positive"
    return "ok"


def collect_voice_prompts() -> List[Dict[str, str]]:
    """
    Discover prompt audio for the voice task. Order: VoiceFiles → audio/mp3 → static/audio/prompts.
    Each entry: { "url": str, "filename": str }.
    """
    items: List[Dict[str, str]] = []
    seen_urls: set = set()

    def add_folder(folder: Path, url_prefix: str) -> None:
        if not folder.is_dir():
            return
        for path in sorted(folder.iterdir()):
            if not path.is_file():
                continue
            if path.suffix.lower() not in VOICE_PROMPT_SUFFIXES:
                continue
            url = f"{url_prefix}{path.name}"
            if url in seen_urls:
                continue
            seen_urls.add(url)
            items.append({"url": url, "filename": path.name})

    add_folder(BASE_DIR / "VoiceFiles", "/voice-prompt/VoiceFiles/")
    add_folder(BASE_DIR / "audio" / "mp3", "/voice-prompt/audio_mp3/")
    add_folder(BASE_DIR / "static" / "audio" / "prompts", "/static/audio/prompts/")
    return items


def _send_voice_prompt_file(root: Path, filename: str) -> Response:
    """Serve one file from root; basename only (no path traversal)."""
    root_resolved = root.resolve()
    if not root_resolved.is_dir():
        abort(404)
    # Reject any path separators or traversal in the URL segment.
    if filename != Path(filename).name or ".." in filename:
        abort(404)
    target = (root_resolved / filename).resolve()
    if target.parent != root_resolved:
        abort(404)
    if not target.is_file():
        abort(404)
    if target.suffix.lower() not in VOICE_PROMPT_SUFFIXES:
        abort(404)
    return send_file(target)


app = Flask(
    __name__,
    static_folder=str(BASE_DIR / "static"),
    template_folder=str(BASE_DIR / "templates"),
)


# ---------------------------------------------------------------------------
# HTML ROUTES
# ---------------------------------------------------------------------------

@app.get("/")
def participant_page() -> str:
    """
    Main entry point for participants.

    The participant UI hides all research / admin controls and simulates
    realistic messaging apps for SMS, Messenger, Email and voice messages.
    """
    return render_template(
        "participant.html",
        voice_prompts=collect_voice_prompts(),
    )


@app.get("/voice-prompt/VoiceFiles/<filename>")
def voice_prompt_voicefiles(filename: str) -> Response:
    """Serve prompt audio from project VoiceFiles/ (flat directory)."""
    return _send_voice_prompt_file(BASE_DIR / "VoiceFiles", filename)


@app.get("/voice-prompt/audio_mp3/<filename>")
def voice_prompt_audio_mp3(filename: str) -> Response:
    """Serve prompt audio from project audio/mp3/ (flat directory)."""
    return _send_voice_prompt_file(BASE_DIR / "audio" / "mp3", filename)


@app.get("/admin")
def admin_page() -> str:
    """
    Admin / researcher dashboard.

    Shows participant list, filters, visualisations and CSV download controls.
    """
    return render_template("admin.html")


# ---------------------------------------------------------------------------
# HEALTH / CONFIG ENDPOINTS
# ---------------------------------------------------------------------------

@app.get("/api/health")
def api_health() -> Response:
    """
    Simple health probe used by the front‑end to confirm the backend is up.

    Also reports availability of optional NLP / audio components so the UI
    can toggle related controls.
    """
    payload = {
        "ok": True,
        "bert_ok": BERT_AVAILABLE,
        "whisper_ok": WHISPER_AVAILABLE,
        "ffmpeg_ok": FFMPEG_AVAILABLE,
        "whisper_error": WHISPER_ERROR,
    }
    return jsonify(payload)


@app.get("/api/config")
def api_config() -> Response:
    """
    Return basic configuration for the front‑end.

    Currently this is minimal but keeps the door open for later extensions
    (e.g., per‑study settings loaded from a JSON file).
    """
    config = {
        "media_types": ["SMS", "Messenger", "Email", "Voice"],
        "default_medium": "SMS",
        "analysis_models": {
            "formality_model": True,
            "bert": BERT_AVAILABLE,
        },
    }
    return jsonify(config)


@app.get("/api/prompt_bundle")
def api_prompt_bundle() -> Response:
    """
    Return one text prompt bundle plus current voice prompt pool.

    Query parameter:
        - consume=1 to consume one-shot admin override for next exercise.
    """
    consume = request.args.get("consume", "0") == "1"
    return jsonify(
        {
            "ok": True,
            "text_bundle": _pick_text_prompt_bundle(consume_override=consume),
            "voice_prompts": collect_voice_prompts(),
        }
    )


@app.get("/api/prompt_pool")
def api_prompt_pool() -> Response:
    """Admin-facing prompt pool and current one-shot override state."""
    return jsonify(
        {
            "ok": True,
            "text_prompts": TEXT_PROMPT_LIBRARY,
            "next_text_prompt_id": NEXT_TEXT_PROMPT_ID or "",
            "next_text_prompt_custom": NEXT_TEXT_PROMPT_CUSTOM or {},
            "voice_prompts": collect_voice_prompts(),
        }
    )


@app.post("/api/prompt_pool/next")
def api_prompt_pool_next() -> Response:
    """Set or clear one-shot next prompt (library ID or custom text)."""
    global NEXT_TEXT_PROMPT_ID, NEXT_TEXT_PROMPT_CUSTOM
    payload: Dict[str, Any] = request.get_json(force=True) or {}
    prompt_id = (payload.get("text_prompt_id") or "").strip()
    custom_sms = (payload.get("custom_sms") or "").strip()
    custom_messenger = (payload.get("custom_messenger") or "").strip()
    custom_email_subject = (payload.get("custom_email_subject") or "").strip()
    custom_email_body = (payload.get("custom_email_body") or "").strip()
    custom_email_from = (payload.get("custom_email_from") or "researcher@example.com").strip()

    if custom_sms or custom_messenger or custom_email_subject or custom_email_body:
        NEXT_TEXT_PROMPT_ID = None
        NEXT_TEXT_PROMPT_CUSTOM = {
            "id": "prompt_custom_next",
            "sms": custom_sms or custom_messenger or custom_email_body or "Please respond.",
            "messenger": custom_messenger
            or custom_sms
            or custom_email_body
            or "Please respond.",
            "email_from": custom_email_from,
            "email_subject": custom_email_subject or "Prompt",
            "email_body": custom_email_body or custom_sms or custom_messenger or "Please respond.",
        }
        return jsonify(
            {
                "ok": True,
                "next_text_prompt_id": "",
                "next_text_prompt_custom": NEXT_TEXT_PROMPT_CUSTOM,
            }
        )

    if not prompt_id:
        NEXT_TEXT_PROMPT_ID = None
        NEXT_TEXT_PROMPT_CUSTOM = None
        return jsonify({"ok": True, "next_text_prompt_id": "", "next_text_prompt_custom": {}})
    if _pick_prompt_by_id(prompt_id) is None:
        return jsonify({"ok": False, "error": "Unknown prompt id"}), 400
    NEXT_TEXT_PROMPT_CUSTOM = None
    NEXT_TEXT_PROMPT_ID = prompt_id
    return jsonify(
        {
            "ok": True,
            "next_text_prompt_id": NEXT_TEXT_PROMPT_ID,
            "next_text_prompt_custom": {},
        }
    )


@app.post("/api/prompt_audio_upload")
def api_prompt_audio_upload() -> Response:
    """
    Upload a voice prompt audio file for admin use.
    File is saved under static/audio/prompts so participant voice mode can pick it.
    """
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No audio file provided."}), 400
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"ok": False, "error": "Empty filename."}), 400
    ext = Path(file.filename).suffix.lower()
    if ext not in VOICE_PROMPT_SUFFIXES:
        return jsonify({"ok": False, "error": "Unsupported audio format."}), 400
    target_dir = BASE_DIR / "static" / "audio" / "prompts"
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"admin_prompt_{stamp}{ext}"
    out = target_dir / filename
    file.save(out)
    return jsonify({"ok": True, "filename": filename, "url": f"/static/audio/prompts/{filename}"})


# ---------------------------------------------------------------------------
# PARTICIPANT: AUDIO UPLOAD + TRANSCRIPTION
# ---------------------------------------------------------------------------

@app.post("/api/upload_audio")
def api_upload_audio() -> Response:
    """
    Receive an uploaded audio reply from the participant.

    Expected form‑data:
        - file: audio blob recorded in the browser (WebM/OGG/WAV etc.)

    The file is stored under static/audio with a timestamped name.
    If Whisper is available, a transcript is generated; otherwise the
    transcript field is an empty string.
    """
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No audio file provided."}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"ok": False, "error": "Empty filename."}), 400

    # Store with a timestamped name to avoid collisions.
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    extension = Path(file.filename).suffix or ".webm"
    filename = f"reply_{timestamp}{extension}"
    audio_path = AUDIO_DIR / filename
    file.save(audio_path)

    transcript: str = ""
    transcript_status: str = "not_attempted"
    if WHISPER_AVAILABLE:
        try:
            transcript = transcribe_audio_file(audio_path)
            transcript_status = "ok" if transcript.strip() else "empty"
        except Exception as exc:  # pragma: no cover - safeguard
            # Transcription failures should not crash the trial.
            transcript = ""
            transcript_status = "transcription_failed"
            app.logger.exception("Whisper transcription failed: %s", exc)
    else:
        transcript_status = "ffmpeg_missing" if not FFMPEG_AVAILABLE else "whisper_unavailable"

    return jsonify(
        {
            "ok": True,
            "audio_filename": filename,
            "transcript": transcript,
            "transcript_status": transcript_status,
            "transcript_source": "whisper" if transcript_status == "ok" else "",
            "whisper_ok": WHISPER_AVAILABLE,
            "ffmpeg_ok": FFMPEG_AVAILABLE,
        }
    )


@app.get("/static/audio/<path:filename>")
def serve_audio(filename: str) -> Response:
    """
    Serve stored audio files from the static/audio directory.

    This is mainly used by the admin dashboard and for playback in the UI.
    """
    file_path = AUDIO_DIR / filename
    if not file_path.exists():
        return jsonify({"ok": False, "error": "Audio file not found."}), 404
    return send_file(file_path)


# ---------------------------------------------------------------------------
# PARTICIPANT: TEXT / AUDIO REPLY LOGGING + ANALYSIS
# ---------------------------------------------------------------------------

@app.post("/api/log_reply")
def api_log_reply() -> Response:
    """
    Core endpoint called by the participant UI for every sent reply.

    Expected JSON body:
        {
          "participant_id": "P001",
          "medium": "SMS" | "Messenger" | "Email" | "Voice",
          "input_method": "Keyboard" | "Speech" | ...,
          "prompt_text": "...",
          "reply_text": "...",          # may be empty for pure‑audio replies
          "audio_filename": "file.webm" # optional
          "response_time_seconds": float,
          "keypress_count": int,
          "backspace_count": int,
          "paste_used": bool,
          "correction_applied": bool,
          "prompt_style": str,
          "ui_style_label": str        # style based only on heuristics
        }

    The backend:
        * Optionally runs Whisper on the audio (if transcript was not already
          sent by the front‑end).
        * Runs the formality model and BERT sentiment models on the final text.
        * Classifies style (formal / informal / neutral) using rule‑based
          heuristics on the reply text.
        * Logs a single row into data/logs/sentiment_log_web.csv and a
          participant‑specific CSV file.
    """
    try:
        payload: Dict[str, Any] = request.get_json(force=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body."}), 400

    participant_id: str = (payload.get("participant_id") or "UNKNOWN").strip()
    medium: str = (payload.get("medium") or "SMS").strip()
    input_method: str = (payload.get("input_method") or "Keyboard").strip()
    prompt_text: str = (payload.get("prompt_text") or "").strip()
    reply_text: str = (payload.get("reply_text") or "").strip()
    audio_filename: str = (payload.get("audio_filename") or "").strip()
    client_transcript: str = (payload.get("transcript") or "").strip()

    # Timing / behaviour metrics
    response_time_seconds: float = float(payload.get("response_time_seconds") or 0.0)
    keypress_count: int = int(payload.get("keypress_count") or 0)
    backspace_count: int = int(payload.get("backspace_count") or 0)
    paste_used: bool = bool(payload.get("paste_used") or False)
    correction_applied: bool = bool(payload.get("correction_applied") or False)

    # If no transcript came from the browser but we have an audio filename,
    # attempt to transcribe it here.
    transcript: str = client_transcript
    if not transcript and audio_filename:
        audio_path = AUDIO_DIR / audio_filename
        if WHISPER_AVAILABLE and audio_path.exists():
            try:
                transcript = transcribe_audio_file(audio_path)
            except Exception as exc:  # pragma: no cover - safeguard
                transcript = ""
                app.logger.exception("Whisper transcription failed: %s", exc)

    # Analysis input rule:
    # - Voice: prefer transcript when available (it reflects recognized speech).
    #          if transcript is missing, fall back to reply_text.
    # - SMS/Messenger/Email: prefer reply_text (typed user text), then transcript fallback.
    if medium == "Voice":
        final_text_for_analysis = transcript or reply_text
    else:
        final_text_for_analysis = reply_text or transcript

    # Run sentiment analysis.
    analysis = analyze_full_text(final_text_for_analysis)
    bert_raw = str(analysis.get("bert_label", "") or "")
    bert_normalized = normalize_bert_label(bert_raw)

    # Use the trained formality model for reply style/formality.
    style_label = analysis.get("formality_label", "")

    # Also analyze the prompt text so we can record prompt formality/style.
    try:
        prompt_analysis = analyze_full_text(prompt_text) if prompt_text else {"formality_label": ""}
    except Exception:
        prompt_analysis = {"formality_label": ""}

    # Build log row strictly following the requested schema.
    row = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "participant_id": participant_id,
        "medium": medium,
        "input_method": input_method,
        "prompt_text": prompt_text,
        "reply_text": reply_text,
        "transcript": transcript,
        "response_time_seconds": response_time_seconds,
        "keypress_count": keypress_count,
        "backspace_count": backspace_count,
        "paste_used": "yes" if paste_used else "no",
        "correction_applied": "yes" if correction_applied else "no",
        # Keep prompt metadata explicit for admin prompt interpretation.
        "prompt_style": payload.get("prompt_style") or prompt_analysis.get("formality_label", ""),
        "prompt_tone": (payload.get("prompt_tone") or "").strip(),
        "prompt_seriousness": (payload.get("prompt_seriousness") or "").strip(),
        "prompt_formality": (payload.get("prompt_formality") or "").strip(),
        "reply_style": style_label,
        "reply_analysis_status": "ok",
        "reply_analysis_basis": (
            "transcript"
            if (medium == "Voice" and transcript)
            else ("reply_text" if reply_text else ("transcript" if transcript else "none"))
        ),
        "transcript_status": (payload.get("transcript_status") or "").strip(),
        "transcript_source": (payload.get("transcript_source") or "").strip()
        or ("upload_api" if client_transcript else ("api_log_reply_fallback" if transcript else "")),
        "formality_label": analysis.get("formality_label", ""),
        "formality_confidence": analysis.get("formality_confidence", 0.0),
        "bert_label": bert_normalized,
        "bert_raw": bert_raw,
        "bert_confidence": analysis["bert_confidence"],
        "audio_filename": audio_filename,
    }

    # Fill prompt tags if the front-end did not send them.
    if not row["prompt_tone"] or not row["prompt_seriousness"] or not row["prompt_formality"]:
        meta = derive_prompt_metadata(prompt_text)
        row["prompt_tone"] = row["prompt_tone"] or meta["prompt_tone"]
        row["prompt_seriousness"] = row["prompt_seriousness"] or meta["prompt_seriousness"]
        row["prompt_formality"] = row["prompt_formality"] or meta["prompt_formality"]

    # If we have no text to analyze, mark it clearly instead of guessing.
    if not final_text_for_analysis:
        row["reply_analysis_status"] = "unavailable_missing_text_or_transcript"
        row["reply_style"] = ""
        row["formality_label"] = ""
        row["formality_confidence"] = ""
        row["bert_label"] = "ok"
        row["bert_raw"] = "unavailable"
        row["bert_confidence"] = ""

    # Persist to global + per‑participant CSV files.
    # Compute whether user's reply roughly matches prompt formality.
    try:
        prompt_analysis = analyze_full_text(prompt_text)
        reply_analysis = analyze_full_text(final_text_for_analysis)
        p_label = (prompt_analysis.get("formality_label") or "").lower()
        r_label = (reply_analysis.get("formality_label") or "").lower()

        def _formality_match(a: str, b: str) -> bool:
            if not a or not b:
                return False
            if a == b:
                return True
            if a == "neutral" or b == "neutral":
                return True
            return False

        row["formality_match_prompt_reply"] = "yes" if _formality_match(p_label, r_label) else "no"
    except Exception:
        row["formality_match_prompt_reply"] = ""

    log_trial_row(BASE_DIR, row)

    return jsonify({"ok": True, "analysis": analysis, "style_label": style_label})


@app.post("/api/analyze_formality")
def api_analyze_formality() -> Response:
    """Analyze multiple pieces of text for formality and BERT sentiment.

    Expected JSON keys (all optional): `prompt_text`, `reply_text`, `llm_reply_text`, `final_text`.
    Returns individual analyses and simple formality-match flags.
    """
    try:
        payload: Dict[str, Any] = request.get_json(force=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body."}), 400

    keys = ["prompt_text", "reply_text", "llm_reply_text", "final_text"]
    analyses: Dict[str, Dict[str, Any]] = {}
    for k in keys:
        t = (payload.get(k) or "")
        analyses[k] = analyze_full_text(t)

    def _match(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
        al = (a.get("formality_label") or "").lower()
        bl = (b.get("formality_label") or "").lower()
        if not al or not bl:
            return False
        if al == bl:
            return True
        if al == "neutral" or bl == "neutral":
            return True
        return False

    matches = {
        "prompt_reply": _match(analyses["prompt_text"], analyses["reply_text"]),
        "reply_llm": _match(analyses["reply_text"], analyses["llm_reply_text"]),
        "llm_final": _match(analyses["llm_reply_text"], analyses["final_text"]),
    }

    conversation_ok = all(v for v in matches.values() if isinstance(v, bool))

    return jsonify({"ok": True, "analyses": analyses, "matches": matches, "conversation_formality_ok": conversation_ok})


@app.post("/api/generate_reply")
def api_generate_reply() -> Response:
    """Generate a reply using a configured LLM API key.

    Payload: { prompt_text, user_reply, target_formality (optional) }
    If an OpenAI key is available (env or keys.json), calls the Chat Completions API.
    Otherwise returns a simple fallback reply.
    """
    try:
        payload: Dict[str, Any] = request.get_json(force=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body."}), 400

    prompt_text = (payload.get("prompt_text") or "")
    user_reply = (payload.get("user_reply") or "")
    target_formality = (payload.get("target_formality") or "")
    # Optional LLM settings
    try:
        temperature = float(payload.get("temperature", 0.6))
    except Exception:
        temperature = 0.6
    try:
        max_tokens = int(payload.get("max_tokens", 256))
    except Exception:
        max_tokens = 256

    # Locate keys.json (repo root) and environment overrides.
    key_path_candidates = [BASE_DIR.parent / "keys.json", BASE_DIR / "keys.json"]
    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENAI_KEY")
    if not api_key:
        for p in key_path_candidates:
            try:
                if p.exists():
                    j = json.loads(p.read_text())
                    # use OPENAI key
                    api_key = j.get("openai_api_key") or api_key
                    break
            except Exception:
                continue

    # Optional participant logging parameters
    participant_id = (payload.get("participant_id") or "").strip()
    medium = (payload.get("medium") or "LLM").strip()

    # Attempt OpenAI Chat completion if we have a key.
    if api_key:
        try:
            import requests

            system = "You are a helpful assistant. Match the requested formality where possible."
            user_content = f"Prompt: {prompt_text}\nUser reply: {user_reply}\nGenerate a single reply that continues the conversation."
            if target_formality:
                user_content += f"\nDesired formality: {target_formality}"

            body = {
                "model": "gpt-3.5-turbo",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_content},
                ],
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            r = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=body, timeout=30)
            r.raise_for_status()
            data = r.json()
            reply_text = data["choices"][0]["message"]["content"].strip()

            # Analyze generated reply for formality and sentiment
            try:
                llm_analysis = analyze_full_text(reply_text)
            except Exception:
                llm_analysis = {"formality_label": "", "formality_confidence": 0.0, "bert_label": "neutral", "bert_confidence": 0.0}

            def _formality_match(target: str, label: str) -> bool:
                ta = (target or "").strip().lower()
                la = (label or "").strip().lower()
                if not ta or not la:
                    return False
                if ta == la:
                    return True
                if ta == "neutral" or la == "neutral":
                    return True
                return False

            matches_target = _formality_match(target_formality, llm_analysis.get("formality_label", ""))

            # Optionally log the generated reply as a trial row when a participant_id is provided.
            if participant_id:
                try:
                    try:
                        prompt_analysis = analyze_full_text(prompt_text) if prompt_text else {"formality_label": ""}
                    except Exception:
                        prompt_analysis = {"formality_label": ""}
                    row = {
                        "timestamp": datetime.now().isoformat(timespec="seconds"),
                        "participant_id": participant_id,
                        "medium": medium,
                        "input_method": "LLM",
                        "prompt_text": prompt_text,
                        "reply_text": reply_text,
                        "transcript": "",
                        "response_time_seconds": 0,
                        "keypress_count": 0,
                        "backspace_count": 0,
                        "paste_used": "no",
                        "correction_applied": "no",
                        "prompt_style": payload.get("prompt_style") or prompt_analysis.get("formality_label", ""),
                        "prompt_tone": payload.get("prompt_tone") or "",
                        "prompt_seriousness": payload.get("prompt_seriousness") or "",
                        "prompt_formality": payload.get("target_formality") or "",
                        "reply_style": llm_analysis.get("formality_label", ""),
                        "reply_analysis_status": "ok",
                        "reply_analysis_basis": "llm_reply",
                        "transcript_status": "",
                        "transcript_source": "",
                        "formality_label": llm_analysis.get("formality_label", ""),
                        "formality_confidence": llm_analysis.get("formality_confidence", 0.0),
                        "bert_label": llm_analysis.get("bert_label", ""),
                        "bert_raw": llm_analysis.get("bert_label", ""),
                        "bert_confidence": llm_analysis.get("bert_confidence", 0.0),
                        "audio_filename": "",
                    }
                    log_trial_row(BASE_DIR, row)
                except Exception:
                    app.logger.exception("Failed to log LLM-generated reply for %s", participant_id)

            return jsonify({
                "ok": True,
                "reply": reply_text,
                "analysis": llm_analysis,
                "matches_target_formality": matches_target,
                "meta": {"provider": "openai", "model": data.get("model")},
            })
        except Exception as exc:  # pragma: no cover - best-effort
            app.logger.exception("LLM call failed: %s", exc)

    # Fallback heuristic reply if no LLM is configured or call fails.
    # Fallback heuristic reply if no LLM is configured or call fails.
    fallback = f"Thanks — I can help with that. Can you clarify what you mean by: '{user_reply[:120]}'?"
    try:
        fallback_analysis = analyze_full_text(fallback)
    except Exception:
        fallback_analysis = {"formality_label": "", "formality_confidence": 0.0, "bert_label": "neutral", "bert_confidence": 0.0}

    # Log fallback reply if participant_id provided.
    if participant_id:
        try:
            try:
                prompt_analysis = analyze_full_text(prompt_text) if prompt_text else {"formality_label": ""}
            except Exception:
                prompt_analysis = {"formality_label": ""}
            row = {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "participant_id": participant_id,
                "medium": medium,
                "input_method": "LLM",
                "prompt_text": prompt_text,
                "reply_text": fallback,
                "transcript": "",
                "response_time_seconds": 0,
                "keypress_count": 0,
                "backspace_count": 0,
                "paste_used": "no",
                "correction_applied": "no",
                "prompt_style": payload.get("prompt_style") or prompt_analysis.get("formality_label", ""),
                "prompt_tone": payload.get("prompt_tone") or "",
                "prompt_seriousness": payload.get("prompt_seriousness") or "",
                "prompt_formality": payload.get("target_formality") or "",
                "reply_style": fallback_analysis.get("formality_label", ""),
                "reply_analysis_status": "ok",
                "reply_analysis_basis": "llm_reply",
                "transcript_status": "",
                "transcript_source": "",
                "formality_label": fallback_analysis.get("formality_label", ""),
                "formality_confidence": fallback_analysis.get("formality_confidence", 0.0),
                "bert_label": fallback_analysis.get("bert_label", ""),
                "bert_raw": fallback_analysis.get("bert_label", ""),
                "bert_confidence": fallback_analysis.get("bert_confidence", 0.0),
                "audio_filename": "",
            }
            log_trial_row(BASE_DIR, row)
        except Exception:
            app.logger.exception("Failed to log fallback LLM reply for %s", participant_id)

    return jsonify({
        "ok": True,
        "reply": fallback,
        "analysis": fallback_analysis,
        "matches_target_formality": (target_formality == "" or fallback_analysis.get("formality_label", "") == target_formality),
        "meta": {"provider": "fallback"},
    })



@app.post("/api/log_run")
def api_log_run() -> Response:
    """Accept a full conversation run and write a single per-run CSV.

    Expected JSON keys:
        - participant_id, medium, input_method
        - prompt_text, reply_text, llm_reply_text, final_text
        - response_time_seconds, keypress_count, backspace_count,
          paste_used, correction_applied, prompt_tone, prompt_seriousness,
          prompt_formality, notes
    """
    try:
        payload: Dict[str, Any] = request.get_json(force=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body."}), 400

    participant_id = (payload.get("participant_id") or "UNKNOWN").strip()
    medium = (payload.get("medium") or "SMS").strip()
    input_method = (payload.get("input_method") or "Keyboard").strip()

    prompt_text = (payload.get("prompt_text") or "").strip()
    reply_text = (payload.get("reply_text") or "").strip()
    llm_reply_text = (payload.get("llm_reply_text") or "").strip()
    final_text = (payload.get("final_text") or "").strip()

    response_time_seconds = float(payload.get("response_time_seconds") or 0.0)
    keypress_count = int(payload.get("keypress_count") or 0)
    backspace_count = int(payload.get("backspace_count") or 0)
    paste_used = bool(payload.get("paste_used") or False)
    correction_applied = bool(payload.get("correction_applied") or False)

    # Analyze each text for formality / BERT.
    try:
        prompt_analysis = analyze_full_text(prompt_text)
    except Exception:
        prompt_analysis = {"formality_label": "", "formality_confidence": 0.0, "bert_label": "", "bert_confidence": 0.0}
    try:
        reply_analysis = analyze_full_text(reply_text)
    except Exception:
        reply_analysis = {"formality_label": "", "formality_confidence": 0.0, "bert_label": "", "bert_confidence": 0.0}
    try:
        llm_analysis = analyze_full_text(llm_reply_text)
    except Exception:
        llm_analysis = {"formality_label": "", "formality_confidence": 0.0, "bert_label": "", "bert_confidence": 0.0}
    try:
        final_analysis = analyze_full_text(final_text)
    except Exception:
        final_analysis = {"formality_label": "", "formality_confidence": 0.0, "bert_label": "", "bert_confidence": 0.0}

    # Build the per-run CSV row.
    run_row: Dict[str, Any] = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "participant_id": participant_id,
        "medium": medium,
        "input_method": input_method,
        "prompt_text": prompt_text,
        "reply_text": reply_text,
        "llm_reply_text": llm_reply_text,
        "final_text": final_text,
        "prompt_formality_label": prompt_analysis.get("formality_label", ""),
        "prompt_formality_confidence": prompt_analysis.get("formality_confidence", 0.0),
        "reply_formality_label": reply_analysis.get("formality_label", ""),
        "reply_formality_confidence": reply_analysis.get("formality_confidence", 0.0),
        "llm_reply_formality_label": llm_analysis.get("formality_label", ""),
        "llm_reply_formality_confidence": llm_analysis.get("formality_confidence", 0.0),
        "final_formality_label": final_analysis.get("formality_label", ""),
        "final_formality_confidence": final_analysis.get("formality_confidence", 0.0),
        "response_time_seconds": response_time_seconds,
        "keypress_count": keypress_count,
        "backspace_count": backspace_count,
        "paste_used": "yes" if paste_used else "no",
        "correction_applied": "yes" if correction_applied else "no",
        "prompt_style": payload.get("prompt_style") or derive_prompt_metadata(prompt_text).get("prompt_formality") or "",
        "prompt_tone": payload.get("prompt_tone") or "",
        "prompt_seriousness": payload.get("prompt_seriousness") or "",
        "notes": payload.get("notes") or "",
    }

    try:
        path = log_run_row(BASE_DIR, run_row)
    except Exception:
        app.logger.exception("Failed to write run CSV")
        return jsonify({"ok": False, "error": "Failed to write run CSV"}), 500

    return jsonify({"ok": True, "run_csv": str(path.relative_to(BASE_DIR))})


# ---------------------------------------------------------------------------
# ADMIN: PARTICIPANT LIST, FILTERING, CSV DOWNLOAD
# ---------------------------------------------------------------------------

@app.get("/api/participants")
def api_participants() -> Response:
    """
    Return a simple list of participant IDs that currently have data files.
    """
    participants = list_participants_with_data(BASE_DIR)
    return jsonify({"ok": True, "participants": participants})


@app.get("/api/logs")
def api_logs() -> Response:
    """
    Return filtered results for the admin dashboard.

    Query parameters:
        - participant_id (optional)
        - medium (optional)
        - date (optional, ISO date prefix "YYYY-MM-DD")

    This endpoint is kept intentionally simple and is intended for interactive
    exploration, not bulk export (for that, use /api/download_csv).
    """
    participant_id = request.args.get("participant_id") or ""
    medium = request.args.get("medium") or ""
    date_prefix = request.args.get("date") or ""

    rows = load_logs_for_admin(
      BASE_DIR,
        participant_id=participant_id or None,
        medium=medium or None,
        date_prefix=date_prefix or None,
    )
    # Sort safely even if a row has a missing timestamp.
    rows = sorted(rows, key=lambda r: (r.get("timestamp") or ""), reverse=True)

    # Make rows safe for jsonify.
    # DictReader uses key=None when a row has more cells than the header.
    malformed_rows = 0
    overflow_cells_total = 0
    sanitized_rows: List[Dict[str, str]] = []
    for row in rows:
        clean_row: Dict[str, str] = {}
        for k, v in row.items():
            if k is None:
                # Overflow cells from malformed rows are folded into row_overflow.
                malformed_rows += 1
                if isinstance(v, list):
                    overflow_cells_total += len(v)
                    if v:
                        prior = clean_row.get("row_overflow", "")
                        joined = " | ".join("" if x is None else str(x) for x in v)
                        clean_row["row_overflow"] = (
                            f"{prior} | {joined}" if prior else joined
                        )
                continue
            key = str(k)
            clean_row[key] = "" if v is None else str(v)
        sanitized_rows.append(clean_row)

    if malformed_rows:
        app.logger.warning(
            "/api/logs sanitized malformed CSV rows: %s (overflow cells: %s)",
            malformed_rows,
            overflow_cells_total,
        )

    return jsonify({"ok": True, "rows": sanitized_rows})


@app.get("/api/admin_summary")
def api_admin_summary() -> Response:
    """
    Lightweight aggregate stats for the admin overview and participant list.

    Reads the same global CSV as /api/logs but returns counts only so the UI
    can render dashboards without transferring every row twice unnecessarily.
    """
    rows = load_logs_for_admin(BASE_DIR, None, None, None)
    by_pid: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    for row in rows:
        pid = (row.get("participant_id") or "UNKNOWN").strip() or "UNKNOWN"
        by_pid[pid].append(row)

    participant_stats: List[Dict[str, Any]] = []
    for pid in sorted(by_pid.keys()):
        pr = by_pid[pid]
        timestamps = [r.get("timestamp") or "" for r in pr]
        participant_stats.append(
            {
                "participant_id": pid,
                "trial_count": len(pr),
                "last_timestamp": max(timestamps) if timestamps else "",
            }
        )

    medium_breakdown = dict(
        Counter((r.get("medium") or "—").strip() or "—" for r in rows))
    bert_breakdown = dict(
        Counter(
            (r.get("bert_label") or "neutral").strip() or "neutral"
            for r in rows
        )
    )

    return jsonify(
        {
            "ok": True,
            "total_trials": len(rows),
            "participant_count": len(participant_stats),
            "participant_stats": participant_stats,
            "medium_breakdown": medium_breakdown,
            "bert_breakdown": bert_breakdown,
        }
    )


@app.get("/api/download_csv")
def api_download_csv() -> Response:
    """
    Allow the admin to download CSV data.

    Query parameters:
        - scope:
            * "all" (default) – global file with all participants.
            * "participant"  – single participant file
        - participant_id – required when scope=participant
    """
    scope = request.args.get("scope", "all")
    participant_id = request.args.get("participant_id", "").strip()

    if scope == "participant":
        if not participant_id:
            return jsonify(
                {"ok": False, "error": "participant_id is required for scope=participant"}
            ), 400
        csv_path = (
            BASE_DIR
            / "data"
            / "participants"
            / participant_id
            / "sentiment_log_web.csv"
        )
        download_name = f"sentiment_log_{participant_id}.csv"
    else:
        csv_path = get_global_log_path(BASE_DIR)
        download_name = "sentiment_log_all_participants.csv"

    if not csv_path.exists():
        # Return an empty CSV with headers so downstream tools still work.
        headers = [
            "timestamp",
            "participant_id",
            "medium",
            "input_method",
            "prompt_text",
            "reply_text",
            "transcript",
            "response_time_seconds",
            "keypress_count",
            "backspace_count",
            "paste_used",
            "correction_applied",
            "prompt_style",
            "prompt_tone",
            "prompt_seriousness",
            "prompt_formality",
            "reply_style",
            "reply_analysis_status",
            "reply_analysis_basis",
            "transcript_status",
            "transcript_source",
            "formality_label",
            "formality_confidence",
            "bert_label",
            "bert_raw",
            "bert_confidence",
            "audio_filename",
        ]
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)

    return send_file(
        csv_path,
        mimetype="text/csv",
        as_attachment=True,
        download_name=download_name,
    )


@app.post("/api/admin/delete_trial")
def api_admin_delete_trial() -> Response:
    """Delete one matching trial row from global and participant CSV files."""
    payload: Dict[str, Any] = request.get_json(force=True) or {}
    keys = {
        "timestamp": (payload.get("timestamp") or "").strip(),
        "participant_id": (payload.get("participant_id") or "").strip(),
        "medium": (payload.get("medium") or "").strip(),
        "prompt_text": (payload.get("prompt_text") or "").strip(),
        "reply_text": (payload.get("reply_text") or "").strip(),
        "audio_filename": (payload.get("audio_filename") or "").strip(),
    }
    if not keys["timestamp"] or not keys["participant_id"] or not keys["medium"]:
        return jsonify({"ok": False, "error": "Missing identifying fields."}), 400

    def remove_one(csv_path: Path) -> bool:
        if not csv_path.exists():
            return False
        with csv_path.open("r", newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            headers = next(reader, [])
        with csv_path.open("r", newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        if not headers:
            return False
        removed = False
        kept: List[Dict[str, str]] = []
        for row in rows:
            if not removed and all((row.get(k) or "").strip() == v for k, v in keys.items()):
                removed = True
                continue
            kept.append(row)
        if not removed:
            return False
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(kept)
        return True

    global_path = get_global_log_path(BASE_DIR)
    removed_global = remove_one(global_path)
    participant_path = (
        BASE_DIR / "data" / "participants" / keys["participant_id"] / "sentiment_log_web.csv"
    )
    if removed_global:
        remove_one(participant_path)
    return jsonify({"ok": removed_global, "deleted": removed_global})


@app.post("/api/admin/trial_detail")
def api_admin_trial_detail() -> Response:
    """
    Return an HTML snippet rendering a single trial row for admin detail view.

    Expects a JSON object mirroring a single CSV row (same keys used in /api/logs rows).
    """
    try:
        payload: Dict[str, Any] = request.get_json(force=True) or {}
    except Exception:
        return jsonify({"ok": False, "error": "Invalid JSON body."}), 400

    row = payload if isinstance(payload, dict) else {}
    # Normalize audio URL so template can render a playable src.
    audio_filename = (row.get("audio_filename") or "").strip()
    audio_url = ""
    if audio_filename:
        if audio_filename.startswith("http") or audio_filename.startswith("/"):
            audio_url = audio_filename
        else:
            audio_url = f"/static/audio/{audio_filename}"
    row["_audio_url"] = audio_url

    # Render a small Jinja template fragment so HTML generation happens server-side.
    return render_template("trial_detail_snippet.html", row=row)


@app.post("/api/admin/delete_participants")
def api_admin_delete_participants() -> Response:
    """Delete selected participants from global logs and participant folders."""
    payload: Dict[str, Any] = request.get_json(force=True) or {}
    ids = payload.get("participant_ids") or []
    participant_ids = [str(x).strip() for x in ids if str(x).strip()]
    if not participant_ids:
        return jsonify({"ok": False, "error": "No participants selected."}), 400

    global_path = get_global_log_path(BASE_DIR)
    removed_rows = 0
    if global_path.exists():
        with global_path.open("r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            headers = list(reader.fieldnames or [])
        kept = []
        for row in rows:
            if (row.get("participant_id") or "") in participant_ids:
                removed_rows += 1
            else:
                kept.append(row)
        if headers:
            with global_path.open("w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=headers)
                writer.writeheader()
                writer.writerows(kept)

    deleted_dirs = []
    for pid in participant_ids:
        pdir = BASE_DIR / "data" / "participants" / pid
        if pdir.exists():
            import shutil

            shutil.rmtree(pdir, ignore_errors=True)
            deleted_dirs.append(pid)

    return jsonify(
        {
            "ok": True,
            "removed_rows": removed_rows,
            "deleted_participant_dirs": deleted_dirs,
        }
    )


if __name__ == "__main__":
    # Keep debug mode on for local testing.
    app.run(host="0.0.0.0", port=8000, debug=True)