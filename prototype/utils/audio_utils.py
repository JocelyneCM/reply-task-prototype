"""
audio_utils.py
--------------

Audio‑related helpers for the research prototype.

This module:
* Exposes the static/audio directory used for storing uploaded recordings.
* Wraps Whisper speech‑to‑text so that server.py can call a single function
  without worrying about model configuration details.

Whisper is optional. If it cannot load, audio still works but transcripts are empty.
"""

from __future__ import annotations

from pathlib import Path
import shutil

WHISPER_ERROR: str = ""
FFMPEG_AVAILABLE: bool = bool(shutil.which("ffmpeg"))

try:
    import whisper  # type: ignore

    _whisper_model = whisper.load_model("base")
    WHISPER_AVAILABLE: bool = True
except Exception:  # pragma: no cover - environment dependent
    whisper = None  # type: ignore
    _whisper_model = None
    WHISPER_AVAILABLE = False
    try:
        import traceback

        WHISPER_ERROR = traceback.format_exc(limit=1).strip()
    except Exception:
        WHISPER_ERROR = "Whisper import/model load failed."


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
AUDIO_DIR = STATIC_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


def transcribe_audio_file(path: Path) -> str:
    """
    Transcribe an audio file using Whisper and return the recognised text.

    If Whisper is not available, an empty string is returned. Callers should
    check WHISPER_AVAILABLE if they need to distinguish this case.
    """
    if not WHISPER_AVAILABLE or _whisper_model is None:
        return ""
    if not path.exists():
        return ""

    # Default Whisper settings are enough for short study clips.
    result = _whisper_model.transcribe(str(path))
    text = result.get("text") or ""
    return text.strip()

