/**
 * Mission mascots — Three.js blobs with googly eyes.
 * Each agent id gets a color + mood. No stickers, no photos.
 */
import * as THREE from './vendor/three.module.js'

const MOODS = {
  refactorer: { color: 0xffb454, brow: -0.55, pupil: 0.16, spike: 0.42, name: 'REFACTOR' },
  tester: { color: 0x3fb950, brow: 0.1, pupil: 0.05, spike: 0.5, name: 'TESTER' },
  scribe: { color: 0x58a6ff, brow: 0.22, pupil: -0.05, spike: 0.34, name: 'SCRIBE' },
  reviewer: { color: 0xf778ba, brow: -0.18, pupil: 0.22, spike: 0.28, name: 'REVIEWER' },
  coordinator: { color: 0xd2a8ff, brow: 0, pupil: 0, spike: 0.36, name: 'COORD' },
  github: { color: 0x39d0d8, brow: 0, pupil: 0, spike: 0.3, name: 'GITHUB' },
  filesystem: { color: 0x39d0d8, brow: 0.1, pupil: 0, spike: 0.32, name: 'FS WATCH' },
}

function moodFor(id) {
  return MOODS[id] || { color: 0x8b949e, brow: 0, pupil: 0, spike: 0.36, name: String(id || 'AGENT').toUpperCase() }
}

/** Icosahedron with radial spikes — the "boople" body. */
function makeBody(color, spikeLen) {
  const geo = new THREE.IcosahedronGeometry(1, 1)
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  // push even vertices outward into spikes (icosahedron detail 1 has 42 verts)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const len = v.length()
    // alternate spike / valley by hash of position
    const h = Math.abs(Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719))
    const isSpike = h > 0.45
    const r = isSpike ? 1 + spikeLen * (0.7 + h * 0.5) : 0.92
    v.multiplyScalar(r / len)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.05,
    flatShading: true,
  })
  return new THREE.Mesh(geo, mat)
}

function makeEye(side) {
  const g = new THREE.Group()
  const white = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
  )
  white.scale.set(1, 1.08, 0.7)
  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.3 }),
  )
  pupil.position.z = 0.16
  pupil.position.x = side * 0.05
  g.add(white, pupil)
  g.userData.pupil = pupil
  return g
}

function makeBrow(side, angle) {
  const brow = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.055, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x141821, roughness: 0.6 }),
  )
  brow.position.set(side * 0.24, 0.34, 0.24)
  brow.rotation.z = side * angle
  return brow
}

export class MascotStage {
  constructor(container) {
    this.container = container
    this.mascots = new Map() // id -> { group, eyeL, eyeR, body, mood, target }
    this.pointer = new THREE.Vector2(0, 0)
    this.clock = new THREE.Clock()

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50)
    this.camera.position.set(0, 0.15, 6.2)

