# PRD: Territory Unity conversion (full rewrite, WebGL)

Status: Draft
Owner: Isaac
Scope: full rewrite — rules, bots, server, and client all move to Unity/C#.
Target: WebGL in the browser, played the same way as today (host on LAN/VPN
shares an address, everyone joins from a browser).

## 1. Summary

Rebuild Territory as a Unity project that plays exactly like the current game:
same capture rules, same room flow, same bots, same feel — running as WebGL in
the browser. The Node server and the canvas client are retired at cutover, not
run side by side in production.

The one structural change the engine forces: a WebGL build cannot listen on a
socket, so it cannot host a round. The host runs a Unity **headless dedicated
server** (same machine that runs `npm start` today) and every player — including
the host — joins it from a browser. From the players' point of view nothing
changes: open an address, type a name, play.

## 2. Background

What exists today (`territory` repo, Node `http` + `ws`, canvas client, no build
step):

| Area | Where | Notes for the port |
|---|---|---|
| Rules + sim | `server/game.js` (~900 lines) | Grid `land`/`trail` arrays, 110ms tick, phases lobby/countdown(3s)/play/over, up to 12 seats, 3 bots, host ownership |
| Bots | `steerBots()`, `BOT_LEVELS` table | Easy/Normal/Hard: `homeAt`, `noise`, `hunt` numbers. Seeded `options.random` for tests |
| Net protocol | `server/index.js` (~380 lines) | JSON over WebSocket. Client→server: `join/rename/dir/steer/aim/start/bot/removeBot/restart`. Server→client: `hello/lobby/full/tick/over/error`. Full snapshots are base64 grids, per-tick updates are run-length `landRuns` |
| Session state | `server/index.js` (`wins`, tokens, 10s reconnect) | Wins keyed by lowercase name, reset on restart; reconnect-by-token grace period |
| Rendering | `public/client.js` (~900 lines), `fx.js` | Neon grid, rounded connected cells, heads with nose/halo, trail shimmer, particles, screen shake, confetti, minimap, kill feed, wall glow |
| Audio | `public/sfx.js` | All synthesized Web Audio: capture/death/countdown/GO/win/lose + looping theme. Lazy `AudioContext` after first gesture, persisted mute |
| Input | keyboard/cursor-steer/touch hold-buttons | Turn model: `heldTurn` left/right + `sendTurn()` |
| Tests | `test/*.js`, 49 tests, `node --test` | Rules, bot ordering, server flow, sfx, view helpers |

Key Unity/WebGL constraints that shape this plan:

- WebGL supports **WebSocket clients only** (via a `.jslib` plugin such as
  NativeWebSocket). No `System.Net.Sockets` listening, no raw UDP in the browser.
- Float math may differ in tiny ways from JS; the sim must not depend on
  bit-exact determinism across client/server — the server stays authoritative
  and clients render what it sends, exactly like today.
- WebGL audio also requires a user gesture; the existing unlock-on-gesture
  design ports directly.

## 3. Goals and non-goals

Goals

- A player cannot tell from gameplay whether the round is served by Node or Unity.
- All 10 shipped behaviors from `docs/PRD-game-improvements.md` (F1–F10) work in Unity.
- The C# sim has test coverage at least equal to today's 49 tests.
- Same hosting story: one command on the host, an address for everyone else.
- One Unity project builds both the headless server and the WebGL client.

Non-goals

- Changing capture, cut, boxing, scoring, or bot rules. This is a port, not a redesign.
- Accounts, matchmaking, internet-wide hosting, dedicated hosting services.
- Native mobile/desktop builds. WebGL only; the current touch controls must keep
  working in mobile browsers, nothing more.
- Rebuilding `logs/results.log` tooling beyond what the server already writes.

## 4. Target architecture

One Unity project, two build targets from the same codebase:

