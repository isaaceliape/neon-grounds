# PRD: Territory game improvements

Status: Draft
Owner: Isaac
Repo: `territory` (Node `http` + `ws` server, canvas client, no build step)

## 1. Summary

Ten small improvements to make Territory easier to learn, fairer to play against the bot, and nicer to share. None of them change the core capture rules. Most are client-only. Two touch the server (bot difficulty and session wins).

## 2. Background

What we saw while testing the current build:

- **The Bot always wins.** All 15 rounds in `logs/results.log` were won by the Bot, 7 of them at exactly 1.8%. Humans died to wall hits and "boxed in by Bot", or stayed at the 0.5% start square. Some of those rounds were test runs, but the pattern is clear: the bot plays one fixed loop and is not hard to beat in principle, yet nothing in the game helps a new player avoid dying.
- **Deaths are hard to read.** The only feedback is a status pill for the player who died. Other players see nothing.
- **Exposed lines are easy to miss.** Your own line pulses, but an opponent's line near your head looks the same as any other.
- **The game is silent**, and it only works with a keyboard or mouse.
- **The name-box bug we fixed has no test**, because the client has no test setup.
- **Chrome logs one console issue** on load: "Non-standard `autocomplete` attribute value" (`autocomplete="nickname"` on both name inputs).

Relevant code:

| Area | Where |
|---|---|
| Bot steering | `server/game.js` `steerBots()`, `addBot()` (one bot only, line 420) |
| Start squares | `place()`, `COLS = 4`, `ROWS = 3`, `startSize = 10` (about 16 cells from any wall) |
| Messages | `server/index.js` `snapshot()`, `delta()`, `lobby()`, `join()` |
| Round end | `server/index.js` `writeResult()` |
| Death and capture hooks | `public/client.js` `celebrateDeath()`, `celebrateCapture()` |
| Effects | `public/fx.js` |
| Input | `public/client.js` keydown/keyup, `heldTurn`, `sendTurn()`, `pointermove` |

## 3. Goals and non-goals

Goals

- A new player can understand the rules in under 30 seconds.
- A human can beat the default bot about half the time with some practice.
- Everyone can see why someone died.
- The game works on a phone on the same network.
- Core rules stay exactly as they are today.

Non-goals

- Changing capture, cut, or boxing rules.
- Accounts, matchmaking, or internet-wide hosting.
- A build step, a framework, or new runtime dependencies.
- Persistent stats across server restarts (see open questions).

## 4. Features

Each feature has an ID used in the plan in section 5.

### F1. Bot difficulty and more than one bot

Problem: one fixed bot, always the same loop, always wins.

Requirements

- "Add bot" lets the host pick **Easy, Normal, or Hard**.
- The host can add up to 3 bots (total seats stay capped at 12) and remove a bot in the waiting room.
- Normal behaves like today's bot. Easy is clearly weaker. Hard is clearly stronger.

Implementation plan

- `createGame(options)` gets `options.random` (default `Math.random`) so bot behavior can be tested with a seed.
- Add a `level` field to the bot player and a small table in `game.js`:
  - `homeAt`: trail length before the bot heads home. Today it is 16. Easy 9, Normal 16, Hard 40.
  - `noise`: random angle jitter added to each candidate heading score. Easy high, Normal low, Hard zero.
  - `hunt`: Hard only. When its trail is longer than 10 and a foreign exposed line is within 25 cells, bias `preferred` toward the nearest foreign trail cell, so it goes for cuts.
- `addBot(level = 'normal')` validates the level, allows up to 3 bots, and returns an error past the limit.
- New `removeBot(id)` (host only, lobby or over phase).
- `server/index.js`: `bot` message accepts `level`; new `removeBot` message, same host check as `bot`.
- Client: replace the single "Add bot" button with a level select plus the button, and a small "x" next to each bot in the roster.
- Update the README "The bot" section (it currently says one bot).

Acceptance criteria

- Host can add Easy, Normal, and Hard bots, up to 3, and remove each one.
- A non-host gets the existing "Only the host can add a bot." error.
- Over 20 seeded simulated rounds against an idle opponent that circles in place, average bot land is Easy < Normal < Hard.
- Normal bot results stay close to today's (about 1.8% median) so existing behavior does not regress.

Tests: unit tests in `test/rules.test.js` for the level table, the bot limit, remove, and the seeded ordering check.

### F2. Wall warning

Problem: running into the edge is the cheapest way to die, and nothing warns you.

Requirements

- When your head is within 8 cells of an edge and moving toward it, that edge glows red, stronger as you get closer.
- Only shown while you are alive and the phase is `play`.

Implementation plan

