import assert from 'node:assert/strict'
import test from 'node:test'
import { BOT_LEVELS, MAX_BOTS, createGame } from '../server/game.js'

function setup(count = 1) {
  const game = createGame({ w: 40, h: 30, startSize: 4, tickMs: 100, countdownMs: 0 })
  const players = []
  for (let i = 0; i < count; i += 1) players.push(game.addPlayer(`P${i + 1}`))
  let now = 10_000
  assert.equal(game.start(players[0].id, 3, now).ok, true)
  function steps(dirs, id = players[0].id) {
    for (const dir of dirs) {
      game.setDirection(id, dir)
      now += game.tickMs
      game.tick(now)
    }
  }
  return { game, players, steps }
}

const OUT_AND_BACK = ['right', 'right', 'right', 'down', 'left', 'left']
const LOOP = ['right', 'right', 'right', 'down', 'down', 'down', 'left', 'left', 'left', 'up', 'up']

test('a line out and back only claims the line', () => {
  const { game, players, steps } = setup()
  steps(OUT_AND_BACK)
  assert.equal(players[0].alive, true)
  assert.equal(players[0].landCount, 20)
  assert.equal(game.land[5 * game.w + 9], 0)
})

test('closing a loop claims the empty cells inside it', () => {
  const { game, players, steps } = setup(2)
  players[1].connected = false
  steps(LOOP)
  assert.equal(players[0].alive, true)
  assert.equal(players[0].landCount, 28)
  assert.equal(game.land[6 * game.w + 7], players[0].id)
  assert.equal(game.land[5 * game.w + 9], 0)
  assert.equal(players[1].alive, true)
  assert.equal(players[1].landCount, 16)
})

test('a line over their land becomes mine when I get home, and they stay alive', () => {
  const { game, players } = setup(2)
  const [a, b] = players
  b.connected = false
  const crossed = 23 * game.w + 33
  const approach = 5 * game.w + 7
  a.trailCells = [crossed, approach]
  game.trail[crossed] = a.id
  game.trail[approach] = a.id
  a.x = 7.5
  a.y = 5.5
  a.onOwn = false
  a.heading = Math.PI
  a.turn = 0
  a.aim = null
  let now = 12_000
  now += game.tickMs
  game.tick(now)
  assert.equal(a.alive, true)
  assert.equal(b.alive, true)
  assert.equal(b.landCount, 15)
  assert.equal(game.land[crossed], a.id)
  assert.equal(game.trail[crossed], 0)
  assert.equal(game.phase, 'play')
})

test('riding across another player land does not kill them', () => {
  const { game, players } = setup(2)
  const [a, b] = players
  b.connected = false
  a.x = 32.5
  a.y = 25.5
  a.onOwn = false
  a.heading = 0
  a.turn = 0
  a.aim = null
  a.trailCells = []
  let now = 12_000
  for (let i = 0; i < 5; i += 1) {
    now += game.tickMs
    game.tick(now)
  }
  assert.equal(b.alive, true)
  assert.equal(b.landCount, 16)
  assert.equal(game.land[25 * game.w + 35], b.id)
  assert.equal(game.phase, 'play')
  assert.equal(a.alive, true)
})

test('crossing a trail kills that player and leaves their land', () => {
  const { game, players, steps } = setup(2)
  const [a, b] = players
  a.connected = false
  steps(['up', 'up', 'up', 'up'], b.id)
  b.connected = false
  assert.ok(b.trailCells.length > 0)
  a.connected = true
  a.x = 34
  a.y = 22
  a.dir = 'right'
  a.queued = null
  a.onOwn = false
  a.trailCells = []
  steps(['right'], a.id)
  assert.equal(b.alive, false)
  assert.equal(b.landCount, 16)
  assert.equal(b.trailCells.length, 0)
  assert.equal([...game.trail].includes(b.id), false)
  assert.equal(b.out.reason, 'cut')
  assert.equal(b.out.by, a.id)
  assert.equal(a.kills, 1)
  assert.equal(a.alive, true)
})

