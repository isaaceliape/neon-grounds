import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { startServer } from '../server/index.js'

function openClient(url) {
  const messages = []
  const waiters = []
  const ws = new WebSocket(url)
  ws.on('message', (buf) => {
    const msg = JSON.parse(buf.toString())
    messages.push(msg)
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (!waiters[i].pred(msg)) continue
      const waiter = waiters.splice(i, 1)[0]
      clearTimeout(waiter.timer)
      waiter.resolve(msg)
    }
  })
  return new Promise((resolve, reject) => {
    ws.once('error', reject)
    ws.once('open', () => {
      resolve({
        ws,
        send(obj) {
          ws.send(JSON.stringify(obj))
        },
        get messages() {
          return messages
        },
        until(pred) {
          const found = messages.find(pred)
          if (found) return Promise.resolve(found)
          return new Promise((resolveWait, rejectWait) => {
            const timer = setTimeout(() => rejectWait(new Error('timed out waiting for a message')), 2000)
            waiters.push({ pred, resolve: resolveWait, timer })
          })
        },
      })
    })
  })
}

test('two browsers can join, and only the host can start', async () => {
  const server = await startServer()
  const url = `ws://127.0.0.1:${server.port}`
  const ada = await openClient(url)
  const bea = await openClient(url)
  try {
    ada.send({ type: 'join', name: 'Ada' })
    const hello = await ada.until((msg) => msg.type === 'hello')
    assert.ok(hello.token)
    assert.equal(hello.playerId, hello.hostId)
    bea.send({ type: 'join', name: 'Bea' })
    await bea.until((msg) => msg.type === 'hello')
    const lobby = await ada.until((msg) => msg.type === 'lobby' && msg.roster.length === 2)
    assert.equal(lobby.roster[0].name, 'Ada')
    assert.equal(lobby.roster[1].name, 'Bea')

    bea.send({ type: 'start', minutes: 1 })
    const denied = await bea.until((msg) => msg.type === 'error')
    assert.match(denied.message, /host/)

    ada.send({ type: 'start', minutes: 1 })
    const full = await ada.until((msg) => msg.type === 'full')
    assert.equal(full.phase, 'countdown')
    assert.equal(full.players.length, 2)
    assert.equal(full.w * full.h, full.land.length > 0 ? decodeLength(full.land) : 0)
    const seen = await bea.until((msg) => msg.type === 'full')
    assert.equal(seen.players.length, 2)
  } finally {
    ada.ws.close()
    bea.ws.close()
    await server.close()
  }
})

function decodeLength(value) {
  return Buffer.from(value, 'base64').length
}

test('a visitor keeps the join form while a round is running', async () => {
  const server = await startServer()
  const url = `ws://127.0.0.1:${server.port}`
  const ada = await openClient(url)
  const visitor = await openClient(url)
  try {
    ada.send({ type: 'join', name: 'Ada' })
    await ada.until((msg) => msg.type === 'hello')
    ada.send({ type: 'start', minutes: 1 })
    await ada.until((msg) => msg.type === 'full')
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.deepEqual(visitor.messages, [])
  } finally {
    ada.ws.close()
    visitor.ws.close()
    await server.close()
  }
})

test('the page is served from the same port', async () => {
  // The static dir is the built site in production; here the repo root
  // proves same-port serving without needing a build first.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const server = await startServer({ dir: root })
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/`)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /Territory/)
  } finally {
    await server.close()
  }
})

test('session wins count up across rounds and show in the lobby', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'territory-'))
  const server = await startServer({
    gameOptions: { countdownMs: 0, tickMs: 12 },
    resultsLog: path.join(dir, 'results.log'),
  })
  const url = `ws://127.0.0.1:${server.port}`
  const ada = await openClient(url)
  const bea = await openClient(url)
  try {
    ada.send({ type: 'join', name: 'Ada' })
    await ada.until((msg) => msg.type === 'hello')
    bea.send({ type: 'join', name: 'Bea' })
    await bea.until((msg) => msg.type === 'hello')
    await ada.until((msg) => msg.type === 'lobby' && msg.roster.length === 2)
    assert.deepEqual((await ada.until((msg) => msg.type === 'lobby')).wins, {})

    for (const round of [1, 2]) {
      ada.send({ type: 'start', minutes: 1 })
      const full = await ada.until((msg) => msg.type === 'full' && msg.wins !== undefined)
      // Ada circles inside her own square, so she stays alive. Bea drives at the nearest wall.
      ada.send({ type: 'steer', turn: 1 })
      const beaRow = full.players.find((row) => row.name === 'Bea')
      bea.send({ type: 'dir', dir: beaRow.y < full.h / 2 ? 'up' : 'down' })
      const over = await ada.until((msg) => msg.type === 'over' && msg.wins.ada === round)
      assert.equal(over.scores.winnerId, over.roster.find((row) => row.name === 'Ada').id)
      assert.equal(over.wins.bea, undefined)
      ada.send({ type: 'restart' })
      const lobby = await ada.until((msg) => msg.type === 'lobby' && msg.phase === 'lobby' && msg.wins.ada === round)
      assert.deepEqual(lobby.wins, { ada: round })
      ada.messages.length = 0
      bea.messages.length = 0
    }
  } finally {
    ada.ws.close()
    bea.ws.close()
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('only the host adds or removes bots, with a level, up to three', async () => {
  const server = await startServer()
  const url = `ws://127.0.0.1:${server.port}`
  const ada = await openClient(url)
  const bea = await openClient(url)
  try {
    ada.send({ type: 'join', name: 'Ada' })
    await ada.until((msg) => msg.type === 'hello')
    bea.send({ type: 'join', name: 'Bea' })
    await bea.until((msg) => msg.type === 'hello')

    bea.send({ type: 'bot', level: 'hard' })
    assert.match((await bea.until((msg) => msg.type === 'error')).message, /host/)

    ada.send({ type: 'bot', level: 'easy' })
    ada.send({ type: 'bot', level: 'hard' })
    const two = await ada.until((msg) => msg.type === 'lobby' && msg.roster.filter((row) => row.bot).length === 2)
    assert.deepEqual(two.roster.filter((row) => row.bot).map((row) => row.level), ['easy', 'hard'])

    ada.send({ type: 'bot' })
    await ada.until((msg) => msg.type === 'lobby' && msg.roster.filter((row) => row.bot).length === 3)
    ada.messages.length = 0
    ada.send({ type: 'bot', level: 'normal' })
    assert.match((await ada.until((msg) => msg.type === 'error')).message, /up to 3 bots/)

    ada.send({ type: 'bot', level: 'nope' })
    assert.match((await ada.until((msg) => msg.type === 'error' && /easy, normal or hard/.test(msg.message))).message, /easy, normal or hard/)

    const botId = two.roster.find((row) => row.level === 'easy').id
    bea.messages.length = 0
    bea.send({ type: 'removeBot', id: botId })
    assert.match((await bea.until((msg) => msg.type === 'error')).message, /host/)

    ada.send({ type: 'removeBot', id: botId })
    const after = await ada.until((msg) => msg.type === 'lobby' && msg.roster.filter((row) => row.bot).length === 2)
    assert.equal(after.roster.some((row) => row.id === botId), false)
  } finally {
    ada.ws.close()
    bea.ws.close()
    await server.close()
  }
})