- Client only. In `frame()`, after the border stroke, compute distance to each wall from `pose(me)` and the sign of `cos/sin(heading)`. If the distance is under 8 and heading points at it, draw a gradient band along that edge, clipped to the view, with alpha `1 - d / 8`.
- Skip the effect when `prefers-reduced-motion` is set (keep a static, non-pulsing band instead).

Acceptance criteria

- Driving at a wall from 8 cells away shows a red band that gets brighter until impact.
- No band appears when you are near a wall but moving along or away from it.
- No band for dead players or outside `play`.

### F3. Kill feed

Problem: only the dead player sees why they died.

Requirements

- A short list under the minimap shows recent events for everyone: "Bot boxed in Isaac", "Isaac was cut by Bot", "Isaac hit the wall", "Isaac crashed", "Isaac left".
- Large captures (1% or more) also appear: "Bot took +1.4%".
- Keep at most 4 entries. Each fades out after 5 seconds.

Implementation plan

- Client only. Add `<ol id="feed">` inside `#hud`. In `celebrateDeath(player)` build the text from `player.out.reason` and `player.out.by` (names from `bodies`) and call a new `pushFeed(text, color)`. In `celebrateCapture()` call it when `pct >= 1`.
- CSS: slide-in, fade-out, entry text in the player's color. Reduced-motion: no slide.

Acceptance criteria

- Every death produces one feed line naming the right killer and reason.
- Feed never exceeds 4 lines and entries disappear after about 5 seconds.
- Spectators and late joiners see the feed too.

### F4. Danger cue for other players' lines

Problem: an opponent's exposed line near you is the main thing to notice, and it looks the same as everything else.

Requirements

- Exposed line cells of other players within 10 cells of your head shimmer red and brighter than normal.
- Other lines farther away keep the normal shimmer.

Implementation plan

- `fx.drawWorld` already loops over `trailCells`. Pass `myId`, the `trail` array, and my head position. For each cell where `trail[index] !== myId` and the distance is under 10, use a red tint and 2x amplitude. The extra work is one distance check per trail cell.

Acceptance criteria

- Moving toward another player's line turns its nearby cells red at 10 cells.
- Your own line never turns red.
- Frame time does not noticeably increase with 12 players on the map (check with the DevTools performance trace).

### F5. "How to play" strip

Problem: the rules are a paragraph of text, and several rules changed recently.

Requirements

- Three short steps with a tiny looping animation on the join card and the waiting room: (1) leave your land, (2) loop back or cross your own line to claim, (3) cross another line to cut them.
- Static (no looping) with `prefers-reduced-motion`.

Implementation plan

- Inline SVG in `index.html` with CSS `stroke-dashoffset` animation. No JS. Hidden once a round starts.

Acceptance criteria

- Strip shows on the join card and waiting room, not during play.
- Text fits at 360px width.

### F6. Sound

Problem: the game is silent.

Requirements

- Short synthesized sounds for: capture (pitch rises with size), death (nearby deaths louder), countdown tick, GO, win, and lose.
- A mute toggle that persists.
- No audio files.

Implementation plan

- New `public/sfx.js` using the Web Audio API (oscillators and gain envelopes), loaded before `client.js`.
- Create the `AudioContext` lazily and resume it on the first pointer or key event, because browsers block audio before a gesture.
- Call sites: the same places `fx.capture`, `fx.death`, the countdown `retrigger`, `flashGo`, and `celebrateWin` are called.
- Mute button in the join/waiting card and a small icon button in the HUD. Store in `localStorage` as `territory-mute`. Default: sound on, master gain about 0.25.
- If `AudioContext` is missing, every call is a no-op.

Acceptance criteria

- No sound and no console warning before the first user gesture.
- Mute persists across reloads and silences everything.
- Each event listed above plays a distinct sound.

### F7. Touch controls

Problem: only keyboard and mouse work, so phones on the same network cannot play.

Requirements

- On touch devices (`(pointer: coarse)`), show large LEFT and RIGHT hold buttons at the bottom corners.
- Page does not scroll or zoom while playing.

Implementation plan

- Reuse the existing turn model: the buttons set `heldTurn.left/right` and call `sendTurn()`, exactly like the keyboard handlers.
- CSS: `touch-action: none` on `#view` and the buttons, `user-select: none`, buttons hidden on non-coarse pointers.
- Use pointer events (`pointerdown`/`pointerup`/`pointercancel`/`pointerleave`) so a finger sliding off a button releases it.
- Layout check at 360x640 and landscape. The HUD scoreboard and minimap must not overlap the buttons.

Acceptance criteria

- With DevTools mobile emulation, a full round is playable with touch only.
- Releasing a button (including by dragging off it or a cancelled touch) stops the turn.
- Buttons do not appear on desktop.

