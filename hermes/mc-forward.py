#!/usr/bin/env python3
"""Forward Hermes lifecycle events to Agent Mission Control.

Used two ways:
1. Shell hook (stdin JSON from Hermes) — post_tool_call, on_session_*, subagent_*
2. Direct: python3 mc-forward.py --event post_tool_call --json '{...}'

MC_URL defaults to http://localhost:4826/api/event
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

MC_URL = os.environ.get("MC_URL", "http://localhost:4826/api/event")
MC_TOKEN = os.environ.get("MC_TOKEN", "")


def post(payload: dict) -> None:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        MC_URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if MC_TOKEN:
        req.add_header("X-Mc-Token", MC_TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            r.read()
    except Exception:
        # never break the agent because the dashboard is down
        pass


def main() -> None:
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw and len(sys.argv) >= 3 and sys.argv[1] == "--event":
        # manual: --event NAME --json '{...}'
        name = sys.argv[2]
        body = {}
        if len(sys.argv) >= 5 and sys.argv[3] == "--json":
            try:
                body = json.loads(sys.argv[4])
            except json.JSONDecodeError:
                body = {}
        raw = json.dumps({**body, "hook_event_name": name})
    if not raw.strip():
        return
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return
    if not isinstance(payload, dict):
        return
    # already MC-shaped?
    if payload.get("type"):
        post(payload)
        return
    if not payload.get("hook_event_name"):
        return
    post(payload)


if __name__ == "__main__":
    main()
