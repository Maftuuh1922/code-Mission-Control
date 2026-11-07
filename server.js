#!/usr/bin/env node
/**
 * Agent Mission Control — zero-dependency event server + dashboard host.
 *
 * Agents POST events to /api/event.
 * Dashboard consumes SSE at /api/stream and snapshot at /api/state.
 *
 * Optional flags:
 *   --port 4826
 *   --repo ./demo-repo        (fs.watch mirror of file activity)
 *   --replay path/to/events.jsonl
 */
import http from 'node:http'
import zlib from 'node:zlib'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'public')
const EVENT_LOG_DIR = path.join(__dirname, 'events')
const DEFAULT_PORT = 4826

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { port: DEFAULT_PORT, repo: null, replay: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') out.port = Number(argv[++i]) || DEFAULT_PORT
    else if (a === '--repo') out.repo = argv[++i]
    else if (a === '--replay') out.replay = argv[++i]
  }
  return out
}
const args = parseArgs(process.argv)
const TOKEN = process.env.MC_TOKEN?.trim() || ''
const HOST = process.env.HOST || '0.0.0.0'

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const MAX_MEMORY_EVENTS = 2000
const CONFLICT_WINDOW_MS = 20_000
const AGENT_TIMEOUT_MS = 45_000

/** @type {Array<any>} */
const events = []
let eventId = 0
let missionStart = null

/** @type {Map<string, any>} */
const agents = new Map()
/** @type {Map<string, any>} */
const files = new Map()
/** @type {Array<any>} */
const conflicts = []
/** @type {Array<any>} */
const merges = []
/** @type {Set<http.ServerResponse>} */
const sseClients = new Set()

const ROLE_META = {
  refactorer: { label: 'REFACTOR', color: '#ffb454', role: 'Refactorer' },
  tester: { label: 'TESTER', color: '#3fb950', role: 'Test Writer' },
  scribe: { label: 'SCRIBE', color: '#58a6ff', role: 'Docs Writer' },
  reviewer: { label: 'REVIEWER', color: '#f778ba', role: 'Reviewer' },
  coordinator: { label: 'COORD', color: '#d2a8ff', role: 'Coordinator' },
}

function now() {
  return Date.now()
}

function defaultRole(agentId) {
  const key = String(agentId || '').toLowerCase()
  return ROLE_META[key] || { label: key.toUpperCase() || 'AGENT', color: '#8b949e', role: 'Agent' }
}

function pushEvent(evt) {
  const e = {
    id: ++eventId,
    ts: now(),
    ...evt,
  }
  if (!missionStart && e.type !== 'boot') missionStart = e.ts
  events.push(e)
  if (events.length > MAX_MEMORY_EVENTS) events.shift()

  applyEvent(e)
  broadcast(e)
  persistEvent(e)
  return e
}

function applyEvent(e) {
  switch (e.type) {
    case 'agent_start': {
      const id = e.agent || 'unknown'
      const meta = ROLE_META[id] || defaultRole(id)
      agents.set(id, {
        id,
        label: meta.label,
        role: e.role || meta.role,
        color: meta.color,
        status: 'active',
        task: e.task || '',
        startedAt: e.ts,
        lastSeen: e.ts,
        lastBark: null,
        lastThought: null,
        filesTouched: 0,
        events: 0,
      })
      break
    }
    case 'agent_done': {
      const a = agents.get(e.agent)
      if (a) {
        a.status = 'done'
        a.lastSeen = e.ts
        if (e.task) a.task = e.task
      }
      break
    }
    case 'thought': {
      const a = agents.get(e.agent)
      if (a) {
        a.lastThought = e.text || ''
        a.lastSeen = e.ts
        a.events++
      }
      break
    }
    case 'bark': {
      const a = agents.get(e.agent)
      if (a) {
        a.lastBark = { text: e.text || '', ts: e.ts }
        a.lastSeen = e.ts
        a.events++
      }
      break
    }
    case 'file_edit': {
      const id = e.agent || 'unknown'
      const a = agents.get(id)
      const file = e.file || e.path
      if (!file) break
      const prev = files.get(file)
      // conflict: different agent touching same file inside window
      if (prev && prev.lastAgent && prev.lastAgent !== id && e.ts - prev.lastTs < CONFLICT_WINDOW_MS) {
        const conflict = {
          id: conflicts.length + 1,
          ts: e.ts,
          file,
          agents: [prev.lastAgent, id],
        }
        conflicts.push(conflict)
        pushEvent({
          type: 'conflict',
          agent: id,
          file,
          text: `${prev.lastAgent} ↔ ${id} on ${file}`,
          meta: { with: prev.lastAgent },
        })
        // pushEvent recursion: applyEvent for conflict is a no-op besides agents map — fine
      }
      files.set(file, {
        path: file,
        edits: (prev?.edits || 0) + 1,
        lastAgent: id,
        lastTs: e.ts,
        firstTs: prev?.firstTs || e.ts,
      })
      if (a) {
        a.filesTouched++
        a.lastSeen = e.ts
        a.events++
        if (e.task) a.task = e.task
      }
      break
    }
    case 'test_run': {
      const a = agents.get(e.agent)
      if (a) {
        a.lastSeen = e.ts
        a.events++
        a.lastTest = { status: e.status || 'ok', text: e.text || '', ts: e.ts }
      }
      break
    }
    case 'merge': {
      merges.push({ ts: e.ts, agent: e.agent, file: e.file, text: e.text || '', status: e.status || 'merged' })
      const a = agents.get(e.agent)
      if (a) a.lastSeen = e.ts
      break
    }
    default:
      break
  }
}

