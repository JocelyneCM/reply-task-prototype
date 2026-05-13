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
        },
    )
    assert r.status_code == 200
    assert len(calls) == 1
    row = calls[0]
    assert row["participant_id"] == "P007"
    assert row["final_reply_text"] == "Sounds good."
    assert row["prompt_formality"] == "formal"
    assert row["prompt_tone"] == ""
    assert int(row["manual_edit_count"]) >= 3
    assert row["keystrokes_per_character"] != ""
    assert "backspaces_per_word" in row
    assert "edit_activity_compact" in row


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
