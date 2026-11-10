export function hexToHsv(hex, previous = { h: 0, s: 0 }) {
  const [r, g, b] = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
  const v = Math.max(r, g, b)
  const chroma = v - Math.min(r, g, b)
  if (!chroma) return { h: previous.h, s: v ? 0 : previous.s, v }

  const sector = v === r ? (g - b) / chroma : v === g ? 2 + (b - r) / chroma : 4 + (r - g) / chroma
  return { h: (sector * 60 + 360) % 360, s: chroma / v, v }
}

export function hsvToHex({ h, s, v }) {
  const channel = (offset) => {
    const sector = (h / 60 + offset) % 6
    const value = v - v * s * Math.max(0, Math.min(sector, 4 - sector, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`
}

export function wheelPoint(x, y, previous) {
  const s = Math.min(1, Math.hypot(x, y))
  const h = s ? (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360 : previous.h
  return { h, s, v: previous.v }
}
