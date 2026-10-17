import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/game.js'

function startMatch() {
  const game = createGame({ w: 40, h: 30, tickMs: 5, countdownMs: 0 })
  const host = game.addPlayer('Host')
  const guest = game.addPlayer('Guest')
  game.start(host.id, 1, Date.now())
  game.setSteer(host.id, -1)
  game.setSteer(guest.id, 1)
  for (let i = 0; i < 10; i += 1) game.tick(Date.now())
  return { game, host, guest }
}

// pack() carries wall-clock msLeft plus the current tick's write buffers
// (landRuns/trail), which are already broadcast and must NOT be replayed
// by the new host. Compare the durable state instead, plus the boards.
function simShape(game) {
  const { msLeft, landRuns, trail, ...rest } = game.pack()
  assert.ok(typeof msLeft === 'number')
  return JSON.stringify({ ...rest, land: [...game.land], trail: [...game.trail] })
}

test('export/import preserves the sim and both evolve identically', () => {
  const { game, host, guest } = startMatch()
  const state = game.exportState()
  assert.equal(state.v, 1)
  assert.equal(state.players.length, 2)
  assert.ok(Array.isArray(state.land) && state.land.length === 40 * 30)

  const next = createGame({ w: 40, h: 30, tickMs: 5, countdownMs: 0 })
  assert.equal(next.importState(state), true)
  assert.equal(simShape(next), simShape(game), 'restored sim matches tick for tick')

  game.setAim(host.id, 1.2)
  next.setAim(host.id, 1.2)
  for (let i = 0; i < 10; i += 1) {
    game.tick(Date.now())
    next.tick(Date.now())
  }
  assert.equal(simShape(next), simShape(game), 'both sims evolve identically after restore')
  assert.equal(next.phase, game.phase)
})

test('import marks the old host down and seats the successor', () => {
  const { game, host, guest } = startMatch()
  const next = createGame({ w: 40, h: 30, tickMs: 5, countdownMs: 0 })
  assert.equal(next.importState(game.exportState(), { downId: host.id, hostId: guest.id }), true)
  assert.equal(next.hostId, guest.id)
  assert.equal(next.player(host.id).connected, false)
  assert.equal(next.player(guest.id).connected, true)
  // A new seat still works after a restore.
  const late = next.addPlayer('Late')
  assert.ok(late, 'seats still available after restore')
})

test('import rejects foreign snapshots', () => {
  const { game } = startMatch()
  const other = createGame({ w: 20, h: 20, tickMs: 5, countdownMs: 0 })
  assert.equal(other.importState(game.exportState()), false, 'different board size')
  assert.equal(other.importState({ ...game.exportState(), v: 999 }), false, 'unknown version')
  assert.equal(other.importState(null), false, 'missing state')
  assert.equal(other.phase, 'lobby', 'failed import leaves the game alone')
})