test('crossing your own line closes the loop instead of killing you', () => {
  const { players, steps } = setup()
  steps(['right', 'right', 'right', 'down', 'left', 'up'])
  assert.equal(players[0].alive, true)
  assert.equal(players[0].out, null)
  assert.equal(players[0].onOwn, true)
  assert.equal(players[0].landCount, 20)
  assert.equal(players[0].trailCells.length, 0)
})

test('a loop closed on open ground claims everything inside it', () => {
  const { game, players, steps } = setup(2)
  players[1].connected = false
  const dirs = [
    ...Array(5).fill('right'),
    ...Array(4).fill('down'),
    ...Array(4).fill('left'),
    ...Array(3).fill('up'),
  ]
  steps(dirs)
  assert.equal(players[0].alive, true)
  assert.equal(players[0].landCount, 39)
  assert.equal(game.land[8 * game.w + 8], players[0].id)
  assert.equal([...game.trail].includes(players[0].id), false)
})

test('a self-closed loop over their land takes the inside and my line, nothing else', () => {
  const { game, players, steps } = setup(2)
  const [a, b] = players
  b.connected = false
  for (let y = 4; y <= 9; y += 1) {
    for (let x = 8; x <= 12; x += 1) {
      game.land[y * game.w + x] = b.id
      b.landCount += 1
    }
  }
  b.x = 10.5
  b.y = 4.5
  const dirs = [
    ...Array(7).fill('right'),
    ...Array(5).fill('down'),
    ...Array(5).fill('left'),
    ...Array(5).fill('up'),
  ]
  steps(dirs)
  assert.equal(a.alive, true)
  assert.equal(b.alive, true)
  assert.equal(game.land[8 * game.w + 9], a.id)
  assert.equal(game.land[5 * game.w + 10], a.id)
  assert.equal(game.land[4 * game.w + 10], b.id)
  assert.equal(b.landCount, 16 + 30 - 25)
})

test('their head sitting outside my self-closed loop is not a kill', () => {
  const { game, players, steps } = setup(2)
  const [a, b] = players
  b.connected = false
  b.x = 30.5
  b.y = 20.5
  steps(['right', 'right', 'right', 'down', 'left', 'up'])
  assert.equal(a.alive, true)
  assert.equal(b.alive, true)
  assert.equal(b.out, null)
  assert.equal(game.land[5 * game.w + 6], a.id)
})

test('a diagonal step connects through the side', () => {
  const { game, players } = setup()
  const player = players[0]
  player.x = 10.5
  player.y = 10.5
  player.onOwn = false
  player.heading = Math.PI / 4
  player.turn = 0
  player.aim = null
  player.trailCells = []
  let now = 12_000
  now += game.tickMs
  game.tick(now)
  const cells = player.trailCells.map((index) => [index % game.w, Math.floor(index / game.w)])
  assert.ok(cells.some(([x, y]) => x === 11 && y === 11))
  assert.ok(cells.some(([x, y]) => (x === 11 && y === 10) || (x === 10 && y === 11)))
})

test('holding a turn makes the snake curve', () => {
  const { game, players } = setup()
  const player = players[0]
  game.setDirection(player.id, 'right')
  game.setSteer(player.id, 1)
  const x = player.x
  const y = player.y
  let now = 11_000
  for (let i = 0; i < 4; i += 1) {
    now += game.tickMs
    game.tick(now)
  }
  assert.equal(player.alive, true)
  assert.ok(player.x > x)
  assert.ok(player.y > y)
  assert.ok(player.heading > 0.4)
})

test('running into the wall is death', () => {
  const { players, steps } = setup()
  steps(Array.from({ length: 40 }, () => 'up'))
  assert.equal(players[0].alive, false)
  assert.equal(players[0].out.reason, 'wall')
  assert.equal(players[0].landCount, 16)
})

