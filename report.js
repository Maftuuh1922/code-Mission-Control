#!/usr/bin/env node
/** Post-run summary from the newest events/*.jsonl (or --file). */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, 'events')
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({
      f,
      t: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
  : []
if (!files.length) {
  console.log('no event logs yet')
  process.exit(0)
}
files.sort((a, b) => b.t - a.t)
const file = process.argv.includes('--file')
  ? path.resolve(process.argv[process.argv.indexOf('--file') + 1])
  : path.join(dir, files[0].f)

const counts = {}
const agents = {}
const barks = []
const conflicts = []
const merges = []
const tests = []
let first = null
let last = null

for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let e
  try { e = JSON.parse(line) } catch { continue }
  if (e.type === 'boot') continue
  counts[e.type] = (counts[e.type] || 0) + 1
  if (e.agent) agents[e.agent] = (agents[e.agent] || 0) + 1
  if (e.type === 'bark') barks.push(`${e.agent}: ${e.text}`)
  if (e.type === 'conflict') conflicts.push(e)
  if (e.type === 'merge') merges.push(e)
  if (e.type === 'test_run') tests.push(e)
  if (!first) first = e.ts
  last = e.ts
}

const dur = first && last ? Math.round((last - first) / 1000) : 0
console.log('═'.repeat(60))
console.log(' MISSION REPORT')
console.log(' source :', path.basename(file))
console.log(' window :', dur, 'seconds')
console.log('─'.repeat(60))
console.log(' events :', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  '))
console.log(' agents :', Object.entries(agents).map(([k, v]) => `${k}(${v})`).join('  ') || '—')
console.log(' edits  :', counts.file_edit || 0)
console.log(' barks  :', barks.length)
console.log(' confl. :', conflicts.length)
console.log(' merges :', merges.length)
if (tests.length) {
  console.log(' tests  :')
  for (const t of tests) console.log(`   [${t.status}] ${t.text || ''}`)
}
if (barks.length) {
  console.log('─'.repeat(60))
  console.log(' best barks')
  for (const b of barks.slice(-8)) console.log('  •', b.slice(0, 140))
}
console.log('═'.repeat(60))
