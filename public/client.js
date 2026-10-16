const view = document.querySelector('#view')
const hud = document.querySelector('#hud')
const board = document.querySelector('#board')
const clock = document.querySelector('#clock')
const mini = document.querySelector('#mini')
const status = document.querySelector('#status')
const restartBtn = document.querySelector('#restart')
const overlay = document.querySelector('#overlay')
const card = document.querySelector('#card')
const blurb = document.querySelector('#blurb')
const joinRow = document.querySelector('#join-row')
const nameInput = document.querySelector('#name')
const room = document.querySelector('#room')
const nickLabel = document.querySelector('#nick-label')
const nick = document.querySelector('#nick')
const roster = document.querySelector('#roster')
const share = document.querySelector('#share')
const lengthLabel = document.querySelector('#length-label')
const minutes = document.querySelector('#minutes')
const startBtn = document.querySelector('#start')
const addBotBtn = document.querySelector('#add-bot')
const botRow = document.querySelector('#bot-row')
const botLevel = document.querySelector('#bot-level')
const steer = document.querySelector('#steer')
const waiting = document.querySelector('#waiting')
const results = document.querySelector('#results')
const error = document.querySelector('#error')
const linkNote = document.querySelector('#link-note')

const RULES = 'Close a loop to take the ground inside it. Cross a line and that player is out. Most ground when the clock stops wins. Move with WASD or the arrow keys.'
const PAPER = [10, 12, 20]
const KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
}

const ctx = view.getContext('2d')
const sheet = document.createElement('canvas')
const sheetCtx = sheet.getContext('2d')
const miniCtx = mini.getContext('2d')

let joined = false
let socket = null
let sendQueue = []
let myId = null
let hostId = null
let phase = 'lobby'
let urls = { local: '', shared: [] }
let w = 0
let h = 0
let tickMs = 110
let land = null
let trail = null
let image = null
let bodies = new Map()
let camX = 0
let camY = 0
let camReady = false
let pointer = null
let lastSteer = null
let viewOriginX = 0
let viewOriginY = 0
let viewCell = 20
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' }
let goUntil = 0
let lastPhase = 'lobby'
const landColors = new Map()
const trailCells = new Set()
const boardRows = new Map()
const goEl = document.querySelector('#go')
const feed = document.querySelector('#feed')
const howto = document.querySelector('#howto')
const muteBtn = document.querySelector('#mute')
const musicBtn = document.querySelector('#music')
const touchPad = document.querySelector('#touch')
const touchLeft = document.querySelector('#touch-left')
const touchRight = document.querySelector('#touch-right')
let lastFrameAt = performance.now()
let sessionWins = {}
let resultsKey = ''
const trailColors = new Map()

nameInput.value = localStorage.getItem('territory-name') || ''

function send(obj) {
  const data = JSON.stringify(obj)
  if (socket && socket.readyState === 1) socket.send(data)
  else sendQueue.push(data)
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  socket = new WebSocket(`${protocol}://${location.host}`)
  socket.addEventListener('open', () => {
    error.textContent = ''
    for (const data of sendQueue) socket.send(data)
    sendQueue = []
    const token = sessionStorage.getItem('territory-token')
    if (token) send({ type: 'join', name: nameInput.value, token })
  })
  socket.addEventListener('message', (event) => {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }
    onMessage(msg)
  })
  socket.addEventListener('close', () => {
    if (phase === 'lobby') error.textContent = 'Reconnecting...'
    setTimeout(connect, 1000)
  })
}

function onMessage(msg) {
  if (msg.type === 'hello') {
    myId = msg.playerId
    hostId = msg.hostId
    urls = msg.urls || urls
    if (msg.tickMs) tickMs = msg.tickMs
    if (msg.token) sessionStorage.setItem('territory-token', msg.token)
    joined = true
    return
  }
  if (msg.type === 'error') {
    error.textContent = msg.message || ''
    return
  }
  if (msg.hostId != null) hostId = msg.hostId
  if (msg.wins) sessionWins = msg.wins
  if (msg.tickMs) tickMs = msg.tickMs

  if (msg.type === 'lobby') {
    if ((phase === 'countdown' || phase === 'play') && msg.phase !== 'lobby') return
    phase = msg.phase
    if (msg.phase === 'lobby') {
      lastPhase = 'lobby'
      land = null
      trail = null
      trailCells.clear()
    }
    urls = msg.urls || urls
    showCard(msg)
    return
  }

  if (msg.type === 'full' || msg.type === 'over') {
    w = msg.w
    h = msg.h
    land = decode(msg.land)
    trail = decode(msg.trail)
    rebuildTrailSet()
    notePhase(msg.phase, msg)
    phase = msg.phase
    if (msg.phase === 'countdown') camReady = false
    syncPlayers(msg.players || [])
    paintHud(msg)
    if (msg.phase === 'over') showCard(msg)
    else hideCard()
    return
  }

  if (msg.type === 'tick') {
    if (!land) return
    notePhase(msg.phase, msg)
    phase = msg.phase
    applyRuns(msg.landRuns || [])
    applyTrail(msg.trail || [])
    syncPlayers(msg.players || [])
    paintHud(msg)
    if (msg.phase === 'over') showCard(msg)
  }
}

