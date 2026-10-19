import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const pub = (name) => new URL(`../public/${name}`, import.meta.url)
const read = (name) => readFileSync(pub(name), 'utf8')

test('the manifest describes an installable app with real icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'))
  assert.equal(manifest.name, 'Territory')
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

test('the page links the manifest and registers the service worker', () => {
  const html = read('index.html')
  assert.ok(html.includes('rel="manifest"'), 'manifest linked')
  assert.ok(html.includes('apple-touch-icon'), 'iOS home-screen icon linked')
  assert.ok(html.includes('theme-color'), 'theme color set')
  const client = read('client.js')
  assert.ok(client.includes("register('sw.js')"), 'service worker registered')
})

test('the service worker parses and caches the app shell', () => {
  const source = read('sw.js')
  assert.doesNotThrow(() => new vm.Script(source), 'sw.js is valid syntax')
  for (const file of ['index.html', 'client.js', 'style.css', 'manifest.webmanifest', 'icon-512.png']) {
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
  assert.match(worker, /const CACHE = 'territory-v\d+'/, 'shell cache is versioned')
  assert.ok(worker.includes('skipWaiting'), 'new worker activates immediately')
  assert.ok(worker.includes('clients.claim'), 'new worker takes over open tabs')
  assert.ok(worker.includes('caches.delete'), 'old shell caches are purged')
  const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8')
  assert.ok(workflow.includes('rev-parse --short HEAD'), 'deploy stamps the cache with the commit')
  assert.ok(workflow.includes("const CACHE = 'territory-"), 'deploy rewrites the versioned cache name')
})
