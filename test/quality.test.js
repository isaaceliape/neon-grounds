import assert from 'node:assert/strict'
import test from 'node:test'
import { createQuality, updateQuality, QUALITY_TIERS, STEP_DOWN_MS, STEP_UP_MS } from '../src/quality.js'

test('the governor starts at full quality', () => {
  const q = createQuality()
  assert.equal(q.tier, 0)
  assert.deepEqual(QUALITY_TIERS[0], { dpr: 2, blobs: 'full', fx: 1 })
})

test('three slow seconds step down one tier', () => {
  const q = createQuality()
  assert.equal(updateQuality(q, STEP_DOWN_MS[0] + 5), 0)
  assert.equal(updateQuality(q, STEP_DOWN_MS[0] + 5), 0)
  assert.equal(updateQuality(q, STEP_DOWN_MS[0] + 5), 1)
  assert.equal(q.tier, 1)
})

test('each tier has its own ceiling', () => {
  const q = createQuality()
  q.tier = 1
  // 21ms would sink tier 0, but tier 1 tolerates up to 28.
  updateQuality(q, STEP_DOWN_MS[0] + 1)
  updateQuality(q, STEP_DOWN_MS[0] + 1)
  updateQuality(q, STEP_DOWN_MS[0] + 1)
  assert.equal(q.tier, 1)
  updateQuality(q, STEP_DOWN_MS[1] + 1)
  updateQuality(q, STEP_DOWN_MS[1] + 1)
  updateQuality(q, STEP_DOWN_MS[1] + 1)
  assert.equal(q.tier, 2)
})

test('the bottom tier holds under sustained slowness', () => {
  const q = createQuality()
  q.tier = 3
  for (let i = 0; i < 10; i += 1) updateQuality(q, 120)
  assert.equal(q.tier, 3)
})

test('ten fast seconds step back up one tier', () => {
  const q = createQuality()
  q.tier = 2
  for (let i = 0; i < 9; i += 1) assert.equal(updateQuality(q, STEP_UP_MS - 1), 2)
  assert.equal(updateQuality(q, STEP_UP_MS - 1), 1)
})

test('a mixed second resets both streaks', () => {
  const q = createQuality()
  updateQuality(q, STEP_DOWN_MS[0] + 5)
  updateQuality(q, STEP_DOWN_MS[0] + 5)
  updateQuality(q, (STEP_DOWN_MS[0] + STEP_UP_MS) / 2)
  assert.equal(q.badSecs, 0)
  assert.equal(q.goodSecs, 0)
  assert.equal(q.tier, 0)
})

test('the top tier never steps up', () => {
  const q = createQuality()
  for (let i = 0; i < 12; i += 1) updateQuality(q, 5)
  assert.equal(q.tier, 0)
})
