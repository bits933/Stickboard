import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'

let nextId = 0

export function readModelHeader(data) {
  const header = new DataView(data)
  if (header.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2
    || header.getUint32(8, true) !== header.byteLength || header.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('Choose a valid GLB file exported as glTF 2.0.')
  }
  const length = header.getUint32(12, true)
  if (!length || length % 4 || length > header.byteLength - 20) throw new Error('This GLB file is incomplete.')
  let description
  try {
    description = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, length)))
    if (description?.asset?.version !== '2.0' || ['buffers', 'images', 'extensionsUsed', 'accessors'].some((key) => (
      key in description && !Array.isArray(description[key])
    ))) throw new Error()
  } catch {
    throw new Error('This GLB file has an invalid model description.')
  }
  if ([...(description.buffers ?? []), ...(description.images ?? [])].some((resource) => (
    !resource || (resource.uri !== undefined && (typeof resource.uri !== 'string' || !resource.uri.startsWith('data:')))
  ))) {
    throw new Error('Export a GLB with its textures and buffers embedded in the file.')
  }
  if (description.extensionsUsed?.some((extension) => ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression'].includes(extension))) {
    throw new Error('Export the GLB without Draco, Meshopt, or Basis texture compression.')
  }
  if (description.accessors?.some((accessor) => !Number.isSafeInteger(accessor?.count) || accessor.count < 1 || accessor.count > 750_000)) {
    throw new Error('This model is too detailed. Export a simpler GLB for the board.')
  }
}

function thumbnail(model, renderer) {
  const size = 144
  const scene = new THREE.Scene()
  const light = new THREE.DirectionalLight('#fff0d7', 2.2)
  light.position.set(2, -3, 5)
  scene.add(model, light, new THREE.HemisphereLight('#e4f3fc', '#59694e', 1.1))
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 12)
  camera.position.set(2.0, -2.75, 2.05)
  camera.lookAt(0, 0, 0)

  const target = new THREE.WebGLRenderTarget(size, size, { samples: 4, colorSpace: THREE.SRGBColorSpace })
  const previous = renderer.getRenderTarget()
  const alpha = renderer.getClearAlpha()
  const pixels = new Uint8Array(size * size * 4)
  try {
    renderer.setClearAlpha(0)
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels)
  } finally {
    renderer.setRenderTarget(previous)
    renderer.setClearAlpha(alpha)
    target.dispose()
    scene.remove(model)
  }

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  const image = context.createImageData(size, size)
  for (let row = 0; row < size; row++) {
    const start = (size - row - 1) * size * 4
    image.data.set(pixels.subarray(start, start + size * 4), row * size * 4)
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL()
}

export async function importModel(file, renderer, lightMaterial) {
  if (file.size > 32 * 1024 * 1024) throw new Error('Choose a GLB up to 32 MB.')
  const data = await file.arrayBuffer()
  readModelHeader(data)
  const manager = new THREE.LoadingManager().setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url
    throw new Error('External model resources are disabled.')
  })
  const { scene } = await new GLTFLoader(manager).parseAsync(data, '').catch(() => {
    throw new Error('This GLB could not be opened. Try exporting it again with embedded textures.')
  })
  const lights = []
  let triangles = 0
  scene.traverse((node) => {
    if (node.isLight) lights.push(node)
    if (!node.isMesh) return
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position?.count ?? 0) / 3 * (node.isInstancedMesh ? node.count : 1)
  })
  if (!triangles || triangles > 250_000) throw new Error('Choose a model with 1 to 250,000 mesh triangles.')
  for (const light of lights) {
    for (const child of [...light.children]) light.parent.attach(child)
    light.removeFromParent()
  }

  const upright = new THREE.Group()
  upright.rotation.x = Math.PI / 2
  upright.add(scene)
  const bounds = new THREE.Box3().setFromObject(upright, true)
  const size = bounds.getSize(new THREE.Vector3())
  const longest = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(longest) || longest <= 0) throw new Error('This GLB has no usable model bounds.')
  const scale = 1.35 / longest
  upright.scale.setScalar(scale)
  upright.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-scale)
  size.multiplyScalar(scale)

  const model = new THREE.Group()
  model.add(upright)
  const preview = thumbnail(model, renderer)
  const materials = new Set()
  model.traverse((node) => {
    if (!node.isMesh) return
    node.castShadow = node.receiveShadow = true
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
  })
  for (const material of materials) {
    if (!material.isMeshStandardMaterial) continue
    lightMaterial(material)
    material.needsUpdate = true
  }

  return {
    id: `model-${++nextId}`, kind: 'object', preview, makeModel: () => clone(model),
    name: file.name.replace(/\.glb$/i, '').trim().slice(0, 45) || 'Untitled model',
    width: Math.max(0.025, size.x), height: Math.max(0.025, size.y), depth: Math.max(0.025, size.z),
  }
}
