// Synthesized sound effects plus the licensed MP3 theme loop (theme.mp3).
// The AudioContext is created only after the first click or key press, because
// browsers block audio before a gesture. If Web Audio is missing, every call is a no-op.
globalThis.sfx = (() => {
  const STORE_KEY = 'neon-grounds-mute'
  const MUSIC_STORE_KEY = 'neon-grounds-music-mute'
  const VOLUME = 0.25
  const MUSIC_VOLUME = 0.5

  let ctx = null
  let master = null
  let music = null
  let muted = false
  let musicMuted = false
  try {
    muted = globalThis.localStorage?.getItem(STORE_KEY) === '1'
    musicMuted = globalThis.localStorage?.getItem(MUSIC_STORE_KEY) === '1'
  } catch {
    muted = false
    musicMuted = false
  }

  function create() {
    if (ctx) return ctx
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : VOLUME
    // A gentle limiter so a death burst landing on a kick and a capture
    // run never clips: everything is glued instead of distorting.
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.knee.value = 12
      comp.ratio.value = 5
      comp.attack.value = 0.004
      comp.release.value = 0.18
      master.connect(comp)
      comp.connect(ctx.destination)
    } else {
      master.connect(ctx.destination)
    }
    // The background theme gets its own bus so it can sit quietly under
    // the effects. Muting the master silences it too.
    music = ctx.createGain()
    music.gain.value = musicMuted ? 0 : MUSIC_VOLUME
    music.connect(master)
    return ctx
  }

  // Called from a user gesture.
  function unlock() {
    const audio = create()
    if (audio && audio.state === 'suspended') audio.resume()
    // If startMusic() ran before the context existed, kick the loop now.
    if (audio && playing) startTrack()
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

  // The theme has its own mute so it can be silenced without losing effects.
  function setMusicMuted(value) {
    musicMuted = Boolean(value)
    try {
      globalThis.localStorage?.setItem(MUSIC_STORE_KEY, musicMuted ? '1' : '0')
    } catch {
      // storage can be unavailable; the setting then lasts until reload
    }
    if (music) music.gain.value = musicMuted ? 0 : MUSIC_VOLUME
  }

  function isMusicMuted() {
    return musicMuted
  }

  // Dips the theme for a beat when an effect lands, then lets it back up.
  // Ducking (instead of just mixing louder) keeps effects intelligible
  // without turning the music into wallpaper you have to mute.
  function duckMusic(amount = 0.5, hold = 0.25) {
    if (!ctx || !music || muted || musicMuted) return
    if (typeof music.gain.setTargetAtTime !== 'function') return
    const t = ctx.currentTime
    music.gain.cancelScheduledValues(t)
    music.gain.setTargetAtTime(MUSIC_VOLUME * amount, t, 0.02)
    music.gain.setTargetAtTime(MUSIC_VOLUME, t + hold, 0.15)
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
    duckMusic(0.6, 0.2)
  }

  // loudness is 0 to 1: your own death is 1, a distant one is quiet.
  function death(loudness = 1) {
    const level = Math.min(1, Math.max(0.2, loudness))
    noise(0.4, { gain: 0.6 * level })
    tone(220, 0.35, { type: 'sawtooth', gain: 0.35 * level, slideTo: 45 })
    duckMusic(0.35, 0.35)
  }

  function tick() {
    tone(660, 0.07, { type: 'square', gain: 0.18 })
  }

  function go() {
    tone(523, 0.4, { type: 'sawtooth', gain: 0.22 })
    tone(659, 0.4, { type: 'sawtooth', gain: 0.22 })
    tone(784, 0.4, { type: 'sawtooth', gain: 0.22 })
    tone(1047, 0.5, { type: 'triangle', gain: 0.3, delay: 0.08 })
    duckMusic(0.5, 0.3)
  }

  function win() {
    ;[523, 659, 784, 1047, 1319].forEach((f, i) => {
      tone(f, 0.28, { type: 'triangle', gain: 0.4, delay: i * 0.09 })
    })
    duckMusic(0.5, 0.4)
  }

  function lose() {
    ;[392, 349, 311, 262].forEach((f, i) => {
      tone(f, 0.3, { type: 'triangle', gain: 0.35, delay: i * 0.14 })
    })
    duckMusic(0.5, 0.4)
  }

  for (const type of ['pointerdown', 'keydown', 'click']) {
    globalThis.addEventListener?.(type, unlock, { passive: true })
  }

  // Licensed theme track (see README credits), looped through the music
  // bus so the music mute, ducking, and limiter apply to it. A decoded
  // buffer loop is sample-accurate: unlike an <audio> element, it cannot
  // click or gap at the loop point. This track is the only theme: if it
  // is missing or fails to decode, the game simply plays without music.
  let trackBuffer = null
  let trackLoading = null
  let trackSource = null
  let trackGain = null
  let trackFailed = false
  let playing = false
  function startTrack() {
    if (trackFailed || !ctx) return
    if (
      typeof globalThis.fetch !== 'function' ||
      typeof ctx.decodeAudioData !== 'function' ||
      typeof ctx.createBufferSource !== 'function'
    ) {
      trackFailed = true
      return
    }
    if (trackBuffer) {
      playTrackBuffer()
      return
    }
    if (!trackLoading) {
      trackLoading = globalThis
        .fetch('../theme.mp3')
        .then((response) => {
          if (!response.ok) throw new Error('theme fetch failed')
          return response.arrayBuffer()
        })
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => {
          trackBuffer = buffer
          trackLoading = null
          if (playing) playTrackBuffer()
        })
        .catch(() => {
          trackLoading = null
          trackFailed = true
        })
    }
  }

  function playTrackBuffer() {
    if (!trackBuffer || !ctx || !playing || trackFailed) return
    // The loop already runs: unlock() fires on every tap and keypress, and
    // restarting here is what cut the song back to the start each time.
    if (trackSource) return
    if (!trackGain) {
      trackGain = ctx.createGain()
      trackGain.gain.value = 0.8
      trackGain.connect(music)
    }
    trackSource = ctx.createBufferSource()
    trackSource.buffer = trackBuffer
    trackSource.loop = true
    trackSource.connect(trackGain)
    trackSource.start()
  }

  // Starts the loop. Safe to call before the first gesture: it waits for
  // unlock() and never creates an AudioContext by itself.
  function startMusic() {
    if (playing) return
    playing = true
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume()
      startTrack()
    }
  }

  function stopMusic() {
    playing = false
    if (trackSource) {
      try {
        trackSource.stop()
      } catch {
        // already stopped
      }
      trackSource = null
    }
  }

  function isMusicPlaying() {
    return playing
  }

  return { unlock, setMuted, isMuted, setMusicMuted, isMusicMuted, capture, death, tick, go, win, lose, startMusic, stopMusic, isMusicPlaying }
})()
