/* Agent Mission Control — client */

const $ = (sel) => document.querySelector(sel)

const state = {
  agents: new Map(),
  files: new Map(),
  conflicts: [],
  merges: [],
  missionStart: null,
  eventCount: 0,
  stats: { edits: 0, barks: 0, thoughts: 0, tests: 0, conflicts: 0, merges: 0, files: 0, agentsActive: 0 },
}

const els = {
  clock: $('#st-clock'),
  agents: $('#st-agents'),
  edits: $('#st-edits'),
  files: $('#st-files'),
  conflicts: $('#st-conflicts'),
  merges: $('#st-merges'),
  led: $('.led'),
  feedLabel: $('#feed-label'),
  tree: $('#file-tree'),
  filesMeta: $('#files-meta'),
  feed: $('#feed'),
  feedMeta: $('#feed-meta'),
  roster: $('#roster'),
  agentsMeta: $('#agents-meta'),
  barkStage: $('#bark-stage'),
  conflictBanner: $('#conflict-banner'),
  conflictText: $('#conflict-text'),
  ticker: $('#ticker'),
  treemap: $('#treemap'),
  mapEmpty: $('#map-empty'),
  modal: $('#modal'),
}

const MAX_FEED = 80
const MAX_TREE_ROWS = 400
const BARK_TTL = 5200
const HOT_MS = 2500

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------
function connect() {
  const es = new EventSource('./api/stream')
  es.onopen = () => {
    els.led.dataset.on = 'true'
    els.feedLabel.textContent = 'LINK LIVE'
    pushFeed({ type: 'system', ts: Date.now(), text: 'telemetry link established' })
  }
  es.onerror = () => {
    els.led.dataset.on = 'false'
    els.feedLabel.textContent = 'LINK LOST — RETRY'
  }
  es.onmessage = (e) => {
    let msg
    try { msg = JSON.parse(e.data) } catch { return }
    if (msg.type === 'hello' && msg.snapshot) {
      hydrate(msg.snapshot)
      return
    }
    if (msg.type === 'reset') {
      location.reload()
      return
    }
    ingest(msg)
  }
}

function hydrate(snap) {
  state.missionStart = snap.missionStart
  state.eventCount = snap.eventCount
  state.stats = snap.stats
  state.conflicts = snap.conflicts || []
  state.merges = snap.merges || []
  for (const a of snap.agents || []) state.agents.set(a.id, a)
  for (const f of snap.files || []) state.files.set(f.path, f)
  renderAll()
}