test('land inside a loop is stolen and the owner stays alive', () => {
  const { game, players, steps } = setup(2)
  const [a, b] = players
  b.connected = false
  const cell = 7 * game.w + 7
  game.land[cell] = b.id
  b.landCount += 1
  steps(LOOP.slice(0, -1))
  assert.equal(game.land[cell], b.id)
  steps(['up'])
  assert.equal(a.alive, true)
  assert.equal(b.alive, true)
  assert.equal(b.landCount, 16)
  assert.equal(game.land[cell], a.id)
})

test('boxing a player in kills them', () => {
  const { game, players, steps } = setup(2)
  const [a, b] = players
  b.connected = false
  steps(LOOP.slice(0, -1))
  b.x = 7
  b.y = 7
  b.onOwn = false
  steps(['up'])
  assert.equal(a.alive, true)
  assert.equal(b.alive, false)
  assert.equal(b.out.reason, 'enclosed')
  assert.equal(b.out.by, a.id)
  assert.equal(game.land[7 * game.w + 7], a.id)
  assert.equal(b.landCount, 16)
  assert.equal(game.land[25 * game.w + 35], b.id)
})

test('the round ends when only one player is left alive', () => {
  const { game, players, steps } = setup(2)
  const [a, b] = players
  a.connected = false
  steps(['up', 'up', 'up', 'up'], b.id)
  b.connected = false
  a.connected = true
  a.x = 34
  a.y = 22
  a.dir = 'right'
  a.queued = null
  a.onOwn = false
  a.trailCells = []
  steps(['right'], a.id)
  assert.equal(a.alive, true)
  assert.equal(b.alive, false)
  assert.equal(game.phase, 'over')
  const scores = game.scores()
  assert.equal(scores.winnerId, a.id)
  assert.equal(scores.list.find((row) => row.id === b.id).land, 16)
  const log = game.resultLog()
  assert.match(log, new RegExp(`Winner: ${a.name}`))
  assert.match(log, new RegExp(`${b.name} lost with .*cut by ${a.name}`))
})

test('a solo player can be out without ending the round', () => {
  const { game, players, steps } = setup()
  steps(Array.from({ length: 40 }, () => 'up'))
  assert.equal(players[0].alive, false)
  assert.equal(game.phase, 'play')
})

test('a bot joins the room and steers during the round', () => {
  const game = createGame({ w: 40, h: 30, startSize: 4, tickMs: 100, countdownMs: 0 })
  const ada = game.addPlayer('Ada')
  const added = game.addBot()
  assert.equal(added.ok, true)
  assert.equal(game.start(ada.id, 1, 0).ok, true)
  const bot = game.player(added.id)
  assert.equal(bot.bot, true)
  assert.equal(bot.alive, true)
  assert.notEqual(game.hostId, bot.id)
  const startX = bot.x
  const startY = bot.y
  let now = 1000
  for (let i = 0; i < 6; i += 1) {
    now += game.tickMs
    game.tick(now)
  }
  assert.ok(bot.x !== startX || bot.y !== startY)
  assert.equal(Number.isFinite(bot.aim), true)
  assert.equal(bot.alive, true)
})

test('a bot loops out without cutting its own line straight away', () => {
  const game = createGame({ w: 80, h: 60, startSize: 10, tickMs: 110, countdownMs: 0 })
  const ada = game.addPlayer('Ada')
  const added = game.addBot()
  assert.equal(game.start(ada.id, 3, 0).ok, true)
  const bot = game.player(added.id)
  let now = 0
  for (let i = 0; i < 40; i += 1) {
    now += 110
    game.tick(now)
  }
  assert.equal(bot.alive, true)
  assert.equal(game.phase, 'play')
})

