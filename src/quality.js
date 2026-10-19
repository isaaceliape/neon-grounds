// Adaptive quality governor: holds at least 30fps on weak hardware by
// shedding load in tiers, and restores full quality when headroom returns.
// Pure logic, no DOM: client.js applies state.tier to the DPR cap, the
// background blobs, and the fx particle budget.
export const QUALITY_TIERS = [
  { dpr: 2, blobs: 'full', fx: 1 },
  { dpr: 2, blobs: 'dim', fx: 1 },
  { dpr: 1.5, blobs: 'off', fx: 1 },
  { dpr: 1, blobs: 'off', fx: 0.35 },
]

// EMA frame time above the current tier's ceiling for 3 straight seconds
// steps down; below STEP_UP_MS for 10 straight seconds steps back up.
export const STEP_DOWN_MS = [20, 28, 33]
export const STEP_UP_MS = 14
export const STEP_DOWN_SECS = 3
export const STEP_UP_SECS = 10

export function createQuality() {
  return { tier: 0, badSecs: 0, goodSecs: 0 }
}

// Call once per second with the EMA frame time in ms. Returns the tier.
export function updateQuality(state, avgMs) {
  if (state.tier < QUALITY_TIERS.length - 1 && avgMs > STEP_DOWN_MS[state.tier]) {
    state.badSecs += 1
    state.goodSecs = 0
    if (state.badSecs >= STEP_DOWN_SECS) {
      state.tier += 1
      state.badSecs = 0
    }
  } else if (state.tier > 0 && avgMs < STEP_UP_MS) {
    state.goodSecs += 1
    state.badSecs = 0
    if (state.goodSecs >= STEP_UP_SECS) {
      state.tier -= 1
      state.goodSecs = 0
    }
  } else {
    state.badSecs = 0
    state.goodSecs = 0
  }
  return state.tier
}
