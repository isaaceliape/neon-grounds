import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// The helpers are a classic browser script. Run it in a VM and read the global it sets.
function loadHelpers() {
  const source = readFileSync(new URL('../public/view-helpers.js', import.meta.url), 'utf8')
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.viewHelpers
}

// Arrays made inside the VM have a different Array prototype, which strict
// deepEqual rejects. Copy results into this realm before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value))

const host = { id: 1, name: 'Host', color: '#ff2a6d', alive: false, bot: false }
const bot = { id: 2, name: 'Bot', color: '#ff6a00', alive: true, bot: true }
const late = { id: 3, name: 'Late', color: '#39ffd2', alive: false, bot: false }

// A finished round where "Late" joined after it started: they are seated, but
// only the players who were in the round appear in the score list.
const overMsg = {
  phase: 'over',
  roster: [host, bot, late],
  scores: { list: [host, bot], winnerId: 2, tied: false },
}

test('a late joiner is found when looking up your own name on the results card', () => {
  const { peopleForNick } = loadHelpers()
  const people = peopleForNick(overMsg)
  assert.ok(people.find((player) => player.id === late.id), 'late joiner must be in the list')
})

test('the results card still lists only the players who were in the round', () => {
  const { listedPlayers } = loadHelpers()
  assert.deepEqual(listedPlayers(overMsg).map((player) => player.id), [1, 2])
})

test('before a round the card lists the whole roster', () => {
  const { listedPlayers, peopleForNick } = loadHelpers()
  const lobby = { phase: 'lobby', roster: [host, bot, late] }
  assert.deepEqual(listedPlayers(lobby).map((player) => player.id), [1, 2, 3])
  assert.deepEqual(peopleForNick(lobby).map((player) => player.id), [1, 2, 3])
})

test('winner text covers a winner, a draw, and a missing winner row', () => {
  const { winnerText } = loadHelpers()
  assert.equal(winnerText(overMsg.scores), 'Bot wins.')
  assert.equal(winnerText({ list: [host], winnerId: null }), 'Draw.')
  assert.equal(winnerText({ list: [host], winnerId: 99 }), 'Round over.')
})

test('wall warning: only walls you are driving toward, stronger when closer', () => {
  const { wallWarnings } = loadHelpers()
  const W = 168
  const H = 126
  const sides = (...args) => plain(wallWarnings(...args)).map((row) => row.side).sort()
  // 4 cells from the left wall, heading left (pi)
  const near = plain(wallWarnings(4, 60, Math.PI, W, H))
  assert.deepEqual(near.map((row) => row.side), ['left'])
  const nearer = plain(wallWarnings(1, 60, Math.PI, W, H))
  assert.ok(nearer[0].strength > near[0].strength)
  assert.ok(nearer[0].strength <= 1)
  // same spot, heading away from the wall
  assert.deepEqual(sides(4, 60, 0, W, H), [])
  // driving along the wall (up) next to the left wall does not warn about it
  assert.deepEqual(sides(4, 60, -Math.PI / 2, W, H), [])
  // far from every wall
  assert.deepEqual(sides(80, 60, Math.PI, W, H), [])
  // a corner warns about both walls it points at
  assert.deepEqual(sides(3, 3, (-3 * Math.PI) / 4, W, H), ['left', 'top'])
  // the bottom and right walls work too
  assert.deepEqual(sides(100, H - 3, Math.PI / 2, W, H), ['bottom'])
  assert.deepEqual(sides(W - 3, 60, 0, W, H), ['right'])
})

test('kill feed text names the right player for each reason', () => {
  const { deathFeedText, captureFeedText } = loadHelpers()
  const names = new Map([[1, 'Isaac'], [2, 'Bot']])
  const out = (reason, by) => ({ name: 'Isaac', out: { reason, by } })
  assert.equal(deathFeedText(out('cut', 2), names), 'Isaac was cut by Bot')
  assert.equal(deathFeedText(out('cut', null), names), "Isaac's line was cut")
  assert.equal(deathFeedText(out('enclosed', 2), names), 'Bot boxed in Isaac')
  assert.equal(deathFeedText(out('enclosed', null), names), 'Isaac got boxed in')
  assert.equal(deathFeedText(out('wall', null), names), 'Isaac hit the wall')
  assert.equal(deathFeedText(out('crash', null), names), 'Isaac crashed')
  assert.equal(deathFeedText(out('left', null), names), 'Isaac left the round')
  assert.equal(deathFeedText({ name: 'Isaac', out: null }, names), 'Isaac is out')
  assert.equal(captureFeedText('Bot', 1.449), 'Bot took +1.4%')
})

