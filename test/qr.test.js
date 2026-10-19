import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// The QR generator is a vendored classic script (qrcode-generator, MIT).
// Run it in a VM and encode a real invite link.
function loadQr() {
  const source = readFileSync(new URL('../public/qrcode.min.js', import.meta.url), 'utf8')
  const sandbox = {}
  sandbox.window = sandbox
  sandbox.self = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.qrcode
}

test('the invite QR encodes the room link as scalable SVG', () => {
  const qrcode = loadQr()
  assert.equal(typeof qrcode, 'function', 'vendored generator exposes qrcode()')
  const code = qrcode(0, 'M')
  code.addData('https://isaaceliape.github.io/neon-groundss/?code=HELLO')
  code.make()
  const svg = code.createSvgTag({ cellSize: 6, margin: 0, scalable: true })
  assert.ok(svg.startsWith('<svg'), 'renders an SVG tag')
  assert.ok(svg.includes('viewBox'), 'scales to its container')
  assert.ok(svg.length > 1000, 'encodes real modules, not an empty grid')
})

test('the waiting room offers the QR next to the invite link', () => {
  const html = readFileSync(new URL('../play/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('qrcode.min.js'), 'generator loads on the page')
  assert.ok(html.includes('id="show-qr"'), 'waiting room has a QR button')
  assert.ok(html.includes('id="qr"'), 'waiting room has a QR slot')
  const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(client.includes('roomInviteLink'), 'QR encodes the same invite link guests type in')
})

test('a generated invite QR decodes back to its URL', () => {
  const sandbox = {}
  sandbox.window = sandbox
  sandbox.self = sandbox
  const genSource = readFileSync(new URL('../public/qrcode.min.js', import.meta.url), 'utf8')
  vm.runInNewContext(genSource, sandbox)
  const decodeSource = readFileSync(new URL('../public/jsqr.min.js', import.meta.url), 'utf8')
  vm.runInNewContext(decodeSource, sandbox)
  const url = 'https://isaaceliape.github.io/neon-groundss/?code=WF9HY'
  const modules = sandbox.qrcode(0, 'M')
  modules.addData(url)
  modules.make()
  // Rasterize the modules by hand: no canvas in Node.
  const scale = 4
  const quiet = 4
  const count = modules.getModuleCount()
  const size = (count + quiet * 2) * scale
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const col = Math.floor(x / scale) - quiet
      const row = Math.floor(y / scale) - quiet
      const dark = row >= 0 && col >= 0 && row < count && col < count ? modules.isDark(row, col) : false
      const at = (y * size + x) * 4
      const ink = dark ? 0 : 255
      pixels[at] = ink
      pixels[at + 1] = ink
      pixels[at + 2] = ink
      pixels[at + 3] = 255
    }
  }
  const found = sandbox.jsQR(pixels, size, size)
  assert.ok(found, 'the invite QR scans')
  assert.equal(found.data, url, 'it carries the exact invite link')
})

test('the join screen offers camera scanning', () => {
  const html = readFileSync(new URL('../play/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('jsqr.min.js'), 'decoder loads on the page')
  assert.ok(html.includes('id="scan-qr"'), 'join screen has a scan button')
  assert.ok(html.includes('id="scanner-video"'), 'join screen has a camera preview')
  const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(client.includes('getUserMedia'), 'scan requests the device camera')
  assert.ok(client.includes('joinOnlineRoom'), 'a good scan joins straight away')
})
