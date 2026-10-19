// ES module entry (Vite): styles come through the bundler so dev edits
// hot-reload, and the helper scripts below run for their globals.
import './style.css'
import './view-helpers.js'
import './sfx.js'
import './p2p.js'
import { fx } from './fx.js'

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
const picker = document.querySelector('#picker')
const pickHostBtn = document.querySelector('#pick-host')
const pickJoinBtn = document.querySelector('#pick-join')
const hostSetup = document.querySelector('#host-setup')
const hostNameInput = document.querySelector('#host-name')
const hostBackBtn = document.querySelector('#host-back')
const joinSetup = document.querySelector('#join-setup')
const guestNameInput = document.querySelector('#guest-name')
const joinBackBtn = document.querySelector('#join-back')
const scanBtn = document.querySelector('#scan-qr')
const scannerBox = document.querySelector('#scanner')
const scannerVideo = document.querySelector('#scanner-video')
const scannerCanvas = document.querySelector('#scanner-canvas')
const scannerHint = document.querySelector('#scanner-hint')
const scannerStopBtn = document.querySelector('#scanner-stop')
let scannerStream = null
let scannerRaf = 0
let scannerLast = 0
const hostRoomBtn = document.querySelector('#host-room')
const codeInput = document.querySelector('#code')
const joinRoomBtn = document.querySelector('#join-room')
const inviteRow = document.querySelector('#invite-row')
const qrBtn = document.querySelector('#show-qr')
const qrBox = document.querySelector('#qr')
const copyCodeBtn = document.querySelector('#copy-code')
const copyLinkBtn = document.querySelector('#copy-link')
const queryParams = new URLSearchParams(location.search)
const LOCAL_DEV = queryParams.has('local')
// Frame-time probe: ?fps=1 forces it on, otherwise the menu's Show FPS
// checkbox controls it. The choice is saved in this browser.
const fpsBox = document.querySelector('#show-fps')
let fpsOn = queryParams.has('fps')
let fpsEl = null
let fpsAcc = 0
let fpsCount = 0
let fpsAt = 0

function setFps(on) {
  fpsOn = Boolean(on)
  fpsBox.checked = fpsOn
  try {
    localStorage.setItem('territory-fps', fpsOn ? '1' : '0')
  } catch {
    // storage can be unavailable; the setting then lasts until reload
  }
  if (!fpsOn && fpsEl) {
    fpsEl.remove()
    fpsEl = null
    fpsAcc = 0
    fpsCount = 0
  }
}

if (!fpsOn) {
  try {
    fpsOn = localStorage.getItem('territory-fps') === '1'
  } catch {
    fpsOn = false
  }
}
fpsBox.checked = fpsOn
fpsBox.addEventListener('change', () => {
  setFps(fpsBox.checked)
})

// Hide mini map: drops the corner map for a cleaner board. The menu and
// feed slide back up to the corner via body.mini-hidden. Saved like the
// other menu toggles.
const miniBox = document.querySelector('#hide-mini')
let miniHiddenPref = false
try {
  miniHiddenPref = localStorage.getItem('territory-hide-mini') === '1'
} catch {
  miniHiddenPref = false
}

function paintMiniVisible() {
  mini.hidden = miniHiddenPref
  document.body.classList.toggle('mini-hidden', miniHiddenPref)
}

function setMiniHidden(hidden) {
  miniHiddenPref = Boolean(hidden)
  miniBox.checked = miniHiddenPref
  try {
    localStorage.setItem('territory-hide-mini', miniHiddenPref ? '1' : '0')
  } catch {
    // storage can be unavailable; the setting then lasts until reload
  }
  paintMiniVisible()
}

miniBox.checked = miniHiddenPref
miniBox.addEventListener('change', () => {
  setMiniHidden(miniBox.checked)
})
paintMiniVisible()
const roomCodeEl = document.querySelector('#room-code')
const startBtn = document.querySelector('#start')
const addBotBtn = document.querySelector('#add-bot')
const botRow = document.querySelector('#bot-row')
const botLevel = document.querySelector('#bot-level')
const steer = document.querySelector('#steer')
const waiting = document.querySelector('#waiting')
const results = document.querySelector('#results')
const error = document.querySelector('#error')
const linkNote = document.querySelector('#link-note')

const RULES = 'Close a loop to take the ground inside it. Cross a line and that player is out. Most ground when the clock stops wins. Move with the left and right arrow keys.'
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
// Pre-blurred copy of the map used for the neon glow. Rebuilt only when the
// map changes, so the hot frame loop never pays for a full-screen blur.
const glow = document.createElement('canvas')
const glowCtx = glow.getContext('2d')
const miniCtx = mini.getContext('2d')
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches
// Set whenever land/trail change; drawRoundedMap clears it after rebuilding
// the cached sheet + glow canvases.
let mapDirty = true
let mapVersion = 0
let miniVersion = -1
let lastSheetCell = 0

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
const fullBtn = document.querySelector('#full')
const menuBtn = document.querySelector('#menu-btn')
const menu = document.querySelector('#menu')
const touchPad = document.querySelector('#touch')