test('danger cells: only other players lines within range', () => {
  const { isDangerCell } = loadHelpers()
  const W = 100
  const at = (x, y) => y * W + x
  const head = [50.5, 50.5]
  assert.equal(isDangerCell(at(55, 50), W, 2, 1, ...head), true)
  assert.equal(isDangerCell(at(55, 50), W, 1, 1, ...head), false, 'own line is never danger')
  assert.equal(isDangerCell(at(55, 50), W, 0, 1, ...head), false, 'empty cell')
  assert.equal(isDangerCell(at(70, 50), W, 2, 1, ...head), false, 'too far')
  assert.equal(isDangerCell(at(59, 50), W, 2, 1, ...head), true, 'just inside 10 cells')
  assert.equal(isDangerCell(at(61, 50), W, 2, 1, ...head), false, 'just outside 10 cells')
})

test('session wins label: nothing, singular, plural, and case-insensitive names', () => {
  const { winsLabel } = loadHelpers()
  const wins = { ada: 1, bot: 3 }
  assert.equal(winsLabel(wins, 'Bea'), '')
  assert.equal(winsLabel(wins, 'Ada'), '1 win')
  assert.equal(winsLabel(wins, 'BOT'), '3 wins')
  assert.equal(winsLabel(undefined, 'Ada'), '')
  assert.equal(winsLabel({}, 'Ada'), '')
})

test('bot helpers: level labels, counts, and the same limit as the server', async () => {
  const { botLabel, botCount, MAX_BOTS } = loadHelpers()
  const { MAX_BOTS: serverMax } = await import('../server/game.js')
  assert.equal(MAX_BOTS, serverMax)
  assert.equal(botLabel({ level: 'hard' }), 'hard bot')
  assert.equal(botLabel({}), 'normal bot')
  const msg = { phase: 'lobby', roster: [host, { ...bot, level: 'easy' }, { ...bot, id: 9, level: 'hard' }] }
  assert.equal(botCount(msg), 2)
  // after a round the bot count still comes from the roster, not the score list
  assert.equal(botCount({ ...overMsg }), 1)
})

test('touch helpers: held buttons make a turn, and phones get smaller cells', () => {
  const { turnFromHeld, followCellSize } = loadHelpers()
  assert.equal(turnFromHeld({ left: false, right: false }), 0)
  assert.equal(turnFromHeld({ left: true, right: false }), -1)
  assert.equal(turnFromHeld({ left: false, right: true }), 1)
  assert.equal(turnFromHeld({ left: true, right: true }), 0, 'both held cancels out')
  assert.equal(followCellSize(1440), 20, 'desktop keeps the full size')
  assert.equal(followCellSize(360), 360 / 26, 'phone width shrinks the cell')
  assert.equal(followCellSize(200), 12, 'never smaller than 12px')
})

test('invite links carry the room code for the join screen', () => {
  const { roomInviteLink } = loadHelpers()
  assert.equal(
    roomInviteLink('https://isaaceliape.github.io/territory/', 'tbftu'),
    'https://isaaceliape.github.io/territory/?code=TBFTU',
  )
  assert.equal(
    roomInviteLink('http://localhost:4174/', 'ABCDE'),
    'http://localhost:4174/?code=ABCDE',
  )
})

test('takeover election picks the lowest connected human, never the host', () => {
  const { electSuccessor } = loadHelpers()
  const humans = [
    { id: 1, bot: false, connected: true },
    { id: 2, bot: false, connected: true },
    { id: 3, bot: true, connected: true },
  ]
  assert.equal(electSuccessor(humans, 1), 2, 'skips the dead host')
  assert.equal(electSuccessor(humans, null), 1, 'no host to skip on a local server')
  assert.equal(electSuccessor([...humans, { id: 0, bot: false, connected: false }], 1), 2, 'skips the disconnected')
  assert.equal(electSuccessor([{ id: 1, bot: true, connected: true }], 1), null, 'bots never take over')
  assert.equal(electSuccessor([], 1), null, 'empty room, nobody to elect')
  assert.equal(electSuccessor(null, 1), null, 'missing list')
})
