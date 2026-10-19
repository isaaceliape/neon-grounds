import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/sfx.js', import.meta.url), 'utf8')

// Minimal stand-ins for the Web Audio API that count what the code does.
function makeEnv({ stored = null, musicStored = null, withAudio = true, trackAudio = false } = {}) {
  const stats = { contexts: 0, oscillators: 0, noiseSources: 0, resumes: 0, masterGain: null, created: [], gains: [], trackSources: 0 }
  const timers = []
  const cleared = []
  const entries = []
  if (stored != null) entries.push(['neon-grounds-mute', stored])
  if (musicStored != null) entries.push(['neon-grounds-music-mute', musicStored])
  const store = new Map(entries)
  const param = () => ({
    value: 1,
    calls: [],
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() { this.calls.push('target') },
    cancelScheduledValues() { this.calls.push('cancel') },
  })
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
      stats.gains.push(gain)
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

    createDynamicsCompressor() {
      return {
        ...node(),
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
      }
    }

    createMediaElementSource() {
      return node()
    }

    createBufferSource() {
      // Shared mock: effect noise, the snare, and the track loop all start
      // buffer sources, so count both uses here.
      return {
        ...node(),
        start() {
          stats.noiseSources += 1
          stats.trackSources += 1
        },
        stop() {},
      }
    }

    decodeAudioData() {
      return Promise.resolve({ duration: 78 })
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
  if (trackAudio === 'error') {
    sandbox.fetch = () => Promise.reject(new Error('offline'))
  } else if (trackAudio) {
    sandbox.fetch = () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
  }
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

test('effects duck the music instead of fighting it', () => {
  const { sfx, stats, listeners } = makeEnv()
  listeners.pointerdown()
  // gains[0] is the master bus, gains[1] the music bus.
  const musicGain = stats.gains[1].gain
  sfx.capture(0.5)
  sfx.death(1)
  assert.ok(musicGain.calls.includes('cancel'), 'previous automation is cleared')
  assert.ok(musicGain.calls.filter((call) => call === 'target').length >= 4, 'music dips and releases')
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
  assert.equal(store.get('neon-grounds-mute'), '1')
  assert.equal(stats.masterGain.gain.value, 0)
  const before = stats.oscillators + stats.noiseSources
  sfx.capture(0.5)
  sfx.death(1)
  sfx.win()
  assert.equal(stats.oscillators + stats.noiseSources, before)
  sfx.setMuted(false)
  assert.equal(store.get('neon-grounds-mute'), '0')
  assert.ok(stats.masterGain.gain.value > 0)
})

test('a saved mute is restored on the next load', () => {
  const { sfx, stats, listeners } = makeEnv({ stored: '1' })
  assert.equal(sfx.isMuted(), true)
  listeners.pointerdown()
  assert.equal(stats.masterGain.gain.value, 0)
})

test('theme music waits for a gesture, then loops', async () => {
  const { sfx, stats, listeners } = makeEnv({ trackAudio: true })
  sfx.startMusic()
  assert.equal(sfx.isMusicPlaying(), true)
  assert.equal(stats.contexts, 0, 'no context before a gesture')
  assert.equal(stats.trackSources, 0, 'no track before a gesture')
  listeners.pointerdown()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(stats.trackSources >= 1, 'track loops after the gesture')
})

test('the licensed track loops from a decoded buffer once ready', async () => {
  const { sfx, stats, listeners } = makeEnv({ trackAudio: true })
  listeners.pointerdown()
  sfx.startMusic()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(stats.trackSources >= 1, 'buffer loop starts after decode')
})

test('a broken track plays silence instead of crashing', async () => {
  const { sfx, stats, listeners } = makeEnv({ trackAudio: 'error' })
  listeners.pointerdown()
  sfx.startMusic()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(stats.trackSources, 0, 'no buffer loop')
  assert.equal(sfx.isMusicPlaying(), true, 'music stays on, quietly')
})

test('later gestures never restart the running track', async () => {
  const { sfx, stats, listeners } = makeEnv({ trackAudio: true })
  listeners.pointerdown()
  sfx.startMusic()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(stats.trackSources >= 1, 'buffer loop starts after decode')
  const started = stats.trackSources
  // Every tap and keypress unlocks audio; none may cut the song over.
  listeners.pointerdown()
  listeners.keydown()
  listeners.click()
  listeners.pointerdown()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(stats.trackSources, started, 'loop keeps playing from where it is')
})

test('stopMusic halts the loop and startMusic resumes it', async () => {
  const { sfx, stats, listeners } = makeEnv({ trackAudio: true })
  listeners.pointerdown()
  sfx.startMusic()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(stats.trackSources >= 1, 'loop plays')
  sfx.stopMusic()
  assert.equal(sfx.isMusicPlaying(), false)
  const stopped = stats.trackSources
  sfx.startMusic()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(stats.trackSources > stopped, 'loop starts over after resume')
})

test('mute silences the theme too', async () => {
  const { sfx, stats, listeners } = makeEnv({ trackAudio: true })
  listeners.pointerdown()
  sfx.startMusic()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(stats.trackSources >= 1, 'loop plays')
  // gains[0] is the master bus, gains[1] the music bus.
  sfx.setMuted(true)
  assert.equal(stats.gains[0].gain.value, 0, 'master silenced')
  sfx.setMuted(false)
  assert.ok(stats.gains[0].gain.value > 0, 'master back')
})

test('music has its own mute, independent of effects', async () => {
  const { sfx, stats, store, listeners } = makeEnv({ trackAudio: true })
  listeners.pointerdown()
  sfx.startMusic()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(stats.trackSources >= 1, 'loop plays')
  sfx.setMusicMuted(true)
  assert.equal(sfx.isMusicMuted(), true)
  assert.equal(store.get('neon-grounds-music-mute'), '1')
  assert.equal(stats.gains[1].gain.value, 0, 'music bus silenced')
  const effects = stats.oscillators
  sfx.tick()
  assert.ok(stats.oscillators > effects, 'effects still sound')
  sfx.setMusicMuted(false)
  assert.equal(store.get('neon-grounds-music-mute'), '0')
  assert.ok(stats.gains[1].gain.value > 0, 'music bus back')
})

test('a saved music mute is restored on the next load', async () => {
  const { sfx, stats, listeners } = makeEnv({ musicStored: '1', trackAudio: true })
  assert.equal(sfx.isMusicMuted(), true)
  assert.equal(sfx.isMuted(), false)
  listeners.pointerdown()
  sfx.startMusic()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(stats.trackSources >= 1, 'loop plays')
  assert.equal(stats.gains[1].gain.value, 0, 'music bus stays silent')
})

test('music is a no-op without Web Audio', () => {
  const { sfx, listeners } = makeEnv({ withAudio: false })
  assert.doesNotThrow(() => {
    sfx.startMusic()
    assert.equal(sfx.isMusicPlaying(), true)
    listeners.pointerdown()
    sfx.stopMusic()
    assert.equal(sfx.isMusicPlaying(), false)
    sfx.setMusicMuted(true)
    assert.equal(sfx.isMusicMuted(), true)
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
