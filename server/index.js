import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { createGame } from './game.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.resolve(rootDir, 'dist')
const defaultResultsLog = path.resolve(rootDir, 'logs/results.log')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
}

function networkUrls(port) {
  const shared = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue
      shared.push(`http://${entry.address}:${port}`)
    }
  }
  return { local: `http://localhost:${port}`, shared }
}

function snapshot(game, msg, type, wins = {}) {
  return {
    type,
    wins,
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
    land: Buffer.from(game.land).toString('base64'),
    trail: Buffer.from(game.trail).toString('base64'),
  }
}

function delta(game, msg) {
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
  }
}

export function startServer({ port = 0, log = false, gameOptions = {}, resultsLog = defaultResultsLog, dir = distDir } = {}) {
  const game = createGame(gameOptions)
  let closing = false
  const tokens = new Map()
  const sockets = new Map()
  const watchers = new Set()
  const dropTimers = new Map()
  // Rounds won since the server started, keyed by lowercase name.
  const wins = new Map()
  let urls = { local: '', shared: [] }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const requested = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''))
      let file = path.resolve(dir, requested)
      if (file !== dir && !file.startsWith(`${dir}${path.sep}`)) {
        res.writeHead(403).end()
        return
      }
      // Folders serve their index page, so /play/ reaches the game.
      const probe = await stat(file).catch(() => null)
      if (probe?.isDirectory()) file = path.join(file, 'index.html')
      const body = await readFile(file)
      const ext = path.extname(file)
      res.writeHead(200, {
        'Content-Type': TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })

  const wss = new WebSocketServer({ server, perMessageDeflate: false })

  function send(socket, obj) {
    if (socket.readyState === 1) socket.send(JSON.stringify(obj))
  }

  function hasJoined(socket) {
    return socket.playerId != null || watchers.has(socket)
  }

  function broadcast(obj) {
    const data = JSON.stringify(obj)
    for (const socket of wss.clients) {
      if (socket.readyState === 1 && hasJoined(socket)) socket.send(data)
    }
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
    }
  }

  function pushLobby() {
    broadcast(lobby())
  }

  function hello(socket) {
    send(socket, {
      type: 'hello',
      token: socket.token ?? null,
      playerId: socket.playerId ?? null,
      hostId: game.hostId,
      urls,
      tickMs: game.tickMs,
    })
  }

  function pushState(socket) {
    if (game.phase === 'lobby') {
      send(socket, lobby())
      return
    }
    send(socket, snapshot(game, game.pack(), game.phase === 'over' ? 'over' : 'full', winsObject()))
  }

  function bind(socket, id, token) {
    const previous = sockets.get(id)
    if (previous && previous !== socket) {
      previous.replaced = true
      previous.close()
    }
    socket.playerId = id
    socket.token = token
    socket.replaced = false
    sockets.set(id, socket)
    watchers.delete(socket)
  }

  function seatWatchers() {
    for (const socket of [...watchers]) {
      const player = game.addPlayer(socket.queuedName)
      if (!player) return
      watchers.delete(socket)
      const token = socket.token ?? randomBytes(16).toString('hex')
      tokens.set(token, player.id)
      bind(socket, player.id, token)
      hello(socket)
    }
  }

  function join(socket, msg) {
    const token = typeof msg.token === 'string' ? msg.token : ''
    const existingId = token ? tokens.get(token) : null
    const existing = existingId ? game.player(existingId) : null
    if (existing) {
      game.markConnected(existing.id)
      const timer = dropTimers.get(existing.id)
      if (timer) clearTimeout(timer)
      dropTimers.delete(existing.id)
      bind(socket, existing.id, token)
      hello(socket)
      pushState(socket)
      if (game.phase === 'lobby' || game.phase === 'over') pushLobby()
      return
    }

    const watching = game.phase === 'play' || game.phase === 'countdown'
    const player = watching ? null : game.addPlayer(msg.name)
    if (!player) {
      socket.playerId = null
      socket.token = token || randomBytes(16).toString('hex')
      socket.queuedName = String(msg.name ?? '')
      watchers.add(socket)
      hello(socket)
      pushState(socket)
      return
    }

    const issued = randomBytes(16).toString('hex')
    tokens.set(issued, player.id)
    bind(socket, player.id, issued)
    hello(socket)
    pushLobby()
    if (log) console.log(`${player.name} joined (${[...sockets.keys()].length} seated)`)
  }

  function drop(socket) {
    if (closing || socket.replaced) return
    watchers.delete(socket)
    const id = socket.playerId
    if (!id || sockets.get(id) !== socket) return
    const player = game.player(id)
    if (!player) return
    player.connected = false
    const timer = setTimeout(() => {
      dropTimers.delete(id)
      if (sockets.get(id) !== socket) return
      const phase = game.phase
      game.removePlayer(id)
      sockets.delete(id)
      if (phase === 'lobby' || phase === 'over') tokens.delete(socket.token)
      if (game.phase === 'lobby' || game.phase === 'over') {
        game.vacate()
        seatWatchers()
        pushLobby()
      }
    }, 10_000)
    dropTimers.set(id, timer)
  }

  wss.on('connection', (socket) => {
    socket.on('message', (buf) => {
      let msg
      try {
        msg = JSON.parse(buf.toString())
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'join') join(socket, msg)
      else if (msg.type === 'rename') {
        const result = game.rename(socket.playerId, msg.name)
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        if (result.changed) broadcast(lobby())
      }
      else if (msg.type === 'dir' && socket.playerId) game.setDirection(socket.playerId, msg.dir)
      else if (msg.type === 'steer' && socket.playerId) game.setSteer(socket.playerId, msg.turn)
      else if (msg.type === 'aim' && socket.playerId) game.setAim(socket.playerId, msg.angle)
      else if (msg.type === 'start') {
        const id = socket.playerId
        game.vacate()
        seatWatchers()
        const result = game.start(id, Number(msg.minutes), Date.now())
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        broadcast(snapshot(game, game.pack(), 'full', winsObject()))
      } else if (msg.type === 'bot') {
        if (socket.playerId !== game.hostId) {
          send(socket, { type: 'error', message: 'Only the host can add a bot.' })
          return
        }
        const result = game.addBot(msg.level)
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        broadcast(lobby())
      } else if (msg.type === 'removeBot') {
        if (socket.playerId !== game.hostId) {
          send(socket, { type: 'error', message: 'Only the host can remove a bot.' })
          return
        }
        const result = game.removeBot(Number(msg.id))
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        broadcast(lobby())
      } else if (msg.type === 'restart') {
        const result = game.returnToLobby(socket.playerId)
        if (!result.ok) {
          send(socket, { type: 'error', message: result.error })
          return
        }
        broadcast(lobby())
      }
    })
    socket.on('close', () => drop(socket))
  })

  function stamp() {
    const date = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  async function writeResult() {
    const entry = `${stamp()}\n${game.resultLog()}\n\n`
    console.log(entry.trimEnd())
    await mkdir(path.dirname(resultsLog), { recursive: true })
    await appendFile(resultsLog, entry)
  }

  const timer = setInterval(() => {
    if (game.phase !== 'countdown' && game.phase !== 'play') return
    const msg = game.tick(Date.now())
    if (msg.phase === 'over') {
      recordWin(msg.scores)
      writeResult().catch((error) => console.error(error))
    }
    if (msg.phase === 'over' || msg.resync) broadcast(snapshot(game, msg, msg.phase === 'over' ? 'over' : 'full', winsObject()))
    else broadcast(delta(game, msg))
  }, game.tickMs)

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    server.on('error', fail)
    wss.on('error', fail)
    server.listen(port, '0.0.0.0', () => {
      if (settled) return
      settled = true
      server.off('error', fail)
      wss.off('error', fail)
      const actual = server.address().port
      urls = networkUrls(actual)
      if (log) {
        console.log('Neon Grounds')
        console.log(`Open on this machine: ${urls.local}`)
        if (urls.shared.length) {
          console.log('Others on the VPN open:')
          for (const url of urls.shared) console.log(url)
        } else {
          console.log('No other network address found. Check that the VPN is connected.')
        }
      }
      resolve({
        port: actual,
        urls,
        close() {
          closing = true
          clearInterval(timer)
          for (const id of dropTimers.keys()) clearTimeout(dropTimers.get(id))
          for (const client of wss.clients) client.close()
          wss.close()
          return new Promise((done) => server.close(() => done()))
        },
      })
    })
  })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const serveDir = process.env.DIR || distDir
  const probe = await stat(serveDir).catch(() => null)
  if (!probe?.isDirectory()) {
    console.error(`Nothing to serve at ${serveDir}. Run bun run build first. (Tests and Vite dev do not need this.)`)
    process.exit(1)
  }
  const port = Number(process.env.PORT) || 4173
  startServer({ port, log: true, dir: serveDir }).catch((error) => {
    if (error?.code === 'EADDRINUSE') console.error(`Port ${port} is already in use.`)
    else console.error(error)
    process.exit(1)
  })
}