// Installable web app: the service worker caches the shell after the first
// visit, so the page loads offline and browsers offer installation.
if ('serviceWorker' in navigator) {
  globalThis.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js').catch(() => {})
  })
}
const touchLeft = document.querySelector('#touch-left')
const touchRight = document.querySelector('#touch-right')
let lastFrameAt = performance.now()
let lastStatusText = ''
let sessionWins = {}
let resultsKey = ''
// Connection mode: 'local' (Node server over WebSocket, same origin),
// 'host' (this browser runs the room, guests join over WebRTC), or
// 'guest' (playing in someone else's room over WebRTC).
let netMode = 'local'
let hostSession = null
let hostNet = null
let hostLocalKey = null
let hostedCode = ''
let guestConn = null
let guestQueue = []
let guestRoom = null // { code, name, token, redials }
let claiming = false // a takeover claim is in flight; redial timers stand down
let dialEpoch = 0 // each dial gets one; drop handling runs once per dial
let dropHandledEpoch = 0
// Takeover state: the latest full sim snapshot plus the freshest player
// list, so a guest can become the host if this browser goes away.
let lastMigrate = null
let lastPlayers = null
let lastHostId = null
let lastTickAt = 0
const trailColors = new Map()

const savedName = localStorage.getItem('territory-name') || ''
hostNameInput.value = savedName
guestNameInput.value = savedName
nameInput.value = savedName

function send(obj) {
  if (netMode === 'host') {
    if (hostSession) hostSession.guestMessage(hostLocalKey, obj)
    return
  }
  if (netMode === 'guest') {
    if (guestConn) {
      if (!guestConn.send(obj)) guestQueue.push(obj)
    } else {
      guestQueue.push(obj)
    }
    return
  }
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
    if (netMode !== 'local') return
    if (phase === 'lobby') error.textContent = 'Reconnecting...'
    setTimeout(connect, 1000)
  })
}

function stopLocalSocket() {
  if (socket) {
    const pending = socket
    socket = null
    try {
      pending.close()
    } catch {
      // ignore
    }
  }
  sendQueue = []
}

function onlineReady() {
  if (!window.P2P) return 'Online play did not load. Reload and try again.'
  return window.P2P.peerError()
}

function lockOnlineButtons(locked) {
  hostRoomBtn.disabled = locked
  joinRoomBtn.disabled = locked
}

// Host an online room: this browser runs the sim (host-session.js) and
// guests connect over WebRTC. The host also plays, via a local loopback.
async function hostOnlineRoom() {
  const name = hostNameInput.value.trim()
  if (!name) {
    error.textContent = 'Type a name first.'
    hostNameInput.focus()
    return
  }
  if (netMode !== 'local') return
  const missing = onlineReady()
  if (missing) {
    error.textContent = missing
    return
  }
  error.textContent = ''
  lockOnlineButtons(true)
  try {
    const mod = await import('./host-session.js')
    const code = window.P2P.makeCode()
    const deliver = (key, obj) => {
      if (key === mod.LOCAL_KEY) onMessage(obj)
      else if (hostNet) hostNet.sendTo(key, obj)
    }
    const broadcastAll = (obj) => {
      onMessage(obj)
      if (hostNet) hostNet.broadcast(obj)
    }
    hostSession = mod.createHostSession({ roomCode: code, onDeliver: deliver, onBroadcast: broadcastAll })
    hostLocalKey = mod.LOCAL_KEY
    hostNet = window.P2P.hostRoom({
      code,
      onMessage: (key, msg) => {
        if (hostSession) hostSession.guestMessage(key, msg)
      },
      onLeave: (key) => {
        if (hostSession) hostSession.guestLeft(key)
      },
      onIdLost: () => yieldToGuest(),
    })
    hostedCode = await hostNet.ready
    netMode = 'host'
    stopLocalSocket()
    localStorage.setItem('territory-name', name)
    sfx.startMusic()
    send({ type: 'join', name, token: '' })
  } catch (err) {
    error.textContent = err?.message || 'Could not host a room.'
    if (hostNet) {
      try {
        hostNet.close()
      } catch {
        // ignore
      }
      hostNet = null
    }
    if (hostSession) {
      try {
        hostSession.close()
      } catch {
        // ignore
      }
      hostSession = null
    }
    hostedCode = ''
    lockOnlineButtons(false)
  }
}

// Join someone's room with their code. Redials for ~12s if the connection
// drops, so the host's 10s seat freeze covers a blip or tab reload.
function joinOnlineRoom() {
  const name = guestNameInput.value.trim()
  if (!name) {
    error.textContent = 'Type a name first.'
    guestNameInput.focus()
    return
  }
  const code = window.P2P ? window.P2P.normalizeCode(codeInput.value) : ''
  if (!code) {
    error.textContent = 'Type the room code the host gave you.'
    codeInput.focus()
    return
  }
  if (netMode !== 'local') return
  const missing = onlineReady()
  if (missing) {
    error.textContent = missing
    return
  }
  error.textContent = ''
  lockOnlineButtons(true)
  netMode = 'guest'
  stopLocalSocket()
  guestRoom = { code, name, token: sessionStorage.getItem(`territory-token-${code}`) || '', redials: 0 }
  localStorage.setItem('territory-name', name)
  sfx.startMusic()
  dialGuest()
}

