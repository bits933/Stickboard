import assert from 'node:assert/strict'
import test from 'node:test'
import { Scene } from 'three'
import { createBoard } from '../src/board.js'

test('board patterns, dimming and shadow direction share the same key light', () => {
  const scene = new Scene()
  const board = createBoard(scene)
  const light = scene.children.find((child) => child.isDirectionalLight)
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' }
  board.mesh.material.onBeforeCompile(shader)

  const initial = shader.uniforms.boardCookie.value
  const maps = new Set([initial])
  const sample = (x, y) => {
    const { data, width, height } = shader.uniforms.boardCookie.value.image
    return data[Math.round(y * (height - 1)) * width + Math.round(x * (width - 1))]
  }
  for (const pattern of ['window', 'blinds', 'spot']) {
    board.setLightPattern(pattern)
    maps.add(shader.uniforms.boardCookie.value)
    if (pattern === 'window') assert.ok(sample(0.62, 0.63) - sample(0.50, 0.50) > 100)
    if (pattern === 'blinds') assert.ok(sample(0.50, 0.50) - sample(0.50, 0.56) > 100)
    if (pattern === 'spot') assert.ok(sample(0.50, 0.50) - sample(0.08, 0.50) > 100)
  }
  assert.equal(maps.size, 4)
  board.setLightPattern('dappled')
  assert.equal(shader.uniforms.boardCookie.value, initial)

  board.setLightPlacement(-1, 0)
  assert.deepEqual(light.position.toArray(), [-11, 0, 8])
  assert.deepEqual(shader.uniforms.boardSunSlope.value.toArray(), [-11 / 8, 0])
  assert.ok(shader.uniforms.boardProjectionShift.value.x > 0)

  board.setLightIntensity(0)
  assert.equal(light.intensity, 0)
  assert.equal(shader.uniforms.boardKeyPower.value, 0)
})

test('startup reveals the grid and ramps the selected light intensity independently', () => {
  const scene = new Scene()
  const board = createBoard(scene)
  const light = scene.children.find((child) => child.isDirectionalLight)
  const defaultIntensity = light.intensity
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' }
  board.mesh.material.onBeforeCompile(shader)

  board.setStartup(0, 0)
  assert.equal(shader.uniforms.boardGridProgress.value, 0)
  assert.equal(light.intensity, 0)
  board.setLightIntensity(0.5)
  board.setStartup(1, 0.25)
  assert.equal(shader.uniforms.boardGridProgress.value, 1)
  assert.equal(shader.uniforms.boardKeyPower.value, 0.125)
  board.setStartup(1, 1)
  assert.equal(light.intensity, defaultIntensity * 0.5)
})