test('a player can rename in the waiting room', () => {
  const game = createGame({ w: 40, h: 30, startSize: 4, tickMs: 100, countdownMs: 0 })
  const ada = game.addPlayer('Ada')
  const bea = game.addPlayer('Bea')
  assert.equal(game.rename(ada.id, 'Ada Nova').ok, true)
  assert.equal(ada.name, 'Ada Nova')
  assert.equal(game.rename(ada.id, 'Bea').name, 'Bea 2')
  assert.equal(game.start(ada.id, 1, 0).ok, true)
  assert.equal(game.rename(ada.id, 'Nope').ok, false)
  assert.equal(ada.name, 'Bea 2')
  game.returnToLobby(ada.id)
  assert.equal(game.rename(bea.id, 'Bea').ok, true)
  assert.equal(bea.name, 'Bea')
})

test('restart waits in the lobby until the host clicks start', () => {
  const game = createGame({ w: 40, h: 30, startSize: 4, tickMs: 100, countdownMs: 3000 })
  const a = game.addPlayer('Ada')
  const b = game.addPlayer('Bea')
  assert.equal(game.start(a.id, 1, 0).ok, true)
  assert.equal(game.phase, 'countdown')
  assert.equal(game.returnToLobby(b.id).ok, false)
  assert.equal(game.phase, 'countdown')
  assert.equal(game.returnToLobby(a.id).ok, true)
  assert.equal(game.phase, 'lobby')
  assert.equal(game.tick(1000).phase, 'lobby')
  assert.equal(a.landCount, 0)
  assert.equal(game.start(a.id, 1, 2000).ok, true)
  assert.equal(game.phase, 'countdown')
})

test('the host can restart a round that is still going', () => {
  const game = createGame({ w: 40, h: 30, startSize: 4, tickMs: 100, countdownMs: 0 })
  const a = game.addPlayer('Ada')
  const b = game.addPlayer('Bea')
  let now = 0
  assert.equal(game.start(a.id, 3, now).ok, true)
  now += 100
  game.tick(now)
  a.kills = 4
  assert.equal(game.start(b.id, 1, now).ok, false)
  assert.equal(game.phase, 'play')
  assert.equal(game.start(a.id, 1, now).ok, true)
  assert.equal(game.phase, 'play')
  assert.equal(a.alive, true)
  assert.equal(b.alive, true)
  assert.equal(a.kills, 0)
  assert.equal(a.landCount, 16)
  assert.equal(b.landCount, 16)
})

test('the timer ends the round and only the host can start', () => {
  const game = createGame({ w: 40, h: 30, startSize: 4, tickMs: 1000, countdownMs: 0 })
  const a = game.addPlayer('Ada')
  const b = game.addPlayer('Bea')
  let now = 0
  assert.equal(game.start(a.id, 1, now).ok, true)
  now = 59_000
  assert.equal(game.tick(now).phase, 'play')
  now = 60_000
  const done = game.tick(now)
  assert.equal(done.phase, 'over')
  assert.equal(done.scores.list[0].id, a.id)
  assert.equal(game.start(b.id, 1, now).ok, false)
  assert.equal(game.start(a.id, 1, now).ok, true)
  assert.equal(a.alive, true)
  assert.equal(b.alive, true)
})

