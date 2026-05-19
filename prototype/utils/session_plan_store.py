"""Lightweight JSON store for per-participant session task order (admin-only)."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .logging_utils import normalize_study_participant_id


def _utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _path(base_dir: Path) -> Path:
    p = base_dir / "data" / "session_plans.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load_all(base_dir: Path) -> Dict[str, Any]:
    p = _path(base_dir)
    if not p.exists():
        return {"plans": {}}
    try:
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"plans": {}}
        data.setdefault("plans", {})
        return data
    except (OSError, json.JSONDecodeError):
        return {"plans": {}}


def save_all(base_dir: Path, data: Dict[str, Any]) -> None:
    p = _path(base_dir)
    with p.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def get_plan(base_dir: Path, participant_id: str) -> Dict[str, Any]:
    pid = normalize_study_participant_id(participant_id.strip())
    plans = load_all(base_dir).get("plans") or {}
    ent = plans.get(pid) or {"tasks": [], "current_index": 0}
    ent.setdefault("tasks", [])
    ent.setdefault("current_index", 0)
    ent.setdefault("updated_at", "")
    return ent


def set_plan(
    base_dir: Path,
    participant_id: str,
    tasks: List[Dict[str, Any]],
    current_index: Optional[int] = None,
) -> Dict[str, Any]:
    pid = normalize_study_participant_id(participant_id.strip())
    data = load_all(base_dir)
    plans = data.setdefault("plans", {})
    old = plans.get(pid) or {}
    cur = int(old.get("current_index") or 0)
    if current_index is not None:
        try:
            cur = int(current_index)
        except (TypeError, ValueError):
            cur = 0
    task_list = list(tasks or [])
    max_i = max(0, len(task_list) - 1)
    cur = max(0, min(cur, max_i))
    plans[pid] = {
        "tasks": task_list,
        "current_index": cur,
        "updated_at": _utc_now_iso(),
    }
    save_all(base_dir, data)
    return plans[pid]


def advance_plan(base_dir: Path, participant_id: str) -> Optional[Dict[str, Any]]:
    """Increment current_index by at most one if there is a next task. Returns updated plan or None."""
    pid = normalize_study_participant_id(participant_id.strip())
    data = load_all(base_dir)
    plans = data.setdefault("plans", {})
    ent = plans.get(pid) or {"tasks": [], "current_index": 0}
    tasks: List = list(ent.get("tasks") or [])
    idx = int(ent.get("current_index") or 0)
    if idx + 1 >= len(tasks):
        return None
    ent = {"tasks": tasks, "current_index": idx + 1, "updated_at": _utc_now_iso()}
    plans[pid] = ent
    save_all(base_dir, data)
    return ent


def get_current_task_payload(base_dir: Path, participant_id: str) -> Dict[str, Any]:
    """Public read of the active plan task (for participant polling)."""
    ent = get_plan(base_dir, participant_id)
    tasks: List = list(ent.get("tasks") or [])
    idx = int(ent.get("current_index") or 0)
    version = str(ent.get("updated_at") or "").strip()
    if not tasks:
        return {
            "plan_version": version,
            "current_index": 0,
            "task_count": 0,
            "task": None,
        }
    idx = max(0, min(idx, len(tasks) - 1))
    task = tasks[idx]
    if not version:
        blob = json.dumps(task, sort_keys=True, separators=(",", ":"))
        version = "legacy-" + hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]
    return {
        "plan_version": version,
        "current_index": idx,
        "task_count": len(tasks),
        "task": task,
    }
