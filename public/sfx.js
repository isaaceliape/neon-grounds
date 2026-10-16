// Small synthesized sound effects. No audio files.
// The AudioContext is created only after the first click or key press, because
// browsers block audio before a gesture. If Web Audio is missing, every call is a no-op.
globalThis.sfx = (() => {
  const STORE_KEY = 'territory-mute'
  const VOLUME = 0.25

  let ctx = null
  let master = null
  let music = null
  let muted = false
  try {
    muted = globalThis.localStorage?.getItem(STORE_KEY) === '1'
  } catch {
    muted = false
  }

  function create() {
    if (ctx) return ctx
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : VOLUME
    master.connect(ctx.destination)
    // The background theme gets its own bus so it can sit quietly under
    // the effects. Muting the master silences it too.
    music = ctx.createGain()
    music.gain.value = 0.5
    music.connect(master)
    return ctx
  }

  // Called from a user gesture.
  function unlock() {
    const audio = create()
    if (audio && audio.state === 'suspended') audio.resume()
    // If startMusic() ran before the context existed, kick the loop now.
    if (audio && playing) kickScheduler()
  }

  function setMuted(value) {
    muted = Boolean(value)
    try {
      globalThis.localStorage?.setItem(STORE_KEY, muted ? '1' : '0')
    } catch {
      // storage can be unavailable; the setting then lasts until reload
    }
    if (master) master.gain.value = muted ? 0 : VOLUME
  }

  function isMuted() {
    return muted
  }

  // One enveloped oscillator note.
  function tone(freq, length, { type = 'sine', gain = 0.5, slideTo = null, delay = 0 } = {}) {
    if (!ctx || muted) return
    const start = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + length)
    amp.gain.setValueAtTime(0.0001, start)
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, start + length)
    osc.connect(amp)
    amp.connect(master)
    osc.start(start)
    osc.stop(start + length + 0.03)
  }

  // A short burst of filtered noise, for the crunch of a death.
  function noise(length, { gain = 0.5, from = 1800, to = 200 } = {}) {
    if (!ctx || muted) return
    const frames = Math.max(1, Math.floor(ctx.sampleRate * length))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(from, ctx.currentTime)
    filter.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + length)
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(gain, ctx.currentTime)
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length)
    src.connect(filter)
    filter.connect(amp)
    amp.connect(master)
    src.start()
  }

  // size is 0 to 1. A bigger capture is a higher, longer run of notes.
  // loudness is 0 to 1 (use less for other players' captures).
  function capture(size = 0.2, loudness = 1) {
    const base = 392 * 2 ** (Math.min(1, Math.max(0, size)) * 0.8)
    const notes = size > 0.5 ? 4 : 3
    const ratios = [1, 1.26, 1.5, 2]
    for (let i = 0; i < notes; i += 1) {
      tone(base * ratios[i], 0.16, { type: 'triangle', gain: 0.45 * loudness, delay: i * 0.065 })
    }
  }

  // loudness is 0 to 1: your own death is 1, a distant one is quiet.
  function death(loudness = 1) {
    const level = Math.min(1, Math.max(0.2, loudness))
    noise(0.4, { gain: 0.6 * level })
    tone(220, 0.35, { type: 'sawtooth', gain: 0.35 * level, slideTo: 45 })
  }

  function tick() {
    tone(660, 0.07, { type: 'square', gain: 0.18 })
  }

  function go() {
    tone(523, 0.4, { type: 'sawtooth', gain: 0.22 })
    tone(659, 0.4, { type: 'sawtooth', gain: 0.22 })
    tone(784, 0.4, { type: 'sawtooth', gain: 0.22 })
    tone(1047, 0.5, { type: 'triangle', gain: 0.3, delay: 0.08 })
  }

  function win() {
    ;[523, 659, 784, 1047, 1319].forEach((f, i) => {
      tone(f, 0.28, { type: 'triangle', gain: 0.4, delay: i * 0.09 })
    })
  }

  function lose() {
    ;[392, 349, 311, 262].forEach((f, i) => {
      tone(f, 0.3, { type: 'triangle', gain: 0.35, delay: i * 0.14 })
    })
  }

  for (const type of ['pointerdown', 'keydown', 'click']) {
    globalThis.addEventListener?.(type, unlock, { passive: true })
  }

  // Looping background theme. 32 eighth-note steps (~8.3s per loop at 116bpm)
  // over Am F C G. 0 means rest. Gains stay low so this sits under the effects.
  // Retune it here: swap the frequencies, keep the 32-step shape.
  const MUSIC_BPM = 116
  const MUSIC_STEP = 60 / MUSIC_BPM / 2
  const MUSIC_LEAD = [
    440, 0, 523.25, 0, 659.25, 0, 523.25, 0,
    440, 0, 392, 0, 349.23, 0, 329.63, 0,
    523.25, 0, 659.25, 0, 587.33, 0, 523.25, 0,
    587.33, 0, 493.88, 0, 392, 0, 493.88, 0,
  ]
  const MUSIC_BASS = [
    110, 0, 0, 0, 110, 0, 0, 0,
    87.31, 0, 0, 0, 87.31, 0, 0, 0,
    130.81, 0, 0, 0, 130.81, 0, 0, 0,
    98, 0, 0, 0, 98, 0, 0, 0,
  ]

  let playing = false
  let musicTimer = null
  let nextTime = 0
  let stepIdx = 0

  // One theme note at an absolute context time, on the music bus.
  function musicTone(freq, when, length, { type = 'sine', gain = 0.1 } = {}) {
    if (!ctx || muted) return
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, when)
    amp.gain.setValueAtTime(0.0001, when)
    amp.gain.exponentialRampToValueAtTime(gain, when + 0.02)
    amp.gain.exponentialRampToValueAtTime(0.0001, when + length)
    osc.connect(amp)
    amp.connect(music)
    osc.start(when)
    osc.stop(when + length + 0.03)
  }

  function playStep(i, when) {
    const lead = MUSIC_LEAD[i]
    if (lead) musicTone(lead, when, 0.22, { type: 'square', gain: 0.09 })
    const bass = MUSIC_BASS[i]
    if (bass) musicTone(bass, when, 0.24, { type: 'triangle', gain: 0.2 })
    if (i % 2 === 1) musicTone(8000, when, 0.03, { type: 'sine', gain: 0.035 })
  }

  // Schedule notes ~0.6s ahead so the loop holds steady under load.
  function pump() {
    if (!ctx || ctx.state !== 'running') return
    while (nextTime < ctx.currentTime + 0.6) {
      playStep(stepIdx, nextTime)
      nextTime += MUSIC_STEP
      stepIdx = (stepIdx + 1) % MUSIC_LEAD.length
    }
  }

  function kickScheduler() {
    if (musicTimer || !ctx) return
    if (typeof globalThis.setInterval !== 'function') return
    stepIdx = 0
    nextTime = ctx.currentTime + 0.1
    musicTimer = globalThis.setInterval(pump, 200)
  }

  // Starts the loop. Safe to call before the first gesture: it waits for
  // unlock() and never creates an AudioContext by itself.
  function startMusic() {
    if (playing) return
    playing = true
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume()
      kickScheduler()
    }
  }

  function stopMusic() {
    playing = false
    if (musicTimer && typeof globalThis.clearInterval === 'function') {
      globalThis.clearInterval(musicTimer)
    }
    musicTimer = null
  }

  function isMusicPlaying() {
    return playing
  }

  return { unlock, setMuted, isMuted, capture, death, tick, go, win, lose, startMusic, stopMusic, isMusicPlaying }
})()
