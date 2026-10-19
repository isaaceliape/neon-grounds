import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')

test('package.json carries a semver version', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, `version is semver (got ${pkg.version})`)
})

test('the changelog tracks the current version', () => {
  const top = changelog.match(/^## (\d+\.\d+\.\d+)\s*$/m)
  assert.ok(top, 'changelog has a versioned entry')
  assert.equal(top[1], pkg.version, 'top changelog entry matches package.json')
})

test('both pages have a version badge baked in at build time', () => {
  for (const page of ['index.html', 'play/index.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8')
    assert.ok(html.includes('id="ver"'), `${page} has the badge element`)
  }
  const landing = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
  assert.ok(landing.includes('__APP_VERSION__'), 'landing stamps the version')
  assert.ok(client.includes('__APP_VERSION__'), 'game stamps the version')
})
