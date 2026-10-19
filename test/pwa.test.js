import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const pub = (name) => new URL(`../public/${name}`, import.meta.url)
const atRoot = (name) => new URL(`../${name}`, import.meta.url)
const inSrc = (name) => new URL(`../src/${name}`, import.meta.url)
const read = (name) => readFileSync(pub(name), 'utf8')

test('the manifest describes an installable app with real icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'))
  assert.equal(manifest.name, 'Neon Ground')
  assert.ok(manifest.short_name)
  assert.ok(manifest.start_url)
  assert.equal(manifest.display, 'standalone')
  assert.ok(manifest.theme_color)
  assert.ok(manifest.background_color)
  const sizes = new Set()
  for (const icon of manifest.icons) {
    sizes.add(`${icon.sizes}${icon.purpose ? `+${icon.purpose}` : ''}`)
    assert.ok(existsSync(pub(icon.src)), `${icon.src} ships in public/`)
  }
  assert.ok(sizes.has('192x192'), 'a 192 icon for the home screen')
  assert.ok(sizes.has('512x512'), 'a 512 icon for the splash screen')
  assert.ok([...sizes].some((size) => size.includes('maskable')), 'a maskable icon for adaptive shapes')
})

test('the landing links the manifest and the game', () => {
  const html = readFileSync(atRoot('index.html'), 'utf8')
  assert.ok(html.includes('rel="manifest"'), 'manifest linked')
  assert.ok(html.includes('apple-touch-icon'), 'iOS home-screen icon linked')
  assert.ok(html.includes('theme-color'), 'theme color set')
  assert.ok(html.includes('href="play/"'), 'Play button reaches the game')
  assert.ok(html.includes('play/?join=1'), 'Join button skips the picker')
  assert.ok(html.includes("play/?code="), 'old invite links forward to the game')
  for (const shot of ['shots/picker.png', 'shots/waiting-room.png', 'shots/round.png']) {
    assert.ok(html.includes(shot), `landing shows ${shot}`)
    assert.ok(existsSync(new URL(`../public/${shot}`, import.meta.url)), `${shot} ships`)
  }
})

test('the game page loads the bundle and registers the service worker', () => {
  const html = readFileSync(new URL('../play/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('type="module"'), 'game boots as a module')
  const client = readFileSync(inSrc('client.js'), 'utf8')
  assert.ok(client.includes("register('../sw.js')"), 'service worker registered above /play/')
})

test('the service worker parses and caches the app shell', () => {
  const source = read('sw.js')
  assert.doesNotThrow(() => new vm.Script(source), 'sw.js is valid syntax')
  for (const file of ['index.html', 'play/index.html', 'play.js', 'play.css', 'host-session.js', 'manifest.webmanifest', 'icon-512.png']) {
    assert.ok(source.includes(file), `shell caches ${file}`)
  }
})

test('the local server serves PWA file types', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8')
  assert.ok(server.includes('.webmanifest'), 'manifest MIME type mapped')
  assert.ok(server.includes('.png'), 'icon MIME type mapped')
})

test('every deploy busts the service-worker cache', () => {
  const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.match(worker, /const CACHE = 'neon-ground-v\d+'/, 'shell cache is versioned')
  assert.ok(worker.includes('skipWaiting'), 'new worker activates immediately')
  assert.ok(worker.includes('clients.claim'), 'new worker takes over open tabs')
  assert.ok(worker.includes('caches.delete'), 'old shell caches are purged')
  const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8')
  assert.ok(workflow.includes('rev-parse --short HEAD'), 'deploy stamps the cache with the commit')
  assert.ok(workflow.includes("const CACHE = 'neon-ground-"), 'deploy rewrites the versioned cache name')
})

test('the shell list matches the Vite build output', () => {
  const config = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')
  assert.ok(config.includes("entryFileNames: '[name].js'"), 'bundles keep stable names')
  assert.ok(config.includes("chunkFileNames: '[name].js'"), 'chunks keep stable names')
  assert.ok(config.includes("assetFileNames: '[name][extname]'"), 'assets keep stable names')
  const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  const shell = [...worker.matchAll(/'([^']+\.(?:js|css|png|woff2))'/g)].map((match) => match[1])
  assert.ok(shell.length > 0, 'shell lists bundles')
  for (const file of shell) {
    assert.ok(
      [
        'play.js',
        'play.css',
        'host-session.js',
        'peerjs.min.js',
        'qrcode.min.js',
        'jsqr.min.js',
        'vendor/fontawesome/css/fontawesome.min.css',
        'vendor/fontawesome/css/solid.min.css',
        'vendor/fontawesome/webfonts/fa-solid-900.woff2',
        'shots/picker.png',
        'shots/waiting-room.png',
        'shots/round.png',
        'icon-192.png',
        'icon-512.png',
        'maskable-512.png',
        'apple-touch-icon.png',
      ].includes(file),
      `${file} is a real build output or vendored file`,
    )
  }
})