function giveUpGuest(room, text) {
  if (guestRoom !== room) return
  error.textContent = text
  if (guestConn) {
    const conn = guestConn
    guestConn = null
    try {
      conn.close()
    } catch {
      // ignore
    }
  }
  guestRoom = null
  guestQueue = []
  lastMigrate = null
  claiming = false
  netMode = 'local'
  lockOnlineButtons(false)
  connect()
}

// The DataChannel to the host dropped. Blips redial fast; a gone host
// triggers the takeover election (see electSuccessor): the lowest-id
// remaining player claims the same room code, everyone else waits.
function handleGuestDrop(epoch) {
  if (epoch <= dropHandledEpoch) return
  dropHandledEpoch = epoch
  guestConn = null
  if (netMode !== 'guest' || !guestRoom) return
  guestRoom.redials += 1
  guestStep(guestRoom)
}

function guestStep(room) {
  if (netMode !== 'guest' || guestRoom !== room || claiming) return
  if (room.redials > 40) {
    giveUpGuest(room, 'Lost the room. Check the code and join again.')
    return
  }
  if (room.redials <= 8) {
    error.textContent = 'Connection lost. Rejoining...'
    setTimeout(() => {
      if (!claiming) dialGuest()
    }, 1500)
    return
  }
  const successor = viewHelpers.electSuccessor(lastPlayers, lastHostId)
  if (successor === myId && myId != null) {
    if (lastMigrate) {
      attemptTakeover(room)
      return
    }
    giveUpGuest(room, 'The host left before any game state arrived. Host a new room to keep playing.')
    return
  }
  error.textContent = successor != null ? 'Host left. Finding a new host...' : 'Connection lost. Rejoining...'
  setTimeout(() => {
    if (!claiming) dialGuest()
  }, 1500)
}

// Become the new host: claim the same room code, restore the sim from the
// cached migration snapshot, and keep playing. Guests rejoin with their
// old tokens and keep their seats.
async function attemptTakeover(room) {
  claiming = true
  error.textContent = 'Host left. Starting a new host...'
  guestRoom = null
  try {
    const mod = await import('./host-session.js')
    const claim = window.P2P.claimRoom({
      code: room.code,
      tries: 45,
      delayMs: 1000,
      onMessage: (key, msg) => {
        if (hostSession) hostSession.guestMessage(key, msg)
      },
      onLeave: (key) => {
        if (hostSession) hostSession.guestLeft(key)
      },
      onIdLost: () => yieldToGuest(),
    })
    await claim.ready
    if (netMode !== 'guest' || !lastMigrate) {
      claim.close()
      throw new Error('Stopped.')
    }
    const deliver = (key, obj) => {
      if (key === mod.LOCAL_KEY) onMessage(obj)
      else if (hostNet) hostNet.sendTo(key, obj)
    }
    const broadcastAll = (obj) => {
      onMessage(obj)
      if (hostNet) hostNet.broadcast(obj)
    }
    hostSession = mod.createHostSession({
      roomCode: room.code,
      initial: { ...lastMigrate.state, hostId: myId, downId: lastHostId },
      onDeliver: deliver,
      onBroadcast: broadcastAll,
    })
    hostLocalKey = mod.LOCAL_KEY
    if (guestConn) {
      const conn = guestConn
      guestConn = null
      try {
        conn.close()
      } catch {
        // ignore
      }
    }
    hostNet = claim
    netMode = 'host'
    hostedCode = room.code
    claiming = false
    error.textContent = ''
    send({ type: 'join', name: room.name, token: room.token })
  } catch (err) {
    claiming = false
    if (netMode !== 'guest') return
    if (guestRoom) return // already redialing or done
    // One more patient redial: someone else may have claimed the room.
    guestRoom = { ...room, redials: 39 }
    dialGuest()
  }
}

// This browser lost the room id to another host: stop the sim and rejoin
// as a guest. Our own token survived in the migrated state, so our seat
// is kept when we come back within the grace window.
function yieldToGuest() {
  if (netMode !== 'host' || !hostSession) return
  const code = hostedCode
  const name = localStorage.getItem('territory-name') || 'Player'
  const token = sessionStorage.getItem('territory-token') || ''
  try {
    hostSession.yieldRoom()
  } catch {
    // ignore
  }
  try {
    if (hostNet) hostNet.close()
  } catch {
    // ignore
  }
  hostNet = null
  hostSession = null
  hostedCode = ''
  claiming = false
  netMode = 'guest'
  guestRoom = { code, name, token, redials: 8 }
  guestQueue = []
  error.textContent = 'Another host took over. Rejoining...'
  dialGuest()
}

