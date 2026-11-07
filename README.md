# Agent Mission Control

**Watch multiple AutoClaw agents work on one real codebase — live.**

File tree lights up when an agent edits a path. Agents think out loud, throw
personality "barks" on screen, collide, resolve, and merge — while you (or
anyone you share the URL with) watch.

This is a tool, not a mockup. Point it at your actual project. Send real
agents. The events you see are the events that happened.

```
┌──────────┬───────────────────────────┬──────────┐
│ FILE TREE│  CODEBASE HEAT (treemap)  │  ROSTER  │
│  heat    │                           │  avatars │
│          ├───────────────────────────┤  barks   │
│          │      EVENT STREAM         │          │
└──────────┴───────────────────────────┴──────────┘
```

Built for **Built with AutoClaw — Round 3** · Open Creation track.  
And for anyone running a multi-agent crew on a real repo.

---

## 60-second start (your repo, not a sample)

Zero dependencies. Node 20+.

```bash
git clone <this-repo> agent-mission-control
cd agent-mission-control
chmod +x mulai.sh
./mulai.sh /path/to/your/project
```

Dashboard opens at `http://localhost:4826`.  
Every file write under that path appears as `FS WATCH` — that is already
real telemetry, no agents required.

## Wire real AutoClaw agents

Any agent that can run a shell command can join. Give each one a role and
this contract:

```bash
# start
curl -s "http://localhost:4826/api/event?type=agent_start&agent=refactorer&task=your+task"

# after every file write
curl -s "http://localhost:4826/api/event?type=file_edit&agent=refactorer&file=src/app.js"

# personality
curl -s "http://localhost:4826/api/event?type=bark&agent=refactorer&text=this+function+is+400+lines."

# done
curl -s "http://localhost:4826/api/event?type=agent_done&agent=refactorer"
```

POST JSON also works (and supports batches):

```bash
curl -X POST http://localhost:4826/api/event \
  -H 'content-type: application/json' \
  -d '{"events":[{"type":"file_edit","agent":"tester","file":"tests/app.test.js"}]}'
```

### Roles that already have faces

| Agent id | Face | Voice |
|---|---|---|
| `refactorer` | chisel, amber | perfectionist, offended by legacy code |
| `tester` | magnifying glass, green | paranoid, ritualistic about coverage |
| `scribe` | quill, blue | poetic, treats docs as archaeology |
| `reviewer` | arms crossed, pink | sarcastic senior dev |

Add a new role by sending any `agent` id — it still shows up, just without
a photo.

### Conflict detection (the point)

Two different agents touching the **same file** within 20 seconds produce a
`conflict` event and a red banner. That is not decorative. That is how you
find out your crew is stepping on each other.

## Share it (same Wi-Fi / tailnet / tunnel)

If you want event writes to require a shared secret, export `MC_TOKEN` from
the environment before starting the server. You can generate one with
`openssl rand -hex 16`. The dashboard (read-only SSE) stays open. Writers
then pass that secret in the query string or in a custom header.

To let a friend across the internet watch:

```bash
npx localtunnel --port 4826
# or
ssh -R 80:localhost:4826 nokey@remotemoe.io
# or put it behind Caddy/nginx
```

Send them the URL. They see the war-room. They cannot write events unless
they also have the shared secret.

## Optional: GitHub webhook

Point a repo webhook at:

```
http://your-host:4826/api/github
```

Push events become `file_edit` from agent `github`. Useful as a truth layer
next to agent self-reports.

## Full event types

| type | fields | what it does |
|---|---|---|
| `agent_start` | `agent`, `task?` | put operator on the roster |
| `file_edit` | `agent`, `file` | light up a path (also detects conflicts) |
| `thought` | `agent`, `text` | internal monologue on the card |
| `bark` | `agent`, `text` | personality toast |
| `test_run` | `agent`, `status` (`ok`\|`fail`), `text?` | test status |
| `merge` | `agent`, `file?`, `text?` | work landed |
| `agent_done` | `agent` | operator signed off |
| `conflict` | `agent`, `file`, `text?`, `meta.with?` | usually emitted by the server |

Every run is persisted to `events/*.jsonl`. That log is the audit trail.

Replay a run:

```bash
node server.js --replay events/real-run-clean.jsonl
```

## One-shot report after a run

```bash
node report.js
```

Prints agents, edits, conflicts, barks, test results — paste into a PR
description or an X thread.

## Use it on CI / another machine

Run the server with `HOST=0.0.0.0` and, if you want writes locked, `MC_TOKEN`
taken from your secret store. There is no build step, no database, no
framework. Copy the folder, run `node server.js`. That is the whole deploy.

---

## Files that matter

```
agent-mission-control/
├── server.js         # HTTP + SSE + conflict detection + fs watch + webhook
├── report.js         # post-run summary
├── cli.js            # human-friendly injector (optional)
├── mulai.sh          # start + open browser
├── public/           # the dashboard (avatars included)
└── events/           # JSONL audit trail
```

`demo-repo/` next to this folder was the first live target. Delete it if you
do not need a sample. Your real work does not live here.

## License

MIT — fork it, point it at your messiest real repo, and let the agents bark.

---

Built with AutoClaw. Round 3. Open Creation.
