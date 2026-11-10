import { Body, Box, Cylinder, Plane, Quaternion, Vec3, World } from 'cannon-es'

const sampleWindow = 90
const pauseLimit = 64
const flickThreshold = 2.8
const maxFlick = 9.6
const timeStep = 1 / 120

export function recordPointer(samples, { x, y }, time) {
  if (samples.at(-1)?.time === time) samples.pop()
  samples.push({ x, y, time })
  while (samples.length > 2 && samples[1].time < time - sampleWindow) samples.shift()
}

export function releaseVelocity(samples) {
  const end = samples.at(-1)
  if (!end || samples.length < 2) return null
  let lastMotion = end
  for (let index = samples.length - 2; index >= 0; index--) {
    const sample = samples[index]
    if (Math.hypot(end.x - sample.x, end.y - sample.y) > 0.012) break
    lastMotion = sample
  }
  if (end.time - lastMotion.time > pauseLimit) return null

  const recent = samples.slice(0, -1).filter((sample) => end.time - sample.time <= sampleWindow)
  const start = recent.findLast((sample) => end.time - sample.time >= 54) ?? recent[0]
  if (!start) return null
  const seconds = Math.max(0.023, (end.time - start.time) / 1000)
  const x = (end.x - start.x) / seconds
  const y = (end.y - start.y) / seconds
  const speed = Math.hypot(x, y)
  if (speed < flickThreshold) return null
  const scale = Math.min(1, maxFlick / speed)
  return { x: x * scale, y: y * scale }
}

export function supportHeight(body) {
  if (body.aabbNeedsUpdate) body.updateAABB()
  return body.position.z - body.aabb.lowerBound.z
}

export function createPropPhysics() {
  const world = new World({ gravity: new Vec3(0, 0, -23), allowSleep: true })
  world.defaultContactMaterial.friction = 0.40
  world.defaultContactMaterial.restitution = 0.32
  world.solver.iterations = 10

  const boundary = (xRotation, yRotation) => {
    const body = new Body({ shape: new Plane() })
    body.quaternion.setFromEuler(xRotation, yRotation, 0)
    world.addBody(body)
    return body
  }
  boundary(0, 0)
  const walls = [boundary(0, Math.PI / 2), boundary(0, -Math.PI / 2), boundary(-Math.PI / 2, 0), boundary(Math.PI / 2, 0)]

  function resize(width, height) {
    walls[0].position.x = -width / 2
    walls[1].position.x = width / 2
    walls[2].position.y = -height / 2
    walls[3].position.y = height / 2
    for (const wall of walls) wall.aabbNeedsUpdate = true
  }

  function scaleShape(body, asset, x = 1, y = 1, z = 1) {
    if (body.shapes.length) body.removeShape(body.shapes[0])
    // shortcut: imported models use a fitted box, use convex hulls for detailed contacts.
    if (asset.id === 'cylinder' || asset.id === 'cone') {
      const radius = asset.width / 2
      const rotateToBoard = new Quaternion().setFromEuler(Math.PI / 2, 0, 0)
      const shape = new Cylinder((asset.tipRadius ?? radius) * x, radius * x, asset.depth * z, 24)
      if (x !== y) {
        for (const vertex of shape.vertices) vertex.z *= y / x
        shape.computeNormals()
        shape.computeEdges()
        shape.updateBoundingSphereRadius()
      }
      if (asset.tipRadius || x !== y) shape.uniqueAxes = null // Use the scaled face normals for contacts.
      body.addShape(shape, new Vec3(), rotateToBoard)
    } else {
      body.addShape(new Box(new Vec3(asset.width * x / 2, asset.height * y / 2, asset.depth * z / 2)))
    }
  }

  function add(asset) {
    const body = new Body({ collisionResponse: false, linearDamping: 0.58, angularDamping: 0.65, sleepSpeedLimit: 0.24, sleepTimeLimit: 0.42 })
    scaleShape(body, asset)
    world.addBody(body)
    return body
  }

  function park(body, x, y, z, orientation, held = false) {
    if (body.type !== Body.STATIC) {
      body.type = Body.STATIC
      body.mass = 0
      body.updateMassProperties()
      body.sleep()
    }
    body.position.set(x, y, z)
    body.quaternion.copy(orientation)
    body.aabbNeedsUpdate = true
    body.collisionResponse = !held
  }

  function launch(body, x, y, z, orientation, velocity, grip) {
    const speed = Math.hypot(velocity.x, velocity.y)
    body.type = Body.DYNAMIC
    body.mass = 1
    body.quaternion.set(0, 0, 0, 1)
    body.updateMassProperties()
    body.quaternion.copy(orientation)
    body.position.set(x, y, z)
    body.aabbNeedsUpdate = true
    body.position.z = Math.max(z, supportHeight(body) + 0.13)
    body.aabbNeedsUpdate = true
    body.previousPosition.copy(body.position)
    body.interpolatedPosition.copy(body.position)
    body.previousQuaternion.copy(body.quaternion)
    body.interpolatedQuaternion.copy(body.quaternion)
    body.collisionResponse = true
    body.velocity.set(velocity.x, velocity.y, 0.78 + speed * 0.23)
    const twist = grip.x * velocity.y - grip.y * velocity.x
    body.angularVelocity.set(-velocity.y * 1.85, velocity.x * 1.85, twist * 4 + speed * 0.30)
    body.wakeUp()
  }

  return {
    resize, add, park, launch, scaleShape,
    remove: (body) => world.removeBody(body),
    step: (dt) => world.step(timeStep, dt, 5),
    sleeping: (body) => body.sleepState === Body.SLEEPING,
  }
}
