#!/usr/bin/env node
/**
 * Tiny CLI for injecting events into a running Agent Mission Control.
 *
 * Usage:
 *   node cli.js start <agentId> [task]
 *   node cli.js edit  <agentId> <filePath> [note]
 *   node cli.js think <agentId> [text]
 *   node cli.js bark  <agentId> [text]
 *   node cli.js test  <agentId> <pass|fail> [text]
 *   node cli.js merge <agentId> [file]
 *   node cli.js done  <agentId>
 *   node cli.js seed                     # scripted 4-agent run (demo)
 *
 * Env: MC_URL (default http://localhost:4826)
 */
const URL_BASE = process.env.MC_URL || 'http://localhost:4826'

async function post(evt) {
  const res = await fetch(`${URL_BASE}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(evt),
  })
  if (!res.ok) {
    console.error(`[cli] HTTP ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  return res.json()
}

const BARKS = {
  refactorer: [
    "this function is 400 lines. I'm not even mad, I'm impressed.",
    'found a TODO from 2021. keeping it as a fossil.',
    'nested if #7. we go deeper.',
    'extracted. the gods of SOLID are pleased.',
    'who names a variable `temp2`? show yourself.',
    'dead code identified. giving it a funeral.',
  ],
  tester: [
    'writing a test for code that has never been tested. ritual begins.',
    'mock the network. mock the clock. mock my feelings.',
    'coverage 0% → 61%. the ritual worked.',
    'this test is flaky. I can feel it in my circuits.',
    'red, green, refactor. mostly red so far.',
    'edge case found. it was not an edge. it was a cliff.',
  ],
  scribe: [
    'documenting the undocumented. archaeology of intent.',
    'the README lied. I am rewriting its future.',
    'a good docstring is a love letter to the next engineer.',
    'diagramming the module graph. it looks like spaghetti. it is spaghetti.',
    'this function needed three paragraphs of context. that is a smell.',
  ],
  reviewer: [
    'LGTM… is what I would say if I were hired to be nice.',
    'this shadowed variable has seen things.',
    'naming things is hard. you chose violence.',
    'I have reviewed 4,000 lines. I have questions. So many questions.',
    'approved with comments. the comments are the real PR.',
    'you used `!!` twice. I felt that in production.',
  ],
}

function pick(list, i = 0) {
  return list[Math.floor(Math.random() * list.length)] ?? list[0]
}

const [, , cmd, ...rest] = process.argv

async function main() {
  switch (cmd) {
    case 'start': {
      const [agent, ...task] = rest
      await post({ type: 'agent_start', agent, task: task.join(' ') || undefined })
      break
    }
    case 'edit': {
      const [agent, file, ...note] = rest
      await post({ type: 'file_edit', agent, file, text: note.join(' ') || undefined })
      break
    }
    case 'think': {
      const [agent, ...text] = rest
      await post({ type: 'thought', agent, text: text.join(' ') || 'thinking…' })
      break
    }
    case 'bark': {
      const [agent, ...text] = rest
      const body = text.length ? text.join(' ') : pick(BARKS[agent] || ['…'])
      await post({ type: 'bark', agent, text: body })
      break
    }
    case 'test': {
      const [agent, status, ...text] = rest
      await post({ type: 'test_run', agent, status: status || 'ok', text: text.join(' ') || undefined })
      break
    }
    case 'merge': {
      const [agent, file, ...text] = rest
      await post({ type: 'merge', agent, file, text: text.join(' ') || undefined })
      break
    }
    case 'done': {
      await post({ type: 'agent_done', agent: rest[0] })
      break
    }
    case 'seed': {
      await seed()
      break
    }
    default:
      console.log('commands: start edit think bark test merge done seed')
      process.exit(2)
  }
}

const DEMO_FILES = [
  'src/utils.js',
  'src/api/routes.js',
  'src/api/handlers.js',
  'src/core/engine.js',
  'src/core/models.js',
  'src/lib/legacy-parser.js',
  'src/lib/date-helpers.js',
  'tests/engine.test.js',
  'tests/routes.test.js',
  'docs/architecture.md',
  'README.md',
  'package.json',
]

async function seed() {
  console.log('[cli] seeding a 4-agent demo run…')
  const agents = [
    { id: 'refactorer', task: 'flatten src/engine.js and retire legacy-parser' },
    { id: 'tester', task: 'write tests for engine + routes' },
    { id: 'scribe', task: 'rewrite architecture.md and README' },
    { id: 'reviewer', task: 'review every PR the others open' },
  ]
  for (const a of agents) {
    await post({ type: 'agent_start', agent: a.id, task: a.task })
    await sleep(250)
  }

  const script = [
    ['think', 'refactorer', 'reading engine.js… 412 lines, 9 responsibilities. classic.'],
    ['bark', 'refactorer'],
    ['edit', 'refactorer', 'src/core/engine.js'],
    ['sleep', 400],
    ['edit', 'tester', 'tests/engine.test.js'],
    ['edit', 'tester', 'src/core/engine.js'], // conflict
    ['bark', 'tester'],
    ['edit', 'scribe', 'docs/architecture.md'],
    ['edit', 'refactorer', 'src/lib/legacy-parser.js'],
    ['edit', 'refactorer', 'src/core/models.js'],
    ['think', 'reviewer', 'diff incoming. bracing for impact.'],
    ['edit', 'reviewer', 'src/api/handlers.js'],
    ['bark', 'reviewer'],
    ['edit', 'scribe', 'README.md'],
    ['edit', 'tester', 'tests/routes.test.js'],
    ['edit', 'tester', 'tests/engine.test.js'],
    ['test', 'tester', 'fail', 'engine.test: 2 failed / 11 passed'],
    ['edit', 'refactorer', 'src/core/engine.js'],
    ['test', 'tester', 'ok', 'engine.test: 13 passed'],
    ['bark', 'scribe'],
    ['edit', 'refactorer', 'src/lib/date-helpers.js'],
    ['edit', 'refactorer', 'src/api/routes.js'],
    ['edit', 'scribe', 'docs/architecture.md'],
    ['merge', 'refactorer', 'src/core/engine.js'],
    ['merge', 'tester', 'tests/engine.test.js'],
    ['merge', 'scribe', 'docs/architecture.md'],
    ['bark', 'refactorer'],
    ['bark', 'reviewer'],
    ['edit', 'refactorer', 'package.json'],
    ['done', 'refactorer'],
    ['done', 'tester'],
    ['done', 'scribe'],
    ['done', 'reviewer'],
  ]

  for (const step of script) {
    const [kind, agent, ...rest] = step
    if (kind === 'sleep') {
      await sleep(rest[0] || 300)
      continue
    }
    if (kind === 'think') await post({ type: 'thought', agent, text: rest.join(' ') })
    if (kind === 'bark') await post({ type: 'bark', agent, text: pick(BARKS[agent]) })
    if (kind === 'edit') await post({ type: 'file_edit', agent, file: rest[0] })
    if (kind === 'test') await post({ type: 'test_run', agent, status: rest[0], text: rest[1] })
    if (kind === 'merge') await post({ type: 'merge', agent, file: rest[0], text: `merged ${rest[0]}` })
    if (kind === 'done') await post({ type: 'agent_done', agent })
    await sleep(180 + Math.random() * 220)
  }
  console.log('[cli] seed complete')
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

main()
