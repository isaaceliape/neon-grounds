# Territory

A local multiplayer game in the browser. Each player owns a patch of land, drives a snake, and takes more ground by closing a loop. Up to 12 players can share a room, and up to 3 of the seats can be bots. It works on phones too.

## Run it

From this folder:

```
npm install
npm start
```

The server listens on port 4173. Open http://localhost:4173 on this machine. Anyone else on the same network or VPN opens one of the addresses printed in the terminal. The waiting room lists those addresses too.

If the Mac asks whether Node may accept incoming connections, allow it. Set `PORT` to use a different port.

Stop the server with Ctrl+C in that terminal. Closing a browser does not stop the server.

## Online rooms (no VPN)

The page can also host a room with no server at all. One player clicks **Host online room** and shares the 5-letter room code. Everyone else opens the same page anywhere on the internet, types their name and the code, and clicks **Join room**. The same 12 seats and 3 bots apply.

The host's browser runs the round, peer to peer over WebRTC. The host must keep the page open: if the host's tab closes, the room ends for everyone. Losing the connection briefly is fine; guests rejoin automatically for about 10 seconds, same as a dropped tab on the local server.

Online rooms need internet access to reach the free PeerJS signaling server that introduces the players. After that introduction, game traffic flows directly between browsers. Win counts last for the tab session, and rounds are not written to `logs/results.log` (there is no server to write it).

The static files in `public/` plus a copy of `server/game.js` as `game.js` are all a host needs. Pushing to `main` deploys them to GitHub Pages automatically (see `.github/workflows/pages.yml`); enable Pages in the repo settings with the workflow source and share that URL instead of a VPN address.

## Joining

Type a name and click Join. Names are up to 16 characters. If someone already has that name, the next person becomes "Name 2".

The first human in the room is the host. A bot is never the host. If the host leaves for good, the next human becomes host. If nobody else is there, the next person who joins becomes host.

A new visitor sees the name field until they join. The live round is not pushed at them before that.

## Waiting room

Everyone who has joined sees the same room: the player list, their color, and who the host is.

- Your name. Edit it and press Enter, or click away. The list updates for everyone. Names lock when the round starts. You can edit again after the round, before the next one.
- Steer with the cursor. Off by default. The choice is saved in this browser.
- Round length. The host picks 1, 2, 3, or 5 minutes. The default is 3.
- Add bot. Host only. Pick Easy, Normal, or Hard, then click Add bot. A room holds up to 3 bots. The host removes one with the x next to its name.
- Start. Host only. Other players see a disabled "Waiting for the host" button.

Nothing moves until the host clicks Start. Then there is a 3 second countdown. During the countdown you can aim, but the snakes do not move yet.

Restart, during a round, sends everyone back to this room. It does not start the countdown by itself.

## How you move

The snake always moves forward. It can head in any direction and turns in a curve. It does not snap to four straight lines.

Keyboard, when Steer with the cursor is off:

- A or Left arrow turns left.
- D or Right arrow turns right.
- W, S, and the up and down arrows do not steer.

Hold the key to keep turning. If you never turn, you drive straight.

Steer with the cursor: the snake curves toward the pointer. If the pointer is directly behind you, it turns sideways first.

Touch screens: two large buttons, left and right, appear at the bottom while you are alive in a round. Hold one to keep turning. Sliding your finger off a button, or a cancelled touch, lets go of it. The buttons only show on touch devices.

You start in the middle of a small square of your own color, aimed toward the middle of the map.

## Taking land

Leave your land and you draw a line. You close the loop in one of two ways:

- Drive back onto your own land.
- Cross your own line. The loop between the two crossing points closes right there, on empty ground or on someone else's land.

When a loop closes, two things happen:

- Your whole line becomes yours, including the part that ran over someone else's land.
- The area inside the loop becomes yours.

A line that only runs across someone else's land, and never closes, takes nothing. Their squares stay theirs, and they stay alive.

If the loop wraps part of their land, you take only that inside part, plus the squares your line covered. The rest of their land stays theirs. They are knocked out only if their head is inside the part you took.

You do not fill old holes in your land just by closing a new loop somewhere else.

## How you go out

Your line is vulnerable only while it is outside your land. These knock you out:

- Someone crosses that outside line. The log says cut by that player.
- You hit the edge of the map.
- You crash head-on into another snake.
- Your head is inside a loop someone else just closed.
- You disconnect and do not come back within 10 seconds during a round.

Driving across filled land is not a cut. A line painted on top of your land does not kill you.