function ingest(e) {
  if (!e || !e.type) return
  state.eventCount++
  if (!state.missionStart && e.type !== 'boot' && e.type !== 'hello') {
    state.missionStart = e.ts
  }

  switch (e.type) {
    case 'agent_start': {
      const meta = ROLE[e.agent] || { label: (e.agent || 'AGENT').toUpperCase(), color: '#8b949e', role: 'Agent' }
      state.agents.set(e.agent, {
        id: e.agent,
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
      const a = state.agents.get(e.agent)
      if (a) { a.status = 'done'; a.lastSeen = e.ts }
      break
    }
    case 'thought': {
      const a = state.agents.get(e.agent)
      if (a) { a.lastThought = e.text; a.lastSeen = e.ts; a.events = (a.events || 0) + 1 }
      break
    }
    case 'bark': {
      const a = state.agents.get(e.agent)
      const bark = { text: e.text, ts: e.ts }
      if (a) { a.lastBark = bark; a.lastSeen = e.ts; a.events = (a.events || 0) + 1 }
      showBark(e.agent, e.text)
      break
    }
    case 'file_edit': {
      const file = e.file || e.path
      if (!file) break
      const prev = state.files.get(file)
      state.files.set(file, {
        path: file,
        edits: (prev?.edits || 0) + 1,
        lastAgent: e.agent,
        lastTs: e.ts,
        firstTs: prev?.firstTs || e.ts,
      })
      const a = state.agents.get(e.agent)
      if (a) {
        a.filesTouched = (a.filesTouched || 0) + 1
        a.lastSeen = e.ts
        a.events = (a.events || 0) + 1
      }
      break
    }
    case 'test_run': {
      const a = state.agents.get(e.agent)
      if (a) { a.lastTest = { status: e.status, text: e.text, ts: e.ts }; a.lastSeen = e.ts }
      break
    }
    case 'conflict': {
      state.stats.conflicts++
      state.conflicts.push({ ts: e.ts, file: e.file, agents: e.meta?.with ? [e.meta.with, e.agent] : [e.agent] })
      showConflict(e)
      break
    }
    case 'merge': {
      state.merges.push(e)
      const a = state.agents.get(e.agent)
      if (a) a.lastSeen = e.ts
      break
    }
  }

  if (e.type !== 'hello') pushFeed(e)
  renderStats()
  if (['file_edit', 'agent_start', 'agent_done', 'bark', 'thought', 'test_run', 'merge'].includes(e.type)) {
    renderRoster()
    renderTree()
  }
}

// ---------------------------------------------------------------------------
// feed
// ---------------------------------------------------------------------------
function pushFeed(e) {
  const li = document.createElement('li')
  li.dataset.type = e.type
  const t = fmtClock(e.ts)
  const who = e.agent ? (state.agents.get(e.agent)?.label || e.agent) : (e.type === 'system' ? 'SYS' : e.type)
  const msg = e.text || e.file || e.type
  li.innerHTML = `
    <span class="t">${t}</span>
    <span class="who" style="color:${agentColor(e.agent)}">${esc(who)}</span>
    <span class="msg">${esc(msg)}</span>
  `
  const empty = els.feed.querySelector('.feed-empty')
  if (empty) empty.remove()
  els.feed.prepend(li)
  while (els.feed.children.length > MAX_FEED) els.feed.lastChild.remove()
  els.feedMeta.textContent = `${state.eventCount} events`
}

// ---------------------------------------------------------------------------
// roster
// ---------------------------------------------------------------------------
function renderRoster() {
  const list = [...state.agents.values()]
  els.agentsMeta.textContent = list.length
    ? `${list.filter((a) => a.status === 'active').length} active / ${list.length} total`
    : 'standby'

  if (!list.length) {
    els.roster.innerHTML = `
      <div class="empty-hint">
        <p class="empty-title">NO AGENTS ON DECK</p>
        <p>Send <code>agent_start</code> to put an operator on the board.</p>
      </div>`
    return
  }

  const existing = new Map()
  for (const child of [...els.roster.children]) {
    if (child.dataset?.id) existing.set(child.dataset.id, child)
  }

  for (const a of list) {
    let card = existing.get(a.id)
    if (!card) {
      card = document.createElement('div')
      card.className = 'agent-card'
      card.dataset.id = a.id
      els.roster.appendChild(card)
    }
    existing.delete(a.id)
    const stale = a.status === 'active' && Date.now() - a.lastSeen > 45000
    card.dataset.status = a.status
    card.classList.toggle('is-stale', stale)
    card.style.setProperty('--agent-c', a.color)
    card.innerHTML = `
      <div class="agent-hd">
        <div class="agent-ava">${avatarHtml(a)}</div>
        <div>
          <div class="agent-name">${esc(a.label)}</div>
          <div class="agent-role">${esc(a.role)}</div>
        </div>
      </div>
      <div class="agent-task">${esc(a.task || 'awaiting orders…')}</div>
      ${a.lastThought ? `<div class="agent-thought">${esc(a.lastThought)}</div>` : ''}
      <div class="agent-stats">
        <span>FILES <b>${a.filesTouched || 0}</b></span>
        <span>EVTS <b>${a.events || 0}</b></span>
        <span>UPTIME <b>${fmtClock(a.startedAt)}</b></span>
      </div>
      ${a.lastBark ? `<div class="agent-bark-line">${esc(a.lastBark.text)}</div>` : ''}
    `
  }
  for (const [, child] of existing) child.remove()

  if (window.__mcStage) {
    window.__mcStage.sync(state.agents)
  } else if (window.__mcDeckReady) {
    window.__mcDeckReady.then((stage) => { if (stage) stage.sync(state.agents) })
  }
}

// ---------------------------------------------------------------------------
// file tree
// ---------------------------------------------------------------------------
function renderTree() {
  const files = [...state.files.values()].sort((a, b) => b.lastTs - a.lastTs).slice(0, MAX_TREE_ROWS)
  els.filesMeta.textContent = `${state.files.size} paths`

  if (!files.length) {
    els.tree.innerHTML = `
      <div class="empty-hint">
        <p class="empty-title">NO FILE ACTIVITY</p>
        <p>Agents report <code>file_edit</code> events.<br>Heat appears as the codebase is touched.</p>
      </div>`
    return
  }

  // rebuild (bounded)
  const frag = document.createDocumentFragment()
  for (const f of files) {
    const row = document.createElement('div')
    row.className = 'tree-row'
    if (Date.now() - f.lastTs < HOT_MS) row.classList.add('is-hot')
    const depth = f.path.split('/').length - 1
    const color = agentColor(f.lastAgent)
    row.innerHTML = `
      <span class="who" style="background:${color}"></span>
      <span class="depth">${'&nbsp;'.repeat(depth * 2)}</span>
      <span class="fname" title="${esc(f.path)}">${esc(f.path)}</span>
      <span class="edits">×${f.edits}</span>
    `
    frag.appendChild(row)
  }
  els.tree.replaceChildren(frag)
}

// ---------------------------------------------------------------------------
// treemap
// ---------------------------------------------------------------------------
const tmCtx = els.treemap.getContext('2d')

function drawTreemap() {
  const rect = els.treemap.parentElement.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  els.treemap.width = Math.max(10, rect.width * dpr)
  els.treemap.height = Math.max(10, rect.height * dpr)
  tmCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  tmCtx.clearRect(0, 0, rect.width, rect.height)

  const files = [...state.files.values()]
  els.mapEmpty.hidden = files.length > 0
  if (!files.length) return

  // sort by edits desc, slice top 40 for readability
  files.sort((a, b) => b.edits - a.edits)
  const top = files.slice(0, 40)
  const total = top.reduce((s, f) => s + f.edits, 0) || 1

  const pad = 3
  const W = rect.width - pad * 2
  const H = rect.height - pad * 2

  // squarified-ish slice-and-dice alternating
  const cells = sliceDice(top, total, 0, 0, W, H, true)

  for (const c of cells) {
    const color = agentColor(c.file.lastAgent)
    const hot = Date.now() - c.file.lastTs < HOT_MS
    tmCtx.globalAlpha = hot ? 0.92 : 0.55
    tmCtx.fillStyle = color
    roundRect(tmCtx, c.x + pad, c.y + pad, Math.max(2, c.w - 1), Math.max(2, c.h - 1), 4)
    tmCtx.fill()
    tmCtx.globalAlpha = 1

    // label if cell large enough
    if (c.w > 70 && c.h > 28) {
      tmCtx.fillStyle = 'rgba(6,8,12,0.85)'
      tmCtx.font = '9px "JetBrains Mono", monospace'
      const name = c.file.path.split('/').pop()
      tmCtx.fillText(truncate(name, Math.floor(c.w / 6)), c.x + pad + 6, c.y + pad + 14)
      tmCtx.fillStyle = 'rgba(215,221,232,0.5)'
      tmCtx.font = '8px "JetBrains Mono", monospace'
      tmCtx.fillText(`×${c.file.edits}`, c.x + pad + 6, c.y + pad + 24)
    }
  }
}

function sliceDice(items, total, x, y, w, h, horiz) {
  if (!items.length || w <= 0 || h <= 0) return []
  if (items.length === 1) {
    return [{ file: items[0], x, y, w, h }]
  }
  // take roughly half the area
  let acc = 0
  let i = 0
  const half = total / 2
  while (i < items.length - 1 && acc + items[i].edits < half) {
    acc += items[i].edits
    i++
  }
  acc += items[i].edits
  const head = items.slice(0, i + 1)
  const tail = items.slice(i + 1)
  const frac = acc / total

  if (horiz) {
    const wHead = w * frac
    return [
      ...sliceDice(head, acc, x, y, wHead, h, !horiz),
      ...sliceDice(tail, total - acc, x + wHead, y, w - wHead, h, !horiz),
    ]
  }
  const hHead = h * frac
  return [
    ...sliceDice(head, acc, x, y, w, hHead, !horiz),
    ...sliceDice(tail, total - acc, x, y + hHead, w, h - hHead, !horiz),
  ]
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ---------------------------------------------------------------------------
// barks
// ---------------------------------------------------------------------------
function showBark(agent, text) {
  if (!text) return
  const a = state.agents.get(agent)
  const color = a?.color || agentColor(agent)
  const label = a?.label || agent

  const el = document.createElement('div')
  el.className = 'bark'
  el.style.setProperty('--agent-c', color)
  el.innerHTML = `
    <div class="bark-ava">${avatarHtml(a || { id: agent, label })}</div>
    <div class="bark-body">
      <div class="bark-name">${esc(label)}</div>
      <div class="bark-text">${esc(text)}</div>
    </div>
  `
  els.barkStage.appendChild(el)

  // keep at most 3
  while (els.barkStage.children.length > 3) {
    els.barkStage.firstChild.remove()
  }

  setTimeout(() => {
    el.classList.add('leaving')
    setTimeout(() => el.remove(), 320)
  }, BARK_TTL)

  if (window.__mcStage) window.__mcStage.poke(agent)
  else if (window.__mcDeckReady) window.__mcDeckReady.then((s) => s && s.poke(agent))

  // ticker
  pushTicker(`${label}: ${text}`)
}

function pushTicker(text) {
  const span = document.createElement('span')
  span.className = 'ticker-item'
  span.textContent = text.slice(0, 140)
  els.ticker.appendChild(span)
  // duplicate first half for seamless loop is overkill; just cap
  while (els.ticker.children.length > 12) els.ticker.firstChild.remove()
}

// ---------------------------------------------------------------------------
// conflict
// ---------------------------------------------------------------------------
let conflictTimer = null
function showConflict(e) {
  els.conflictText.textContent = `FILE CONFLICT — ${e.file || e.text || 'unknown path'}`
  els.conflictBanner.hidden = false
  document.body.classList.remove('shake')
  void document.body.offsetWidth
  document.body.classList.add('shake')
  setTimeout(() => document.body.classList.remove('shake'), 400)
  clearTimeout(conflictTimer)
  conflictTimer = setTimeout(() => { els.conflictBanner.hidden = true }, 4000)
}

// ---------------------------------------------------------------------------
// stats + clock
// ---------------------------------------------------------------------------
function bump(el) {
  el.classList.remove('bump')
  // force reflow
  void el.offsetWidth
  el.classList.add('bump')
}

function renderStats() {
  const active = [...state.agents.values()].filter((a) => a.status === 'active').length
  els.agents.innerHTML = `${active}<i>/${state.agents.size}</i>`
  const edits = String(countEdits())
  if (els.edits.textContent !== edits) { els.edits.textContent = edits; bump(els.edits) }
  const nfiles = String(state.files.size)
  if (els.files.textContent !== nfiles) { els.files.textContent = nfiles; bump(els.files) }
  const nconf = String(state.conflicts.length)
  if (els.conflicts.textContent !== nconf) { els.conflicts.textContent = nconf; bump(els.conflicts) }
  const nmerge = String(state.merges.length)
  if (els.merges.textContent !== nmerge) { els.merges.textContent = nmerge; bump(els.merges) }
  els.conflicts.classList.toggle('stat-danger', state.conflicts.length > 0)
}

function countEdits() {
  let n = 0
  for (const f of state.files.values()) n += f.edits
  return n
}

function tickClock() {
  if (!state.missionStart) {
    els.clock.textContent = '00:00:00'
    return
  }
  els.clock.textContent = fmtClock(state.missionStart)
}

function fmtClock(fromTs) {
  if (!fromTs) return '00:00:00'
  const ms = Math.max(0, Date.now() - fromTs)
  const s = Math.floor(ms / 1000)
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const sec = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${sec}`
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------
const ROLE = {
  refactorer: { label: 'REFACTOR', color: '#ffb454', role: 'Refactorer' },
  tester: { label: 'TESTER', color: '#3fb950', role: 'Test Writer' },
  scribe: { label: 'SCRIBE', color: '#58a6ff', role: 'Docs Writer' },
  reviewer: { label: 'REVIEWER', color: '#f778ba', role: 'Reviewer' },
  coordinator: { label: 'COORD', color: '#d2a8ff', role: 'Coordinator' },
  filesystem: { label: 'FS WATCH', color: '#39d0d8', role: 'Filesystem mirror' },
}

function agentColor(id) {
  if (!id) return '#565e6e'
  return state.agents.get(id)?.color || ROLE[id]?.color || '#8b949e'
}

function avatarHtml(a) {
  // 3D mascots live in the deck; cards keep a flat token so they still read at a glance
  return '<span class="ava-ini">' + esc(initials(a?.label)) + '</span>'
}

function initials(label) {
  return String(label || '?').replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase() || '?'
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function truncate(s, n) {
  s = String(s)
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function renderAll() {
  renderStats()
  renderRoster()
  renderTree()
  drawTreemap()
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
$('#btn-help').addEventListener('click', () => { els.modal.hidden = false })
$('#modal-x').addEventListener('click', () => { els.modal.hidden = true })
els.modal.addEventListener('click', (e) => {
  if (e.target === els.modal) els.modal.hidden = true
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') els.modal.hidden = true
})

window.addEventListener('resize', drawTreemap)
setInterval(tickClock, 1000)
setInterval(renderRoster, 15000) // staleness
setInterval(drawTreemap, 2500)

connect()
tickClock()
renderAll()

// warm the canvas
requestAnimationFrame(drawTreemap)
