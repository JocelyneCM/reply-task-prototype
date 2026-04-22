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
