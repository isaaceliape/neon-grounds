// Peer-to-peer networking over WebRTC DataChannels (PeerJS for signaling).
// No game logic here: JSON messages cross exactly like they do over the
// Node WebSocket server, so the client handles both with one onMessage().
//
// Large messages (full snapshots carry ~56KB of base64 board) are split
// into 16KB chunks because per-message limits vary by browser.
globalThis.P2P = (() => {
  const PEER_PREFIX = 'territory-room-'
  // Short, unambiguous codes: no 0/O, 1/I/L.
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const CHUNK_SIZE = 16384

  function makeCode(length = 5) {
    const rand = (n) => {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const out = new Uint8Array(n)
        crypto.getRandomValues(out)
        return [...out]
      }
      return Array.from({ length: n }, () => Math.floor(Math.random() * 256))
    }
    return rand(length).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  }

  // Codes never contain 0/O, 1/I/L, so anything outside the alphabet is a
  // typo: drop it. A mangled code then simply finds no room, and the guest
  // sees "check the code and try again" instead of joining the wrong room.
  function normalizeCode(raw) {
    return String(raw ?? '').toUpperCase().split('').filter((ch) => CODE_ALPHABET.includes(ch)).join('')
  }

  function peerIdFor(code) {
    return PEER_PREFIX + normalizeCode(code).toLowerCase()
  }

  function peerError() {
    if (typeof window !== 'undefined' && window.Peer) return null
    return 'Online play needs the PeerJS library, which did not load. Check your connection and reload.'
  }

  // Split a message into wire strings; the receiver feeds each to `receive`.
  function chunkMessage(obj) {
    const text = JSON.stringify(obj)
    if (text.length <= CHUNK_SIZE) return [text]
    const id = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
    const total = Math.ceil(text.length / CHUNK_SIZE)
    const out = []
    for (let idx = 0; idx < total; idx += 1) {
      out.push(JSON.stringify({ __chunk: { id, idx, total, data: text.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE) } }))
    }
    return out
  }

  // Reassembles chunked messages and calls onMessage with parsed objects.
  // Returns a function that accepts one wire string per call.
  function createReceiver(onMessage) {
    const pending = new Map()
    return function receive(wire) {
      let msg
      try {
        msg = JSON.parse(wire)
      } catch {
        return
      }
      const part = msg && typeof msg === 'object' ? msg.__chunk : null
      if (!part || typeof part.idx !== 'number' || typeof part.total !== 'number') {
        // Only objects are game messages; stray primitives are dropped.
        if (msg && typeof msg === 'object') onMessage(msg)
        return
      }
      let entry = pending.get(part.id)
      if (!entry) {
        entry = { parts: new Array(part.total), got: 0 }
        pending.set(part.id, entry)
      }
      if (entry.parts[part.idx] === undefined) {
        entry.parts[part.idx] = part.data
        entry.got += 1
      }
      if (entry.got === part.total) {
        pending.delete(part.id)
        try {
          onMessage(JSON.parse(entry.parts.join('')))
        } catch {
          // Corrupt reassembly; drop it.
        }
      }
      if (pending.size > 8) {
        const first = pending.keys().next().value
        pending.delete(first)
      }
    }
  }

  function sendChunked(conn, obj) {
    if (!conn || conn.open === false) return false
    try {
      for (const wire of chunkMessage(obj)) conn.send(wire)
      return true
    } catch {
      return false
    }
  }

  // Host side: accepts guests, keyed by peer id. Resolves once the room is
  // registered with the signaling server and the code is joinable.
  function hostRoom({ code = makeCode(), onMessage, onLeave, onError } = {}) {
    const missing = peerError()
    if (missing) return { ready: Promise.reject(new Error(missing)), sendTo() {}, broadcast() {}, close() {}, code }
    const peer = new window.Peer(peerIdFor(code), { debug: 0 })
    const guests = new Map() // peer id -> connection
    let closed = false

    const ready = new Promise((resolve, reject) => {
      peer.on('open', () => resolve(code))
      peer.on('error', (error) => {
        if (error?.type === 'unavailable-id') {
          reject(new Error(`Room code ${code} is taken. Try hosting again for a new code.`))
        } else if (!peer.open && !peer.destroyed) {
          reject(new Error('Could not reach the signaling server. Check your connection.'))
        } else if (onError) {
          onError(error)
        }
      })
    })

    peer.on('connection', (conn) => {
      const key = conn.peer
      guests.set(key, conn)
      const receive = createReceiver((msg) => {
        if (!closed && onMessage) onMessage(key, msg)
      })
      conn.on('data', (wire) => receive(String(wire)))
      conn.on('close', () => {
        guests.delete(key)
        if (!closed && onLeave) onLeave(key)
      })
      conn.on('error', () => {
        guests.delete(key)
        if (!closed && onLeave) onLeave(key)
      })
    })

    return {
      code,
      ready,
      sendTo(key, obj) {
        const conn = guests.get(key)
        if (conn) sendChunked(conn, obj)
      },
      broadcast(obj) {
        const wires = chunkMessage(obj)
        for (const conn of guests.values()) {
          if (conn.open === false) continue
          try {
            for (const wire of wires) conn.send(wire)
          } catch {
            // A dead connection closes itself out via on close/error.
          }
        }
      },
      close() {
        closed = true
        for (const conn of guests.values()) {
          try {
            conn.close()
          } catch {
            // ignore
          }
        }
        guests.clear()
        try {
          peer.destroy()
        } catch {
          // ignore
        }
      },
    }
  }

  // Guest side: dials the host's room code.
  function joinRoom(code, { onMessage, onClose, onError } = {}) {
    const missing = peerError() || (!normalizeCode(code) ? 'Type the room code the host gave you.' : null)
    if (missing) {
      return { ready: Promise.reject(new Error(missing)), send() {}, close() {} }
    }
    const peer = new window.Peer({ debug: 0 })
    let conn = null
    let closed = false
    const receive = createReceiver((msg) => {
      if (!closed && onMessage) onMessage(msg)
    })

    const ready = new Promise((resolve, reject) => {
      peer.on('open', () => {
        try {
          conn = peer.connect(peerIdFor(code), { reliable: true })
        } catch (error) {
          reject(error)
          return
        }
        conn.on('open', () => resolve())
        conn.on('data', (wire) => receive(String(wire)))
        conn.on('close', () => {
          if (!closed && onClose) onClose()
        })
        conn.on('error', (error) => {
          if (onError) onError(error)
        })
      })
      peer.on('error', (error) => {
        if (error?.type === 'peer-unavailable') {
          reject(new Error(`No room found for code ${normalizeCode(code)}. Check the code and try again.`))
        } else if (!conn) {
          reject(new Error('Could not reach the signaling server. Check your connection.'))
        } else if (onError) {
          onError(error)
        }
      })
    })

    return {
      ready,
      send(obj) {
        if (!conn) return false
        return sendChunked(conn, obj)
      },
      close() {
        closed = true
        try {
          if (conn) conn.close()
        } catch {
          // ignore
        }
        try {
          peer.destroy()
        } catch {
          // ignore
        }
      },
    }
  }

  return { makeCode, normalizeCode, peerIdFor, peerError, chunkMessage, createReceiver, hostRoom, joinRoom }
})()
