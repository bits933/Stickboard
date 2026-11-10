import assert from 'node:assert/strict'
import test from 'node:test'
import { hexToHsv, hsvToHex, wheelPoint } from '../src/color-wheel.js'

test('color wheel preserves exact hex colors and hue through grayscale', () => {
  for (const hex of ['#5b843e', '#fd50a7', '#09e0ff', '#ff0000', '#00ff00', '#0000ff', '#bcbcbc', '#000000', '#ffffff']) {
    assert.equal(hsvToHex(hexToHsv(hex)), hex)
  }
  const violet = hexToHsv('#9f52e1')
  assert.equal(hexToHsv('#dddddd', violet).h, violet.h)
  assert.deepEqual(hexToHsv('#000000', violet), { ...violet, v: 0 })
})

test('wheel coordinates match its clockwise gradient and clamp outside the rim', () => {
  const start = { h: 45, s: 1, v: 0.75 }
  assert.deepEqual(wheelPoint(0, -2, start), { h: 0, s: 1, v: 0.75 })
  assert.deepEqual(wheelPoint(0.5, 0, start), { h: 90, s: 0.5, v: 0.75 })
  assert.deepEqual(wheelPoint(0, 0, start), { h: 45, s: 0, v: 0.75 })
})
