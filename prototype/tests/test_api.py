import csv
import json
import pytest

from prototype import server as srv


@pytest.fixture
def client():
    srv.app.config.update({"TESTING": True})
    with srv.app.test_client() as c:
        yield c


def test_analyze_formality_empty(client):
    r = client.post("/api/analyze_formality", json={"prompt_text": "", "reply_text": ""})
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert "analyses" in data


def test_generate_reply_fallback_and_log(client, tmp_path):
    # Call generate_reply without API key; pass a participant_id so it should log.
    payload = {"prompt_text": "Hello", "user_reply": "Hi", "participant_id": "TEST_PID"}
    r = client.post("/api/generate_reply", json=payload)
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert "reply" in data


def test_generate_reply_mocked(monkeypatch, client):
    """Mock external LLM call and capture logging without writing files."""
    # Patch requests.post so the server does not perform a real network call.
    import requests

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": "Mock reply"}}], "model": "gpt-3.5-turbo"}

    def fake_post(*args, **kwargs):
        return FakeResponse()

    monkeypatch.setattr(requests, "post", fake_post)

    # Capture calls to log_trial_row to avoid filesystem writes
    from prototype import server as srv

    calls = []

    def fake_log(base_dir, row):
        calls.append(row)

    monkeypatch.setattr(srv, "log_trial_row", fake_log)

    # Ensure code enters the LLM branch
    monkeypatch.setenv("OPENAI_API_KEY", "fake-key")

    r = client.post(
        "/api/generate_reply",
        json={"prompt_text": "Prompt text", "user_reply": "User reply", "participant_id": "testpid"},
    )
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("ok") is True
    assert data.get("reply") == "Mock reply"

    # Successful OpenAI responses no longer log trial rows here (client logs generated rows).
    assert len(calls) == 0


def test_participants_includes_suggested_next(client):
    r = client.get("/api/participants")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("ok") is True
    assert "participants" in data
    assert "suggested_next_participant_id" in data
    sid = (data.get("suggested_next_participant_id") or "").strip()
    assert sid.startswith("P")
    assert len(sid) >= 4


def test_download_csv_rejects_non_stable_participant_id(client):
    r = client.get("/api/download_csv?scope=participant&participant_id=NotAnId")
    assert r.status_code == 400


def test_log_reply_final_reply_and_metrics(monkeypatch, client):
    calls = []

    def fake_log(base_dir, row):
        calls.append(row)

    def fake_analyze(text):
        return {
            "formality_label": "LABEL_1",
            "formality_confidence": 0.5,
            "bert_label": "neutral",
            "bert_confidence": 0.12,
        }

    monkeypatch.setattr(srv, "log_trial_row", fake_log)
    monkeypatch.setattr(srv, "analyze_full_text", fake_analyze)

    r = client.post(
        "/api/log_reply",
        json={
            "participant_id": "p7",
            "medium": "SMS",
            "input_method": "Typing",
            "prompt_text": "Hello there",
            "reply_text": "Sounds good.",
            "response_time_seconds": 2.0,
            "keypress_count": 14,
            "backspace_count": 1,
            "paste_used": True,
            "correction_applied": True,
            "participant_turn": "final",
            "prompt_formality": "formal",
            "prompt_id": "prompt_002",
            "prompt_source": "url_param",
        },
    )
    assert r.status_code == 200
    assert len(calls) == 1
    row = calls[0]
    assert row["participant_id"] == "P007"
    assert row["final_reply_text"] == "Sounds good."
    assert row["prompt_formality"] == "formal"
    assert row["prompt_id"] == "prompt_002"
    assert row["prompt_source"] == "url_param"
    assert row["prompt_tone"] == ""
    assert int(row["manual_edit_count"]) >= 3
    assert row["keystrokes_per_character"] != ""
    assert "backspaces_per_word" in row
    assert "edit_activity_compact" in row
    assert "log_row_id" in row


