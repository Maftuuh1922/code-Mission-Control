#!/usr/bin/env python3
"""Claude Code / OpenClaw hook → Agent Mission Control.

Point any hook that POSTs JSON, or that pipes JSON to stdin, at this script.
Works with:
- Claude Code settings.json hooks (PreToolUse, PostToolUse, SessionStart, Stop, UserPromptSubmit)
- OpenClaw-style agent hooks with the same shapes
- Anything that sends {"type": "..."} Mission Control events

Env: MC_URL (default http://localhost:4826/api/event), MC_TOKEN
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

MC_URL = os.environ.get("MC_URL", "http://localhost:4826/api/event")
MC_TOKEN = os.environ.get("MC_TOKEN", "")

# Map tool names that look like file edits
FILE_TOOLS = {
    "Write", "Edit", "MultiEdit", "write_file", "patch", "str_replace",
    "WriteFile", "EditFile", "apply_patch", "NotebookEdit",
}


def post(payload: dict) -> None:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        MC_URL, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    if MC_TOKEN:
        req.add_header("X-Mc-Token", MC_TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            r.read()
    except Exception:
        pass  # dashboard down must never break the agent


def main() -> None:
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw.strip():
        return
    try:
        evt = json.loads(raw)
    except json.JSONDecodeError:
        return
    if not isinstance(evt, dict):
        return

    # Pass through Mission Control events untouched
    if evt.get("type"):
        post(evt)
        return

    name = evt.get("hook_event_name") or evt.get("event") or evt.get("HookEventName") or ""
    tool = evt.get("tool_name") or evt.get("toolName") or ""
    inp = evt.get("tool_input") or evt.get("toolInput") or {}
    if not isinstance(inp, dict):
        inp = {}
    file = (
        inp.get("file_path")
        or inp.get("filePath")
        or inp.get("path")
        or inp.get("file")
        or ""
    )
    command = inp.get("command") or ""
    session = evt.get("session_id") or evt.get("sessionId") or evt.get("agent") or "openclaw"

    out = {"agent": str(session)[:40]}

    if name in ("SessionStart", "on_session_start"):
        out.update(type="agent_start", task="session started")
    elif name in ("Stop", "SessionEnd", "on_session_end"):
        out.update(type="agent_done")
    elif name in ("UserPromptSubmit", "pre_llm_call"):
        msg = inp.get("prompt") or evt.get("prompt") or evt.get("message") or ""
        out.update(type="thought", text=str(msg)[:180] or "thinking")
    elif name in ("PreToolUse", "PreToolCall", "pre_tool_call", "PostToolUse", "PostToolCall", "post_tool_call"):
        if command:
            out.update(type="thought", text=f"$ {str(command)[:160]}")
        elif file:
            out.update(type="file_edit", file=str(file))
        else:
            out.update(type="thought", text=f"{name} {tool}".strip()[:160])
    elif name:
        out.update(type="thought", text=str(name)[:120])
    else:
        return

    post(out)


if __name__ == "__main__":
    main()
