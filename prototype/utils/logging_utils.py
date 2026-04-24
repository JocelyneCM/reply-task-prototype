"""
logging_utils.py
----------------

Utility functions for writing trial logs to CSV files.

This module is intentionally independent of Flask so it can be reused
in offline analysis scripts if desired.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import csv
from datetime import datetime


GLOBAL_LOG_FILENAME = "sentiment_log_web.csv"


def base_data_dir(base_dir: Path) -> Path:
    """Return the absolute path to the top‑level data directory."""
    return base_dir / "data"


def logs_dir(base_dir: Path) -> Path:
    """Directory containing global log CSV files."""
    return base_data_dir(base_dir) / "logs"


def participants_dir(base_dir: Path) -> Path:
    """Directory containing per‑participant sub‑directories."""
    return base_data_dir(base_dir) / "participants"


def ensure_base_directories(base_dir: Path) -> None:
    """
    Ensure that the directory layout described in the project specification
    exists. This is safe to call multiple times.
    """
    logs_dir(base_dir).mkdir(parents=True, exist_ok=True)
    participants_dir(base_dir).mkdir(parents=True, exist_ok=True)


def get_global_log_path(base_dir: Path) -> Path:
    """Path to the global CSV log file."""
    return logs_dir(base_dir) / GLOBAL_LOG_FILENAME


def _csv_headers() -> List[str]:
    """
    Canonical order of CSV columns used both for global and per‑participant
    logs. This must stay aligned with server.py.
    """
    return [
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
        "formality_match_prompt_reply",
        "bert_label",
        "bert_raw",
        "bert_confidence",
        "audio_filename",
    ]


def _ensure_csv_with_headers(path: Path) -> None:
    """
    Ensure this CSV uses the current header schema.
    """
    headers = _csv_headers()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(headers)
        return

    # Older files may have shorter headers. Rewrite them to the current schema.
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        existing_headers = next(reader, [])
    if existing_headers == headers:
        return

    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        existing_rows = list(reader)

    migrated_rows: List[Dict[str, str]] = []
    for row in existing_rows:
        clean: Dict[str, str] = {}
        for h in headers:
            v = row.get(h, "")
            clean[h] = "" if v is None else str(v)
        migrated_rows.append(clean)

    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(migrated_rows)


def log_trial_row(base_dir: Path, row: Dict[str, Any]) -> None:
    """
    Append a single trial row to:
        * the global CSV file under data/logs
        * the participant‑specific CSV file under data/participants/<id>

    Missing fields are filled with empty strings so that all rows share
    exactly the same schema.
    """
    headers = _csv_headers()

    # Write everything as strings so CSV output stays consistent.
    def normalise_value(key: str) -> str:
        value = row.get(key, "")
        if value is None:
            return ""
        return str(value)

    serialised_row = {key: normalise_value(key) for key in headers}

    # Global log
    global_path = get_global_log_path(base_dir)
    _ensure_csv_with_headers(global_path)
    with global_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writerow(serialised_row)

    # Per‑participant log
    participant_id = serialised_row.get("participant_id") or "UNKNOWN"
    participant_dir = participants_dir(base_dir) / participant_id
    participant_path = participant_dir / GLOBAL_LOG_FILENAME
    _ensure_csv_with_headers(participant_path)
    with participant_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writerow(serialised_row)


def list_participants_with_data(base_dir: Path) -> List[str]:
    """
    Return a sorted list of participant IDs that currently have any
    participant‑specific CSV files.
    """
    root = participants_dir(base_dir)
    if not root.exists():
        return []
    participants: List[str] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        csv_path = child / GLOBAL_LOG_FILENAME
        if csv_path.exists():
            participants.append(child.name)
    participants.sort()
    return participants


def runs_dir(base_dir: Path) -> Path:
    """Directory for per-run CSV exports."""
    return base_data_dir(base_dir) / "runs"


def _run_csv_headers() -> List[str]:
    """Headers for per-run CSV files and the run summary."""
    return [
        "timestamp",
        "participant_id",
        "medium",
        "input_method",
        "prompt_text",
        "reply_text",
        "llm_reply_text",
        "final_text",
        "prompt_formality_label",
        "prompt_formality_confidence",
        "reply_formality_label",
        "reply_formality_confidence",
        "llm_reply_formality_label",
        "llm_reply_formality_confidence",
        "final_formality_label",
        "final_formality_confidence",
        "response_time_seconds",
        "keypress_count",
        "backspace_count",
        "paste_used",
        "correction_applied",
        "prompt_style",
        "prompt_tone",
        "prompt_seriousness",
        "notes",
    ]


def log_run_row(base_dir: Path, row: Dict[str, Any]) -> Path:
    """Write a per-run CSV file (one-row) and append it to run_summary.csv.

    Returns the path to the created per-run CSV file.
    """
    rd = runs_dir(base_dir)
    rd.mkdir(parents=True, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    pid = (row.get("participant_id") or "UNKNOWN").strip() or "UNKNOWN"
    fname = f"run_{ts}_{pid}.csv"
    run_path = rd / fname

    headers = _run_csv_headers()

    # Serialise a single-row CSV
    with run_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        serialised = {k: ("" if row.get(k) is None else str(row.get(k))) for k in headers}
        writer.writerow(serialised)

    # Append to summary
    summary = rd / "run_summary.csv"
    if not summary.exists():
        with summary.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=headers)
            w.writeheader()
            w.writerow(serialised)
    else:
        with summary.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=headers)
            w.writerow(serialised)

    return run_path


def load_logs_for_admin(
    base_dir: Path,
    participant_id: Optional[str] = None,
    medium: Optional[str] = None,
    date_prefix: Optional[str] = None,
) -> List[Dict[str, str]]:
    """
    Load rows from the global log CSV file and apply basic filters.

    This helper keeps the admin API implementation small and focused.
    """
    csv_path = get_global_log_path(base_dir)
    if not csv_path.exists():
        return []

    rows: List[Dict[str, str]] = []
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if participant_id and row.get("participant_id") != participant_id:
                continue
            if medium and row.get("medium") != medium:
                continue
            if date_prefix and not (row.get("timestamp") or "").startswith(date_prefix):
                continue
            rows.append(row)

    return rows

