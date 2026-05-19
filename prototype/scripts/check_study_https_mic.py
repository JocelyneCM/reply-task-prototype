#!/usr/bin/env python3
"""
Quick check for phone voice-to-text readiness (HTTPS / mic).

Usage:
  python -m prototype.server   # in another terminal
  python prototype/scripts/check_study_https_mic.py
  python prototype/scripts/check_study_https_mic.py --base https://YOUR.ngrok-free.app
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Relay /api/health for mic-friendly HTTPS.")
    parser.add_argument(
        "--base",
        default="http://127.0.0.1:8000",
        help="Relay base URL (use your ngrok https:// URL when testing phones)",
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    health_url = f"{base}/api/health"

    print(f"Checking {health_url}\n")
    try:
        data = fetch_json(health_url)
    except urllib.error.URLError as exc:
        print(f"FAIL: Could not reach server — {exc}")
        print("\nStart Relay:  python -m prototype.server")
        return 1

    if not data.get("ok"):
        print("FAIL: /api/health returned ok=false")
        return 1

    secure = data.get("request_is_secure")
    mic = data.get("mic_likely_available")
    whisper = data.get("whisper_ok")

    print(f"  request_is_secure:      {secure}")
    print(f"  mic_likely_available:   {mic}")
    print(f"  whisper_ok (transcribe): {whisper}")

    host = base.split("://", 1)[-1].split("/")[0].split(":")[0].lower()
    if mic and not secure and host not in {"localhost", "127.0.0.1"}:
        print("\nWARNING: Server says mic may work, but this is not HTTPS.")
        print("  Phones on Wi‑Fi still need an https:// URL (ngrok). Do not use this check on http://192.168.x.x alone.")
        return 2

    if mic:
        print("\nPASS: This origin should allow microphone prompts for voice-to-text.")
        print("Next: open a participant link with input_method=Voice-to-text on a phone and tap Mic.")
        return 0

    print("\nWARNING: Microphone is unlikely to work on this origin.")
    print("  • Use an https:// forwarding URL (e.g. ngrok http 8000)")
    print("  • Open admin + participant links on that HTTPS host")
    print("  • Typing / Swipe typing on LAN http:// is still fine")
    return 2


if __name__ == "__main__":
    sys.exit(main())