```
unity-territory/
  Assets/Scripts/Sim/        pure C# game logic (no UnityEngine dependency)
  Assets/Scripts/Net/        message types + WebSocket server/client
  Assets/Scripts/Client/     rendering, input, HUD, fx, audio (UnityEngine)
  Assets/Scripts/Server/     headless host: sim loop + broadcast (small UnityEngine surface)
  Assets/Tests/EditMode/     Unity Test Framework ports of test/*.js
  Assets/Plugins/WebGL/      NativeWebSocket-style .jslib for the browser client
```

- **Sim** (`Sim/`): a straight port of `server/game.js` — grid arrays, tick,
  `pack()` equivalents, bot steering with the same `BOT_LEVELS` numbers, seeded
  `Random` for tests. No `MonoBehaviour`, no engine calls, so EditMode tests run
  without a player loop.
- **Protocol** (`Net/`): keep the existing JSON message shapes (`hello`, `lobby`,
  `full`, `tick` with `landRuns`, `over`, `error`, and the client→server set).
  Keeping the wire format means the old Node client can talk to the new C#
  server during migration, which is the cheapest interop test available.
- **Server build**: headless Linux (and Win/Mac for convenience) dedicated
  server. It runs the sim at 110ms, accepts WebSockets (SuperSocket / Fleck-style
  C# WS server library —-decision below), serves the WebGL build over HTTP like
  today's `createServer`, prints the same LAN addresses, appends to
  `logs/results.log` in the same format.
- **Client build**: WebGL. Renders with 2D sprites/Tilemap or a single
  texture-backed grid (today's client paints cells; a `Texture2D` updated from
  `landRuns` is the closest port and keeps minimap/support code simple).
  `AudioSource`-free synthesized audio: port `sfx.js` to C# generating PCM
  buffers (or Milea-style oscillator code) so there are still no audio files.

Networking decision (made here, not deferred):

- **Custom WebSocket protocol, not NGO/Mirror/Fish-Net.** Reasons: (a) the game
  already has a complete, tested message protocol; (b) high-level Unity netcode
  is a poor fit for WebGL (no host, transports need extra plugins anyway);
  (c) reusing the wire format gives cross-implementation interop tests for free.
  Revisit only if real-time requirements change (they don't — 110ms tick).

## 5. Features (parity checklist)

Each item must behave as documented in the README today. IDs map to the
improvements PRD so QA can reuse its acceptance criteria.

| ID | Behavior | Port notes |
|---|---|---|
| P0 | Core loop: lobby → countdown → play → results → lobby | Same phases, 3s countdown, aim-during-countdown |
| P0 | Capture rules (return-home, self-cross, boxing, cuts, wall/head-on deaths) | Port of `server/game.js` tick; EditMode tests mirror `test/rules.test.js` |
| P0 | Wire protocol parity | Same JSON shapes; old client ↔ new server interop test |
| P1 | Host owns room: rename rules, round length, start/restart, host migration | Port seating/token logic incl. 10s reconnect grace |
| P1 | Bots Easy/Normal/Hard, up to 3, add/remove, seeded ordering Easy < Normal < Hard | Same `BOT_LEVELS` numbers; port bot tests |
| P1 | Session wins by name, draws add nothing, reset on restart | Same `wins` semantics in results + lobby messages |
| P2 | Scoreboard, timer, minimap, kill feed (4 lines, 5s fade), wall glow, danger shimmer | UGUI/HUD port; reduced-motion calm-downs respected |
| P2 | Synthesized SFX + looping theme + persisted mute | PCM-synth port, gesture unlock, same mute key if feasible |
| P2 | Touch hold-buttons, cursor steer, keyboard | Unity Input System; `touch-action`-equivalent via canvas focus handling |
| P2 | Results log line format | Same `Winner: … / lost with …` lines |
| P3 | How-to-play strip on join/waiting cards | UI animation port (or recorded clips — visual parity, not code parity) |

## 6. Delivery plan

Phases ship in order; each ends with something runnable.

| Phase | Work | Exit criteria |
|---|---|---|
| 1. Sim port | Port `server/game.js` to `Sim/` (pure C#). Port `test/rules.test.js` to EditMode tests, same scenario names. | All rule/bot scenarios green without Unity runtime. Seeded Easy < Normal < Hard ordering holds. |
| 2. Headless server | `Net/` message types + WS server; `Server/` tick loop, HTTP file serving, LAN address print, results log, wins, tokens/reconnect. | Old Node client can join and finish a round against the C# server (interop test). `npm test`-equivalent C# suite green. |
| 3. WebGL client | Grid renderer, heads/trails, HUD (board/clock/mini/feed), input (keys/cursor/touch), SFX+theme synth, mute, how-to strip. | New client finishes a round against the C# server; manual pass over P2 checklist at desktop + 360×640 touch emulation. |
| 4. Parity QA + cutover | Bot-vs-bot soak (C# sim vs recorded Node behavior: median Normal land ≈1.8% vs idle opponent), full README rewrite, retire Node. | 20 seeded rounds: no rule divergences; playtest: a practiced human beats Normal ~half the time; no console errors; repo archived or `unity-territory` becomes canonical. |

Suggested repo shape: new `unity-territory` repo (Unity projects don't merge
cleanly into a flat Node repo). Keep this repo for reference until cutover.

## 7. Test plan

- **Automated:** Unity Test Framework EditMode suite mirroring all of
  `test/rules.test.js` + `test/server.test.js` (wins, host rules, bot limits,
  reconnect grace). Target: same scenario count or better before Phase 2 exits.
- **Interop:** old client ↔ new server round (Phase 2), new client ↔ old server
  round (Phase 3 — proves wire parity both directions).
- **Manual in browser:** reuse the acceptance criteria in
  `docs/PRD-game-improvements.md` §§F2–F8 verbatim (wall glow, feed, danger cue,
  strip, sound, touch, wins).
- **Soak:** scripted C# bot rounds vs the documented Node baselines (Normal
  ≈1.8% median vs idle opponent; Hard cuts lines).
- **Regression:** replay the capture scenarios (return home, self-cross, enclose
  head) on every phase — rules must not drift.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Sim drift (C# tick diverges from JS rules) | Pure-C# sim + ported tests first; interop rounds catch drift early |
| WebGL WebSocket friction (plugins, compression, close codes) | Proven `.jslib` plugin; keep `perMessageDeflate`-off equivalent; interop test exercises the real path |
| Grid render perf in WebGL (full repaint per tick) | `Texture2D` updated from `landRuns` deltas only, as today; profile with 12 players before cutover |
| Theme/SFX synth sounds different | PCM port of the same oscillator recipes; human listen-check in Phase 3 QA |
| Unity build/test iteration slower than `node --test` | Sim stays engine-free so logic tests run in milliseconds; only client work needs the editor |
| Scope creep into redesign | PRD §3 non-goals enforced at review: any rule change needs its own PRD |

## 9. Open questions

1. Which C# WebSocket server library (SuperSocket, Fleck, WatsonWs)? Criteria:
   standalone (no ASP.NET), Linux-headless friendly, MIT-compatible license.
2. Should the C# server also serve the WebGL build over HTTP (like today), or
   split static hosting out? Proposal: serve it, keeps the one-command story.
3. Keep `logs/results.log` line format byte-identical for existing tooling?
   Proposal: yes.
4. LocalStorage keys (`territory-name`, `territory-mute`, token): reuse as-is so
   returning browsers keep names/mute? Proposal: yes via `Application.persistentDataPath` mapping note in README.
5. After cutover: archive the Node repo or keep it as protocol reference?

## 10. Success criteria

- A WebGL round with a human + Normal bot is indistinguishable in rules, pacing,
  and feel from today's game.
- All parity items (P0–P3) pass their acceptance checks; C# suite green.
- `npm start`-equivalent single command serves WebGL + prints join addresses.
- No console errors in Chrome; touch round completable on a phone browser.