### F8. Session wins

Problem: `logs/results.log` records every round, but players never see it.

Requirements

- Show a win count next to each name on the results card and in the waiting room ("2 wins"). Counts reset when the server restarts.

Implementation plan

- `server/index.js`: keep `wins = new Map()` keyed by lowercase display name. In the round-over path (where `writeResult()` is called), increment the winner's count unless the round was a draw.
- Include `wins: Object.fromEntries(wins)` in the `lobby()` and `over` snapshot messages.
- Client: `playerRow()` appends `wins` text when a player's count is above zero.
- Names are the key, so a renamed player starts at zero. That is acceptable for a session counter (see open questions).

Acceptance criteria

- After two rounds won by the same player, that player shows 2 wins in the waiting room and on the next results card.
- Draws add nothing.
- Counts survive a player disconnecting and rejoining under the same name, and reset on server restart.

Tests: add to `test/server.test.js`: two rounds, assert the count in the `lobby` message.

### F9. Fix the autocomplete notice

Problem: Chrome reports a non-standard `autocomplete` value on both name inputs.

Requirements

- No `autocomplete` issue in the DevTools console on load.

Implementation plan

- Check the issue details in DevTools first to confirm which attribute it flags. If it is `nickname`, switch both inputs (`#name`, `#nick`) to `autocomplete="off"`, which also suits a game name field.

Acceptance criteria

- Reload the page: the Issues panel and console list nothing about autocomplete.

### F10. Test coverage for the client list bug

Problem: the `showCard` name-box fix has no regression test.

Requirements

- A test that fails if a late joiner is missing from the list used to fill the name box on the results screen.

Implementation plan

- Move the pure logic into `public/view-helpers.js` (for example `peopleForNick(msg)` and `winnerText(scores)`), loaded as a classic script before `client.js`.
- Test it with `node:test` by reading the file and evaluating it in `node:vm`, so no module system change or new dependency is needed. The test builds a results message where the late joiner is only in `roster` and asserts the helper returns them.

Acceptance criteria

- Test passes now, and fails if `showCard` goes back to using `scores.list` for the name box.

## 5. Delivery plan

Phases are ordered so each one can ship on its own.

| Phase | Features | Why first | Effort |
|---|---|---|---|
| 1. Quick wins (client only) | F9, F2, F3, F4, F10 | Small, low risk, directly reduce cheap deaths | about 1 day |
| 2. Feel and onboarding | F6, F8, F5 | Biggest "feels like a real game" gain | about 1.5 days |
| 3. Depth and reach | F1, F7 | Larger changes: server bot logic and a new input mode | about 2.5 days |

Suggested commits: one per feature, README updated in the same commit when behavior changes (F1 and F8 at minimum).

Order within Phase 1: F9, F10, F2, F3, F4. F10 comes before the others so later client changes have a test harness.

## 6. Test plan

- **Automated:** `bun test` must stay green. New unit tests for F1, new server tests for F8, new vm-based test for F10.
- **Manual in the browser (chrome-devtools MCP):** one pass per feature using the acceptance criteria above. Use a second client (a small `ws` script) as an opponent, and run it on a separate port so a live game is not disturbed. Restore `logs/results.log` after test rounds.
- **Mobile:** Chrome device emulation with touch for F7 at 360x640 and landscape.
- **Regression:** replay the capture scenarios (return home, self-cross, enclose head) to confirm no rule changes.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Hard bot is no fun, or Easy is still too hard | Keep the level table as plain numbers in one place so tuning is a one-line change. Playtest each level. |
| Sound annoys players | Default volume low, one-click mute that persists. |
| Danger cue costs frame time | It adds one distance check per trail cell. Measure with a performance trace before merging. |
| Touch buttons overlap HUD on small screens | Test at 360x640 and landscape before merging. |
| Session wins keyed by name | Documented limitation. Revisit if renames become common. |

## 8. Open questions

1. Max number of bots: is 3 right, or should it match the 12-seat cap?
2. Should win counts be rebuilt from `logs/results.log` on server start instead of resetting?
3. Sound default: on (proposed) or off until the player turns it on?
4. Touch: are hold buttons enough, or should dragging also steer (reusing cursor-steer)?
5. Should Hard bots be allowed in the same room as Easy ones, or one level per room?

## 9. Success criteria

- Playtest: a new human beats the Normal bot in at least 1 of 3 rounds after one practice round.
- No console errors or issues on load.
- Every death shows up in the kill feed with the right reason.
- A phone on the same network can join and finish a round with touch only.
- `bun test` passes, with new tests for F1, F8, and F10.
