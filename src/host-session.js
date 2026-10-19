// Single source of truth for the sim is server/game.js, resolved relative
// to this file both in Node and in the Vite bundle.
import { createGame } from '../server/game.js'

// The room server, running in the host player's browser. This is a port of
// server/index.js's room logic (same message shapes, same rules), with the
// HTTP/WebSocket layer replaced by pluggable deliver/broadcast functions so
// guests can arrive over WebRTC DataChannels instead of sockets.
//
// Guests are identified by string keys. The host themself plays through the
// reserved LOCAL_KEY, which behaves like a guest that never disconnects.
//
// Everything crossing the network is plain JSON, exactly like the Node
// server, so the client handles both paths with one onMessage().
export const LOCAL_KEY = 'local'

function randomHex(bytes) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const out = new Uint8Array(bytes)
    crypto.getRandomValues(out)
    return [...out].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  let out = ''
  for (let i = 0; i < bytes; i += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  return out
}

// btoa works on binary strings; chunk the conversion so huge snapshots do
// not blow the argument limit of String.fromCharCode(...big).
function u8ToBase64(u8) {
  const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function base64ToU8(text) {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

export function createHostSession({ gameOptions = {}, roomCode = '', initial = null, onDeliver = () => {}, onBroadcast = () => {} } = {}) {
  const game = createGame(gameOptions)
  const tokens = new Map() // token -> player id
  const guests = new Map() // key -> { playerId, token, queuedName, watcher }
  const watchers = new Set() // keys waiting for a seat mid-round
  const dropTimers = new Map()
  const wins = new Map() // lowercase name -> session wins
  const urls = { local: '', shared: [] }
  let closed = false
  let ticksSinceMigrate = 0

  if (initial) {
    // Taking over a room whose host went away. Guests rejoin with their
    // old tokens and keep their seats.
    const land = base64ToU8(initial.game.landB64)
    const trail = base64ToU8(initial.game.trailB64)
    const ok = game.importState({ ...initial.game, land: [...land], trail: [...trail] }, {
      downId: initial.downId ?? null,
      hostId: initial.hostId ?? null,
    })
    if (!ok) throw new Error('Migration state did not match this game.')
    for (const [name, count] of Object.entries(initial.wins ?? {})) wins.set(name, count)
    for (const [token, id] of Object.entries(initial.tokens ?? {})) tokens.set(token, id)
    // Seats survive the takeover: everyone absent gets a long grace window
    // to redial with their old token.
    for (const id of new Set(tokens.values())) {
      if (id !== initial.hostId && game.player(id)) scheduleDrop(id, null, 60_000)
    }
  }

  function sendTo(key, obj) {
    if (closed) return
    onDeliver(key, obj)
  }

  function broadcast(obj) {
    if (closed) return
    onBroadcast(obj)
  }

  function winsObject() {
    return Object.fromEntries(wins)
  }

  function recordWin(scores) {
    if (!scores || scores.tied || !scores.winnerId) return
    const winner = scores.list.find((row) => row.id === scores.winnerId)
    if (!winner) return
    const key = winner.name.toLowerCase()
    wins.set(key, (wins.get(key) ?? 0) + 1)
  }

  function lobby() {
    const msg = game.pack()
    return {
      type: 'lobby',
      wins: winsObject(),
      phase: msg.phase,
      hostId: msg.hostId,
      roster: msg.roster,
      scores: msg.scores,
      urls,
      roomCode,
    }
  }

  function pushLobby() {
    broadcast(lobby())
    pushMigrate()
  }

  // Full takeover state for guests, in case this browser goes away. Small
  // enough to repeat: ~60KB every 30 ticks plus alongside lobby pushes.
  function pushMigrate() {
    const { land, trail, ...rest } = game.exportState()
    broadcast({
      type: 'migrate',
      roomCode,
      state: {
        game: { ...rest, landB64: u8ToBase64(land), trailB64: u8ToBase64(trail) },
        wins: winsObject(),
        tokens: Object.fromEntries(tokens),
      },
    })
  }

  function hello(key) {
    const guest = guests.get(key)
    sendTo(key, {
      type: 'hello',
      token: guest?.token ?? null,
      playerId: guest?.playerId ?? null,
      hostId: game.hostId,
      urls,
      tickMs: game.tickMs,
      roomCode,
    })
  }

  function snapshot(msg, type) {
    return {
      type,
      wins: winsObject(),
      phase: msg.phase,
      msLeft: msg.msLeft,
      hostId: msg.hostId,
      tick: msg.tick,
      tickMs: game.tickMs,
      w: game.w,
      h: game.h,
      players: msg.players,
      roster: msg.roster,
      scores: msg.scores,
      roomCode,
      land: u8ToBase64(game.land),
      trail: u8ToBase64(game.trail),
    }
  }

  function delta(msg) {
    return {
      type: 'tick',
      phase: msg.phase,
      msLeft: msg.msLeft,
      hostId: msg.hostId,
      tick: msg.tick,
      tickMs: game.tickMs,
      players: msg.players,
      landRuns: msg.landRuns,
      trail: msg.trail,
      scores: msg.scores,
      roomCode,
    }
  }

  function pushState(key) {
    if (game.phase === 'lobby') {
      sendTo(key, lobby())
      return
    }
    sendTo(key, snapshot(game.pack(), game.phase === 'over' ? 'over' : 'full'))
  }

  function bind(key, id, token) {
    // Same seat reconnecting (new connection, same token): retire the old key.
    for (const [other, guest] of guests) {
      if (other !== key && guest.playerId === id) guests.delete(other)
    }
    guests.set(key, { playerId: id, token, queuedName: '', watcher: false })
    watchers.delete(key)
  }

  function seatWatchers() {
    for (const key of [...watchers]) {
      const guest = guests.get(key)
      if (!guest) {
        watchers.delete(key)
        continue
      }
      const player = game.addPlayer(guest.queuedName)
      if (!player) return
      watchers.delete(key)
      const token = guest.token ?? randomHex(16)
      tokens.set(token, player.id)
      bind(key, player.id, token)
      hello(key)
    }
  }

  function join(key, msg) {
    let guest = guests.get(key)
    if (!guest) {
      guest = { playerId: null, token: null, queuedName: '', watcher: false }
      guests.set(key, guest)
    }
    const token = typeof msg.token === 'string' ? msg.token : ''
    const existingId = token ? tokens.get(token) : null
    const existing = existingId ? game.player(existingId) : null
    if (existing) {
      game.markConnected(existing.id)
      const timer = dropTimers.get(existing.id)
      if (timer) clearTimeout(timer)
      dropTimers.delete(existing.id)
      bind(key, existing.id, token)
      hello(key)
      pushState(key)
      if (game.phase === 'lobby' || game.phase === 'over') pushLobby()
      return
    }

    const watching = game.phase === 'play' || game.phase === 'countdown'
    const player = watching ? null : game.addPlayer(msg.name)
    if (!player) {
      guest.playerId = null
      guest.token = token || randomHex(16)
      guest.queuedName = String(msg.name ?? '')
      guest.watcher = true
      watchers.add(key)
      hello(key)
      pushState(key)
      return
    }

    const issued = randomHex(16)
    tokens.set(issued, player.id)
    bind(key, player.id, issued)
    hello(key)
    pushLobby()
    console.log(`[room ${roomCode}] ${player.name} joined`)
  }

  function guestMessage(key, msg) {
    if (!msg || typeof msg !== 'object') return
    if (!guests.has(key)) guests.set(key, { playerId: null, token: null, queuedName: '', watcher: false })
    const guest = guests.get(key)
    if (msg.type === 'join') join(key, msg)
    else if (msg.type === 'rename') {
      const result = game.rename(guest.playerId, msg.name)
      if (!result.ok) {
        sendTo(key, { type: 'error', message: result.error })
        return
      }
      if (result.changed) pushLobby()
    }
    else if (msg.type === 'dir' && guest.playerId) game.setDirection(guest.playerId, msg.dir)
    else if (msg.type === 'steer' && guest.playerId) game.setSteer(guest.playerId, msg.turn)
    else if (msg.type === 'aim' && guest.playerId) game.setAim(guest.playerId, msg.angle)
    else if (msg.type === 'start') {
      const id = guest.playerId
      game.vacate()
      seatWatchers()
      const result = game.start(id, Number(msg.minutes), Date.now())
      if (!result.ok) {
        sendTo(key, { type: 'error', message: result.error })
        return
      }
      broadcast(snapshot(game.pack(), 'full'))
      pushMigrate()
    } else if (msg.type === 'bot') {
      if (guest.playerId !== game.hostId) {
        sendTo(key, { type: 'error', message: 'Only the host can add a bot.' })
        return
      }
      const result = game.addBot(msg.level)
      if (!result.ok) {
        sendTo(key, { type: 'error', message: result.error })
        return
      }
      broadcast(lobby())
    } else if (msg.type === 'removeBot') {
      if (guest.playerId !== game.hostId) {
        sendTo(key, { type: 'error', message: 'Only the host can remove a bot.' })
        return
      }
      const result = game.removeBot(Number(msg.id))
      if (!result.ok) {
        sendTo(key, { type: 'error', message: result.error })
        return
      }
      broadcast(lobby())
    } else if (msg.type === 'restart') {
      const result = game.returnToLobby(guest.playerId)
      if (!result.ok) {
        sendTo(key, { type: 'error', message: result.error })
        return
      }
      broadcast(lobby())
    }
  }

  function tokenFor(id) {
    for (const [token, pid] of tokens) {
      if (pid === id) return token
    }
    return null
  }

  // A seat goes cold: flip it to disconnected now, remove it for good if
  // nobody rebinds it within ms. Takeovers grant a long grace (60s) since
  // claiming the room id alone can take half of that.
  function scheduleDrop(id, key, ms) {
    const old = dropTimers.get(id)
    if (old) clearTimeout(old)
    const timer = setTimeout(() => {
      dropTimers.delete(id)
      if (key && guests.get(key)?.playerId !== id) return
      const phase = game.phase
      const token = key ? guests.get(key)?.token : tokenFor(id)
      game.removePlayer(id)
      if (key) guests.delete(key)
      if (phase === 'lobby' || phase === 'over') tokens.delete(token)
      if (game.phase === 'lobby' || game.phase === 'over') {
        game.vacate()
        seatWatchers()
        pushLobby()
      }
    }, ms)
    dropTimers.set(id, timer)
  }

  function guestLeft(key) {
    if (key === LOCAL_KEY) return
    watchers.delete(key)
    const guest = guests.get(key)
    if (!guest?.playerId) {
      guests.delete(key)
      return
    }
    const id = guest.playerId
    const player = game.player(id)
    if (!player) {
      guests.delete(key)
      return
    }
    player.connected = false
    scheduleDrop(id, key, 10_000)
  }

  let lastPingAt = 0
  const timer = setInterval(() => {
    if (game.phase !== 'countdown' && game.phase !== 'play') {
      // Idle rooms still heartbeat so guests notice a dead host in lobby.
      const now = Date.now()
      if (now - lastPingAt >= 2000) {
        lastPingAt = now
        broadcast({ type: 'ping', roomCode })
      }
      return
    }
    const msg = game.tick(Date.now())
    if (msg.phase === 'over') {
      recordWin(msg.scores)
      console.log(`[room ${roomCode}] round over\n${game.resultLog()}`)
    }
    if (msg.phase === 'over' || msg.resync) broadcast(snapshot(msg, msg.phase === 'over' ? 'over' : 'full'))
    else broadcast(delta(msg))
    ticksSinceMigrate += 1
    if (ticksSinceMigrate >= 30) {
      ticksSinceMigrate = 0
      pushMigrate()
    }
  }, game.tickMs)

  function close() {
    closed = true
    clearInterval(timer)
    for (const id of dropTimers.keys()) clearTimeout(dropTimers.get(id))
    dropTimers.clear()
  }

  // Lost the room id to another host (network race): stop the sim and tell
  // any remaining guests to redial, then the caller switches to guest mode.
  function yieldRoom() {
    broadcast({ type: 'moved', roomCode })
    close()
  }

  return { game, guestMessage, guestLeft, pushLobby, pushMigrate, yieldRoom, close }
}
