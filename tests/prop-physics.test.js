import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Quaternion } from 'cannon-es'
import { createPropPhysics, recordPointer, releaseVelocity, supportHeight } from '../src/prop-physics.js'

test('a recent flick survives pointer-up, while a slow drag or pause places the object', () => {
  const sample = (positions) => {
    const samples = []
    for (const [time, x, y] of positions) recordPointer(samples, { x, y }, time)
    return releaseVelocity(samples)
  }
  assert.equal(sample([[0, 0, 0], [30, 0.04, 0], [60, 0.09, 0], [70, 0.1, 0]]), null)
  assert.equal(sample([[0, 0, 0], [30, 0.2, 0.2], [62, 0.6, 0.4], [141, 0.6, 0.4]]), null)
  const flick = sample([[0, 0, 0], [24, 0.19, 0.1], [49, 0.49, 0.28], [56, 0.49, 0.28]])
  assert.ok(flick.x > 7 && flick.y > 4)
  assert.ok(Math.hypot(flick.x, flick.y) <= 9.60001)
  assert.equal(sample([[0, 0, 0], [35, 0.32, 0], [60, 0.001, 0]]), null)
})

test('nonuniform scaling replaces the prop collider and updates its bounds', () => {
  const physics = createPropPhysics()
  for (const asset of [
    { id: 'cube', width: 0.8, height: 0.8, depth: 1 },
    { id: 'cone', width: 0.8, height: 0.8, depth: 1, tipRadius: 0.025 },
  ]) {
    const body = physics.add(asset)
    physics.scaleShape(body, asset, 2, 0.5, 1.5)
    assert.equal(body.shapes.length, 1)
    assert.ok(Math.abs(supportHeight(body) - 0.75) < 1e-6)
    assert.ok(Math.abs(body.aabb.upperBound.x - 0.8) < 1e-6)
    assert.ok(Math.abs(body.aabb.upperBound.y - 0.2) < 1e-6)
  }
})

for (const id of ['cube', 'cylinder']) {
  test(`${id} translates, tumbles, stays above the board, and sleeps after impact`, () => {
    const physics = createPropPhysics()
    physics.resize(7.35, 7.35)
    const collider = physics.add({ id, width: 0.94, height: 0.94, depth: 0.80 })
    const orientation = new Quaternion().setFromEuler(-0.22, 0.27, 0.4)
    physics.launch(collider, 1.8, 0, 0.72, orientation, { x: 8, y: -2 }, { x: 0.2, y: 0.3 })

    let peakX = collider.position.x
    let peakRotation = 0
    let reversed = false
    for (let index = 0; index < 480 && !physics.sleeping(collider); index++) {
      physics.step(index % 2 ? 1 / 75 : 1 / 60)
      peakX = Math.max(peakX, collider.position.x)
      const alignment = Math.abs(collider.quaternion.x * orientation.x + collider.quaternion.y * orientation.y
        + collider.quaternion.z * orientation.z + collider.quaternion.w * orientation.w)
      peakRotation = Math.max(peakRotation, 1 - alignment)
      reversed ||= collider.velocity.x < -0.15
      assert.ok(collider.position.z >= supportHeight(collider) - 0.10)
      assert.ok(Math.abs(collider.position.x) < 3.675 && Math.abs(collider.position.y) < 3.675)
    }
    assert.ok(peakX > 2.6 && peakRotation > 0.25 && reversed)
    assert.ok(physics.sleeping(collider))
    assert.ok(Math.abs(collider.position.z - supportHeight(collider)) < 0.04)
  })
}