When you die, the unfinished line disappears. Land you already took stays your color. Other players can still take it by closing a loop around it.

You then watch as Watcher. The camera shows the whole map. The timer and scoreboard stay. The status line says Watcher and why you went out. You do not steer anymore.

## How a round ends

The clock runs out. Whoever owns the most land wins. If the top land totals match, and the kill counts match too, it is a draw.

Or only one player is still alive, and the round started with more than one player. That survivor wins immediately, even if a dead player still owns more land. If everyone dies on the same tick, the round ends and land decides it.

A solo round does not end just because you die. It runs until the timer.

The score screen shows each player's share of the map. The host clicks Play again, which returns to the waiting room. Countdown waits for Start.

## The bots

The host adds up to three bots from the waiting room, each with its own level. A bot takes a normal seat and is marked with its level, for example (hard bot). Bots after the first are named Bot 2 and Bot 3.

| Level | How it plays |
|---|---|
| Easy | Wobbles when it picks a heading, turns home early, and rests on its land between trips. It grows about half as fast as Normal. |
| Normal | The original bot. |
| Hard | Longer trips, and it goes after other players' exposed lines. It steers toward the nearest one and drives through it to cut that player. |

It drives out from the middle of its land, then curves so the line does not cross itself. It looks along the turn it is about to make and rejects a heading that would hit its own older line, someone else's line, or the edge. Once the line is long, it heads back toward its own land if that way is clear. If the way home is blocked, it keeps turning.

Every level plays by the same capture and death rules as everyone else. The levels are plain numbers at the top of `server/game.js` (`BOT_LEVELS`), so tuning one is a one-line change.

## What you see

The board is dark. Each player has a neon color, and their land glows. Connected squares share a side and the outer corners are rounded. A diagonal step is filled in so the path does not leave a gap.

During a round:

- Scoreboard, top left. Name and percent of the map. Rows slide when the ranking changes and flash when a player gains ground. Dead players are dimmed but their land percent stays.
- Timer, top center. It counts down. The last three seconds before movement are shown large.
- Mini-map, top right. The whole board. It clears when a new round starts, so the previous round does not stay on it.
- Kill feed, under the mini-map. Who was cut, boxed in, crashed, hit the wall, or left, and who took 1% or more of the map. It keeps four lines and each fades after 5 seconds.
- Restart, bottom left, host only.
- A bright head with a nose showing the direction you are heading, and a pulsing halo around your own.
- A line is drawn with a shimmer. Another player's exposed line within 10 cells of your head pulses red, so you can see what you could cut or what could cut you.
- A red glow along a wall when you are driving toward it within 8 cells. It gets stronger as you close in.

Effects: closing a loop flashes the taken ground and shows how much you took. A death bursts into particles and shakes the screen. The winner gets confetti. Turn off motion in your system settings (reduce motion) and these calm down.

## Sound

Short synthesized sounds play for captures, deaths, the countdown, GO, and the end of a round. There are no audio files. Browsers only allow sound after you click or press a key, so the first sound comes after that. The Sound on/off button, bottom right, mutes everything, and the choice is saved in this browser.

A looping theme (lead, bass, and hats over Am F C G, about 8 seconds per loop) starts once you join and keeps playing behind the round. The Music on/off button above it silences just the theme; Sound mutes everything. Both choices are saved in this browser. Retune it in `public/sfx.js`: the `MUSIC_LEAD` and `MUSIC_BASS` tables are 32 eighth-note steps, so swapping frequencies is a data-only change.

## Wins this session

The waiting room and the score screen show a small "1 win" or "3 wins" next to a name. The server counts rounds won by name since it started. A draw adds nothing. Restarting the server resets the counts. The full history stays in `logs/results.log`.

## How to play strip

The join card and the waiting room show three small animations: leave your land, loop back to claim, cross a line to cut.

## Disconnects

Closing a browser does not stop the server.

Your snake freezes for 10 seconds. Reopen the same tab in that time and you keep the seat. If you were host, you stay host. A new window is a new player. The old seat does not follow it.

After 10 seconds in the waiting room, the seat is removed. After 10 seconds during a round, you die, the line goes away, and your land stays.

## Logs

When a round ends, the server prints the result and appends it to `logs/results.log`.

```
Winner: Isaac
Isaac won with 18.2%
Jonny lost with 6.4%, cut by Isaac
Bot lost with 9.1%, hit the wall
```

A player who is still alive but has less land is logged as lost with less territory. A tie is logged as Draw.