def test_admin_session_plan_save_and_advance(client, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    r = client.get("/api/admin/session_plan?participant_id=P001")
    assert r.status_code == 200
    body = r.get_json()
    assert body.get("ok") is True
    assert body.get("plan", {}).get("tasks") == []
    r2 = client.post(
        "/api/admin/session_plan",
        json={
            "participant_id": "P001",
            "tasks": [
                {"medium": "SMS", "input_method": "Typing"},
                {"medium": "SMS", "input_method": "Swipe typing"},
            ],
        },
    )
    assert r2.status_code == 200
    d2 = r2.get_json()
    assert d2.get("ok") is True
    assert len(d2.get("plan", {}).get("tasks", [])) == 2
    r3 = client.post("/api/admin/session_plan/advance", json={"participant_id": "P001"})
    assert r3.status_code == 200
    d3 = r3.get_json()
    assert d3.get("ok") is True
    assert d3.get("done") is False
    assert d3.get("plan", {}).get("current_index") == 1
    r4 = client.post("/api/admin/session_plan/advance", json={"participant_id": "P001"})
    d4 = r4.get_json()
    assert d4.get("done") is True


def test_session_plan_current_for_participant_polling(client, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    r0 = client.get("/api/session_plan/current?participant_id=P005")
    assert r0.status_code == 200
    d0 = r0.get_json()
    assert d0.get("ok") is True
    assert d0.get("task") is None
    r1 = client.post(
        "/api/admin/session_plan",
        json={
            "participant_id": "P005",
            "tasks": [
                {
                    "medium": "Email",
                    "input_method": "Typing",
                    "device": "laptop",
                    "prompt_condition": "formal",
                    "prompt_pick": "selected",
                    "text_prompt_id": "prompt_001",
                }
            ],
        },
    )
    assert r1.status_code == 200
    version1 = r1.get_json().get("plan", {}).get("updated_at")
    assert version1
    r2 = client.get("/api/session_plan/current?participant_id=P005")
    d2 = r2.get_json()
    assert d2.get("ok") is True
    assert d2.get("plan_version") == version1
    assert d2.get("task", {}).get("medium") == "Email"
    assert d2.get("task", {}).get("device") == "laptop"
    r3 = client.post(
        "/api/admin/session_plan",
        json={
            "participant_id": "P005",
            "tasks": [
                {
                    "medium": "Messenger",
                    "input_method": "Swipe typing",
                    "device": "phone",
                }
            ],
        },
    )
    version2 = r3.get_json().get("plan", {}).get("updated_at")
    assert version2
    r4 = client.get("/api/session_plan/current?participant_id=P005")
    d4 = r4.get_json()
    assert d4.get("task", {}).get("medium") == "Messenger"
    assert d4.get("plan_version") == version2


def test_admin_session_plan_save_clamps_current_index(client, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    r = client.post(
        "/api/admin/session_plan",
        json={
            "participant_id": "P002",
            "tasks": [
                {"medium": "SMS", "input_method": "Typing"},
                {"medium": "Email", "input_method": "Typing"},
            ],
            "current_index": 99,
        },
    )
    assert r.status_code == 200
    d = r.get_json()
    assert d.get("ok") is True
    assert d.get("plan", {}).get("current_index") == 1


def test_prompt_library_seed_and_pool(client, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    r = client.get("/api/prompt_pool")
    assert r.status_code == 200
    body = r.get_json()
    assert body.get("ok") is True
    prompts = body.get("text_prompts") or []
    assert len(prompts) >= 3
    assert (tmp_path / "data" / "prompt_library.json").is_file()


def test_prompt_bundle_text_prompt_id_param(client, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    client.get("/api/prompt_pool")
    r = client.get("/api/prompt_bundle?consume=0&text_prompt_id=prompt_002")
    assert r.status_code == 200
    b = r.get_json().get("text_bundle") or {}
    assert b.get("id") == "prompt_002"
    assert b.get("source") == "url_param"


def test_admin_prompt_library_crud(client, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    client.get("/api/prompt_pool")
    r = client.post(
        "/api/admin/prompt_library",
        json={
            "id": "prompt_zeta",
            "sms": "Z sms",
            "messenger": "Z msg",
            "email_from": "z@study.local",
            "email_subject": "Z subj",
            "email_body": "Z body",
            "prompt_kind": "all",
            "prompt_condition": "formal",
            "notes": "n",
            "category": "c",
            "active": True,
        },
    )
    assert r.status_code == 200
    r2 = client.get("/api/admin/prompt_library?q=zeta")
    assert r2.status_code == 200
    rows = r2.get_json().get("prompts") or []
    assert any((x.get("id") == "prompt_zeta") for x in rows)
    r3 = client.put(
        "/api/admin/prompt_library/prompt_zeta",
        json={
            "id": "prompt_zeta",
            "sms": "Z sms2",
            "messenger": "Z msg2",
            "email_from": "z@study.local",
            "email_subject": "Z subj",
            "email_body": "Z body",
            "prompt_condition": "informal",
            "notes": "",
            "category": "",
            "active": False,
        },
    )
    assert r3.status_code == 200
    lib_path = tmp_path / "data" / "prompt_library.json"
    saved = json.loads(lib_path.read_text(encoding="utf-8"))
    zeta = next(p for p in saved["prompts"] if p["id"] == "prompt_zeta")
    assert zeta["prompt_condition"] == "informal"
    r4 = client.delete("/api/admin/prompt_library/prompt_zeta")
    assert r4.status_code == 200


def test_log_reply_writes_edit_trace_sidecar(monkeypatch, client, tmp_path):
    import uuid

    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    from prototype.utils.logging_utils import ensure_base_directories

    ensure_base_directories(tmp_path)

    def fake_analyze(text):
        return {
            "formality_label": "LABEL_1",
            "formality_confidence": 0.5,
            "bert_label": "neutral",
            "bert_confidence": 0.12,
        }

    monkeypatch.setattr(srv, "analyze_full_text", fake_analyze)
    lid = str(uuid.uuid4())
    trace = {
        "schema_version": 1,
        "log_row_id": lid,
        "metrics": {
            "revision_count": 2,
            "inserted_chars_est": 10,
            "deleted_chars_est": 1,
            "net_char_change": 9,
            "manual_edit_chars_after_transcript_est": 0,
            "voice_transcript_initial_chars": 0,
        },
        "events": [{"type": "session_start", "tMs": 1}],
        "snapshots": [],
    }
    r = client.post(
        "/api/log_reply",
        json={
            "participant_id": "P001",
            "medium": "SMS",
            "input_method": "Typing",
            "prompt_text": "Hello",
            "reply_text": "Hello back",
            "log_row_id": lid,
            "edit_trace": trace,
            "response_time_seconds": 1.0,
            "keypress_count": 5,
            "backspace_count": 0,
            "paste_used": False,
            "correction_applied": False,
        },
    )
    assert r.status_code == 200
    sidecar = tmp_path / "data" / "edit_traces" / "P001" / f"{lid.lower()}.json"
    assert sidecar.is_file()


def test_download_edit_trace(monkeypatch, client, tmp_path):
    import uuid

    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    from prototype.utils.logging_utils import ensure_base_directories

    ensure_base_directories(tmp_path)

    def fake_analyze(text):
        return {
            "formality_label": "LABEL_1",
            "formality_confidence": 0.5,
            "bert_label": "neutral",
            "bert_confidence": 0.12,
        }

    monkeypatch.setattr(srv, "analyze_full_text", fake_analyze)
    lid = str(uuid.uuid4())
    trace = {
        "schema_version": 1,
        "log_row_id": lid,
        "metrics": {
            "revision_count": 0,
            "inserted_chars_est": 3,
            "deleted_chars_est": 0,
            "net_char_change": 3,
            "manual_edit_chars_after_transcript_est": 0,
            "voice_transcript_initial_chars": 0,
        },
        "events": [],
        "snapshots": [],
    }
    client.post(
        "/api/log_reply",
        json={
            "participant_id": "P002",
            "medium": "Messenger",
            "input_method": "Typing",
            "prompt_text": "X",
            "reply_text": "Y",
            "log_row_id": lid,
            "edit_trace": trace,
            "response_time_seconds": 1.0,
            "keypress_count": 1,
            "backspace_count": 0,
            "paste_used": False,
            "correction_applied": False,
        },
    )
    r = client.get(f"/api/download_edit_trace?participant_id=P002&log_row_id={lid}")
    assert r.status_code == 200
    assert b"schema_version" in r.data


def test_log_reply_writes_schema_v2_edit_trace_sidecar(monkeypatch, client, tmp_path):
    import uuid

    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    from prototype.utils.logging_utils import ensure_base_directories

    ensure_base_directories(tmp_path)

    def fake_analyze(text):
        return {
            "formality_label": "LABEL_1",
            "formality_confidence": 0.5,
            "bert_label": "neutral",
            "bert_confidence": 0.12,
        }

    monkeypatch.setattr(srv, "analyze_full_text", fake_analyze)
    lid = str(uuid.uuid4())
    trace = {
        "schema_version": 2,
        "log_row_id": lid,
        "metrics": {
            "revision_count": 0,
            "inserted_chars_est": 1,
            "deleted_chars_est": 0,
            "net_char_change": 1,
            "manual_edit_chars_after_transcript_est": 0,
            "voice_transcript_initial_chars": 0,
            "key_event_count": 2,
            "text_mutation_count": 1,
            "snapshot_count": 0,
        },
        "key_events": [{"type": "keydown", "t": 0, "key": "a", "code": "KeyA"}],
        "text_mutations": [{"kind": "value_diff", "t": 1, "ins": 1, "del": 0, "len": 1}],
        "snapshots": [],
    }
    r = client.post(
        "/api/log_reply",
        json={
            "participant_id": "P001",
            "medium": "Email",
            "input_method": "Typing",
            "prompt_text": "Hello",
            "reply_text": "a",
            "log_row_id": lid,
            "edit_trace": trace,
            "response_time_seconds": 1.0,
            "keypress_count": 1,
            "backspace_count": 0,
            "paste_used": False,
            "correction_applied": False,
        },
    )
    assert r.status_code == 200
    sidecar = tmp_path / "data" / "edit_traces" / "P001" / f"{lid.lower()}.json"
    assert sidecar.is_file()
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    assert data.get("schema_version") == 2
    assert isinstance(data.get("key_events"), list)
    assert isinstance(data.get("text_mutations"), list)
    assert "events" not in data


def test_admin_trial_detail_includes_edit_trace_layers(monkeypatch, client, tmp_path):
    import uuid

    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    from prototype.utils.logging_utils import ensure_base_directories

    ensure_base_directories(tmp_path)
    lid = str(uuid.uuid4())
    pid = "P001"
    trace = {
        "schema_version": 2,
        "log_row_id": lid.lower(),
        "participant_id": pid,
        "metrics": {"revision_count": 0},
        "key_events": [{"type": "send", "t": 5, "source": "enter_chat_submit"}],
        "text_mutations": [{"kind": "trace_session", "t": 0}],
        "snapshots": [],
    }
    dest = tmp_path / "data" / "edit_traces" / pid / f"{lid.lower()}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(trace), encoding="utf-8")

    r = client.post(
        "/api/admin/trial_detail",
        json={
            "timestamp": "2026-01-01T00:00:00",
            "participant_id": pid,
            "participant_display": pid,
            "log_row_id": lid,
            "edit_trace_available": "yes",
            "medium": "SMS",
            "input_method": "Typing",
            "reply_text": "Hi",
            "prompt_text": "Yo",
        },
    )
    assert r.status_code == 200
    html = r.get_data(as_text=True)
    assert "Keystrokes / edit trace" in html
    assert "key_events" in html
    assert "download_edit_trace" in html


def _write_global_log_row_with_trace(tmp_path, monkeypatch, lid: str, pid: str = "P099"):
    monkeypatch.setattr(srv, "BASE_DIR", tmp_path)
    from prototype.utils.logging_utils import _csv_headers, ensure_base_directories, get_global_log_path

    ensure_base_directories(tmp_path)
    headers = _csv_headers()
    row = {h: "" for h in headers}
    row.update(
        {
            "timestamp": "2026-05-13T12:00:00",
            "participant_id": pid,
            "medium": "SMS",
            "input_method": "Typing",
            "row_role": "participant_reply",
            "prompt_formality": "formal",
            "formality_label": "LABEL_1",
            "reply_text": "Hello there",
            "response_time_seconds": "12.5",
            "revision_count": "1",
            "edit_trace_available": "yes",
            "log_row_id": lid,
            "edit_trace_path": f"data/edit_traces/{pid}/{lid.lower()}.json",
        }
    )
    global_path = get_global_log_path(tmp_path)
    global_path.parent.mkdir(parents=True, exist_ok=True)
    with global_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        w.writerow(row)
    trace = {
        "schema_version": 2,
        "log_row_id": lid.lower(),
        "metrics": {"revision_count": 1, "key_event_count": 3, "text_mutation_count": 2},
        "key_events": [{"type": "keydown", "t": 1}],
        "text_mutations": [{"kind": "value_diff", "t": 2}],
        "snapshots": [],
    }
    dest = tmp_path / "data" / "edit_traces" / pid / f"{lid.lower()}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(trace), encoding="utf-8")


def test_admin_edit_traces_browse(monkeypatch, client, tmp_path):
    import uuid

    lid = str(uuid.uuid4())
    _write_global_log_row_with_trace(tmp_path, monkeypatch, lid)
    r = client.post("/api/admin/edit_traces/browse", json={"page": 1, "page_size": 25})
    assert r.status_code == 200
    d = r.get_json()
    assert d.get("ok") is True
    assert d.get("total") == 1
    assert len(d.get("rows") or []) == 1
    row = d["rows"][0]
    assert row.get("trace_schema_version") == 2
    assert row.get("key_event_count") == 3
    assert "reply_preview" in row


def test_admin_edit_trace_json_get(monkeypatch, client, tmp_path):
    import uuid

    lid = str(uuid.uuid4())
    _write_global_log_row_with_trace(tmp_path, monkeypatch, lid)
    r = client.get(f"/api/admin/edit_trace_json?participant_id=P099&log_row_id={lid}")
    assert r.status_code == 200
    d = r.get_json()
    assert d.get("ok") is True
    assert d.get("trace", {}).get("schema_version") == 2


def test_admin_edit_traces_export_zip(monkeypatch, client, tmp_path):
    import uuid

    lid = str(uuid.uuid4())
    _write_global_log_row_with_trace(tmp_path, monkeypatch, lid)
    r = client.post("/api/admin/edit_traces/export_zip", json={})
    assert r.status_code == 200
    assert r.data[:2] == b"PK"
