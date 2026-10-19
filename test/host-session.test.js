import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostSession, LOCAL_KEY } from '../src/host-session.js'

// Drives the in-browser room server headlessly: the host plays through the
// local loopback key, one guest arrives over a (fake) DataChannel.
function makeRoom() {
  const toLocal = []
  const toGuests = new Map() // key -> messages
  const broadcasts = []
  const session = createHostSession({
    gameOptions: { w: 40, h: 30, tickMs: 5, countdownMs: 20 },
    roomCode: 'ABCDE',
    onDeliver: (key, obj) => {
      if (key === LOCAL_KEY) toLocal.push(obj)
      else {
        if (!toGuests.has(key)) toGuests.set(key, [])
        toGuests.get(key).push(obj)
      }
    },
    onBroadcast: (obj) => {
      broadcasts.push(obj)
      toLocal.push(obj)
      for (const key of toGuests.keys()) toGuests.get(key).push(obj)
    },
  })
  return { session, toLocal, toGuests, broadcasts }
}

const lastOf = (list, type) => [...list].reverse().find((msg) => msg.type === type)
const waitFor = async (fn, timeout = 2000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = fn()
    if (value) return value
    await new Promise((done) => setTimeout(done, 5))
  }
  throw new Error('timed out waiting for condition')
}

test('host and guest join, start, and play a round', async () => {
  const { session, toLocal, toGuests, broadcasts } = makeRoom()
  try {
    session.guestMessage(LOCAL_KEY, { type: 'join', name: 'Host', token: '' })
    const hello = lastOf(toLocal, 'hello')
    assert.ok(hello, 'host gets a hello')
    assert.equal(hello.roomCode, 'ABCDE')
    const hostId = hello.playerId
    assert.ok(hostId, 'host is seated')

    session.guestMessage('guest-1', { type: 'join', name: 'Guest', token: '' })
    const guestHello = lastOf(toGuests.get('guest-1'), 'hello')
    assert.ok(guestHello?.playerId, 'guest is seated')
    assert.notEqual(guestHello.playerId, hostId)

    const lobby = lastOf(broadcasts, 'lobby')
    assert.equal(lobby.roster.length, 2, 'roster lists host and guest')

    session.guestMessage('guest-1', { type: 'rename', name: 'Guest2' })
    const renamed = await waitFor(() => lastOf(broadcasts, 'lobby'))
    assert.ok(renamed.roster.some((p) => p.name === 'Guest2'), 'rename shows up in the lobby')

    session.guestMessage(LOCAL_KEY, { type: 'start', minutes: 1 })
    const full = await waitFor(() => lastOf(toLocal, 'full'))
    assert.ok(full.land, 'full snapshot carries land')
    assert.ok(full.trail, 'full snapshot carries trail')
    assert.ok(typeof full.land === 'string', 'board is base64 for the wire')
    await waitFor(() => broadcasts.some((msg) => msg.type === 'tick' && msg.phase === 'play'), 4000)

    session.guestMessage('guest-1', { type: 'steer', turn: 1 })
    const played = await waitFor(() => broadcasts.some((msg) => msg.type === 'tick' && msg.phase === 'play'), 4000)
    assert.ok(played, 'round reaches play')

    session.guestMessage(LOCAL_KEY, { type: 'restart' })
    const back = await waitFor(() => lastOf(broadcasts, 'lobby'))
    assert.equal(back.phase, 'lobby')
  } finally {
    session.close()
  }
})

test('only the host can manage bots', async () => {
  const { session, toLocal, toGuests } = makeRoom()
  try {
    session.guestMessage(LOCAL_KEY, { type: 'join', name: 'Host', token: '' })
    session.guestMessage('guest-1', { type: 'join', name: 'Guest', token: '' })
    session.guestMessage('guest-1', { type: 'bot', level: 'easy' })
    const denied = lastOf(toGuests.get('guest-1'), 'error')
    assert.match(denied.message, /Only the host/)
    session.guestMessage(LOCAL_KEY, { type: 'bot', level: 'easy' })
    assert.ok(!lastOf(toLocal, 'error'), 'host can add a bot')
  } finally {
    session.close()
  }
})

test('a dropped guest keeps their seat briefly and can rejoin with the token', async () => {
  const { session, toGuests } = makeRoom()
  try {
    session.guestMessage(LOCAL_KEY, { type: 'join', name: 'Host', token: '' })
    session.guestMessage('guest-1', { type: 'join', name: 'Guest', token: '' })
    const first = lastOf(toGuests.get('guest-1'), 'hello')
    assert.ok(first.token, 'guest gets a reconnect token')
    session.guestLeft('guest-1')
    // Same player, new connection, same token: seat kept.
    session.guestMessage('guest-1b', { type: 'join', name: 'SomeoneElse', token: first.token })
    const second = lastOf(toGuests.get('guest-1b') ?? [], 'hello')
    assert.equal(second?.playerId, first.playerId, 'token rebinds the same seat')
  } finally {
    session.close()
  }
})

test('takeover: migrate snapshots restore a room and keep seats', async () => {
  const { createHostSession } = await import('../src/host-session.js')
  const first = makeRoom()
  try {
    first.session.guestMessage(LOCAL_KEY, { type: 'join', name: 'Host', token: '' })
    first.session.guestMessage('guest-1', { type: 'join', name: 'Guest', token: '' })
    const hostHello = lastOf(first.toLocal, 'hello')
    const guestHello = lastOf(first.toGuests.get('guest-1'), 'hello')
    first.session.guestMessage(LOCAL_KEY, { type: 'start', minutes: 1 })
    const migrate = await waitFor(() => lastOf(first.broadcasts, 'migrate'), 8000)
    assert.ok(migrate?.state?.game?.landB64, 'host streams takeover state')
    assert.equal(migrate?.state?.tokens?.[guestHello.token], guestHello.playerId, 'tokens travel with the state')

    // The host is gone. The guest takes over under the same code.
    const local = []
    const taken = createHostSession({
      gameOptions: { w: 40, h: 30, tickMs: 5, countdownMs: 20 },
      roomCode: 'ABCDE',
      initial: { ...migrate.state, hostId: guestHello.playerId, downId: hostHello.playerId },
      onDeliver: (key, obj) => local.push(obj),
      onBroadcast: (obj) => local.push(obj),
    })
    try {
      assert.equal(taken.game.hostId, guestHello.playerId, 'successor hosts')
      assert.equal(taken.game.player(hostHello.playerId).connected, false, 'old host marked down')
      taken.guestMessage(LOCAL_KEY, { type: 'join', name: 'Guest', token: guestHello.token })
      const hello = lastOf(local, 'hello')
      assert.equal(hello?.playerId, guestHello.playerId, 'successor keeps its own seat')
      const state = lastOf(local, 'full') ?? lastOf(local, 'lobby')
      assert.ok(state, 'new host serves state to rejoined players')
    } finally {
      taken.close()
    }
  } finally {
    first.session.close()
  }
})