    // lights — no colored wash, just key + fill
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(2, 3, 4)
    const fill = new THREE.DirectionalLight(0xd7dde8, 0.7)
    fill.position.set(-3, -1, 2)
    const rim = new THREE.DirectionalLight(0xffffff, 0.8)
    rim.position.set(0, 2, -3)
    this.scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.35))

    // subtle ground dots so they aren't floating in void
    const grid = new THREE.GridHelper(20, 20, 0x1e232d, 0x1e232d)
    grid.position.y = -1.6
    grid.material.opacity = 0.35
    grid.material.transparent = true
    this.scene.add(grid)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'

    this.resize()
    window.addEventListener('resize', () => this.resize())
    container.addEventListener('pointermove', (e) => {
      const r = container.getBoundingClientRect()
      this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1
      this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1
    })

    this._loop = this.loop.bind(this)
    this.renderer.setAnimationLoop(this._loop)
  }

  resize() {
    const w = this.container.clientWidth || 200
    const h = this.container.clientHeight || 160
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  sync(agentMap) {
    // add / update
    const ids = [...agentMap.keys()]
    const n = Math.max(ids.length, 1)
    ids.forEach((id, i) => {
      const a = agentMap.get(id)
      let m = this.mascots.get(id)
      if (!m) {
        m = this.spawn(id)
        this.mascots.set(id, m)
        this.scene.add(m.group)
      }
      const x = (i - (n - 1) / 2) * 2.1
      m.targetX = x
      m.mood = moodFor(id)
      m.active = a?.status !== 'done'
      m.barkAt = a?.lastBark?.ts || m.barkAt || 0
      // recolor if role changed
      if (m.body.material.color.getHex() !== m.mood.color) {
        m.body.material.color.setHex(m.mood.color)
      }
    })
    // remove gone
    for (const [id, m] of this.mascots) {
      if (!agentMap.has(id)) {
        this.scene.remove(m.group)
        this.mascots.delete(id)
      }
    }
  }

  spawn(id) {
    const mood = moodFor(id)
    const group = new THREE.Group()
    const body = makeBody(mood.color, mood.spike)
    const eyeL = makeEye(-1)
    const eyeR = makeEye(1)
    eyeL.position.set(-0.28, 0.08, 0.78)
    eyeR.position.set(0.28, 0.08, 0.78)
    const browL = makeBrow(-1, mood.brow)
    const browR = makeBrow(1, mood.brow)
    group.add(body, eyeL, eyeR, browL, browR)
    group.rotation.y = -0.15
    return {
      id, group, body, eyeL, eyeR, browL, browR, mood,
      targetX: 0, active: true, barkAt: 0, spawnT: this.clock.getElapsedTime(),
      phase: Math.random() * Math.PI * 2,
    }
  }

  poke(id) {
    const m = this.mascots.get(id)
    if (!m) return
    m.pokeT = this.clock.getElapsedTime()
  }

  loop() {
    const t = this.clock.getElapsedTime()
    for (const m of this.mascots.values()) {
      // slide to slot
      m.group.position.x += (m.targetX - m.group.position.x) * 0.08
      // idle bob + squish
      const idle = m.active ? 1 : 0.35
      const bob = Math.sin(t * 2.2 + m.phase) * 0.12 * idle
      m.group.position.y = bob
      const squish = 1 + Math.sin(t * 2.2 + m.phase) * 0.04 * idle
      m.body.scale.set(1 / Math.sqrt(squish), squish, 1 / Math.sqrt(squish))
      // slow spin when active
      m.group.rotation.y = -0.15 + Math.sin(t * 0.6 + m.phase) * 0.25 * idle
      // googly eyes follow pointer (and wander a bit)
      const px = this.pointer.x * 0.7 + Math.sin(t * 1.3 + m.phase) * 0.12
      const py = this.pointer.y * 0.5 + Math.cos(t * 1.1 + m.phase) * 0.08
      for (const eye of [m.eyeL, m.eyeR]) {
        eye.userData.pupil.position.x = THREE.MathUtils.clamp(px * 0.12, -0.14, 0.14)
        eye.userData.pupil.position.y = THREE.MathUtils.clamp(py * 0.1, -0.12, 0.12)
      }
      // poke / bark jump
      if (m.pokeT) {
        const dt = t - m.pokeT
        if (dt < 0.5) {
          const k = 1 - dt / 0.5
          m.group.position.y += Math.sin(dt * Math.PI) * 0.55 * k
          m.group.rotation.z = Math.sin(dt * 20) * 0.18 * k
        } else {
          m.group.rotation.z = 0
        }
      }
      // spawn pop
      const age = t - m.spawnT
      if (age < 0.45) {
        const s = 0.3 + (age / 0.45) * 0.7 + Math.sin(age * 14) * 0.08 * (1 - age / 0.45)
        m.group.scale.setScalar(s)
      } else {
        m.group.scale.setScalar(1)
      }
    }
    // camera gently follows pointer
    this.camera.position.x += (this.pointer.x * 0.4 - this.camera.position.x) * 0.04
    this.camera.position.y += (0.15 + this.pointer.y * 0.25 - this.camera.position.y) * 0.04
    this.camera.lookAt(0, 0, 0)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.renderer.dispose()
  }
}