// A small seeded random source so bot behavior is repeatable.
function seeded(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('bots have a level: normal by default, easy and hard on request, junk refused', () => {
  const game = createGame({ countdownMs: 0 })
  game.addPlayer('Ada')
  const normal = game.addBot()
  const easy = game.addBot('easy')
  const hard = game.addBot('hard')
  assert.equal(game.player(normal.id).level, 'normal')
  assert.equal(game.player(easy.id).level, 'easy')
  assert.equal(game.player(hard.id).level, 'hard')
  const roster = game.pack().roster
  assert.deepEqual(roster.map((row) => row.level), [null, 'normal', 'easy', 'hard'])
  assert.equal(game.addBot('impossible').ok, false)
  assert.equal(game.addBot('toString').ok, false, 'inherited object keys are not levels')
  assert.deepEqual(Object.keys(BOT_LEVELS), ['easy', 'normal', 'hard'])
})

test('a room holds up to three bots and refuses a fourth', () => {
  const game = createGame({ countdownMs: 0 })
  game.addPlayer('Ada')
  assert.equal(MAX_BOTS, 3)
  for (let i = 0; i < MAX_BOTS; i += 1) assert.equal(game.addBot().ok, true)
  const fourth = game.addBot()
  assert.equal(fourth.ok, false)
  assert.match(fourth.error, /up to 3 bots/)
  const names = game.pack().roster.filter((row) => row.bot).map((row) => row.name)
  assert.equal(new Set(names).size, 3, 'bots get distinct names')
})

test('bots can be removed in the waiting room, only bots, and not mid-round', () => {
  const game = createGame({ countdownMs: 0 })
  const ada = game.addPlayer('Ada')
  const bot = game.addBot('hard')
  assert.equal(game.removeBot(ada.id).ok, false, 'a human is not a bot')
  assert.equal(game.removeBot(999).ok, false, 'unknown id')
  assert.equal(game.removeBot(bot.id).ok, true)
  assert.equal(game.player(bot.id), null)
  assert.equal(game.addBot().ok, true, 'a seat opens up again')
  const again = game.addBot()
  assert.equal(game.start(ada.id, 1, 0).ok, true)
  assert.equal(game.removeBot(again.id).ok, false, 'not while the round runs')
  assert.equal(game.addBot().ok, false, 'no new bots mid-round either')
})

function botGrowth(level, seed, ticks) {
  const game = createGame({ countdownMs: 0, random: seeded(seed) })
  const human = game.addPlayer('Human')
  const bot = game.player(game.addBot(level).id)
  let now = 1000
  game.start(human.id, 5, now)
  game.setSteer(human.id, 1) // the human circles inside their own square
  for (let i = 0; i < ticks; i += 1) {
    now += game.tickMs
    game.tick(now)
  }
  return bot.landCount
}

test('an easy bot grows clearly slower than a normal one', () => {
  const seeds = [1, 2, 3, 4, 5, 6]
  const average = (level) => seeds.reduce((sum, seed) => sum + botGrowth(level, seed, 545), 0) / seeds.length
  const easy = average('easy')
  const normal = average('normal')
  assert.ok(easy < normal * 0.75, `easy ${easy} should be well under normal ${normal}`)
})

test('a hard bot beats a normal bot and cuts lines to do it', () => {
  let hardWins = 0
  let hardKills = 0
  let normalKills = 0
  for (let seed = 1; seed <= 6; seed += 1) {
    const game = createGame({ countdownMs: 0, random: seeded(seed) })
    const human = game.addPlayer('Human')
    const hard = game.player(game.addBot('hard').id)
    const normal = game.player(game.addBot('normal').id)
    let now = 1000
    game.start(human.id, 5, now)
    game.setSteer(human.id, 1)
    for (let i = 0; i < 1500 && game.phase === 'play'; i += 1) {
      now += game.tickMs
      game.tick(now)
    }
    if (hard.landCount > normal.landCount) hardWins += 1
    hardKills += hard.kills
    normalKills += normal.kills
  }
  assert.ok(hardWins >= 5, `hard won ${hardWins} of 6`)
  assert.ok(hardKills > normalKills, `hard kills ${hardKills} vs normal ${normalKills}`)
})

test('the normal bot plays the same as before levels existed', () => {
  // Same seed, same start: two normal bots follow identical paths, and the
  // level table entry for normal has no rest, noise or hunting.
  assert.deepEqual(BOT_LEVELS.normal, { homeAt: 16, noise: 0, hunt: false, rest: 0 })
  assert.equal(botGrowth('normal', 1, 300), botGrowth('normal', 99, 300), 'normal does not use randomness')
})