function dialGuest() {
  const room = guestRoom
  if (!room || netMode !== 'guest' || guestConn) return
  lastTickAt = performance.now()
  const epoch = ++dialEpoch
  guestConn = window.P2P.joinRoom(room.code, {
    onMessage,
    onClose: () => handleGuestDrop(epoch),
  })
  guestConn.ready.then(() => {
    if (netMode !== 'guest' || guestRoom !== room) return
    room.redials = 0
    lastTickAt = performance.now()
    error.textContent = ''
    for (const obj of guestQueue) guestConn.send(obj)
    guestQueue = []
    lockOnlineButtons(false)
    send({ type: 'join', name: room.name, token: room.token })
  }).catch((err) => {
    if (netMode !== 'guest' || guestRoom !== room) return
    if (room.redials === 0) {
      // First dial failed outright (usually a wrong code): say so now.
      giveUpGuest(room, err?.message || 'Could not join the room.')
      return
    }
    room.redials += 1
    guestStep(room)
  })
}

// Transport close events can take a minute to notice a dead peer, so
// guests also watch for starvation: ticks flow at 9Hz in play and pings
// every 2s in lobby. Three silent seconds means the host is gone.
setInterval(() => {
  if (document.hidden) return
  if (netMode !== 'guest' || !guestConn || claiming) return
  if (performance.now() - lastTickAt <= 3000) return
  if (guestRoom) guestRoom.redials = Math.max(guestRoom.redials, 7)
  const conn = guestConn
  try {
    conn.close()
  } catch {
    // ignore
  }
  handleGuestDrop(dialEpoch)
}, 1000)

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  if (netMode !== 'guest' || !guestConn || claiming) return
  if (performance.now() - lastTickAt > 3000) {
    if (guestRoom) guestRoom.redials = Math.max(guestRoom.redials, 7)
    handleGuestDrop(dialEpoch)
  }
})

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return
  if (netMode === 'guest') lastTickAt = performance.now()
  if (msg.type === 'ping') return
  if (msg.type === 'moved') {
    // The old host yielded to a new one: skip the blip budget and go
    // straight to patient redial / takeover.
    if (netMode === 'guest' && guestRoom) {
      guestRoom.redials = Math.max(guestRoom.redials, 8)
      error.textContent = 'Host moved. Rejoining...'
      if (guestConn) {
        // Closing triggers onClose, which runs the drop handler once. If
        // the dead connection never reports back, nudge it below.
        const conn = guestConn
        try {
          conn.close()
        } catch {
          // ignore
        }
        const epoch = dialEpoch
        setTimeout(() => handleGuestDrop(epoch), 2500)
      } else {
        handleGuestDrop(dialEpoch)
      }
    }
    return
  }
  if (msg.type === 'migrate') {
    if (msg.state?.game?.landB64 && msg.state?.game?.trailB64) lastMigrate = msg
    return
  }
  if (msg.type === 'hello') {
    myId = msg.playerId
    hostId = msg.hostId
    urls = msg.urls || urls
    if (msg.tickMs) tickMs = msg.tickMs
    if (msg.token) {
      if (netMode === 'guest' && guestRoom) {
        guestRoom.token = msg.token
        sessionStorage.setItem(`territory-token-${guestRoom.code}`, msg.token)
      } else {
        sessionStorage.setItem('territory-token', msg.token)
      }
    }
    joined = true
    return
  }
  if (msg.type === 'error') {
    error.textContent = msg.message || ''
    return
  }
  if (msg.hostId != null) hostId = msg.hostId
  if (msg.hostId != null) lastHostId = msg.hostId
  if (msg.wins) sessionWins = msg.wins
  if (msg.tickMs) tickMs = msg.tickMs
  // Freshest roster for the takeover election.
  if (Array.isArray(msg.players) && msg.players.length) lastPlayers = msg.players
  else if (msg.type === 'lobby' && Array.isArray(msg.roster) && msg.roster.length) lastPlayers = msg.roster

  if (msg.type === 'lobby') {
    if ((phase === 'countdown' || phase === 'play') && msg.phase !== 'lobby') return
    phase = msg.phase
    if (msg.phase === 'lobby') {
      lastPhase = 'lobby'
      land = null
      trail = null
      trailCells.clear()
      mapDirty = true
      mapVersion += 1
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
    mapDirty = true
    mapVersion += 1
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
  if (!runs.length) return
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
  mapDirty = true
  mapVersion += 1
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
  if (!pairs.length) return
  for (const [index, id] of pairs) {
    trail[index] = id
    if (id) trailCells.add(index)
    else trailCells.delete(index)
  }
  mapDirty = true
  mapVersion += 1
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
  joinRow.hidden = !LOCAL_DEV
  room.hidden = true
  blurb.textContent = RULES
  const inviteCode = window.P2P ? window.P2P.normalizeCode(queryParams.get('code')) : ''
  if (inviteCode) {
    // Arrived via an invite link: skip the picker, go straight to joining.
    picker.hidden = true
    hostSetup.hidden = true
    joinSetup.hidden = false
    codeInput.value = inviteCode
    guestNameInput.focus()
    return
  }
  picker.hidden = false
  hostSetup.hidden = true
  joinSetup.hidden = true
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
  joinRow.hidden = joined || !LOCAL_DEV
  picker.hidden = joined
  hostSetup.hidden = joined
  joinSetup.hidden = joined
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
  roomCodeEl.replaceChildren()
  roomCodeEl.hidden = true
  inviteRow.hidden = true
  hideQr()
  if (!show) return
  if (hostedCode) {
    const label = document.createElement('span')
    label.textContent = 'Room code: '
    const code = document.createElement('strong')
    code.textContent = hostedCode
    roomCodeEl.append(label, code)
    roomCodeEl.hidden = false
    inviteRow.hidden = false
    return
  }
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
// and flash when a player gains ground. Both animations are skipped under
// prefers-reduced-motion, and layout reads are skipped unless the order may
// have changed, so steady-state ticks do no forced layout.
function paintBoard(rows) {
  const animate = !REDUCED_MOTION
  const before = animate ? new Map() : null
  if (animate) {
    for (const [id, row] of boardRows) before.set(id, row.el.getBoundingClientRect().top)
  }
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
      row = { el, swatch, name, stat, pct: null, landRaw: 0 }
      boardRows.set(player.id, row)
      el.classList.add('enter')
    }
    row.el.classList.toggle('out', !player.alive)
    row.swatch.style.background = player.color
    row.swatch.style.color = player.color
    row.name.textContent = player.id === myId ? `${player.name} (you)` : player.name
    const pct = land ? (player.land / (w * h)) * 100 : null
    const label = pct == null ? '' : `${pct.toFixed(1)}%`
    if (row.stat.textContent !== label) row.stat.textContent = label
    // Only flash meaningful gains: a +1 cell trickle every tick would keep
    // a WAAPI animation alive forever.
    if (animate && pct != null && row.pct != null && player.land - row.landRaw >= 5) {
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
  const orderChanged = order.length !== current.length || order.some((el, i) => el !== current[i])
  if (orderChanged) {
    for (const el of order) board.append(el)
  }
  if (!animate || !orderChanged) return
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
    if (!me.out) return 'Watching'
    return reasonText(me)
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
  if (fpsOn) {
    if (!fpsEl) {
      fpsEl = document.createElement('div')
      fpsEl.id = 'fps'
      document.body.appendChild(fpsEl)
    }
    fpsAcc += frameAt - fpsAt
    fpsAt = frameAt
    fpsCount += 1
    if (fpsAcc >= 500 && fpsCount > 1) {
      const avg = fpsAcc / (fpsCount - 1)
      fpsEl.textContent = `${avg.toFixed(1)}ms ${(1000 / avg).toFixed(0)}fps`
      fpsAcc = 0
      fpsCount = 0
    }
  }
  fx.update(dt)
  // Cap DPR at 2: a 3x phone pushes 9x the pixels for no visible gain on
  // neon shapes, and every fullscreen pass (bg, glow, sheet, fx) pays it.
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
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
    // The glow is pre-rendered into `glow` (only rebuilt when the map
    // changes), so this is a plain image blit with no per-frame blur filter.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(glow, 0, 0, glow.width || 1, glow.height || 1, originX, originY, w * cell, h * cell)
    ctx.restore()
    viewOriginX = originX
    viewOriginY = originY
    viewCell = cell
    steerTowardCursor(me)
    ctx.drawImage(sheet, originX, originY)
    ctx.strokeStyle = 'rgba(57, 255, 210, 0.45)'
    ctx.lineWidth = 1
    ctx.strokeRect(originX - 0.5, originY - 0.5, w * cell + 1, h * cell + 1)
    // Batch the name labels: one font/textAlign setup for all heads.
    const showNames = cell >= 8
    if (showNames) {
      ctx.font = '12px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
    }
    for (const body of bodies.values()) {
      if (!body.alive) continue
      const point = pose(body)
      if (phase === 'play') fx.trailSparks(point.x, point.y, body.heading || 0, hex(body.color), dt)
      drawHead(originX + point.x * cell, originY + point.y * cell, cell, body, showNames)
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
    // Mini-map only changes when the board does (ticks), not every frame.
    if (mapVersion !== miniVersion) {
      miniVersion = mapVersion
      if (mini.width !== w) mini.width = w
      if (mini.height !== h) mini.height = h
      miniCtx.setTransform(1, 0, 0, 1, 0, 0)
      miniCtx.clearRect(0, 0, mini.width, mini.height)
      miniCtx.fillStyle = '#070910'
      miniCtx.fillRect(0, 0, mini.width, mini.height)
      miniCtx.imageSmoothingEnabled = true
      miniCtx.drawImage(sheet, 0, 0, mini.width, mini.height)
    }
  }
  if (phase === 'play' || phase === 'countdown') {
    const text = statusText()
    if (text !== lastStatusText) {
      lastStatusText = text
      status.textContent = text
    }
  }
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

// The board only changes on server ticks (~9Hz), so the sheet is cached and
// rebuilt only when land/trail are dirty or the cell size changes. Interior
// cells (same owner on all 4 sides) take a plain fillRect fast path; only
// edge cells pay for roundRect.
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
  if (!mapDirty && sheet.width === width && sheet.height === height && cellSize === lastSheetCell) return
  lastSheetCell = cellSize
  mapDirty = false
  if (sheet.width !== width || sheet.height !== height) {
    sheet.width = width
    sheet.height = height
  }
  sheetCtx.clearRect(0, 0, width, height)
  sheetCtx.fillStyle = '#070910'
  sheetCtx.fillRect(0, 0, width, height)
  const radius = cellSize * 0.36
  const overlap = Math.max(1.25, cellSize * 0.14)
  const size = cellSize + overlap
  // Group consecutive cells of the same color into one fillStyle change.
  let lastStyle = null
  for (let y = 0; y < h; y += 1) {
    const rowOff = y * w
    for (let x = 0; x < w; x += 1) {
      const index = rowOff + x
      const trailId = trail[index]
      const id = trailId || land[index]
      if (!id) continue
      const up = y > 0 ? (trail[index - w] || land[index - w] || 0) : 0
      const down = y + 1 < h ? (trail[index + w] || land[index + w] || 0) : 0
      const left = x > 0 ? (trail[index - 1] || land[index - 1] || 0) : 0
      const right = x + 1 < w ? (trail[index + 1] || land[index + 1] || 0) : 0
      const style = fillStyleFor(id, Boolean(trailId))
      if (style !== lastStyle) {
        sheetCtx.fillStyle = style
        lastStyle = style
      }
      if (up === id && down === id && left === id && right === id) {
        // Interior: no rounded corners, no seam check needed.
        sheetCtx.fillRect(x * cellSize, y * cellSize, size, size)
        continue
      }
      const tl = up !== id && left !== id
      const tr = up !== id && right !== id
      const br = down !== id && right !== id
      const bl = down !== id && left !== id
      if (!tl && !tr && !br && !bl) {
        sheetCtx.fillRect(x * cellSize, y * cellSize, size, size)
      } else {
        sheetCtx.beginPath()
        sheetCtx.roundRect(x * cellSize, y * cellSize, size, size, [
          tl ? radius : 0,
          tr ? radius : 0,
          br ? radius : 0,
          bl ? radius : 0,
        ])
        sheetCtx.fill()
      }
      const diag = x + 1 < w && y + 1 < h ? (trail[index + w + 1] || land[index + w + 1] || 0) : -1
      if (diag === id && right !== id && down !== id) {
        const seam = cellSize * 0.72
        sheetCtx.fillRect((x + 1) * cellSize - seam / 2, (y + 1) * cellSize - seam / 2, seam, seam)
      }
    }
  }
  rebuildGlow(width, height)
}

// Downscaled blurred copy for the neon glow. Blurring a small canvas once
// per map change is far cheaper than ctx.filter='blur(12px)' every frame.
function rebuildGlow(width, height) {
  const scale = 0.5
  const gw = Math.max(1, Math.round(width * scale))
  const gh = Math.max(1, Math.round(height * scale))
  if (glow.width !== gw || glow.height !== gh) {
    glow.width = gw
    glow.height = gh
  }
  glowCtx.setTransform(1, 0, 0, 1, 0, 0)
  glowCtx.clearRect(0, 0, gw, gh)
  try {
    glowCtx.filter = 'blur(6px)'
  } catch {
    // Older browsers ignore filter; the plain downscaled copy still glows
    // when drawn back with 'lighter'.
  }
  glowCtx.drawImage(sheet, 0, 0, gw, gh)
  try {
    glowCtx.filter = 'none'
  } catch {
    // ignore
  }
}

function drawHead(x, y, cell, body, showNames = true) {
  const radius = Math.max(3, cell * 0.34)
  // Cheap neon: a translucent underlay instead of shadowBlur (shadowBlur
  // forces a full blur pass per head, per frame).
  ctx.fillStyle = body.color
  ctx.globalAlpha = 0.22
  ctx.beginPath()
  ctx.arc(x, y, radius * 1.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  const heading = body.heading || 0
  const cos = Math.cos(heading)
  const sin = Math.sin(heading)
  ctx.beginPath()
  ctx.fillStyle = body.color
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  // Dark outline so the head reads on its own land, where it would
  // otherwise be the same neon on the same neon.
  ctx.beginPath()
  ctx.lineWidth = Math.max(2, radius * 0.28)
  ctx.strokeStyle = '#070910'
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.stroke()
  if (body.id === myId && phase !== 'over') {
    const pulse = REDUCED_MOTION ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / 170)
    ctx.beginPath()
    ctx.arc(x, y, radius * (1.8 + 0.7 * pulse), 0, Math.PI * 2)
    // White, not body color: it has to pop on every land color.
    ctx.strokeStyle = '#f4fff8'
    ctx.globalAlpha = 0.65 - 0.45 * pulse
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // Nose showing heading. Rotated by hand to avoid save/translate/rotate
  // per head.
  const nx = x + cos * radius * 0.2
  const ny = y + sin * radius * 0.2
  const px = -sin
  const py = cos
  ctx.fillStyle = '#f4fff8'
  ctx.beginPath()
  ctx.moveTo(nx + cos * radius * 0.9 + px * radius * 0.18, ny + sin * radius * 0.9 + py * radius * 0.18)
  ctx.lineTo(nx + cos * radius * 0.9 - px * radius * 0.18, ny + sin * radius * 0.9 - py * radius * 0.18)
  ctx.lineTo(nx - cos * radius * 0.35 - px * radius * 0.18, ny - sin * radius * 0.35 - py * radius * 0.18)
  ctx.lineTo(nx - cos * radius * 0.35 + px * radius * 0.18, ny - sin * radius * 0.35 + py * radius * 0.18)
  ctx.closePath()
  ctx.fill()
  if (!showNames) return
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

hostRoomBtn.addEventListener('click', hostOnlineRoom)
joinRoomBtn.addEventListener('click', joinOnlineRoom)

function stopScanner() {
  if (scannerRaf) {
    cancelAnimationFrame(scannerRaf)
    scannerRaf = 0
  }
  if (scannerStream) {
    for (const track of scannerStream.getTracks()) track.stop()
    scannerStream = null
  }
  scannerVideo.removeAttribute('src')
  scannerVideo.srcObject = null
  scannerBox.hidden = true
}

function scanFrame() {
  const w = scannerVideo.videoWidth
  const h = scannerVideo.videoHeight
  if (!w || !h) return null
  // Big phone sensors downscale: QR reads fine small, and jsQR is O(pixels).
  const scale = Math.min(1, 480 / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  if (scannerCanvas.width !== cw || scannerCanvas.height !== ch) {
    scannerCanvas.width = cw
    scannerCanvas.height = ch
  }
  const ctx = scannerCanvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(scannerVideo, 0, 0, cw, ch)
  const found = window.jsQR(ctx.getImageData(0, 0, cw, ch).data, cw, ch)
  return found?.data ?? null
}

function handleScannedUrl(text) {
  stopScanner()
  const raw = viewHelpers.inviteCodeFromUrl(text)
  const code = window.P2P ? window.P2P.normalizeCode(raw) : raw.trim().toUpperCase()
  if (!code) {
    error.textContent = "That QR code is not a Territory invite. Scan the host's code."
    return
  }
  codeInput.value = code
  joinOnlineRoom()
}

async function startScanner() {
  if (scannerStream || scannerRaf) return
  if (typeof window.jsQR !== 'function' || !navigator.mediaDevices?.getUserMedia) {
    error.textContent = 'Camera scanning is not available on this device or browser.'
    return
  }
  error.textContent = ''
  scannerHint.textContent = "Point the camera at the host's QR code."
  scannerBox.hidden = false
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
  } catch (err) {
    scannerBox.hidden = true
    error.textContent =
      err?.name === 'NotAllowedError'
        ? 'Camera access was denied. Allow it in the browser, then try again.'
        : 'No camera is available on this device.'
    return
  }
  scannerVideo.srcObject = scannerStream
  try {
    await scannerVideo.play()
  } catch {
    // Muted inline playback is allowed everywhere modern; if it still
    // fails the frames simply never arrive and Cancel stays available.
  }
  scannerLast = 0
  const tick = (now) => {
    scannerRaf = 0
    if (!scannerStream) return
    if (now - scannerLast > 120) {
      scannerLast = now
      const hit = scanFrame()
      if (hit) {
        handleScannedUrl(hit)
        return
      }
    }
    scannerRaf = requestAnimationFrame(tick)
  }
  scannerRaf = requestAnimationFrame(tick)
}

scanBtn.addEventListener('click', startScanner)
scannerStopBtn.addEventListener('click', stopScanner)
codeInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  joinOnlineRoom()
})

// Room codes are uppercase: morph typing and pastes as they happen (caret
// kept where it was) so the field never shows lowercase.
codeInput.addEventListener('input', () => {
  const upper = codeInput.value.toUpperCase()
  if (upper === codeInput.value) return
  const caret = codeInput.selectionStart ?? upper.length
  codeInput.value = upper
  codeInput.setSelectionRange(caret, caret)
})

function showSetup(which) {
  error.textContent = ''
  if (which !== 'join') stopScanner()
  picker.hidden = which !== 'picker'
  hostSetup.hidden = which !== 'host'
  joinSetup.hidden = which !== 'join'
  if (which === 'host') hostNameInput.focus()
  if (which === 'join') {
    if (!codeInput.value) guestNameInput.focus()
    else codeInput.focus()
  }
}

pickHostBtn.addEventListener('click', () => showSetup('host'))
pickJoinBtn.addEventListener('click', () => showSetup('join'))
hostBackBtn.addEventListener('click', () => showSetup('picker'))
joinBackBtn.addEventListener('click', () => showSetup('picker'))
hostNameInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  hostOnlineRoom()
})
guestNameInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  joinOnlineRoom()
})

