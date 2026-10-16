// Visual effects for the board. Everything here is cosmetic and client side.
// World positions are in map cells, screen positions are in CSS pixels.
const fx = (() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const MAX_PARTICLES = 900
  const screen = document.querySelector('#fx')
  const screenCtx = screen.getContext('2d')

  let particles = []
  let rings = []
  let flashes = []
  let floaters = []
  let confetti = []
  let shakeAmp = 0
  let screenDirty = false

  const rand = (min, max) => min + Math.random() * (max - min)
  const rgba = (color, alpha) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`
  const WHITE = [255, 255, 255]
  const PALETTE = [
    [255, 42, 109],
    [57, 255, 210],
    [255, 214, 10],
    [20, 184, 255],
    [255, 106, 0],
    [190, 90, 255],
  ]

  function addParticle(particle) {
    if (particles.length < MAX_PARTICLES) particles.push(particle)
  }

  function burst(x, y, color, count, minSpeed, maxSpeed, minLife, maxLife, size) {
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2)
      const speed = rand(minSpeed, maxSpeed)
      addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        drag: 2.2,
        age: 0,
        life: rand(minLife, maxLife),
        size: rand(size * 0.5, size),
        color: Math.random() < 0.25 ? WHITE : color,
      })
    }
  }

  // A closed loop: cells light up as a wave runs out from the head, then fade.
  function capture({ cells, w, color, ox, oy, label }) {
    if (reduced || cells.length === 0) return
    const n = cells.length
    const xs = new Int16Array(n)
    const ys = new Int16Array(n)
    let cx = 0
    let cy = 0
    for (let k = 0; k < n; k += 1) {
      const x = cells[k] % w
      xs[k] = x
      ys[k] = (cells[k] - x) / w
      cx += x
      cy += ys[k]
    }
    cx = cx / n + 0.5
    cy = cy / n + 0.5
    const originX = Number.isFinite(ox) ? ox : cx
    const originY = Number.isFinite(oy) ? oy : cy
    const dist = new Float32Array(n)
    let maxDist = 1
    for (let k = 0; k < n; k += 1) {
      dist[k] = Math.hypot(xs[k] + 0.5 - originX, ys[k] + 0.5 - originY)
      if (dist[k] > maxDist) maxDist = dist[k]
    }
    const speed = Math.max(28, maxDist / 0.55)
    const bright = color.map((c) => Math.round(c + (255 - c) * 0.65))
    flashes.push({ xs, ys, dist, bright, age: 0, speed, life: maxDist / speed + 0.8 })
    const reach = Math.min(maxDist + 4, 30)
    rings.push({ x: originX, y: originY, reach, age: 0, delay: 0, life: 0.85, color, width: 0.9 })
    rings.push({ x: originX, y: originY, reach: reach * 0.7, age: 0, delay: 0.12, life: 0.7, color: WHITE, width: 0.5 })
    floaters.push({ x: originX, y: originY - 2.5, text: label, color, age: 0, life: 1.7 })
    const sparks = Math.min(70, 12 + Math.floor(n / 4))
    for (let i = 0; i < sparks; i += 1) {
      const k = Math.floor(Math.random() * n)
      addParticle({
        x: xs[k] + 0.5,
        y: ys[k] + 0.5,
        vx: rand(-2, 2),
        vy: rand(-9, -2),
        drag: 1.2,
        age: 0,
        life: rand(0.6, 1.3),
        size: rand(0.12, 0.3),
        color: Math.random() < 0.5 ? WHITE : color,
      })
    }
  }

  // A player going out: big burst, shock rings, and a screen shake for nearby deaths.
  function death({ x, y, color, mine, near }) {
    if (reduced) return
    burst(x, y, color, mine ? 110 : 80, 5, 22, 0.5, 1.5, 0.42)
    burst(x, y, WHITE, 24, 8, 26, 0.25, 0.6, 0.28)
    rings.push({ x, y, reach: 8, age: 0, delay: 0, life: 0.45, color: WHITE, width: 1.1 })
    rings.push({ x, y, reach: 17, age: 0, delay: 0.05, life: 0.95, color, width: 0.9 })
    rings.push({ x, y, reach: 26, age: 0, delay: 0.2, life: 1.15, color, width: 0.45 })
    shakeAmp = Math.max(shakeAmp, mine ? 1 : near)
  }

  // Glow sparks left behind a moving head.
  function trailSparks(x, y, heading, color, dt) {
    if (reduced) return
    // Shed load when a burst just filled the pool: trail sparks are the
    // first thing to drop, so captures/deaths never hitch.
    if (particles.length > 650) return
    const count = Math.floor(dt * 70 + Math.random())
    for (let i = 0; i < count; i += 1) {
      const back = heading + Math.PI + rand(-0.55, 0.55)
      const speed = rand(1.5, 5)
      addParticle({
        x: x + rand(-0.2, 0.2),
        y: y + rand(-0.2, 0.2),
        vx: Math.cos(back) * speed,
        vy: Math.sin(back) * speed,
        drag: 3,
        age: 0,
        life: rand(0.3, 0.7),
        size: rand(0.1, 0.22),
        color: Math.random() < 0.3 ? WHITE : color,
      })
    }
  }

  function celebrate({ colors, winner }) {
    if (reduced) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const palette = colors.length ? [...colors, ...colors, ...PALETTE] : PALETTE
    const count = winner ? 220 : 80
    for (let i = 0; i < count; i += 1) {
      const fromCannon = i % 3 !== 0
      const left = i % 2 === 0
      confetti.push(
        fromCannon
          ? {
              x: left ? 0 : vw,
              y: vh,
              vx: (left ? 1 : -1) * rand(150, 620),
              vy: -rand(520, 1050),
              gravity: 780,
              drag: 0.55,
              rot: rand(0, 6.3),
              spin: rand(-12, 12),
              w: rand(7, 14),
              h: rand(4, 8),
              color: palette[Math.floor(Math.random() * palette.length)],
            }
          : {
              x: rand(0, vw),
              y: rand(-vh * 0.4, -10),
              vx: rand(-50, 50),
              vy: rand(80, 240),
              gravity: 260,
              drag: 0.2,
              rot: rand(0, 6.3),
              spin: rand(-8, 8),
              w: rand(6, 12),
              h: rand(3, 7),
              color: palette[Math.floor(Math.random() * palette.length)],
            },
      )
    }
  }

  // In-place compaction: update() runs every frame, and Array.filter would
  // allocate a fresh array (plus iterator garbage) right in the middle of
  // the effects that need the budget most.
  function compactAlive(list, alive) {
    let kept = 0
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i]
      if (!alive(item)) continue
      list[kept] = item
      kept += 1
    }
    list.length = kept
  }

  function update(dt) {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i]
      p.age += dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const damp = Math.exp(-p.drag * dt)
      p.vx *= damp
      p.vy *= damp
    }
    compactAlive(particles, (p) => p.age < p.life)
    for (let i = 0; i < rings.length; i += 1) rings[i].age += dt
    compactAlive(rings, (r) => r.age < r.life + r.delay)
    for (let i = 0; i < flashes.length; i += 1) flashes[i].age += dt
    compactAlive(flashes, (f) => f.age < f.life)
    for (let i = 0; i < floaters.length; i += 1) floaters[i].age += dt
    compactAlive(floaters, (f) => f.age < f.life)
    for (const c of confetti) {
      c.age = (c.age || 0) + dt
      c.vy += c.gravity * dt
      const damp = Math.exp(-c.drag * dt)
      c.vx *= damp
      c.vy *= Math.exp(-0.25 * dt)
      c.x += c.vx * dt
      c.y += c.vy * dt
      c.rot += c.spin * dt
    }
    const vh = window.innerHeight
    compactAlive(confetti, (c) => c.y < vh + 40)
  }

  // [x, y] pixel offset for this frame. Fades out on its own.
  function shake(dt) {
    if (reduced || shakeAmp <= 0.01) {
      shakeAmp = 0
      return [0, 0]
    }
    const magnitude = shakeAmp * shakeAmp * 20
    shakeAmp = Math.max(0, shakeAmp - dt * 2.1)
    return [rand(-magnitude, magnitude), rand(-magnitude, magnitude)]
  }

  function drawWorld(ctx, { ox, oy, cell, vw, vh, t, w, trailCells, danger }) {
    ctx.save()
    for (const f of flashes) {
      const front = f.age * f.speed
      const n = f.xs.length
      ctx.fillStyle = rgba(f.bright, 1)
      for (let k = 0; k < n; k += 1) {
        const since = (front - f.dist[k]) / f.speed
        if (since < 0) continue
        const alpha = 1 - since / 0.75
        if (alpha <= 0) continue
        const px = ox + f.xs[k] * cell
        const py = oy + f.ys[k] * cell
        if (px < -cell || py < -cell || px > vw || py > vh) continue
        ctx.globalAlpha = alpha * alpha * 0.8
        ctx.fillRect(px, py, cell + 0.5, cell + 0.5)
      }
      ctx.fillStyle = '#ffffff'
      for (let k = 0; k < n; k += 1) {
        const since = (front - f.dist[k]) / f.speed
        if (since < 0 || since > 0.16) continue
        const px = ox + f.xs[k] * cell
        const py = oy + f.ys[k] * cell
        if (px < -cell || py < -cell || px > vw || py > vh) continue
        ctx.globalAlpha = (1 - since / 0.16) * 0.85
        ctx.fillRect(px, py, cell + 0.5, cell + 0.5)
      }
    }
    ctx.restore()

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    const hasDanger = Boolean(danger)
    const dangerTrail = hasDanger ? danger.trail : null
    const dangerId = hasDanger ? danger.myId : 0
    const dangerX = hasDanger ? danger.x : 0
    const dangerY = hasDanger ? danger.y : 0
    const dangerRange2 = 10 * 10
    let hotCells = null
    if (trailCells.size) {
      ctx.fillStyle = '#ffffff'
      for (const index of trailCells) {
        if (hasDanger) {
          const owner = dangerTrail[index]
          if (owner && owner !== dangerId) {
            const x = index % w
            const y = (index - x) / w
            const dx = x + 0.5 - dangerX
            const dy = y + 0.5 - dangerY
            if (dx * dx + dy * dy < dangerRange2) {
              if (!hotCells) hotCells = []
              hotCells.push(index)
              continue
            }
          }
        }
        if (reduced) continue
        const x = index % w
        const y = (index - x) / w
        const wave = Math.sin(t * 8 - (x + y) * 0.55)
        if (wave <= 0) continue
        const px = ox + x * cell
        const py = oy + y * cell
        if (px < -cell || py < -cell || px > vw || py > vh) continue
        ctx.globalAlpha = wave * 0.34
        ctx.fillRect(px, py, cell + 0.5, cell + 0.5)
      }
    }

    for (const r of rings) {
      const progress = (r.age - r.delay) / r.life
      if (progress <= 0) continue
      const eased = 1 - (1 - progress) ** 3
      ctx.globalAlpha = (1 - progress) ** 1.4
      ctx.strokeStyle = rgba(r.color, 1)
      ctx.lineWidth = Math.max(1, (1 - progress) * r.width * cell)
      ctx.beginPath()
      ctx.arc(ox + r.x * cell, oy + r.y * cell, Math.max(1, eased * r.reach * cell), 0, Math.PI * 2)
      ctx.stroke()
    }

    // Rects, not arcs: one fillRect per spark is ~3x cheaper than an arc
    // path and looks identical at these sizes. fillStyle strings are cached
    // so a burst of one color does a single string alloc per frame.
    let lastParticleStyle = null
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i]
      const progress = p.age / p.life
      const px = ox + p.x * cell
      const py = oy + p.y * cell
      if (px < -20 || py < -20 || px > vw + 20 || py > vh + 20) continue
      ctx.globalAlpha = (1 - progress) ** 1.3
      const key = p.color[0] * 65536 + p.color[1] * 256 + p.color[2]
      if (key !== lastParticleStyle) {
        lastParticleStyle = key
        ctx.fillStyle = rgba(p.color, 1)
      }
      const s = Math.max(1, p.size * cell * (1 - progress * 0.5))
      ctx.fillRect(px - s / 2, py - s / 2, s, s)
    }
    ctx.restore()

    if (hotCells && hotCells.length) {
      // Normal blending so the cells read as red whatever color the line is.
      ctx.save()
      ctx.fillStyle = '#ff2d55'
      for (const index of hotCells) {
        const x = index % w
        const y = (index - x) / w
        const px = ox + x * cell
        const py = oy + y * cell
        if (px < -cell || py < -cell || px > vw || py > vh) continue
        const pulse = reduced ? 0.7 : 0.5 + 0.4 * Math.sin(t * 12 - (x + y) * 0.5)
        ctx.globalAlpha = pulse
        ctx.fillRect(px, py, cell + 0.5, cell + 0.5)
      }
      ctx.restore()
    }

    ctx.save()
    ctx.textAlign = 'center'
    ctx.lineJoin = 'round'
    // No shadowBlur here: the dark outline already gives contrast, and a
    // blur per floater per frame is one of the most expensive canvas ops.
    for (const f of floaters) {
      const progress = f.age / f.life
      const pop = progress < 0.12 ? 0.6 + (progress / 0.12) * 0.55 : 1.15 - Math.min(0.15, (progress - 0.12) * 0.4)
      ctx.globalAlpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3
      ctx.font = `800 ${Math.round(22 * pop)}px ui-sans-serif, system-ui, sans-serif`
      const px = ox + f.x * cell
      const py = oy + f.y * cell - progress * cell * 5
      ctx.lineWidth = 5
      ctx.strokeStyle = 'rgba(7, 9, 16, 0.85)'
      ctx.strokeText(f.text, px, py)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(f.text, px, py)
    }
    ctx.restore()
  }

  // Red glow along a wall the head is driving toward.
  function edgeWarning(ctx, { ox, oy, cell, w, h, x, y, heading, t }) {
    const band = cell * 5
    const span = 18 * cell
    for (const { side, strength } of viewHelpers.wallWarnings(x, y, heading, w, h)) {
      const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 14)
      const alpha = Math.min(1, strength * pulse) * 0.85
      const hot = `rgba(255, 60, 90, ${alpha})`
      const clear = 'rgba(255, 60, 90, 0)'
      let gradient
      let rect
      if (side === 'left') {
        gradient = ctx.createLinearGradient(ox, 0, ox + band, 0)
        rect = [ox, oy + y * cell - span, band, span * 2]
      } else if (side === 'right') {
        gradient = ctx.createLinearGradient(ox + w * cell, 0, ox + w * cell - band, 0)
        rect = [ox + w * cell - band, oy + y * cell - span, band, span * 2]
      } else if (side === 'top') {
        gradient = ctx.createLinearGradient(0, oy, 0, oy + band)
        rect = [ox + x * cell - span, oy, span * 2, band]
      } else {
        gradient = ctx.createLinearGradient(0, oy + h * cell, 0, oy + h * cell - band)
        rect = [ox + x * cell - span, oy + h * cell - band, span * 2, band]
      }
      gradient.addColorStop(0, hot)
      gradient.addColorStop(1, clear)
      ctx.save()
      ctx.fillStyle = gradient
      ctx.fillRect(...rect)
      ctx.restore()
    }
  }

  // Confetti lives on its own canvas above the results card.
  function drawScreen(dt, vw, vh, dpr) {
    if (!confetti.length) {
      if (screenDirty) {
        screenCtx.setTransform(1, 0, 0, 1, 0, 0)
        screenCtx.clearRect(0, 0, screen.width, screen.height)
        screenDirty = false
      }
      return
    }
    const pw = Math.round(vw * dpr)
    const ph = Math.round(vh * dpr)
    if (screen.width !== pw || screen.height !== ph) {
      screen.width = pw
      screen.height = ph
    }
    screenCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    screenCtx.clearRect(0, 0, vw, vh)
    for (const c of confetti) {
      screenCtx.save()
      screenCtx.translate(c.x, c.y)
      screenCtx.rotate(c.rot)
      screenCtx.scale(1, Math.cos(c.rot * 1.7))
      screenCtx.fillStyle = rgba(c.color, 1)
      screenCtx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h)
      screenCtx.restore()
    }
    screenDirty = true
  }

  return { capture, death, trailSparks, celebrate, update, shake, drawWorld, edgeWarning, drawScreen }
})()
