import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/p2p.js', import.meta.url), 'utf8')

function loadP2P() {
  const sandbox = {}
  vm.createContext(sandbox)
  vm.runInContext(`${source}\nthis.P2P = globalThis.P2P;`, sandbox)
  return sandbox.P2P
}

const P2P = loadP2P()

test('room codes are short, unambiguous, and normalize cleanly', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = P2P.makeCode()
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
  }
  assert.equal(P2P.normalizeCode('abcde'), 'ABCDE')
  assert.equal(P2P.normalizeCode(' a-b c_d!e '), 'ABCDE')
  // Ambiguous characters can never be in a code, so they are dropped rather
  // than mapped (mapping could join the wrong room).
  assert.equal(P2P.normalizeCode('AB01ILODE'), 'ABDE')
  assert.equal(P2P.peerIdFor('abcde'), 'territory-room-abcde')
})

test('chunking round-trips small and snapshot-sized messages', () => {
  const received = []
  const receive = P2P.createReceiver((msg) => received.push(msg))

  const small = { type: 'tick', tick: 7 }
  const smallWires = P2P.chunkMessage(small)
  assert.equal(smallWires.length, 1)
  for (const wire of smallWires) receive(wire)
  assert.equal(JSON.stringify(received.at(-1)), JSON.stringify(small))

  // A full snapshot: land + trail base64 at default board size.
  const big = {
    type: 'full',
    land: 'A'.repeat(28_224),
    trail: 'B'.repeat(28_224),
    players: [{ id: 1, name: 'Host' }],
  }
  const wires = P2P.chunkMessage(big)
  assert.ok(wires.length > 3, `expected several chunks, got ${wires.length}`)
  assert.ok(wires.every((wire) => wire.length <= 17_000), 'every wire fits a DataChannel message')
  // Deliver out of order and duplicated, like a network might.
  for (const wire of [...wires].reverse()) {
    receive(wire)
    receive(wire)
  }
  assert.equal(JSON.stringify(received.at(-1)), JSON.stringify(big))
})

test('corrupt input never throws or calls back', () => {
  const received = []
  const receive = P2P.createReceiver((msg) => received.push(msg))
  receive('not json{{{')
  receive('42')
  receive(JSON.stringify({ __chunk: { id: 'x', idx: 0, total: 2, data: 'half' } }))
  assert.equal(received.length, 0)
})
