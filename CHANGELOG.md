# Changelog

Versions are stamped into both pages at build time (bottom-right badge)
from `package.json`. Bump the version there and add an entry here.

## 1.0.2

- Rocket Clouds DEMO logo with CSS-Tricks neon halo and flicker.
- Grounds in solid primary blue; HUD names slide vertically.
- Adaptive quality governor holds 30fps on weak hardware.

## 1.0.1

- Drop the synthesized theme: the licensed track is the only music.
- Fix the theme restarting on every tap and keypress.
- Slide HUD names vertically instead of sideways.

## 1.0.0

- Neon Grounds: multiplayer turf war for up to 12 players, browser-only.
- Landing page at `/` with scroll reveals and morph glow; game at `/play/`.
- Online rooms over WebRTC (room codes, invite links, QR show/scan) with
  host migration; bots fill empty seats.
- Adaptive quality governor holds 30fps on weak hardware (dims, then hides,
  the background glow; caps DPR; trims particles).
- Font Awesome icons throughout; installable PWA with offline shell.
- Bun toolchain: `bun install`, `bun test`, `bun run build`, `bun server/index.js`.