function notePhase(next, msg) {
  if (lastPhase === 'countdown' && next === 'play') {
    goUntil = performance.now() + 700
    flashGo()
  }
  if (lastPhase === 'play' && next === 'over') celebrateWin(msg?.scores)
  lastPhase = next
}

function retrigger(el, name) {
  el.classList.remove(name)
  void el.offsetWidth
  el.classList.add(name)
}

function flashGo() {
  sfx.go()
  goEl.hidden = false
  retrigger(goEl, 'show')
  setTimeout(() => { goEl.hidden = true }, 1000)
}

function celebrateWin(scores) {
  const winner = scores?.list?.find((row) => row.id === scores.winnerId)
  const colors = winner ? [hex(winner.color)] : []
  fx.celebrate({ colors, winner: Boolean(winner) })
  if (winner && winner.id === myId) sfx.win()
  else if (myId && scores?.list?.some((row) => row.id === myId)) sfx.lose()
}

function rebuildTrailSet() {
  trailCells.clear()
  for (let i = 0; i < trail.length; i += 1) if (trail[i]) trailCells.add(i)
}

function decode(value) {
  const bin = atob(value)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function applyRuns(runs) {
  const taken = new Map()
  for (const [start, len, value] of runs) {
    if (value) {
      for (let i = start; i < start + len; i += 1) {
        if (land[i] === value) continue
        const list = taken.get(value)
        if (list) list.push(i)
        else taken.set(value, [i])
      }
    }
    land.fill(value, start, start + len)
  }
  for (const [owner, cells] of taken) celebrateCapture(owner, cells)
}

const FEED_MAX = 4
const FEED_MS = 5000

function pushFeed(text, color) {
  const item = document.createElement('li')
  item.textContent = text
  item.style.borderLeftColor = color
  feed.append(item)
  while (feed.children.length > FEED_MAX) feed.firstElementChild.remove()
  setTimeout(() => {
    item.classList.add('fade')
    setTimeout(() => item.remove(), 450)
  }, FEED_MS)
}

function celebrateCapture(owner, cells) {
  if (cells.length < 3) return
  const body = bodies.get(owner)
  const point = body ? pose(body) : null
  const pct = (cells.length / (w * h)) * 100
  if (pct >= 1 && body) pushFeed(viewHelpers.captureFeedText(body.name, pct), body.color)
  sfx.capture(Math.min(1, pct / 3), owner === myId ? 1 : 0.35)
  fx.capture({
    cells,
    w,
    color: landColors.get(owner) || [57, 255, 210],
    ox: point?.x,
    oy: point?.y,
    label: pct >= 0.1 ? `+${pct.toFixed(1)}%` : `+${cells.length}`,
  })
}

function celebrateDeath(player) {
  const names = new Map([...bodies].map(([id, body]) => [id, body.name]))
  pushFeed(viewHelpers.deathFeedText(player, names), player.color)
  const mine = player.id === myId
  const me = myId ? bodies.get(myId) : null
  let near = 0.3
  if (me && !mine) near = Math.max(0.25, Math.min(0.7, 1 - Math.hypot(me.toX - player.x, me.toY - player.y) / 45))
  fx.death({ x: player.x, y: player.y, color: landColors.get(player.id) || [255, 255, 255], mine, near })
  sfx.death(mine ? 1 : near)
}

function applyTrail(pairs) {
  for (const [index, id] of pairs) {
    trail[index] = id
    if (id) trailCells.add(index)
    else trailCells.delete(index)
  }
}

function syncPlayers(list) {
  const seen = new Set()
  for (const player of list) {
    seen.add(player.id)
    rememberColor(player)
    const prev = bodies.get(player.id)
    if (prev && prev.alive && !player.alive) celebrateDeath(player)
    const current = prev ? pose(prev) : { x: player.x, y: player.y }
    const jump = !prev || Math.hypot(current.x - player.x, current.y - player.y) > 2
    bodies.set(player.id, {
      ...player,
      fromX: jump ? player.x : current.x,
      fromY: jump ? player.y : current.y,
      toX: player.x,
      toY: player.y,
      at: performance.now(),
    })
  }
  for (const id of bodies.keys()) {
    if (!seen.has(id)) bodies.delete(id)
  }
}

function pose(body) {
  const t = Math.min(1, (performance.now() - body.at) / tickMs)
  return {
    x: body.fromX + (body.toX - body.fromX) * t,
    y: body.fromY + (body.toY - body.fromY) * t,
  }
}

function rememberColor(player) {
  if (landColors.has(player.id)) return
  const rgb = hex(player.color)
  landColors.set(player.id, rgb)
  trailColors.set(player.id, rgb.map((channel) => Math.round(channel + (255 - channel) * 0.42)))
}

function hex(value) {
  const n = Number.parseInt(value.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function showJoin() {
  howto.hidden = false
  overlay.hidden = false
  hud.hidden = true
  joinRow.hidden = false
  room.hidden = true
  blurb.textContent = RULES
}

function showCard(msg) {
  if (!joined) {
    showJoin()
    return
  }
  overlay.hidden = false
  hud.hidden = true
  const scores = msg.scores
  const ended = msg.phase === 'over' && scores
  blurb.textContent = ended ? winnerText(scores) : RULES
  howto.hidden = Boolean(ended)
  const champion = ended ? scores.list.find((row) => row.id === scores.winnerId) : null
  blurb.classList.toggle('winner', Boolean(champion))
  if (champion) blurb.style.setProperty('--win', champion.color)
  const host = myId != null && myId === hostId
  joinRow.hidden = joined
  room.hidden = !joined
  results.hidden = !ended
  lengthLabel.hidden = !host || ended
  minutes.hidden = !host || ended
  const listed = viewHelpers.listedPlayers(msg)
  botRow.hidden = !host
  const bots = viewHelpers.botCount(msg)
  addBotBtn.disabled = bots >= viewHelpers.MAX_BOTS
  addBotBtn.textContent = bots >= viewHelpers.MAX_BOTS ? 'Bot limit reached' : 'Add bot'
  startBtn.hidden = false
  startBtn.disabled = !host
  startBtn.textContent = host ? (ended ? 'Play again' : 'Start') : 'Waiting for the host'
  nickLabel.hidden = myId == null
  nick.hidden = myId == null
  syncNick(viewHelpers.peopleForNick(msg))
  if (ended) {
    roster.replaceChildren()
    renderScores(scores.list)
  } else {
    results.replaceChildren()
    resultsKey = ''
    renderRoster(msg.roster || [])
  }
  renderShare(host && !ended)
  waiting.textContent = ended ? '' : waitText(host)
  linkNote.textContent = host && !ended ? 'Send a VPN address. Localhost only works on this machine.' : ''
}

const { winnerText } = viewHelpers

function waitText(host) {
  if (myId == null) return 'You are watching this one. You will get a seat when the next round starts.'
  if (host) return 'You are the host. Start when everyone is in. The countdown begins after you click Start.'
  return ''
}

let savedNick = ''

function syncNick(list) {
  const me = list.find((player) => player.id === myId)
  if (!me) return
  savedNick = me.name
  if (document.activeElement === nick) return
  nick.value = me.name
}

function commitNick() {
  const name = nick.value.trim()
  if (!name) {
    nick.value = savedNick
    return
  }
  if (name === savedNick) return
  localStorage.setItem('territory-name', name)
  send({ type: 'rename', name })
}

function renderRoster(list) {
  roster.replaceChildren()
  for (const player of list) roster.append(playerRow(player, false))
}

function renderScores(list) {
  const key = JSON.stringify(list.map((row) => [row.id, row.land, row.alive, row.kills])) + myId + JSON.stringify(sessionWins)
  if (key === resultsKey && results.childElementCount) return
  resultsKey = key
  results.replaceChildren()
  const max = Math.max(1, ...list.map((row) => row.land))
  for (const row of list) {
    const item = playerRow(row, true)
    const bar = document.createElement('div')
    bar.className = 'bar'
    const fill = document.createElement('span')
    fill.style.width = `${(row.land / max) * 100}%`
    fill.style.background = row.color
    fill.style.boxShadow = `0 0 8px ${row.color}`
    bar.append(fill)
    item.append(bar)
    results.append(item)
  }
}

function playerRow(player, scored) {
  const item = document.createElement('li')
  if (player.alive === false && scored) item.className = 'out'
  const swatch = document.createElement('span')
  swatch.className = 'swatch'
  swatch.style.background = player.color
  swatch.style.color = player.color
  const name = document.createElement('span')
  const mine = player.id === myId ? ' (you)' : ''
  const host = player.id === hostId && !scored ? ' (host)' : ''
  const bot = player.bot ? ` (${viewHelpers.botLabel(player)})` : ''
  name.textContent = `${player.name}${mine}${host}${bot}`
  const record = viewHelpers.winsLabel(sessionWins, player.name)
  if (record) {
    const badge = document.createElement('span')
    badge.className = 'wins'
    badge.textContent = record
    name.append(' ', badge)
  }
  const stat = document.createElement('span')
  if (scored) {
    const cuts = player.kills ? ` (${player.kills})` : ''
    stat.textContent = `${player.pct.toFixed(1)}%${cuts}`
  }
  if (!scored && player.bot && myId != null && myId === hostId && (phase === 'lobby' || phase === 'over')) {
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove-bot'
    remove.textContent = '×'
    remove.setAttribute('aria-label', `Remove ${player.name}`)
    remove.addEventListener('click', () => send({ type: 'removeBot', id: player.id }))
    stat.append(remove)
  }
  item.append(swatch, name, stat)
  return item
}

function renderShare(show) {
  share.replaceChildren()
  if (!show) return
  const title = document.createElement('p')
  title.textContent = urls.shared?.length ? 'Others on the VPN open:' : 'No other network address found. Check that the VPN is connected.'
  share.append(title)
  for (const url of urls.shared || []) {
    const input = document.createElement('input')
    input.className = 'share-url'
    input.name = 'share-url'
    input.setAttribute('aria-label', 'Address to share')
    input.readOnly = true
    input.value = url
    input.addEventListener('focus', () => input.select())
    share.append(input)
  }
}

function hideCard() {
  if (!joined) {
    showJoin()
    return
  }
  overlay.hidden = true
  hud.hidden = false
}

function paintHud(msg) {
  const counting = msg.phase === 'countdown'
  const text = counting ? String(Math.max(1, Math.ceil(msg.msLeft / 1000))) : formatClock(msg.msLeft)
  const changed = clock.textContent !== text
  clock.classList.toggle('count', counting)
  clock.classList.toggle('low', msg.phase === 'play' && msg.msLeft <= 10_000)
  clock.textContent = text
  if (changed && counting) {
    retrigger(clock, 'pop')
    sfx.tick()
  }
  const rows = [...(msg.players || [])].sort((a, b) => b.land - a.land || b.kills - a.kills || a.name.localeCompare(b.name))
  paintBoard(rows)
  status.textContent = statusText()
  const mine = myId ? (msg.players || []).find((player) => player.id === myId) : null
  touchPad.hidden = !(mine && mine.alive && (msg.phase === 'play' || msg.phase === 'countdown'))
  const host = myId != null && myId === hostId
  restartBtn.hidden = !(host && (msg.phase === 'play' || msg.phase === 'countdown'))
}

// Rows are kept between ticks so they can slide when the ranking changes
// and flash when a player gains ground.
function paintBoard(rows) {
  const before = new Map()
  for (const [id, row] of boardRows) before.set(id, row.el.getBoundingClientRect().top)
  const seen = new Set()
  for (const player of rows) {
    seen.add(player.id)
    let row = boardRows.get(player.id)
    if (!row) {
      const el = document.createElement('li')
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      const name = document.createElement('span')
      const stat = document.createElement('span')
      el.append(swatch, name, stat)
      row = { el, swatch, name, stat, pct: null }
      boardRows.set(player.id, row)
      el.classList.add('enter')
    }
    row.el.classList.toggle('out', !player.alive)
    row.swatch.style.background = player.color
    row.swatch.style.color = player.color
    row.name.textContent = player.id === myId ? `${player.name} (you)` : player.name
    const pct = land ? (player.land / (w * h)) * 100 : null
    row.stat.textContent = pct == null ? '' : `${pct.toFixed(1)}%`
    if (pct != null && row.pct != null && player.land > row.landRaw) {
      row.stat.animate(
        [
          { transform: 'scale(1.5)', color: '#ffffff', textShadow: `0 0 12px ${player.color}` },
          { transform: 'scale(1)', color: 'inherit', textShadow: '0 0 0 transparent' },
        ],
        { duration: 650, easing: 'cubic-bezier(.2,.9,.3,1)' },
      )
    }
    row.pct = pct
    row.landRaw = player.land
  }
  for (const [id, row] of boardRows) {
    if (seen.has(id)) continue
    row.el.remove()
    boardRows.delete(id)
  }
  const order = rows.map((player) => boardRows.get(player.id).el)
  const current = [...board.children]
  if (order.length !== current.length || order.some((el, i) => el !== current[i])) {
    for (const el of order) board.append(el)
  }
  for (const [id, row] of boardRows) {
    const was = before.get(id)
    if (was == null) continue
    const dy = was - row.el.getBoundingClientRect().top
    if (Math.abs(dy) < 1) continue
    row.el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
      duration: 420,
      easing: 'cubic-bezier(.2,.9,.3,1)',
    })
  }
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function statusText() {
  const me = myId ? bodies.get(myId) : null
  if (me && !me.alive && (phase === 'play' || phase === 'countdown')) {
    if (!me.out) return 'Watcher'
    return `Watcher. ${reasonText(me)}`
  }
  if (!myId && (phase === 'play' || phase === 'countdown')) return 'Watching'
  return ''
}

function reasonText(player) {
  const killer = player.out.by ? bodies.get(player.out.by) : null
  const name = killer?.name
  if (player.out.reason === 'cut') return name ? `Cut by ${name}` : 'Your line was cut'
  if (player.out.reason === 'enclosed') return name ? `${name} boxed you in` : 'You got boxed in'
  if (player.out.reason === 'wall') return 'You hit the wall'
  if (player.out.reason === 'crash') return 'You crashed'
  if (player.out.reason === 'left') return 'You left the round'
  return 'You are out'
}

function frame() {
  const frameAt = performance.now()
  const dt = Math.min(0.05, (frameAt - lastFrameAt) / 1000)
  lastFrameAt = frameAt
  fx.update(dt)
  const dpr = window.devicePixelRatio || 1
  const cssW = window.innerWidth
  const cssH = window.innerHeight
  const pixelW = Math.round(cssW * dpr)
  const pixelH = Math.round(cssH * dpr)
  if (view.width !== pixelW || view.height !== pixelH) {
    view.width = pixelW
    view.height = pixelH
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#070910'
  ctx.fillRect(0, 0, cssW, cssH)
  if (land && w && h) {
    const me = myId ? bodies.get(myId) : null
    const follow = me && me.alive && phase !== 'over'
    let originX = 0
    let originY = 0
    let cell = viewHelpers.followCellSize(cssW)
    if (follow) {
      const point = pose(me)
      if (!camReady) {
        camX = point.x
        camY = point.y
        camReady = true
      } else {
        camX += (point.x - camX) * 0.18
        camY += (point.y - camY) * 0.18
      }
      originX = Math.round(cssW / 2 - camX * cell)
      originY = Math.round(cssH / 2 - camY * cell)
    } else {
      cell = Math.min((cssW - 48) / w, (cssH - 48) / h)
      originX = (cssW - w * cell) / 2
      originY = (cssH - h * cell) / 2
      camReady = false
    }
    const [shakeX, shakeY] = fx.shake(dt)
    ctx.save()
    ctx.translate(shakeX, shakeY)
    drawRoundedMap(cell)
    ctx.save()
    ctx.filter = 'blur(12px)'
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(sheet, originX, originY)
    ctx.restore()
    viewOriginX = originX
    viewOriginY = originY
    viewCell = cell
    steerTowardCursor(me)
    ctx.drawImage(sheet, originX, originY)
    ctx.strokeStyle = 'rgba(57, 255, 210, 0.45)'
    ctx.shadowColor = '#39ffd2'
    ctx.shadowBlur = 12
    ctx.strokeRect(originX - 0.5, originY - 0.5, w * cell + 1, h * cell + 1)
    ctx.shadowBlur = 0
    for (const body of bodies.values()) {
      if (!body.alive) continue
      const point = pose(body)
      if (phase === 'play') fx.trailSparks(point.x, point.y, body.heading || 0, hex(body.color), dt)
      drawHead(originX + point.x * cell, originY + point.y * cell, cell, body)
    }
    const myPoint = me && me.alive && phase === 'play' ? pose(me) : null
    fx.drawWorld(ctx, {
      ox: originX,
      oy: originY,
      cell,
      vw: cssW,
      vh: cssH,
      t: frameAt / 1000,
      w,
      trailCells,
      danger: myPoint ? { trail, myId, x: myPoint.x, y: myPoint.y } : null,
    })
    if (myPoint) {
      fx.edgeWarning(ctx, { ox: originX, oy: originY, cell, w, h, x: myPoint.x, y: myPoint.y, heading: me.heading || 0, t: frameAt / 1000 })
    }
    ctx.restore()
    if (mini.width !== w) mini.width = w
    if (mini.height !== h) mini.height = h
    miniCtx.setTransform(1, 0, 0, 1, 0, 0)
    miniCtx.clearRect(0, 0, mini.width, mini.height)
    miniCtx.fillStyle = '#070910'
    miniCtx.fillRect(0, 0, mini.width, mini.height)
    miniCtx.imageSmoothingEnabled = true
    miniCtx.drawImage(sheet, 0, 0, mini.width, mini.height)
  }
  if (phase === 'play' || phase === 'countdown') status.textContent = statusText()
  fx.drawScreen(dt, cssW, cssH, dpr)
  requestAnimationFrame(frame)
}

function steerTowardCursor(me) {
  if (!steer.checked || !pointer || !me?.alive) return
  if (phase !== 'play' && phase !== 'countdown') return
  const point = pose(me)
  const dx = (pointer.x - viewOriginX) / viewCell - point.x
  const dy = (pointer.y - viewOriginY) / viewCell - point.y
  if (Math.hypot(dx, dy) < 0.8) return
  const angle = Math.atan2(dy, dx)
  if (lastSteer != null && Math.abs(angle - lastSteer) < 0.08) return
  lastSteer = angle
  send({ type: 'aim', angle })
}

function ownerAt(x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0
  const index = y * w + x
  return trail[index] || land[index] || 0
}

function fillStyleFor(id, isTrail) {
  const rgb = isTrail ? trailColors.get(id) : landColors.get(id)
  if (!rgb) return '#39ffd2'
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
}

function drawRoundedMap(cellSize) {
  const width = Math.ceil(w * cellSize)
  const height = Math.ceil(h * cellSize)
  if (sheet.width !== width || sheet.height !== height) {
    sheet.width = width
    sheet.height = height
  }
  sheetCtx.clearRect(0, 0, width, height)
  sheetCtx.fillStyle = '#070910'
  sheetCtx.fillRect(0, 0, width, height)
  const radius = cellSize * 0.36
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = y * w + x
      const trailId = trail[index]
      const id = trailId || land[index]
      if (!id) continue
      const same = (nx, ny) => ownerAt(nx, ny) === id
      const tl = !same(x, y - 1) && !same(x - 1, y)
      const tr = !same(x, y - 1) && !same(x + 1, y)
      const br = !same(x, y + 1) && !same(x + 1, y)
      const bl = !same(x, y + 1) && !same(x - 1, y)
      const style = fillStyleFor(id, Boolean(trailId))
      const overlap = Math.max(1.25, cellSize * 0.14)
      sheetCtx.fillStyle = style
      sheetCtx.beginPath()
      sheetCtx.roundRect(x * cellSize, y * cellSize, cellSize + overlap, cellSize + overlap, [
        tl ? radius : 0,
        tr ? radius : 0,
        br ? radius : 0,
        bl ? radius : 0,
      ])
      sheetCtx.fill()
      if (ownerAt(x + 1, y + 1) === id && !same(x + 1, y) && !same(x, y + 1)) {
        const seam = cellSize * 0.72
        sheetCtx.fillRect((x + 1) * cellSize - seam / 2, (y + 1) * cellSize - seam / 2, seam, seam)
      }
    }
  }
}

function drawHead(x, y, cell, body) {
  const radius = Math.max(3, cell * 0.34)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(body.heading || 0)
  ctx.shadowColor = body.color
  ctx.shadowBlur = 18
  ctx.beginPath()
  ctx.fillStyle = body.color
  ctx.arc(0, 0, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  if (body.id === myId && phase !== 'over') {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 170)
    ctx.beginPath()
    ctx.arc(0, 0, radius * (1.8 + 0.7 * pulse), 0, Math.PI * 2)
    ctx.strokeStyle = body.color
    ctx.globalAlpha = 0.65 - 0.45 * pulse
    ctx.lineWidth = 2.5
    ctx.shadowColor = body.color
    ctx.shadowBlur = 14
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
  }
  ctx.fillStyle = '#f4fff8'
  ctx.fillRect(radius * 0.2, -radius * 0.18, radius * 0.9, radius * 0.36)
  ctx.restore()
  if (cell < 8) return
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.lineWidth = 3
  ctx.strokeStyle = '#070910'
  ctx.strokeText(body.name, x, y - radius - 8)
  ctx.fillStyle = body.color
  ctx.fillText(body.name, x, y - radius - 8)
}

card.addEventListener('submit', (event) => {
  event.preventDefault()
  const name = nameInput.value.trim()
  if (!name) return
  localStorage.setItem('territory-name', name)
  error.textContent = ''
  send({ type: 'join', name, token: sessionStorage.getItem('territory-token') || '' })
  sfx.startMusic()
})

nick.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  nick.blur()
})

