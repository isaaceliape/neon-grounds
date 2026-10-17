const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }

const COLORS = [
  '#ff2a6d',
  '#ff6a00',
  '#ffe600',
  '#39ff14',
  '#00f5d4',
  '#00d4ff',
  '#3d7bff',
  '#b44dff',
  '#ff4fd8',
  '#ff4d4d',
  '#7af0ff',
  '#c6ff4a',
]

const SPREAD = [0, 11, 3, 8, 5, 6, 1, 10, 4, 7, 2, 9]
const MINUTES = new Set([1, 2, 3, 5])
const COLS = 4
const ROWS = 3

export const MAX_BOTS = 3

// How each bot level plays.
//   homeAt: how long its line gets before it turns back toward its own land.
//   noise:  random wobble added to each candidate heading, so it picks worse lines.
//   hunt:   steers toward other players' exposed lines and drives through them.
//   rest:   ticks it idles on its own land before each trip out.
export const BOT_LEVELS = {
  easy: { homeAt: 12, noise: 14, hunt: false, rest: 60 },
  normal: { homeAt: 16, noise: 0, hunt: false, rest: 0 },
  hard: { homeAt: 28, noise: 0, hunt: true, rest: 0 },
}

function cleanName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
  return name || 'Player'
}

export function createGame(options = {}) {
  const w = options.w ?? 168
  const h = options.h ?? 126
  const tickMs = options.tickMs ?? 110
  const startSize = options.startSize ?? 10
  const countdownMs = options.countdownMs ?? 3000
  const maxPlayers = 12
  const random = options.random ?? Math.random

  const land = new Uint8Array(w * h)
  const trail = new Uint8Array(w * h)
  const players = new Map()

  let phase = 'lobby'
  let hostId = null
  let durationMs = 180000
  let endsAt = 0
  let countdownRemaining = 0
  let tickCount = 0
  let nowMs = 0

  const landWrites = new Map()
  const trailWrites = new Map()

  function idx(x, y) {
    return y * w + x
  }

  function setLand(i, id) {
    const prev = land[i]
    if (prev === id) return
    if (prev) {
      const owner = players.get(prev)
      if (owner) owner.landCount -= 1
    }
    if (id) {
      const owner = players.get(id)
      if (owner) owner.landCount += 1
    }
    land[i] = id
    landWrites.set(i, id)
  }

  function setTrail(i, id) {
    if (trail[i] === id) return
    trail[i] = id
    trailWrites.set(i, id)
  }

  function clearPatch() {
    landWrites.clear()
    trailWrites.clear()
  }

  function landRuns() {
    const entries = [...landWrites.entries()].sort((a, b) => a[0] - b[0])
    const runs = []
    for (const [i, value] of entries) {
      const last = runs.at(-1)
      if (last && last[2] === value && last[0] + last[1] === i) last[1] += 1
      else runs.push([i, 1, value])
    }
    return runs
  }

  function electHost() {
    const current = hostId ? players.get(hostId) : null
    if (current?.connected && !current.bot) return
    hostId = null
    for (const player of players.values()) {
      if (player.connected && !player.bot) {
        hostId = player.id
        return
      }
    }
  }

  function uniqueName(name, exceptId) {
    const taken = new Set(
      [...players.values()].filter((player) => player.id !== exceptId).map((player) => player.name),
    )
    if (!taken.has(name)) return name
    let n = 2
    while (taken.has(`${name} ${n}`)) n += 1
    return `${name} ${n}`
  }

  function nextId() {
    const used = new Set(players.keys())
    let id = 1
    while (used.has(id)) id += 1
    return id
  }

  function publicPlayer(player) {
    return {
      id: player.id,
      name: player.name,
      color: player.color,
      x: player.x,
      y: player.y,
      heading: player.heading,
      dir: player.dir,
      alive: player.alive,
      bot: Boolean(player.bot),
      level: player.bot ? player.level : null,
      connected: player.connected,
      inRound: player.inRound,
      kills: player.kills,
      land: player.landCount,
      out: player.out,
    }
  }

  function scores() {
    const list = [...players.values()]
      .filter((player) => player.inRound)
      .map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        land: player.landCount,
        kills: player.kills,
        alive: player.alive,
        out: player.out,
        pct: (player.landCount / (w * h)) * 100,
      }))
    list.sort((a, b) => b.land - a.land || b.kills - a.kills || a.name.localeCompare(b.name))
    const living = list.filter((row) => row.alive)
    if (living.length === 1 && list.length > 1) {
      return { list, tied: false, winnerId: living[0].id }
    }
    const top = list[0]
    const tied = top
      ? list.filter((row) => row.land === top.land && row.kills === top.kills).length > 1
      : false
    return { list, tied, winnerId: top && !tied && top.land > 0 ? top.id : null }
  }

  function lossReason(row, list) {
    const killer = row.out?.by ? list.find((other) => other.id === row.out.by) : null
    const who = killer?.name
    switch (row.out?.reason) {
      case 'cut': return who ? `cut by ${who}` : 'line was cut'
      case 'wall': return 'hit the wall'
      case 'crash': return 'crashed into another player'
      case 'enclosed': return who ? `boxed in by ${who}` : 'got boxed in'
      case 'left': return 'left the round'
      default: return 'out'
    }
  }

  function resultLog() {
    const result = scores()
    const lines = []
    if (result.tied || !result.winnerId) lines.push('Draw')
    else lines.push(`Winner: ${result.list.find((row) => row.id === result.winnerId).name}`)
    for (const row of result.list) {
      const share = `${row.pct.toFixed(1)}%`
      if (!result.tied && row.id === result.winnerId) {
        lines.push(`${row.name} won with ${share}`)
        continue
      }
      const why = row.alive ? 'less territory' : lossReason(row, result.list)
      lines.push(`${row.name} lost with ${share}, ${why}`)
    }
    return lines.join('\n')
  }

  function pack(extra = {}) {
    const msLeft = phase === 'countdown'
      ? countdownRemaining
      : phase === 'play'
        ? Math.max(0, endsAt - nowMs)
        : 0
    return {
      phase,
      msLeft,
      hostId,
      tick: tickCount,
      players: [...players.values()].filter((player) => player.inRound).map(publicPlayer),
      roster: [...players.values()].map(publicPlayer),
      landRuns: landRuns(),
      trail: [...trailWrites.entries()],
      scores: phase === 'over' ? scores() : null,
      ...extra,
    }
  }

  function kill(player, reason, killer) {
    if (!player || !player.alive) return
    player.alive = false
    player.onOwn = false
    player.out = { reason, by: killer && killer.id !== player.id ? killer.id : null }
    if (killer && killer.id !== player.id) killer.kills += 1
    for (const i of player.trailCells) {
      if (trail[i] === player.id) setTrail(i, 0)
    }
    player.trailCells = []
  }

  function takeCell(i, id, cut) {
    const trailOwner = trail[i]
    if (trailOwner && trailOwner !== id) cut.add(trailOwner)
    if (trailOwner) setTrail(i, 0)
    setLand(i, id)
  }

  function floodOutside(ownerId, seen, walls) {
    const queue = []
    let head = 0
    const push = (i) => {
      if (seen[i] || land[i] === ownerId || walls?.has(i)) return
      seen[i] = 1
      queue.push(i)
    }
    for (let x = 0; x < w; x += 1) {
      push(x)
      push((h - 1) * w + x)
    }
    for (let y = 0; y < h; y += 1) {
      push(y * w)
      push(y * w + w - 1)
    }
    while (head < queue.length) {
      const i = queue[head]
      head += 1
      const x = i % w
      const y = (i - x) / w
      if (x > 0) push(i - 1)
      if (x < w - 1) push(i + 1)
      if (y > 0) push(i - w)
      if (y < h - 1) push(i + w)
    }
  }

  function capture(player) {
    const trailCells = player.trailCells.slice()
    const walls = new Set(trailCells)
    const withTrail = new Uint8Array(w * h)
    const beforeTrail = new Uint8Array(w * h)
    floodOutside(player.id, withTrail, walls)
    floodOutside(player.id, beforeTrail, null)

    const cut = new Set()
    for (let i = 0; i < land.length; i += 1) {
      if (walls.has(i) || land[i] === player.id) continue
      if (withTrail[i] || !beforeTrail[i]) continue
      const trailOwner = trail[i]
      if (trailOwner && trailOwner !== player.id && land[i] !== trailOwner) cut.add(trailOwner)
      if (trailOwner) setTrail(i, 0)
      setLand(i, player.id)
    }

    for (const i of trailCells) {
      if (trail[i] === player.id) setTrail(i, 0)
      setLand(i, player.id)
    }
    player.trailCells = []

    for (const id of cut) {
      const victim = players.get(id)
      if (victim?.alive) kill(victim, 'cut', player)
    }
    for (const other of players.values()) {
      if (!other.alive || other.id === player.id || !other.inRound) continue
      const head = idx(Math.floor(other.x), Math.floor(other.y))
      if (land[head] === player.id) kill(other, 'enclosed', player)
    }
  }

  function place(player, slot) {
    const zoneW = Math.floor(w / COLS)
    const zoneH = Math.floor(h / ROWS)
    const size = Math.min(startSize, zoneW - 2, zoneH - 2)
    const col = slot % COLS
    const row = Math.floor(slot / COLS)
    const bx = col * zoneW + Math.floor((zoneW - size) / 2)
    const by = row * zoneH + Math.floor((zoneH - size) / 2)
    for (let y = by; y < by + size; y += 1) {
      for (let x = bx; x < bx + size; x += 1) setLand(idx(x, y), player.id)
    }
    player.x = bx + Math.floor(size / 2) + 0.5
    player.y = by + Math.floor(size / 2) + 0.5
    player.onOwn = true
    player.heading = Math.atan2(h / 2 - player.y, w / 2 - player.x)
    player.turn = 0
    player.aim = null
    player.dir = 'right'
  }

  function resetBoard() {
    land.fill(0)
    trail.fill(0)
    clearPatch()
    for (const player of players.values()) {
      player.landCount = 0
      player.kills = 0
      player.trailCells = []
      player.out = null
      player.queued = null
      player.alive = false
      player.inRound = false
      player.onOwn = false
      player.x = 0
      player.y = 0
    }
  }

  const FACING = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }
  const TURN_RATE = Math.PI * 1.35

  function wrapAngle(angle) {
    let value = angle
    while (value > Math.PI) value -= Math.PI * 2
    while (value < -Math.PI) value += Math.PI * 2
    return value
  }

  function applyHeading(player, dt) {
    if (player.aim != null && Number.isFinite(player.aim)) {
      const max = TURN_RATE * dt
      player.heading += Math.max(-max, Math.min(max, wrapAngle(player.aim - player.heading)))
      return
    }
    if (player.turn) player.heading += player.turn * TURN_RATE * dt
  }

  function cellsCrossed(x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0)
    const samples = Math.max(1, Math.ceil(dist / 0.2))
    const cells = []
    let last = idx(Math.floor(x0), Math.floor(y0))
    for (let sample = 1; sample <= samples; sample += 1) {
      const t = sample / samples
      const x = x0 + (x1 - x0) * t
      const y = y0 + (y1 - y0) * t
      const cx = Math.floor(x)
      const cy = Math.floor(y)
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) return { out: true, cells }
      const cell = idx(cx, cy)
      if (cell === last) continue
      const prevX = last % w
      const prevY = (last - prevX) / w
      if (Math.abs(cx - prevX) + Math.abs(cy - prevY) === 2) {
        const bridge = idx(cx, prevY)
        if (bridge !== last) cells.push(bridge)
      }
      cells.push(cell)
      last = cell
    }
    return { out: false, cells }
  }

  function addPlayer(name) {
    if (players.size >= maxPlayers) return null
    const id = nextId()
    const player = {
      id,
      name: uniqueName(cleanName(name)),
      color: COLORS[id - 1],
      x: 0,
      y: 0,
      heading: 0,
      turn: 0,
      aim: null,
      dir: 'right',
      queued: null,
      alive: false,
      bot: false,
      connected: true,
      inRound: false,
      onOwn: false,
      landCount: 0,
      kills: 0,
      trailCells: [],
      out: null,
    }
    players.set(id, player)
    if (!hostId && !player.bot) hostId = id
    return player
  }

  function addBot(level = 'normal') {
    if (!Object.hasOwn(BOT_LEVELS, level)) {
      return { ok: false, error: 'Pick easy, normal or hard.' }
    }
    if ([...players.values()].filter((player) => player.bot).length >= MAX_BOTS) {
      return { ok: false, error: `The room can have up to ${MAX_BOTS} bots.` }
    }
    if (phase === 'play' || phase === 'countdown') {
      return { ok: false, error: 'Wait until the round is over.' }
    }
    const player = addPlayer('Bot')
    if (!player) return { ok: false, error: 'The room is full.' }
    player.bot = true
    player.level = level
    return { ok: true, id: player.id, level }
  }

  function removeBot(id) {
    const player = players.get(id)
    if (!player || !player.bot) return { ok: false, error: 'That is not a bot.' }
    if (phase === 'play' || phase === 'countdown') {
      return { ok: false, error: 'Wait until the round is over.' }
    }
    removePlayer(id)
    return { ok: true }
  }

  function rename(id, raw) {
    const player = players.get(id)
    if (!player) return { ok: false, error: 'You are not in the room.' }
    if (phase !== 'lobby' && phase !== 'over') {
      return { ok: false, error: 'You can change your name in the waiting room.' }
    }
    const cleaned = cleanName(raw)
    const taken = new Set(
      [...players.values()].filter((other) => other.id !== id).map((other) => other.name),
    )
    let name = cleaned
    if (taken.has(name)) {
      let n = 2
      while (taken.has(`${name} ${n}`)) n += 1
      name = `${name} ${n}`
    }
    if (name === player.name) return { ok: true, name, changed: false }
    player.name = name
    return { ok: true, name, changed: true }
  }

  function removePlayer(id) {
    const player = players.get(id)
    if (!player) return
    player.connected = false
    if (phase === 'lobby' || phase === 'over') {
      for (let i = 0; i < land.length; i += 1) {
        if (land[i] === id) setLand(i, 0)
      }
      for (const i of player.trailCells) {
        if (trail[i] === id) setTrail(i, 0)
      }
      players.delete(id)
    } else if (player.alive) kill(player, 'left', null)
    electHost()
  }

  function markConnected(id) {
    const player = players.get(id)
    if (!player) return
    player.connected = true
    if (!hostId || !players.get(hostId)?.connected) electHost()
  }

  function setDirection(id, dir) {
    const player = players.get(id)
    if (!player || FACING[dir] == null) return
    if (!player.alive && phase === 'play') return
    player.heading = FACING[dir]
    player.turn = 0
    player.aim = null
  }

  function setSteer(id, turn) {
    const player = players.get(id)
    if (!player) return
    const value = Number(turn)
    player.turn = value < 0 ? -1 : value > 0 ? 1 : 0
    player.aim = null
  }

  function setAim(id, angle) {
    const player = players.get(id)
    if (!player || !Number.isFinite(Number(angle))) return
    player.aim = Number(angle)
    player.turn = 0
  }

  function vacate() {
    if (phase === 'play' || phase === 'countdown') return
    for (const [id, player] of [...players]) {
      if (!player.connected) players.delete(id)
    }
    electHost()
  }

  function returnToLobby(byId) {
    if (byId !== hostId) return { ok: false, error: 'Only the host can restart.' }
    if (phase === 'lobby') return { ok: false, error: 'The round has not started.' }
    resetBoard()
    phase = 'lobby'
    endsAt = 0
    countdownRemaining = 0
    tickCount = 0
    return { ok: true }
  }

  function start(byId, minutes, now) {
    if (byId !== hostId) return { ok: false, error: 'Only the host can start.' }
    for (const [id, player] of [...players]) {
      if (!player.connected) players.delete(id)
    }
    electHost()
    if (hostId == null) return { ok: false, error: 'Nobody is here.' }
    if (![...players.values()].some((player) => player.connected)) {
      return { ok: false, error: 'Nobody is here.' }
    }

    const chosen = MINUTES.has(minutes) ? minutes : 3
    durationMs = chosen * 60 * 1000
    nowMs = now ?? Date.now()
    resetBoard()
    tickCount = 0

    const seated = [...players.values()].filter((player) => player.connected)
    seated.forEach((player, index) => {
      player.alive = true
      player.inRound = true
      player.connected = true
      place(player, SPREAD[index] ?? index)
    })
    clearPatch()

    if (countdownMs <= 0) {
      phase = 'play'
      countdownRemaining = 0
      endsAt = nowMs + durationMs
    } else {
      phase = 'countdown'
      countdownRemaining = countdownMs
      endsAt = 0
    }
    return { ok: true }
  }

  function nearestOwn(player) {
    const cx = Math.floor(player.x)
    const cy = Math.floor(player.y)
    let best = null
    let bestDist = Infinity
    const reach = 24
    for (let y = Math.max(0, cy - reach); y <= Math.min(h - 1, cy + reach); y += 1) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(w - 1, cx + reach); x += 1) {
        if (land[idx(x, y)] !== player.id) continue
        const dist = (x + 0.5 - player.x) ** 2 + (y + 0.5 - player.y) ** 2
        if (dist < bestDist) {
          bestDist = dist
          best = { x, y }
        }
      }
    }
    return best
  }

  // Closest exposed line cell of another player, or null.
  function nearestForeignTrail(player, reach) {
    const cx = Math.floor(player.x)
    const cy = Math.floor(player.y)
    let best = null
    let bestDist = Infinity
    for (let y = Math.max(0, cy - reach); y <= Math.min(h - 1, cy + reach); y += 1) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(w - 1, cx + reach); x += 1) {
        const cell = idx(x, y)
        const owner = trail[cell]
        if (!owner || owner === player.id || land[cell] === owner) continue
        const dist = (x + 0.5 - player.x) ** 2 + (y + 0.5 - player.y) ** 2
        if (dist < bestDist) {
          bestDist = dist
          best = { x, y }
        }
      }
    }
    return best
  }

  function clearance(player, angle, ignoreForeign = false) {
    const head = idx(Math.floor(player.x), Math.floor(player.y))
    const recent = new Set(player.trailCells.slice(-5))
    for (let dist = 1.4; dist <= 18; dist += 0.9) {
      const x = player.x + Math.cos(angle) * dist
      const y = player.y + Math.sin(angle) * dist
      const cx = Math.floor(x)
      const cy = Math.floor(y)
      if (cx < 1 || cy < 1 || cx >= w - 1 || cy >= h - 1) return dist
      const cell = idx(cx, cy)
      if (cell === head || recent.has(cell)) continue
      if (trail[cell] !== 0 && !(ignoreForeign && trail[cell] !== player.id)) return dist
    }
    return 20
  }

  function wouldCrossOwnTrail(player, angle) {
    const dt = tickMs / 1000
    const maxTurn = TURN_RATE * dt
    const recent = new Set(player.trailCells.slice(-4))
    let heading = player.heading
    let x = player.x
    let y = player.y
    for (let step = 0; step < 5; step += 1) {
      heading += Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(angle - heading)))
      const nx = x + Math.cos(heading)
      const ny = y + Math.sin(heading)
      const crossed = cellsCrossed(x, y, nx, ny)
      if (crossed.out) return true
      if (crossed.cells.some((cell) => trail[cell] === player.id && !recent.has(cell))) return true
      x = nx
      y = ny
    }
    return false
  }

  function ownCentroid(player) {
    const cx = Math.floor(player.x)
    const cy = Math.floor(player.y)
    let sx = 0
    let sy = 0
    let count = 0
    for (let y = Math.max(0, cy - 12); y <= Math.min(h - 1, cy + 12); y += 1) {
      for (let x = Math.max(0, cx - 12); x <= Math.min(w - 1, cx + 12); x += 1) {
        if (land[idx(x, y)] !== player.id) continue
        sx += x + 0.5
        sy += y + 0.5
        count += 1
      }
    }
    if (!count) return { x: player.x, y: player.y }
    return { x: sx / count, y: sy / count }
  }

  function steerBots() {
    for (const player of players.values()) {
      if (!player.bot || !player.alive || !player.inRound) continue
      if (player.botTurn == null) player.botTurn = player.id % 2 === 0 ? 1 : -1
      const config = BOT_LEVELS[player.level] ?? BOT_LEVELS.normal
      if (player.trailCells.length > 0) {
        player.restUntil = null
      } else if (config.rest && player.onOwn) {
        // Back on its own land: idle in a small circle before the next trip.
        if (player.restUntil == null) player.restUntil = tickCount + config.rest
        if (tickCount < player.restUntil) {
          player.turn = 1
          player.aim = null
          continue
        }
      }
      let preferred
      if (player.onOwn && player.trailCells.length === 0) {
        const center = ownCentroid(player)
        preferred = Math.atan2(player.y - center.y, player.x - center.x)
      } else if (player.trailCells.length > config.homeAt) {
        const home = nearestOwn(player)
        preferred = home
          ? Math.atan2(home.y + 0.5 - player.y, home.x + 0.5 - player.x)
          : player.heading + player.botTurn * 0.15
      } else {
        const prey = config.hunt && player.trailCells.length > 10 ? nearestForeignTrail(player, 25) : null
        preferred = prey
          ? Math.atan2(prey.y + 0.5 - player.y, prey.x + 0.5 - player.x)
          : player.heading + player.botTurn * 0.15
      }
      let bestAngle = player.heading
      let bestScore = -Infinity
      for (let step = -8; step <= 8; step += 1) {
        const angle = player.heading + step * 0.22
        const room = clearance(player, angle, config.hunt)
        const turn = Math.abs(wrapAngle(angle - preferred))
        const crosses = wouldCrossOwnTrail(player, angle)
        const wobble = config.noise ? (random() - 0.5) * config.noise : 0
        const score = room * 5 - turn - (room < 9 ? 200 : 0) - (crosses ? 500 : 0) + wobble
        if (score > bestScore) {
          bestScore = score
          bestAngle = angle
        }
      }
      const diff = wrapAngle(bestAngle - player.heading)
      if (Math.abs(diff) > 0.08) player.botTurn = diff > 0 ? 1 : -1
      player.aim = bestAngle
      player.turn = 0
    }
  }

  function vulnerableOwner(cell) {
    const owner = trail[cell]
    if (!owner || land[cell] === owner) return 0
    return owner
  }

  function step() {
    steerBots()
    const dt = tickMs / 1000
    const distance = dt * (1000 / tickMs)
    const moving = [...players.values()].filter((player) => player.inRound && player.alive && player.connected)
    for (const player of moving) applyHeading(player, dt)

    const moves = moving.map((player) => {
      const nx = player.x + Math.cos(player.heading) * distance
      const ny = player.y + Math.sin(player.heading) * distance
      return { player, nx, ny, ...cellsCrossed(player.x, player.y, nx, ny) }
    })

    const doomed = new Map()
    const doom = (player, reason, killer) => {
      if (!player || !player.alive || doomed.has(player.id)) return
      doomed.set(player.id, { reason, killer: killer ?? null })
    }

    for (const move of moves) {
      if (move.out) doom(move.player, 'wall', null)
    }

    const groups = new Map()
    for (const move of moves) {
      if (doomed.has(move.player.id) || move.out) continue
      const key = idx(Math.floor(move.nx), Math.floor(move.ny))
      const group = groups.get(key)
      if (group) group.push(move)
      else groups.set(key, [move])
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const head = idx(Math.floor(group[0].nx), Math.floor(group[0].ny))
      const trailOwner = vulnerableOwner(head)
      if (trailOwner) doom(players.get(trailOwner), 'cut', group[0].player)
      for (const move of group) doom(move.player, 'crash', null)
    }

    const selfClosed = new Set()
    for (const move of moves) {
      if (doomed.has(move.player.id)) continue
      for (const cell of move.cells) {
        const trailOwner = vulnerableOwner(cell)
        if (!trailOwner) continue
        if (trailOwner === move.player.id) selfClosed.add(move.player.id)
        else doom(players.get(trailOwner), 'cut', move.player)
      }
    }

    for (const [id, info] of doomed) kill(players.get(id), info.reason, info.killer)

    const returning = []
    for (const move of moves) {
      const player = move.player
      if (!player.alive || move.out) continue
      let outside = !player.onOwn
      for (const cell of move.cells) {
        if (land[cell] === player.id) {
          if (outside && player.trailCells.length) returning.push(player)
          outside = false
          player.onOwn = true
        } else if (trail[cell] !== player.id) {
          setTrail(cell, player.id)
          player.trailCells.push(cell)
          outside = true
          player.onOwn = false
        } else {
          outside = true
          player.onOwn = false
        }
      }
      player.x = move.nx
      player.y = move.ny
      if (selfClosed.has(player.id) && player.trailCells.length && !returning.includes(player)) {
        returning.push(player)
      }
    }
    for (const player of returning) {
      if (!player.alive) continue
      capture(player)
      player.onOwn = true
    }
  }

  function tick(now) {
    nowMs = now ?? Date.now()
    clearPatch()
    if (phase === 'lobby' || phase === 'over') return pack()

    if (phase === 'countdown') {
      countdownRemaining -= tickMs
      if (countdownRemaining > 0) {
        const dt = tickMs / 1000
        for (const player of players.values()) {
          if (player.inRound && player.alive) applyHeading(player, dt)
        }
        return pack()
      }
      phase = 'play'
      endsAt = nowMs + durationMs
    }

    if (phase === 'play') {
      if (nowMs >= endsAt) {
        phase = 'over'
        return pack()
      }
      tickCount += 1
      step()
      const seated = [...players.values()].filter((player) => player.inRound)
      const alive = seated.filter((player) => player.alive).length
      if (seated.length > 1 && alive <= 1) phase = 'over'
      if (nowMs >= endsAt) phase = 'over'
    }
    return pack({ resync: phase === 'play' && tickCount % 20 === 0 })
  }

  // Full sim snapshot for host migration: another browser can take over
  // the room from this state with no shared memory. Plain data only
  // (arrays, no Uint8Array) so it survives JSON over a DataChannel.
  // Game time pauses while nobody ticks, so msLeft stays valid.
  function exportState() {
    return {
      v: 1,
      w,
      h,
      phase,
      durationMs,
      msLeft: phase === 'countdown'
        ? countdownRemaining
        : phase === 'play'
          ? Math.max(0, endsAt - nowMs)
          : 0,
      countdownRemaining,
      tickCount,
      land: Array.from(land),
      trail: Array.from(trail),
      players: [...players.values()].map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        x: player.x,
        y: player.y,
        heading: player.heading,
        turn: player.turn,
        aim: player.aim,
        dir: player.dir,
        queued: player.queued,
        alive: player.alive,
        bot: player.bot,
        level: player.level ?? null,
        connected: player.connected,
        inRound: player.inRound,
        onOwn: player.onOwn,
        kills: player.kills,
        trailCells: [...player.trailCells],
        out: player.out ? { ...player.out } : null,
        botTurn: player.botTurn ?? null,
        restUntil: player.restUntil ?? null,
      })),
    }
  }

  // Restore a snapshot from exportState. The previous host is marked
  // disconnected (downId) and hosting passes to hostId explicitly, so the
  // outcome does not depend on Map insertion order. Returns false when the
  // snapshot is for a different board or build.
  function importState(state, { downId = null, hostId: nextHost = null } = {}) {
    if (!state || state.v !== 1 || state.w !== w || state.h !== h) return false
    if (state.phase !== 'lobby' && state.phase !== 'countdown' && state.phase !== 'play' && state.phase !== 'over') return false
    phase = state.phase
    durationMs = state.durationMs ?? durationMs
    countdownRemaining = state.countdownRemaining ?? 0
    tickCount = state.tickCount ?? 0
    endsAt = state.phase === 'play' ? Date.now() + Math.max(0, state.msLeft ?? 0) : 0
    land.set(state.land)
    trail.set(state.trail)
    players.clear()
    for (const saved of state.players ?? []) {
      players.set(saved.id, {
        id: saved.id,
        name: saved.name,
        color: saved.color,
        x: saved.x,
        y: saved.y,
        heading: saved.heading,
        turn: saved.turn,
        aim: saved.aim,
        dir: saved.dir,
        queued: saved.queued,
        alive: saved.alive,
        bot: saved.bot,
        level: saved.level ?? undefined,
        connected: saved.connected,
        inRound: saved.inRound,
        onOwn: saved.onOwn,
        landCount: 0,
        kills: saved.kills,
        trailCells: [...(saved.trailCells ?? [])],
        out: saved.out ? { ...saved.out } : null,
        botTurn: saved.botTurn ?? undefined,
        restUntil: saved.restUntil ?? undefined,
      })
    }
    for (let i = 0; i < land.length; i += 1) {
      const owner = players.get(land[i])
      if (owner) owner.landCount += 1
    }
    if (downId != null) {
      const down = players.get(downId)
      if (down) down.connected = false
    }
    if (nextHost != null && players.get(nextHost)?.connected) hostId = nextHost
    else electHost()
    clearPatch()
    return true
  }

  return {
    w,
    h,
    tickMs,
    land,
    trail,
    get phase() {
      return phase
    },
    get hostId() {
      return hostId
    },
    get durationMs() {
      return durationMs
    },
    addPlayer,
    addBot,
    removeBot,
    removePlayer,
    vacate,
    returnToLobby,
    rename,
    markConnected,
    setDirection,
    setSteer,
    setAim,
    start,
    tick,
    pack,
    scores,
    resultLog,
    exportState,
    importState,
    player(id) {
      return players.get(id) ?? null
    },
  }
}