function snapshot() {
  const agentList = [...agents.values()].map((a) => ({
    ...a,
    stale: a.status === 'active' && now() - a.lastSeen > AGENT_TIMEOUT_MS,
  }))
  return {
    missionStart,
    uptime: missionStart ? now() - missionStart : 0,
    agents: agentList,
    files: [...files.values()].sort((a, b) => b.lastTs - a.lastTs),
    conflicts,
    merges,
    eventCount: events.length,
    stats: computeStats(),
  }
}

function computeStats() {
  let edits = 0
  let barks = 0
  let thoughts = 0
  let tests = 0
  for (const e of events) {
    if (e.type === 'file_edit') edits++
    else if (e.type === 'bark') barks++
    else if (e.type === 'thought') thoughts++
    else if (e.type === 'test_run') tests++
  }
  return {
    edits,
    barks,
    thoughts,
    tests,
    conflicts: conflicts.length,
    merges: merges.length,
    files: files.size,
    agentsActive: [...agents.values()].filter((a) => a.status === 'active').length,
  }
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------
let logStream = null
let logPath = null

async function ensureLog() {
  if (logStream) return
  await fsp.mkdir(EVENT_LOG_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  logPath = path.join(EVENT_LOG_DIR, `run-${stamp}.jsonl`)
  logStream = fs.createWriteStream(logPath, { flags: 'a' })
  logStream.write(`${JSON.stringify({ type: 'boot', ts: now(), pid: process.pid })}\n`)
  console.log(`[mc] event log → ${logPath}`)
}

function persistEvent(e) {
  if (!logStream) return
  logStream.write(`${JSON.stringify(e)}\n`)
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------
function broadcast(evt) {
  const payload = `data: ${JSON.stringify(evt)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(payload)
    } catch {
      sseClients.delete(res)
    }
  }
}

function handleSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(`data: ${JSON.stringify({ type: 'hello', ts: now(), snapshot: snapshot() })}\n\n`)
  sseClients.add(res)
  const ping = setInterval(() => {
    try {
      res.write(`: ping ${now()}\n\n`)
    } catch {
      clearInterval(ping)
      sseClients.delete(res)
    }
  }, 15000)
  req.on('close', () => {
    clearInterval(ping)
    sseClients.delete(res)
  })
}

// ---------------------------------------------------------------------------
// fs.watch (optional mirror)
// ---------------------------------------------------------------------------
function startRepoWatch(repoDir) {
  const abs = path.resolve(repoDir)
  if (!fs.existsSync(abs)) {
    console.warn(`[mc] --repo path missing, skipping watch: ${abs}`)
    return
  }
  console.log(`[mc] watching ${abs}`)
  let debounce = new Map()
  fs.watch(abs, { recursive: true }, (event, filename) => {
    if (!filename) return
    if (/(^|[/\\])(node_modules|\.git)([/\\]|$)/.test(filename)) return
    if (filename.endsWith('.jsonl') || filename.endsWith('package-lock.json')) return
    if (/\.tmp$/.test(filename) || /\.[0-9a-f-]{36}\.tmp$/i.test(filename) || filename.startsWith('.')) return
    const rel = filename.split(path.sep).join('/')
    const last = debounce.get(rel) || 0
    const t = now()
    if (t - last < 400) return
    debounce.set(rel, t)
    pushEvent({
      type: 'file_edit',
      agent: 'filesystem',
      file: rel,
      text: `fs.${event} ${rel}`,
      meta: { source: 'watch' },
    })
  })
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------
async function startReplay(file) {
  const abs = path.resolve(file)
  const raw = await fsp.readFile(abs, 'utf8')
  const lines = raw.split('\n').filter((l) => l.trim())
  console.log(`[mc] replaying ${lines.length} events from ${abs}`)
  let prevTs = null
  for (const line of lines) {
    let evt
    try {
      evt = JSON.parse(line)
    } catch {
      continue
    }
    if (evt.type === 'boot') continue
    // preserve relative timing but cap gaps at 1.5s
    if (prevTs && evt.ts) {
      const gap = Math.min(Math.max(evt.ts - prevTs, 0), 1500)
      await new Promise((r) => setTimeout(r, gap))
    }
    prevTs = evt.ts
    pushEvent(evt)
  }
  console.log('[mc] replay complete')
}

// ---------------------------------------------------------------------------
// http
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

async function handleGithubWebhook(req, res) {
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid json' })
  }
  const commits = Array.isArray(body?.commits) ? body.commits : []
  const pusher = body?.pusher?.name || 'github'
  const files = new Set()
  for (const c of commits) {
    for (const k of ['added', 'modified', 'removed']) {
      if (Array.isArray(c?.[k])) for (const f of c[k]) if (f) files.add(f)
    }
  }
  if (!files.size) {
    return sendJson(res, 200, { ok: true, saved: 0 })
  }
  const events = [...files].slice(0, 50).map((f) => ({
    type: 'file_edit',
    agent: 'github',
    file: f,
    text: `push by ${pusher}`,
  }))
  const saved = []
  for (const evt of events) saved.push(pushEvent(evt))
  sendJson(res, 200, { ok: true, saved: saved.length })
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1_000_000) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function authorized(req, url) {
  if (!TOKEN) return true
  if (url.searchParams.get('token') === TOKEN) return true
  if (req.headers['x-mc-token'] === TOKEN) return true
  return false
}

async function handleEventPost(req, res) {
  if (!authorized(req, new URL(req.url, 'http://x'))) return sendJson(res, 401, { ok: false, error: 'bad token' })
  const raw = await readBody(req)
  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid json' })
  }
  // support single event or {events: [...]}
  const list = Array.isArray(body.events) ? body.events : [body]
  const saved = []
  for (const evt of list) {
    if (!evt || typeof evt !== 'object' || !evt.type) continue
    saved.push(pushEvent(evt))
  }
  sendJson(res, 200, { ok: true, saved: saved.length, id: saved.at(-1)?.id })
}

function serveStatic(res, urlPath, acceptGzip = true) {
  let rel = urlPath === '/' ? '/index.html' : urlPath
  rel = rel.split('?')[0]
  const abs = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''))
  if (!abs.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    return res.end('forbidden')
  }
  fs.readFile(abs, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('not found')
    }
    const type = MIME[path.extname(abs)] || 'application/octet-stream'
    const gzippable = /javascript|css|html|json/.test(type) && acceptGzip
    if (gzippable && buf.length > 1024) {
      const gz = zlib.gzipSync(buf)
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Encoding': 'gzip',
        'Content-Length': gz.length,
        'Cache-Control': 'no-store',
        Vary: 'Accept-Encoding',
      })
      return res.end(gz)
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    })
    res.end(buf)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const p = url.pathname

  if (p === '/api/stream') return handleSse(req, res)
  if (p === '/api/state') return sendJson(res, 200, snapshot())
  if (p === '/api/github' && req.method === 'POST') return handleGithubWebhook(req, res)
  if (p === '/api/event' && req.method === 'POST') return handleEventPost(req, res)
  if (p === '/api/event' && req.method === 'GET') {
    if (!authorized(req, url)) return sendJson(res, 401, { ok: false, error: 'bad token' })
    const evt = { type: url.searchParams.get('type'), agent: url.searchParams.get('agent'), file: url.searchParams.get('file'), text: url.searchParams.get('text'), status: url.searchParams.get('status'), task: url.searchParams.get('task') }
    if (!evt.type) return sendJson(res, 400, { ok: false, error: 'missing type' })
    return sendJson(res, 200, { ok: true, saved: 1, id: pushEvent(evt).id })
  }
  if (p === '/api/reset' && req.method === 'POST') {
    events.length = 0
    agents.clear()
    files.clear()
    conflicts.length = 0
    merges.length = 0
    missionStart = null
    eventId = 0
    broadcast({ type: 'reset', ts: now() })
    return sendJson(res, 200, { ok: true })
  }
  if (p === '/healthz') return sendJson(res, 200, { ok: true, clients: sseClients.size, events: events.length })

  serveStatic(res, p)
})

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
await ensureLog()
server.listen(args.port, HOST, () => {
  console.log(`[mc] Agent Mission Control`)
  console.log(`[mc] dashboard  → http://localhost:${args.port}`)
  if (TOKEN) console.log('[mc] token auth ON (MC_TOKEN)')
  console.log(`[mc] POST event → curl -X POST localhost:${args.port}/api/event -H 'content-type: application/json' -d '{"type":"agent_start","agent":"refactorer","task":"..."}'`)
  console.log(`[mc] GET  event → curl "localhost:${args.port}/api/event?type=bark&agent=refactorer&text=hi"`)
  console.log(`[mc] SSE        → curl -N localhost:${args.port}/api/stream`)
})
if (args.repo) startRepoWatch(args.repo)
if (args.replay) {
  // give the dashboard a moment to connect before the first event lands
  await new Promise((r) => setTimeout(r, 400))
  await startReplay(args.replay)
}

process.on('SIGINT', () => {
  console.log('\n[mc] shutting down')
  logStream?.end()
  server.close()
  process.exit(0)
})
