import assert from 'node:assert/strict'
import test from 'node:test'
import { readModelHeader } from '../src/model-assets.js'

function glb(description) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, ...description }))
  const length = Math.ceil(json.length / 4) * 4
  const data = new ArrayBuffer(20 + length)
  const header = new DataView(data)
  for (const [index, value] of [0x46546c67, 2, data.byteLength, length, 0x4e4f534a].entries()) {
    header.setUint32(index * 4, value, true)
  }
  const chunk = new Uint8Array(data, 20)
  chunk.fill(0x20)
  chunk.set(json)
  return data
}

test('model uploads accept embedded data and reject invalid, external, or oversized geometry', () => {
  assert.doesNotThrow(() => readModelHeader(glb({ images: [{ bufferView: 0 }, { uri: 'data:image/png;base64,AA==' }] })))
  assert.throws(() => readModelHeader(new ArrayBuffer(20)), /valid GLB/)
  assert.throws(() => readModelHeader(glb({ images: [{ uri: 'https://example.test/texture.png' }] })), /embedded/)
  assert.throws(() => readModelHeader(glb({ extensionsUsed: ['KHR_draco_mesh_compression'] })), /without Draco/)
  assert.throws(() => readModelHeader(glb({ accessors: [{ count: 2 ** 30 }] })), /too detailed/)
})