nick.addEventListener('change', commitNick)

addBotBtn.addEventListener('click', () => {
  send({ type: 'bot', level: botLevel.value })
})

steer.checked = localStorage.getItem('territory-steer') === '1'
steer.addEventListener('change', () => {
  localStorage.setItem('territory-steer', steer.checked ? '1' : '0')
  lastSteer = null
})

window.addEventListener('pointermove', (event) => {
  pointer = { x: event.clientX, y: event.clientY }
})

startBtn.addEventListener('click', () => {
  error.textContent = ''
  send({ type: 'start', minutes: Number(minutes.value) })
})

restartBtn.addEventListener('click', () => {
  send({ type: 'restart' })
})

function paintMute() {
  const off = sfx.isMuted()
  muteBtn.textContent = off ? 'Sound off' : 'Sound on'
  muteBtn.setAttribute('aria-pressed', String(!off))
}

muteBtn.addEventListener('click', () => {
  sfx.setMuted(!sfx.isMuted())
  paintMute()
})
paintMute()

function paintMusic() {
  const off = sfx.isMusicMuted()
  musicBtn.textContent = off ? 'Music off' : 'Music on'
  musicBtn.setAttribute('aria-pressed', String(!off))
}

musicBtn.addEventListener('click', () => {
  sfx.setMusicMuted(!sfx.isMusicMuted())
  paintMusic()
})
paintMusic()

