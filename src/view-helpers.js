// Pure helpers for the cards. No DOM access, so they can be tested in Node.
globalThis.viewHelpers = (() => {
  // True when the message is a finished round with scores.
  function isEnded(msg) {
    return Boolean(msg && msg.phase === 'over' && msg.scores)
  }

  // The rows the card shows: final scores after a round, the roster before one.
  function listedPlayers(msg) {
    return isEnded(msg) ? msg.scores.list : (msg.roster || [])
  }

  // Everyone seated, including people who joined after the round started.
  // The score list only has players who were in the round, so it cannot be
  // used to find your own name.
  function peopleForNick(msg) {
    return msg.roster || listedPlayers(msg)
  }

  function winnerText(scores) {
    if (!scores?.winnerId) return 'Draw.'
    const winner = scores.list.find((row) => row.id === scores.winnerId)
    return winner ? `${winner.name} wins.` : 'Round over.'
  }

  // Which walls the head is driving toward and how close it is.
  // strength is 0 at `range` cells away and 1 at the wall. Walls the head is
  // moving along or away from are left out. Allocation-free fast path: most
  // frames the head is mid-map and this returns null without building arrays.
  function wallWarnings(x, y, heading, w, h, range = 8) {
    const vx = Math.cos(heading)
    const vy = Math.sin(heading)
    // Fast path: far from every wall heading toward it is the common case.
    if (x >= range || -vx < 0.2) {
      if ((w - x >= range || vx < 0.2) && (y >= range || -vy < 0.2) && (h - y >= range || vy < 0.2)) return []
    }
    const out = []
    const dl = x
    if (dl < range && -vx >= 0.2) out.push({ side: 'left', strength: (1 - Math.max(0, dl) / range) * Math.min(1, -vx * 1.4) })
    const dr = w - x
    if (dr < range && vx >= 0.2) out.push({ side: 'right', strength: (1 - Math.max(0, dr) / range) * Math.min(1, vx * 1.4) })
    const dt = y
    if (dt < range && -vy >= 0.2) out.push({ side: 'top', strength: (1 - Math.max(0, dt) / range) * Math.min(1, -vy * 1.4) })
    const db = h - y
    if (db < range && vy >= 0.2) out.push({ side: 'bottom', strength: (1 - Math.max(0, db) / range) * Math.min(1, vy * 1.4) })
    return out
  }

  // One line for the kill feed. `names` maps player id to name.
  function deathFeedText(player, names) {
    const who = player.name
    const by = player.out?.by != null ? names.get(player.out.by) : null
    switch (player.out?.reason) {
      case 'cut': return by ? `${who} was cut by ${by}` : `${who}'s line was cut`
      case 'enclosed': return by ? `${by} boxed in ${who}` : `${who} got boxed in`
      case 'wall': return `${who} hit the wall`
      case 'crash': return `${who} crashed`
      case 'left': return `${who} left the round`
      default: return `${who} is out`
    }
  }

  function captureFeedText(name, pct) {
    return `${name} took +${pct.toFixed(1)}%`
  }

  // True when an exposed line cell of another player is within `range` cells of the head.
  function isDangerCell(index, w, owner, myId, hx, hy, range = 10) {
    if (!owner || owner === myId) return false
    const x = index % w
    const y = (index - x) / w
    const dx = x + 0.5 - hx
    const dy = y + 0.5 - hy
    return dx * dx + dy * dy < range * range
  }

  // Who takes over when the host's browser goes away. Lowest connected
  // human id wins, so every guest computes the same successor from the
  // same player list with no extra messages. The old host is excluded;
  // when it is missing (local server) pass null to include everyone.
  function electSuccessor(list, hostId) {
    let best = null
    for (const player of list ?? []) {
      if (!player || player.bot || player.connected === false) continue
      if (hostId != null && player.id === hostId) continue
      if (best == null || player.id < best) best = player.id
    }
    return best
  }

  // Shareable invite link: opening it lands the guest on the join screen
  // with the room code already filled in.
  function roomInviteLink(base, code) {
    const clean = String(base ?? '').replace(/\?$/, '')
    return `${clean}?code=${encodeURIComponent(String(code ?? '').toUpperCase())}`
  }

  // "1 win" / "3 wins" for the session counter, or '' when there are none.
  function winsLabel(wins, name) {
    const count = wins?.[String(name).toLowerCase()] ?? 0
    if (!count) return ''
    return count === 1 ? '1 win' : `${count} wins`
  }

  // -1 left, 1 right, 0 for none or both held.
  function turnFromHeld(held) {
    return (held.left ? -1 : 0) + (held.right ? 1 : 0)
  }

  // Size of one map cell in pixels while following your own snake.
  // Phones get smaller cells so more of the map fits on screen.
  function followCellSize(viewWidth) {
    return Math.max(12, Math.min(20, viewWidth / 26))
  }

  // Matches MAX_BOTS in server/game.js (a test keeps them in step).
  const MAX_BOTS = 3

  function botCount(msg) {
    return peopleForNick(msg).filter((player) => player.bot).length
  }

  // "easy bot", "hard bot"... Old messages without a level read as normal.
  function botLabel(player) {
    return `${player.level || 'normal'} bot`
  }

  return {
    turnFromHeld,
    followCellSize,
    MAX_BOTS,
    botCount,
    botLabel,
    winsLabel,
    roomInviteLink,
    electSuccessor,
    isEnded, listedPlayers, peopleForNick, winnerText,
    wallWarnings, deathFeedText, captureFeedText, isDangerCell,
  }
})()
