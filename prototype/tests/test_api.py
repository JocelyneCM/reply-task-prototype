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
    # No API key configured → explicit error (no fallback allowed)
    assert r.status_code == 503
    data = r.get_json()
    assert data["ok"] is False
    assert "error" in data


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

    # confirm logging was attempted
    assert len(calls) == 1
    assert calls[0]["participant_id"] == "testpid"
    assert calls[0]["reply_text"] == "Mock reply"