const heldTurn = { left: false, right: false }

function turnKey(key) {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left'
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right'
  return null
}

function sendTurn() {
  if (steer.checked) return
  send({ type: 'steer', turn: viewHelpers.turnFromHeld(heldTurn) })
}

// On-screen turn buttons for touch screens. They feed the same held-turn state
// as the keyboard, so the server sees no difference.
function bindTurnButton(button, side) {
  const active = () => myId && (phase === 'countdown' || phase === 'play')
  const press = (event) => {
    event.preventDefault()
    if (heldTurn[side]) return
    heldTurn[side] = true
    button.classList.add('down')
    if (active()) sendTurn()
  }
  const release = () => {
    if (!heldTurn[side]) return
    heldTurn[side] = false
    button.classList.remove('down')
    if (active()) sendTurn()
  }
  button.addEventListener('pointerdown', press)
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(type, release)
  button.addEventListener('contextmenu', (event) => event.preventDefault())
}

bindTurnButton(touchLeft, 'left')
bindTurnButton(touchRight, 'right')

window.addEventListener('keydown', (event) => {
  const target = event.target
  if (target instanceof Element && target.matches('input, select, textarea')) return
  const side = turnKey(event.key)
  if (!side) return
  event.preventDefault()
  if (event.repeat) return
  heldTurn[side] = true
  if (myId && (phase === 'countdown' || phase === 'play')) sendTurn()
})

window.addEventListener('keyup', (event) => {
  const side = turnKey(event.key)
  if (!side) return
  heldTurn[side] = false
  if (myId && (phase === 'countdown' || phase === 'play')) sendTurn()
})

connect()
requestAnimationFrame(frame)