async function copyText(text, button, doneLabel = 'Copied!') {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const temp = document.createElement('textarea')
    temp.value = text
    document.body.append(temp)
    temp.select()
    try {
      document.execCommand('copy')
    } catch {
      // Clipboard unavailable; the code stays visible to type over.
    }
    temp.remove()
  }
  const original = button.textContent
  button.textContent = doneLabel
  setTimeout(() => {
    button.textContent = original
  }, 1500)
}

copyCodeBtn.addEventListener('click', () => {
  if (hostedCode) copyText(hostedCode, copyCodeBtn)
})
copyLinkBtn.addEventListener('click', () => {
  if (hostedCode) copyText(viewHelpers.roomInviteLink(location.origin + location.pathname, hostedCode), copyLinkBtn)
})

function inviteUrl() {
  if (!hostedCode) return ''
  return viewHelpers.roomInviteLink(location.origin + location.pathname, hostedCode)
}

function hideQr() {
  qrBox.hidden = true
  qrBox.replaceChildren()
  qrBtn.textContent = 'Show QR code'
}

// Phones join by scanning the invite link: no typing the room code.
qrBtn.addEventListener('click', () => {
  if (!qrBox.hidden) {
    hideQr()
    return
  }
  const url = inviteUrl()
  if (!url || typeof window.qrcode !== 'function') return
  const code = window.qrcode(0, 'M')
  code.addData(url)
  code.make()
  qrBox.replaceChildren()
  qrBox.insertAdjacentHTML('beforeend', code.createSvgTag({ cellSize: 6, margin: 0, scalable: true }))
  qrBox.hidden = false
  qrBtn.textContent = 'Hide QR code'
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

// Steering mode follows the last input used: pressing a turn control
// (touch buttons, arrow keys) drops back to buttons, ticking the menu
// checkbox aims with the cursor. Without this, a persisted steer choice
// silently swallowed every turn press, which is exactly how the touch
// buttons "broke" on mobile.
function setSteerMode(on) {
  steer.checked = Boolean(on)
  localStorage.setItem('territory-steer', steer.checked ? '1' : '0')
  lastSteer = null
}

steer.checked = localStorage.getItem('territory-steer') === '1'
steer.addEventListener('change', () => {
  setSteerMode(steer.checked)
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
  setMenu(false)
})

function paintMute() {
  const off = sfx.isMuted()
  muteBtn.textContent = off ? 'Sound effects off' : 'Sound effects on'
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

// Full screen toggle for phones and tablets. Stays hidden on desktops and
// on browsers with no fullscreen support (older iPhone Safari): entering
// needs a tap, so the button only appears where it can work.
function paintFull() {
  const on = Boolean(document.fullscreenElement)
  fullBtn.textContent = on ? 'Exit full' : 'Full screen'
  fullBtn.setAttribute('aria-pressed', String(on))
}

fullBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    if (typeof document.exitFullscreen === 'function') document.exitFullscreen()
    return
  }
  const root = document.documentElement
  const ask =
    typeof root.requestFullscreen === 'function'
      ? root.requestFullscreen()
      : typeof root.webkitRequestFullscreen === 'function'
        ? root.webkitRequestFullscreen()
        : null
  // A denied request (kiosk profiles, iframes without permission) rejects:
  // swallow it so the tap never surfaces as an error.
  if (ask && typeof ask.catch === 'function') ask.catch(() => {})
})
document.addEventListener('fullscreenchange', paintFull)

