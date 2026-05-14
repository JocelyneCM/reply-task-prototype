"""Persistent JSON store for researcher text prompt library (SMS / Messenger / Email bundles)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

_ID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_\-]{0,63}$")


def _path(base_dir: Path) -> Path:
    p = base_dir / "data" / "prompt_library.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _truthy_active(v: Any) -> bool:
    if v is False or v == 0:
        return False
    if isinstance(v, str) and v.strip().lower() in ("0", "false", "no", "inactive"):
        return False
    return True


def normalize_prompt_record(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize one library row for storage / API (no invented formality labels)."""
    pid = str(raw.get("id") or "").strip()
    kind = str(raw.get("prompt_kind") or "all").strip().lower()
    if kind not in ("all", "sms_messenger", "email"):
        kind = "all"
    pc = str(raw.get("prompt_condition") or "auto").strip().lower()
    if pc not in ("formal", "informal", "auto"):
        pc = "auto"
    return {
        "id": pid,
        "sms": str(raw.get("sms") or ""),
        "messenger": str(raw.get("messenger") or ""),
        "email_from": str(raw.get("email_from") or ""),
        "email_subject": str(raw.get("email_subject") or ""),
        "email_body": str(raw.get("email_body") or ""),
        "prompt_kind": kind,
        "prompt_condition": pc,
        "notes": str(raw.get("notes") or ""),
        "category": str(raw.get("category") or ""),
        "active": _truthy_active(raw.get("active", True)),
    }


def validate_new_id(prompt_id: str) -> Optional[str]:
    """Return error message if invalid, else None."""
    s = (prompt_id or "").strip()
    if not s:
        return "id is required."
    if not _ID_RE.match(s):
        return "id must start with a letter and use only letters, digits, _ or - (max 64 chars)."
    return None


def load_file_data(base_dir: Path) -> Dict[str, Any]:
    p = _path(base_dir)
    if not p.exists():
        return {"prompts": []}
    try:
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"prompts": []}
        data.setdefault("prompts", [])
        if not isinstance(data["prompts"], list):
            return {"prompts": []}
        return data
    except (OSError, json.JSONDecodeError):
        return {"prompts": []}


