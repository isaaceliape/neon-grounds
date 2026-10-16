import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../public/sfx.js', import.meta.url), 'utf8')

// Minimal stand-ins for the Web Audio API that count what the code does.
function makeEnv({ stored = null, withAudio = true } = {}) {
  const stats = { contexts: 0, oscillators: 0, noiseSources: 0, resumes: 0, masterGain: null, created: [] }
  const timers = []
  const cleared = []
  const store = new Map(stored == null ? [] : [['territory-mute', stored]])
  const param = () => ({ value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} })
  const node = () => ({ connect() {} })

  class FakeAudioContext {
    constructor() {
      stats.contexts += 1
      stats.created.push(this)
      this.state = 'suspended'
      this.currentTime = 0
      this.sampleRate = 8000
      this.destination = node()
    }

    resume() {
      stats.resumes += 1
      this.state = 'running'
    }

    createGain() {
      const gain = { ...node(), gain: param() }
      if (stats.masterGain === null) stats.masterGain = gain
      return gain
    }

    createOscillator() {
      return { ...node(), frequency: param(), type: 'sine', start() { stats.oscillators += 1 }, stop() {} }
    }

    createBuffer(channels, frames) {
      return { getChannelData: () => new Float32Array(frames) }
    }

    createBufferSource() {
      return { ...node(), start() { stats.noiseSources += 1 } }
    }

    createBiquadFilter() {
      return { ...node(), frequency: param(), type: 'lowpass' }
    }
  }

  const listeners = {}
  const sandbox = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
    },
    addEventListener: (type, fn) => { listeners[type] = fn },
  }
  if (withAudio) sandbox.AudioContext = FakeAudioContext
  sandbox.globalThis = sandbox
  sandbox.setInterval = (fn) => { timers.push(fn); return timers.length }
  sandbox.clearInterval = (id) => { cleared.push(id) }
  vm.runInNewContext(source, sandbox)
  return { sfx: sandbox.sfx, stats, store, listeners, timers, cleared }
}

test('no audio context is created before the first user gesture', () => {
  const { sfx, stats } = makeEnv()
  sfx.capture(0.5)
  sfx.death(1)
  sfx.tick()
  assert.equal(stats.contexts, 0)
  assert.equal(stats.oscillators, 0)
})

test('the first click or key press creates one context and resumes it', () => {
  const { stats, listeners } = makeEnv()
  assert.equal(typeof listeners.pointerdown, 'function')
  assert.equal(typeof listeners.keydown, 'function')
  assert.equal(typeof listeners.click, 'function')
  listeners.pointerdown()
  listeners.keydown()
  assert.equal(stats.contexts, 1)
  assert.equal(stats.resumes, 1)
})

test('each event makes a sound once audio is unlocked', () => {
  const { sfx, stats, listeners } = makeEnv()
  listeners.pointerdown()
  const play = (fn) => {
    const before = stats.oscillators + stats.noiseSources
    fn()
    return stats.oscillators + stats.noiseSources - before
  }
  assert.ok(play(() => sfx.capture(0.2)) >= 3, 'capture')
  assert.ok(play(() => sfx.capture(0.9)) >= 4, 'a big capture is a longer run')
  assert.ok(play(() => sfx.death(1)) >= 2, 'death')
  assert.ok(play(() => sfx.tick()) === 1, 'tick')
  assert.ok(play(() => sfx.go()) >= 3, 'go')
  assert.ok(play(() => sfx.win()) >= 5, 'win')
  assert.ok(play(() => sfx.lose()) >= 4, 'lose')
})

test('mute silences everything and is remembered', () => {
  const { sfx, stats, store, listeners } = makeEnv()
  listeners.pointerdown()
  sfx.setMuted(true)
  assert.equal(sfx.isMuted(), true)
  assert.equal(store.get('territory-mute'), '1')
  assert.equal(stats.masterGain.gain.value, 0)
  const before = stats.oscillators + stats.noiseSources
  sfx.capture(0.5)
  sfx.death(1)
  sfx.win()
  assert.equal(stats.oscillators + stats.noiseSources, before)
  sfx.setMuted(false)
  assert.equal(store.get('territory-mute'), '0')
  assert.ok(stats.masterGain.gain.value > 0)
})

test('a saved mute is restored on the next load', () => {
  const { sfx, stats, listeners } = makeEnv({ stored: '1' })
  assert.equal(sfx.isMuted(), true)
  listeners.pointerdown()
  assert.equal(stats.masterGain.gain.value, 0)
})

test('theme music waits for a gesture, then loops', () => {
  const { sfx, stats, listeners, timers } = makeEnv()
  sfx.startMusic()
  assert.equal(sfx.isMusicPlaying(), true)
  assert.equal(stats.contexts, 0)
  assert.equal(timers.length, 0)
  listeners.pointerdown()
  assert.equal(timers.length, 1)
  const before = stats.oscillators
  timers[0]()
  assert.ok(stats.oscillators > before, 'scheduled loop notes')
  stats.created[0].currentTime = 5
  const mid = stats.oscillators
  timers[0]()
  assert.ok(stats.oscillators > mid, 'keeps scheduling as time advances')
})

test('stopMusic halts the loop', () => {
  const { sfx, listeners, timers, cleared } = makeEnv()
  listeners.pointerdown()
  sfx.startMusic()
  assert.equal(timers.length, 1)
  sfx.stopMusic()
  assert.equal(sfx.isMusicPlaying(), false)
  assert.deepEqual(cleared, [1])
})

test('mute silences the theme too', () => {
  const { sfx, stats, listeners, timers } = makeEnv()
  listeners.pointerdown()
  sfx.startMusic()
  sfx.setMuted(true)
  const before = stats.oscillators
  timers[0]()
  assert.equal(stats.oscillators, before)
})

test('music is a no-op without Web Audio', () => {
  const { sfx, listeners } = makeEnv({ withAudio: false })
  assert.doesNotThrow(() => {
    sfx.startMusic()
    assert.equal(sfx.isMusicPlaying(), true)
    listeners.pointerdown()
    sfx.stopMusic()
    assert.equal(sfx.isMusicPlaying(), false)
  })
})
test('browsers without Web Audio get silent no-ops, not errors', () => {
  const { sfx, listeners } = makeEnv({ withAudio: false })
  assert.doesNotThrow(() => {
    listeners.pointerdown()
    sfx.capture(1)
    sfx.death(1)
    sfx.tick()
    sfx.go()
    sfx.win()
    sfx.lose()
    sfx.setMuted(true)
  })
})