if (
  typeof globalThis.matchMedia === 'function' &&
  globalThis.matchMedia('(pointer: coarse)').matches &&
  (typeof document.documentElement.requestFullscreen === 'function' ||
    typeof document.documentElement.webkitRequestFullscreen === 'function')
) {
  fullBtn.hidden = false
  paintFull()
}

// Hamburger menu beside the mini-map: Music, Full screen, Sound.
function setMenu(open) {
  menu.hidden = !open
  menuBtn.setAttribute('aria-expanded', String(open))
}

menuBtn.addEventListener('click', () => {
  setMenu(menu.hidden)
})
document.addEventListener('pointerdown', (event) => {
  if (menu.hidden) return
  if (menu.contains(event.target) || menuBtn.contains(event.target)) return
  setMenu(false)
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menu.hidden) setMenu(false)
})

const heldTurn = { left: false, right: false }

function turnKey(key) {
  if (key === 'ArrowLeft') return 'left'
  if (key === 'ArrowRight') return 'right'
  return null
}

function sendTurn() {
  send({ type: 'steer', turn: viewHelpers.turnFromHeld(heldTurn) })
}

// On-screen turn buttons for touch screens. They feed the same held-turn state
// as the keyboard, so the server sees no difference.
function bindTurnButton(button, side) {
  const active = () => myId && (phase === 'countdown' || phase === 'play')
  const press = (event) => {
    event.preventDefault()
    if (steer.checked) setSteerMode(false)
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
  if (steer.checked) setSteerMode(false)
  heldTurn[side] = true
  if (myId && (phase === 'countdown' || phase === 'play')) sendTurn()
})

window.addEventListener('keyup', (event) => {
  const side = turnKey(event.key)
  if (!side) return
  heldTurn[side] = false
  if (myId && (phase === 'countdown' || phase === 'play')) sendTurn()
})

// The local Node server is a dev path now (?local). The public game is
// online rooms only, so no WebSocket is opened unless asked for.
if (LOCAL_DEV) connect()
showJoin()
// The landing page links here with ?join=1 to skip the picker.
if (queryParams.has('join') && !queryParams.has('code')) showSetup('join')
requestAnimationFrame(frame)