def save_file_data(base_dir: Path, data: Dict[str, Any]) -> None:
    p = _path(base_dir)
    out = {"prompts": data.get("prompts") or []}
    with p.open("w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)


def seed_file_from_builtins_if_missing(base_dir: Path, builtins: List[Dict[str, str]]) -> None:
    """Create prompt_library.json once with built-in copies. Never overwrites an existing file."""
    p = _path(base_dir)
    if p.exists():
        return
    seeded: List[Dict[str, Any]] = []
    for b in builtins:
        row = normalize_prompt_record(
            {
                "id": b.get("id", ""),
                "sms": b.get("sms", ""),
                "messenger": b.get("messenger", ""),
                "email_from": b.get("email_from", ""),
                "email_subject": b.get("email_subject", ""),
                "email_body": b.get("email_body", ""),
                "prompt_kind": "all",
                "prompt_condition": "auto",
                "notes": "",
                "category": "",
                "active": True,
            }
        )
        if row["id"]:
            seeded.append(row)
    save_file_data(base_dir, {"prompts": seeded})


def merge_builtin_with_file(
    builtin: Dict[str, str], file_row: Optional[Dict[str, Any]]
) -> Dict[str, Any]:
    base = {k: str(v) if v is not None else "" for k, v in dict(builtin).items()}
    if not file_row:
        base["prompt_kind"] = "all"
        base["prompt_condition"] = "auto"
        base["notes"] = ""
        base["category"] = ""
        base["active"] = True
        base["_source"] = "builtin"
        return base
    n = normalize_prompt_record({**base, **file_row})
    n["_source"] = "file_overlay"
    return n


def get_merged_library(
    base_dir: Path, builtins: List[Dict[str, str]], active_only: bool = False
) -> List[Dict[str, Any]]:
    """
    Merge builtins with file rows by id; append file-only ids.
    If the JSON file is missing, it is created once from builtins. An existing file
    (even with an empty prompt list) is left as-is; merge then falls back to builtins.
    """
    seed_file_from_builtins_if_missing(base_dir, builtins)
    raw = load_file_data(base_dir)
    file_rows: List[Dict[str, Any]] = [
        normalize_prompt_record(x) for x in (raw.get("prompts") or []) if isinstance(x, dict)
    ]
    by_id: Dict[str, Dict[str, Any]] = {str(r["id"]): r for r in file_rows if r.get("id")}

    out: List[Dict[str, Any]] = []
    builtin_ids = {str(b.get("id")) for b in builtins if b.get("id")}

    for b in builtins:
        bid = str(b.get("id") or "")
        if not bid:
            continue
        merged = merge_builtin_with_file(b, by_id.get(bid))
        if active_only and not merged.get("active", True):
            continue
        out.append(merged)

    for r in file_rows:
        rid = str(r.get("id") or "")
        if rid and rid not in builtin_ids:
            row = dict(r)
            row["_source"] = "file_only"
            if active_only and not row.get("active", True):
                continue
            out.append(row)
    return out


def list_file_prompts_after_seed(base_dir: Path, builtins: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    seed_file_from_builtins_if_missing(base_dir, builtins)
    return [
        normalize_prompt_record(x)
        for x in load_file_data(base_dir).get("prompts") or []
        if isinstance(x, dict)
    ]


def get_by_id_merged(
    base_dir: Path, builtins: List[Dict[str, str]], prompt_id: str
) -> Optional[Dict[str, Any]]:
    pid = (prompt_id or "").strip()
    if not pid:
        return None
    for row in get_merged_library(base_dir, builtins, active_only=False):
        if str(row.get("id")) == pid and row.get("active", True):
            return row
    return None


def upsert_prompt(base_dir: Path, builtins: List[Dict[str, str]], record: Dict[str, Any]) -> Dict[str, Any]:
    seed_file_from_builtins_if_missing(base_dir, builtins)
    row = normalize_prompt_record(record)
    if not row["id"]:
        raise ValueError("Missing id")
    err = validate_new_id(row["id"])
    if err:
        raise ValueError(err)
    data = load_file_data(base_dir)
    prompts: List[Dict[str, Any]] = [
        normalize_prompt_record(x) for x in (data.get("prompts") or []) if isinstance(x, dict)
    ]
    replaced = False
    for i, p in enumerate(prompts):
        if str(p.get("id")) == row["id"]:
            prompts[i] = row
            replaced = True
            break
    if not replaced:
        prompts.append(row)
    save_file_data(base_dir, {"prompts": prompts})
    return row


def delete_prompt_by_id(base_dir: Path, builtins: List[Dict[str, str]], prompt_id: str) -> bool:
    """Remove from file. Builtin ids reappear as pure builtin on next merge."""
    seed_file_from_builtins_if_missing(base_dir, builtins)
    pid = (prompt_id or "").strip()
    if not pid:
        return False
    data = load_file_data(base_dir)
    prompts = [x for x in (data.get("prompts") or []) if isinstance(x, dict) and str(x.get("id")) != pid]
    if len(prompts) == len(data.get("prompts") or []):
        return False
    save_file_data(base_dir, {"prompts": prompts})
    return True


def bundle_dict_from_library_row(row: Dict[str, Any], source: str) -> Dict[str, str]:
    """Shape expected by participant applyTextPromptScenario / logging."""
    out: Dict[str, str] = {
        "id": str(row.get("id") or ""),
        "sms": str(row.get("sms") or ""),
        "messenger": str(row.get("messenger") or ""),
        "email_from": str(row.get("email_from") or ""),
        "email_subject": str(row.get("email_subject") or ""),
        "email_body": str(row.get("email_body") or ""),
        "source": source,
    }
    pc = str(row.get("prompt_condition") or "auto").strip().lower()
    if pc in ("formal", "informal"):
        out["prompt_formality"] = pc
    return out
