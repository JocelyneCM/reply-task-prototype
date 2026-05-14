"""
Write bounded edit-trace sidecars under data/edit_traces/<participant_id>/<log_row_id>.json.

Traces are research aids (edit/revision behaviour), not copy-typing error rates.
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if __package__:
    from .logging_utils import base_data_dir, get_global_log_path
else:
    from logging_utils import base_data_dir, get_global_log_path  # type: ignore

_MAX_TRACE_BYTES = 750_000
_MAX_EVENTS = 200  # legacy schema_version 1 "events" array
_MAX_KEY_EVENTS = 220
_MAX_TEXT_MUTATIONS = 120
_MAX_SNAPSHOTS = 40
_LOG_ROW_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def is_valid_log_row_uuid(s: str) -> bool:
    return bool(s and _LOG_ROW_ID_RE.match(s.strip()))

_FORBIDDEN_TRACE_KEYS = {"clipboard", "clipboard_text", "clipboardText"}


def edit_traces_root(base_dir: Path) -> Path:
    return base_data_dir(base_dir) / "edit_traces"


def _clamp_int(v: Any, lo: int, hi: int) -> int:
    try:
        x = int(v)
    except (TypeError, ValueError):
        return lo
    return max(lo, min(hi, x))


def _sanitize_string_leaf(s: str, max_len: int) -> str:
    t = str(s)
    if len(t) > max_len:
        return t[:max_len]
    return t


def sanitize_trace_for_storage(raw: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """
    Return a bounded copy safe to JSON-serialize. Drops forbidden keys recursively.
    """
    errors: List[str] = []

    def walk(obj: Any, depth: int) -> Any:
        if depth > 24:
            return None
        if isinstance(obj, dict):
            out: Dict[str, Any] = {}
            for k, v in obj.items():
                kl = str(k).lower()
                if kl in _FORBIDDEN_TRACE_KEYS:
                    errors.append(f"dropped_key:{k}")
                    continue
                out[str(k)[:80]] = walk(v, depth + 1)
            return out
        if isinstance(obj, list):
            return [walk(x, depth + 1) for x in obj]
        if isinstance(obj, (int, float, bool)) or obj is None:
            return obj
        if isinstance(obj, str):
            return _sanitize_string_leaf(obj, 4000)
        return str(obj)[:4000]

    base = walk(dict(raw), 0)
    if not isinstance(base, dict):
        return {}, errors + ["invalid_root"]

    events = base.get("events")
    if isinstance(events, list):
        base["events"] = events[:_MAX_EVENTS]
    else:
        base["events"] = []

    key_ev = base.get("key_events")
    if isinstance(key_ev, list):
        base["key_events"] = key_ev[:_MAX_KEY_EVENTS]
    else:
        base["key_events"] = []

    text_mut = base.get("text_mutations")
    if isinstance(text_mut, list):
        base["text_mutations"] = text_mut[:_MAX_TEXT_MUTATIONS]
    else:
        base["text_mutations"] = []

    snaps = base.get("snapshots")
    if isinstance(snaps, list):
        base["snapshots"] = snaps[:_MAX_SNAPSHOTS]
    else:
        base["snapshots"] = []

    try:
        sv = int(base.get("schema_version") or 1)
    except (TypeError, ValueError):
        sv = 1
    if sv >= 2:
        ev = base.get("events")
        if isinstance(ev, list) and len(ev) == 0:
            base.pop("events", None)

    return base, errors


def extract_summary_for_csv(trace: Dict[str, Any]) -> Dict[str, Any]:
    """Pull numeric summary fields from client trace.metrics (already bounded)."""
    m = trace.get("metrics")
    if not isinstance(m, dict):
        m = {}
    return {
        "revision_count": _clamp_int(m.get("revision_count"), 0, 5000),
        "inserted_chars_est": _clamp_int(m.get("inserted_chars_est"), 0, 500_000),
        "deleted_chars_est": _clamp_int(m.get("deleted_chars_est"), 0, 500_000),
        "net_char_change": _clamp_int(m.get("net_char_change"), -500_000, 500_000),
        "manual_edit_chars_after_transcript_est": _clamp_int(
            m.get("manual_edit_chars_after_transcript_est"), 0, 500_000
        ),
        "voice_transcript_initial_chars": _clamp_int(
            m.get("voice_transcript_initial_chars"), 0, 500_000
        ),
    }


def write_edit_trace_sidecar(
    base_dir: Path,
    participant_id: str,
    log_row_id: str,
    trace: Dict[str, Any],
) -> Optional[str]:
    """
    Write JSON sidecar. Returns POSIX relative path data/edit_traces/... or None if skipped.
    """
    pid = (participant_id or "").strip() or "UNKNOWN"
    lid = (log_row_id or "").strip()
    if not lid or not _LOG_ROW_ID_RE.match(lid):
        return None

    safe, _errs = sanitize_trace_for_storage(trace)
    safe["log_row_id"] = lid.lower()
    safe["participant_id"] = pid

    root = edit_traces_root(base_dir)
    dest_dir = root / pid
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{lid.lower()}.json"

    raw_bytes = json.dumps(safe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(raw_bytes) > _MAX_TRACE_BYTES:
        # Last-resort shrink: drop snapshots, trim layered arrays, then legacy events.
        safe["snapshots"] = []
        safe["key_events"] = safe.get("key_events", [])[: min(_MAX_KEY_EVENTS, 100)]
        safe["text_mutations"] = safe.get("text_mutations", [])[: min(_MAX_TEXT_MUTATIONS, 80)]
        safe["events"] = safe.get("events", [])[: min(_MAX_EVENTS, 80)]
        safe["truncated_due_to_size"] = True
        raw_bytes = json.dumps(safe, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(raw_bytes) > _MAX_TRACE_BYTES:
            return None

    dest.write_bytes(raw_bytes)
    rel = f"data/edit_traces/{pid}/{lid.lower()}.json"
    return rel.replace("\\", "/")


def load_edit_trace_json(
    base_dir: Path, participant_id: str, log_row_id: str
) -> Optional[Dict[str, Any]]:
    """Load trace JSON for a participant id + UUID log row id."""
    pid = (participant_id or "").strip()
    lid = (log_row_id or "").strip().lower()
    if not pid or not lid or not _LOG_ROW_ID_RE.match(lid):
        return None
    rel = f"data/edit_traces/{pid}/{lid}.json"
    return read_edit_trace_sidecar(base_dir, rel)


def read_edit_trace_sidecar(base_dir: Path, relative_path: str) -> Optional[Dict[str, Any]]:
    """Load a trace from a repo-relative path like data/edit_traces/P001/uuid.json."""
    rel = (relative_path or "").strip().lstrip("/").replace("..", "")
    if not rel.startswith("data/edit_traces/"):
        return None
    path = (base_dir / rel).resolve()
    try:
        root = (base_dir / "data" / "edit_traces").resolve()
        path.relative_to(root)
    except ValueError:
        return None
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


# --- Admin explorer (Phase 1C): browse / ZIP export (CSV + sidecars, bounded) ---

_MAX_BROWSE_SCHEMA_SCANS = 4000
_MAX_ZIP_FILES = 100
_MAX_ZIP_SERIALIZED_BYTES = 6_000_000


def _prompt_condition_bucket(pf: str) -> str:
    """Match server.classify_prompt_condition_bucket / client promptConditionBucket."""
    x = (pf or "").strip().lower()
    if x == "formal" or x.startswith("auto:label_1"):
        return "formal"
    if x == "informal" or x.startswith("auto:label_0"):
        return "informal"
    return "other"


def trace_schema_and_layer_counts(
    trace: Optional[Dict[str, Any]],
) -> Tuple[int, Optional[int], Optional[int], int]:
    """
    Return (schema_version, key_event_count, text_mutation_count, snapshot_count).
    v1 key_event_count counts legacy keydown_special rows; text_mutation_count counts
    selected mutation-like legacy event types (approximate).
    """
    if not trace or not isinstance(trace, dict):
        return 0, None, None, 0
    try:
        sv = int(trace.get("schema_version") or 1)
    except (TypeError, ValueError):
        sv = 1
    snaps = trace.get("snapshots") if isinstance(trace.get("snapshots"), list) else []
    snap_n = len(snaps)
    if sv >= 2:
        ke = trace.get("key_events") if isinstance(trace.get("key_events"), list) else []
        tm = trace.get("text_mutations") if isinstance(trace.get("text_mutations"), list) else []
        m = trace.get("metrics") if isinstance(trace.get("metrics"), dict) else {}
        kc = m.get("key_event_count")
        mc = m.get("text_mutation_count")
        k_out: Optional[int] = int(kc) if isinstance(kc, int) else len(ke)
        m_out: Optional[int] = int(mc) if isinstance(mc, int) else len(tm)
        return sv, k_out, m_out, snap_n
    ev = trace.get("events") if isinstance(trace.get("events"), list) else []
    k_out = sum(1 for e in ev if isinstance(e, dict) and e.get("type") == "keydown_special")
    mut_types = frozenset(
        {
            "text_change",
            "voice_transcript_insert",
            "finalize_align",
            "beforeinput",
            "compositionend",
        }
    )
    m_out = sum(1 for e in ev if isinstance(e, dict) and (e.get("type") or "") in mut_types)
    return sv, k_out, m_out, snap_n


def _load_global_csv_rows(base_dir: Path) -> List[Dict[str, str]]:
    path = get_global_log_path(base_dir)
    if not path.exists():
        return []
    out: List[Dict[str, str]] = []
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not isinstance(row, dict):
                continue
            out.append({str(k): ("" if v is None else str(v)) for k, v in row.items()})
    return out


def _csv_row_matches_explorer_filters(row: Dict[str, str], filters: Dict[str, Any]) -> bool:
    if (row.get("edit_trace_available") or "").strip().lower() != "yes":
        return False

    pid = (filters.get("participant_id") or "").strip()
    if pid and (row.get("participant_id") or "").strip() != pid:
        return False

    med = (filters.get("medium") or "").strip()
    if med and (row.get("medium") or "").strip() != med:
        return False

    im = (filters.get("input_method") or "").strip()
    if im and (row.get("input_method") or "").strip() != im:
        return False

    if not filters.get("include_generated"):
        if (row.get("input_method") or "").strip() == "LLM":
            return False

    pc = (filters.get("prompt_condition") or "").strip().lower()
    if pc in ("formal", "informal"):
        if _prompt_condition_bucket(row.get("prompt_formality") or "") != pc:
            return False

    fl = (filters.get("formality_label") or "").strip()
    if fl and (row.get("formality_label") or "").strip() != fl:
        return False

    rr = (filters.get("row_role") or "").strip()
    if rr and (row.get("row_role") or "").strip().lower() != rr.lower():
        return False

    date_from = (filters.get("date_from") or "").strip()
    date_to = (filters.get("date_to") or "").strip()
    ts = (row.get("timestamp") or "").strip()
    if date_from:
        df = date_from[:10] if len(date_from) >= 10 else date_from
        if not ts or ts[:10] < df:
            return False
    if date_to:
        dt = date_to[:10] if len(date_to) >= 10 else date_to
        if not ts or ts[:10] > dt:
            return False

    return True


def browse_edit_traces(
    base_dir: Path,
    filters: Dict[str, Any],
    page: int = 1,
    page_size: int = 25,
) -> Tuple[List[Dict[str, Any]], int, List[str]]:
    """
    Filter global CSV rows (edit_trace_available=yes), optionally by schema_version
    (requires reading sidecars; bounded scan).

    Returns (table_rows, total_matching, warnings).
    Each table row merges CSV fields with trace-derived schema_version and layer counts.
    """
    warnings: List[str] = []
    page = max(1, int(page or 1))
    page_size = max(1, min(80, int(page_size or 25)))

    raw_rows = _load_global_csv_rows(base_dir)
    filtered = [r for r in raw_rows if _csv_row_matches_explorer_filters(r, filters)]

    schema_want = str(filters.get("schema_version") or "").strip().lower()
    if schema_want in ("", "all", "any"):
        schema_want = ""

    trace_cache: Dict[Tuple[str, str], Optional[Dict[str, Any]]] = {}

    def get_trace(r: Dict[str, str]) -> Optional[Dict[str, Any]]:
        pid = (r.get("participant_id") or "").strip()
        lid = (r.get("log_row_id") or "").strip().lower()
        if not pid or not lid or not is_valid_log_row_uuid(lid):
            return None
        key = (pid, lid)
        if key not in trace_cache:
            trace_cache[key] = load_edit_trace_json(base_dir, pid, lid)
        return trace_cache[key]

    narrowed: List[Dict[str, str]] = []
    if schema_want:
        scans = 0
        for r in filtered:
            if scans >= _MAX_BROWSE_SCHEMA_SCANS:
                warnings.append(
                    f"schema_filter_scan_capped_at_{_MAX_BROWSE_SCHEMA_SCANS}_rows_truncated"
                )
                break
            scans += 1
            t = get_trace(r)
            sv, _, _, _ = trace_schema_and_layer_counts(t)
            if str(sv) == schema_want:
                narrowed.append(r)
    else:
        narrowed = filtered

    total = len(narrowed)
    start = (page - 1) * page_size
    slice_rows = narrowed[start : start + page_size]

    out: List[Dict[str, Any]] = []
    for r in slice_rows:
        t = get_trace(r)
        sv, kc, mc, sc = trace_schema_and_layer_counts(t)
        reply = (r.get("reply_text") or "").strip()
        preview = reply[:120] + ("…" if len(reply) > 120 else "")
        row_out: Dict[str, Any] = dict(r)
        row_out["reply_preview"] = preview
        row_out["trace_schema_version"] = sv
        row_out["key_event_count"] = kc
        row_out["text_mutation_count"] = mc
        row_out["snapshot_count"] = sc
        row_out["trace_found"] = bool(t)
        out.append(row_out)

    return out, total, warnings


def build_edit_traces_zip(
    base_dir: Path,
    filters: Dict[str, Any],
) -> Tuple[Optional[bytes], str, List[str]]:
    """
    Build a ZIP of JSON sidecars for rows matching filters (same as browse, no pagination).
    Caps file count and approximate serialized size for safety.
    """
    warnings: List[str] = []
    raw_rows = _load_global_csv_rows(base_dir)
    filtered = [r for r in raw_rows if _csv_row_matches_explorer_filters(r, filters)]

    schema_want = str(filters.get("schema_version") or "").strip().lower()
    if schema_want in ("", "all", "any"):
        schema_want = ""

    trace_cache: Dict[Tuple[str, str], Optional[Dict[str, Any]]] = {}

    def get_trace(r: Dict[str, str]) -> Optional[Dict[str, Any]]:
        pid = (r.get("participant_id") or "").strip()
        lid = (r.get("log_row_id") or "").strip().lower()
        if not pid or not lid or not is_valid_log_row_uuid(lid):
            return None
        key = (pid, lid)
        if key not in trace_cache:
            trace_cache[key] = load_edit_trace_json(base_dir, pid, lid)
        return trace_cache[key]

    narrowed: List[Dict[str, str]] = []
    if schema_want:
        scans = 0
        for r in filtered:
            if scans >= _MAX_BROWSE_SCHEMA_SCANS:
                warnings.append(
                    f"schema_filter_scan_capped_at_{_MAX_BROWSE_SCHEMA_SCANS}_zip_incomplete"
                )
                break
            scans += 1
            t = get_trace(r)
            sv, _, _, _ = trace_schema_and_layer_counts(t)
            if str(sv) == schema_want:
                narrowed.append(r)
    else:
        narrowed = filtered

    if len(narrowed) > _MAX_ZIP_FILES:
        warnings.append(f"zip_file_cap_{_MAX_ZIP_FILES}_applied")
        narrowed = narrowed[:_MAX_ZIP_FILES]

    buf = io.BytesIO()
    total_bytes = 0
    added = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for r in narrowed:
            pid = (r.get("participant_id") or "").strip()
            lid = (r.get("log_row_id") or "").strip().lower()
            t = get_trace(r)
            if not t:
                continue
            payload = json.dumps(t, ensure_ascii=False, indent=2).encode("utf-8")
            if total_bytes + len(payload) > _MAX_ZIP_SERIALIZED_BYTES:
                warnings.append("zip_size_cap_reached")
                break
            arc = f"{pid}_{lid}.json"
            zf.writestr(arc, payload)
            total_bytes += len(payload)
            added += 1

    if added == 0:
        return None, "", warnings + ["no_trace_files_exported"]

    fname = "edit_traces_export.zip"
    return buf.getvalue(), fname, warnings
