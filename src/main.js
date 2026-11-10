import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { builtInStickers, importSticker, objects } from './assets.js'
import { createBoard } from './board.js'
import { hexToHsv, hsvToHex, wheelPoint } from './color-wheel.js'
import { importModel } from './model-assets.js'
import { createPropPhysics, recordPointer, releaseVelocity, supportHeight } from './prop-physics.js'
import { createSticker, paperHeight, paperThickness, restingCurl } from './sticker.js'

const byId = (id) => document.getElementById(id)
const canvas = byId('board')
const stage = byId('stage')
const status = byId('board-status')
const assetList = byId('asset-list')
const uploadInput = byId('upload-input')
const uploadArea = byId('upload-area')
const uploadStatus = byId('upload-status')
const boardItems = byId('board-items')
const tabs = [byId('sticker-tab'), byId('object-tab')]
const peelAction = byId('peel-action')
const stickerSize = byId('sticker-size')
const stickerAngle = byId('sticker-angle')
const rotationToggle = byId('rotation-toggle')
const gizmoMode = byId('gizmo-mode')
const objectScale = byId('object-scale')
const undoTransform = byId('undo-transform')
const redoTransform = byId('redo-transform')
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
const defaultDirection = [-1, -1]
const rotationAxes = new Map([
  ['x', new THREE.Vector3(1, 0, 0)], ['y', new THREE.Vector3(0, 1, 0)], ['z', new THREE.Vector3(0, 0, 1)],
])
const channels = ['x', 'y', 'z', 'peel', 'loft']
const clamp = THREE.MathUtils.clamp

function spring(value, target, velocity, frequency, dt) {
  const offset = value - target
  const decay = Math.exp(-frequency * dt)
  const impulse = velocity + frequency * offset
  return [target + (offset + impulse * dt) * decay, (velocity - frequency * impulse * dt) * decay]
}

function colorGeometry(geometry, hex) {
  const color = new THREE.Color(hex)
  const colors = new Float32Array(geometry.attributes.position.count * 3)
  for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function rubiksGeometry(size) {
  const tileDepth = 0.028
  const core = size - tileDepth
  const parts = [colorGeometry(new RoundedBoxGeometry(core, core, core, 3, 0.044), '#191a1e')]
  const tileSize = size * 0.276
  const tile = new RoundedBoxGeometry(tileSize, tileSize, tileDepth, 1, 0.011)
  const faces = [
    ['#f5efe0', 0, 0], ['#f3c525', Math.PI, 0],
    ['#f47b2b', 0, Math.PI / 2], ['#e53738', 0, -Math.PI / 2],
    ['#139a57', -Math.PI / 2, 0], ['#2359d9', Math.PI / 2, 0],
  ]
  for (const [color, x, y] of faces) {
    colorGeometry(tile, color)
    const faceRotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, 0))
    for (let row = -1; row <= 1; row++) {
      for (let column = -1; column <= 1; column++) {
        parts.push(new THREE.BufferGeometry().copy(tile)
          .translate(column * size * 0.303, row * size * 0.303, core / 2)
          .applyMatrix4(faceRotation))
      }
    }
  }
  return mergeGeometries(parts)
}

function builtInModel(asset, lightMaterial) {
  const cube = asset.id === 'cube'
  const rubiks = asset.id === 'rubiks-cube'
  const { tipRadius } = asset
  const radius = asset.width * 0.5
  const halfDepth = asset.depth / 2
  let geometry
  if (rubiks) geometry = rubiksGeometry(asset.width)
  else if (cube) geometry = new RoundedBoxGeometry(asset.width, asset.height, asset.depth, 4, 0.075)
  else {
    const profile = tipRadius ? [
      [0, -halfDepth], [radius - 0.024, -halfDepth], [radius - 0.006, -halfDepth + 0.008],
      [radius - 0.005, -halfDepth + 0.022], [tipRadius + 0.009, halfDepth - 0.019],
      [tipRadius, halfDepth - 0.006], [tipRadius * 0.60, halfDepth], [0, halfDepth],
    ] : [
      [0, -halfDepth], [radius - 0.047, -halfDepth], [radius - 0.012, -halfDepth + 0.015], [radius, -halfDepth + 0.041],
      [radius, halfDepth - 0.041], [radius - 0.012, halfDepth - 0.015], [radius - 0.047, halfDepth], [0, halfDepth],
    ]
    geometry = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 64).rotateX(Math.PI / 2)
  }
  const color = { cube: '#265dc1', cylinder: '#bd5f35', cone: '#a46ae1' }[asset.id] ?? '#ffffff'
  const material = lightMaterial(new THREE.MeshPhysicalMaterial({
    color, vertexColors: rubiks, roughness: rubiks ? 0.36 : 0.43,
    clearcoat: cube ? 0.16 : 0.32, clearcoatRoughness: 0.32,
  }))
  const body = new THREE.Mesh(geometry, material)
  if (rubiks) body.rotation.set(-0.44, 0.43, -0.29)
  else if (tipRadius) body.rotation.set(-1.10, 0.36, -0.50)
  else body.rotation.set(cube ? -0.22 : -0.58, cube ? 0.27 : 0.21, cube ? 0.57 : -0.43)
  body.position.z = -new THREE.Box3().setFromObject(body, true).min.z + 0.009
  body.castShadow = body.receiveShadow = true
  return body
}

function objectModel(asset, lightMaterial, contactMaterial) {
  const body = asset.makeModel ? asset.makeModel() : builtInModel(asset, lightMaterial)
  if (asset.makeModel) body.position.z = asset.depth / 2 + 0.009

  const shade = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), contactMaterial.clone())
  shade.position.set(-0.055, -0.055, 0.01)
  shade.raycast = () => {}
  const group = new THREE.Group()
  group.add(shade, body)
  group.solid = body
  group.updateShade = (offset, clearance = offset) => {
    shade.position.z = 0.01 - offset
    shade.scale.setScalar(Math.max(body.scale.x, body.scale.y, body.scale.z) * (1 + clearance * 0.6))
    shade.material.opacity = 0.46 / (1 + clearance * 5)
  }
  group.dispose = () => {
    if (!asset.makeModel) {
      body.geometry.dispose()
      body.material.dispose()
    }
    shade.geometry.dispose()
    shade.material.dispose()
  }
  return group
}

function contactShadow() {
  const image = document.createElement('canvas')
  image.width = image.height = 64
  const context = image.getContext('2d')
  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.98)')
  gradient.addColorStop(0.46, 'rgba(0, 0, 0, 0.68)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(image), transparent: true, depthWrite: false })
}

async function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.autoUpdate = false

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 36)
  camera.position.z = 16
  camera.updateMatrixWorld()
  const rotation = new TransformControls(camera)
  rotation.setMode('rotate')
  rotation.setSize(0.88)
  rotation.setColors('#ff8581', '#91ebaa', '#80c8ff', '#fff3b1')
  const rotationHelper = rotation.getHelper()
  scene.add(rotationHelper)
  const { resize: resizeBoard, setColor: setBoardColor, driftLight, lightMaterial,
    setLightPattern, setLightIntensity, setLightPlacement, setLightBlur, setStartup } = createBoard(scene)
  const colorDialog = byId('board-color-dialog')
  const physics = createPropPhysics()
  const contactMaterial = contactShadow()
  const litMaterials = new WeakSet()
  const raycaster = new THREE.Raycaster()
  const placedMeshes = new WeakMap()
  const items = []
  const stickers = []
  const uploads = [
    { assets: stickers, title: 'Upload PNG', accept: 'image/png,.png', label: 'Upload a PNG sticker', noun: 'sticker', load: importSticker },
    { assets: objects, title: 'Upload GLB', hint: 'Browse or drop an uncompressed GLB', accept: '.glb,model/gltf-binary',
      label: 'Upload a GLB model', noun: 'model',
      load: (file) => importModel(file, renderer, lightMaterial) },
  ]
  let selection = null
  let gesture = null
  let starter = null
  let rotationPointer = null
  let gizmoBefore
  let scaleBefore
  let activeTab = 0
  let viewWidth = 0
  let viewHeight = 0
  let nextId = 0
  let stickerPlacements = 0
  let frame = 0
  let previousTime = 0
  let sceneDirty = true
  let paintDirty = false
  let lastPaint = 0
  let lightTime = 0
  let hoverEvent = null
  let startupActive = !reduceMotion.matches
  let startupStart
  const workspace = stage.parentElement

  if (startupActive) {
    setStartup(0, 0)
    workspace.addEventListener('pointerdown', finishStartup, true)
    workspace.addEventListener('keydown', finishStartup, true)
  }

  function scheduleFrame() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(draw)
  }

  function requestRender() {
    sceneDirty = true
    scheduleFrame()
  }

  function finishStartup() {
    if (!startupActive) return
    startupActive = false
    workspace.removeEventListener('pointerdown', finishStartup, true)
    workspace.removeEventListener('keydown', finishStartup, true)
    setStartup(1, 1)
    updateStarterIntro(1)
    requestRender()
  }

  const lightToggle = byId('light-toggle')
  const lightSettings = byId('light-settings')
  lightToggle.addEventListener('click', () => {
    lightSettings.hidden = !lightSettings.hidden
    lightToggle.setAttribute('aria-expanded', String(!lightSettings.hidden))
  })
  function updateLightControl(target) {
    if (target.name === 'light-placement') {
      setLightPlacement(...target.value.split(',').map(Number))
      requestRender()
      return
    }
    if (target.name === 'light-pattern') setLightPattern(target.value)
    else if (target.type === 'range') {
      const setAmount = target.id === 'light-blur' ? setLightBlur : setLightIntensity
      setAmount(target.valueAsNumber / 100)
      const percentage = `${target.value}%`
      target.setAttribute('aria-valuetext', percentage)
      byId(`${target.id}-value`).textContent = percentage
    }
    paintDirty = true
    scheduleFrame()
  }
  lightSettings.addEventListener('input', ({ target }) => updateLightControl(target))
  byId('reset-light').addEventListener('click', () => {
    for (const input of lightSettings.querySelectorAll('input[checked], input[type="range"]')) {
      if (input.type === 'radio') input.checked = true
      else input.value = input.defaultValue
      updateLightControl(input)
    }
    status.textContent = 'Lighting reset.'
  })

  const exportButton = byId('board-export')
  exportButton.addEventListener('click', () => {
    finishStartup()
    exportButton.disabled = true
    let showHelper = rotationHelper.visible
    try {
      if (sceneDirty) advanceScene(performance.now())
      showHelper = rotationHelper.visible
      rotationHelper.visible = false
      renderer.render(scene, camera)
      canvas.toBlob((blob) => {
        exportButton.disabled = false
        if (!blob) {
          status.textContent = 'Could not export the board.'
          return
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'stickboard.png'
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        status.textContent = 'Board exported as PNG.'
      }, 'image/png')
    } catch {
      exportButton.disabled = false
      status.textContent = 'Could not export the board.'
    } finally {
      rotationHelper.visible = showHelper
      paintDirty = true
      scheduleFrame()
    }
  })

  function draw(time) {
    frame = 0
    const drifting = !reduceMotion.matches
    if (startupActive && starter) {
      startupStart ??= time
      const elapsed = time - startupStart
      if (elapsed >= 1850) finishStartup()
      else {
        setStartup(Math.min(elapsed / 980, 1), THREE.MathUtils.smoothstep(elapsed, 120, 1850))
        updateStarterIntro(clamp((elapsed - 840) / 1010, 0, 1))
        paintDirty = true
      }
    }
    const updateScene = sceneDirty || previousTime !== 0
    if (updateScene || paintDirty || (drifting && time - lastPaint >= 1000 / 30)) {
      paintDirty = false
      if (updateScene) advanceScene(time)
      if (drifting) {
        if (lastPaint) lightTime += Math.min(time - lastPaint, 100) / 1000
        driftLight(lightTime)
      }
      rotation.object?.updateWorldMatrix(true, false)
      renderer.render(scene, camera)
      lastPaint = time
    }
    if (drifting || previousTime) scheduleFrame()
  }

  const swatches = [...document.querySelectorAll('.color-swatch[data-color]')]
  const customSwatch = byId('custom-board-color')
  const colorPicker = byId('board-color-picker')
  const colorHex = byId('board-color-hex')
  const colorWheel = byId('color-wheel')
  const brightness = byId('board-brightness')
  let boardColor = colorPicker.value
  let draftColor = hexToHsv(boardColor)

  function showColorWheel() {
    const { h, s, v } = draftColor
    const angle = h * Math.PI / 180
    colorWheel.style.setProperty('--wheel-x', `${50 + 50 * s * Math.sin(angle)}%`)
    colorWheel.style.setProperty('--wheel-y', `${50 - 50 * s * Math.cos(angle)}%`)
    colorWheel.style.setProperty('--wheel-darkness', 1 - v)
    colorWheel.style.setProperty('--wheel-color', colorPicker.value)
    brightness.value = Math.round(v * 100)
    const percentage = `${brightness.value}%`
    brightness.setAttribute('aria-valuetext', percentage)
    byId('board-brightness-value').textContent = percentage
  }

  function updateColorWheel() {
    draftColor = hexToHsv(colorPicker.value, draftColor)
    showColorWheel()
  }

  function setDraftColor(color) {
    draftColor = color
    colorPicker.value = colorHex.value = hsvToHex(color)
    showColorWheel()
    previewBoardColor(colorPicker.value)
  }

  function dragColorWheel(event) {
    const bounds = colorWheel.getBoundingClientRect()
    const x = 2 * (event.clientX - bounds.left) / bounds.width - 1
    const y = 2 * (event.clientY - bounds.top) / bounds.height - 1
    setDraftColor(wheelPoint(x, y, draftColor))
  }

  colorWheel.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return
    colorWheel.setPointerCapture(event.pointerId)
    dragColorWheel(event)
  })
  colorWheel.addEventListener('pointermove', (event) => {
    if (colorWheel.hasPointerCapture(event.pointerId)) dragColorWheel(event)
  })
  colorWheel.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: [-3, 0], ArrowRight: [3, 0], ArrowDown: [0, -0.04], ArrowUp: [0, 0.04] }[event.key]
    if (!step) return
    event.preventDefault()
    const h = (draftColor.h + step[0] + 360) % 360
    const s = clamp(draftColor.s + step[1], 0, 1)
    setDraftColor({ h, s, v: draftColor.v })
  })
  brightness.addEventListener('input', () => setDraftColor({ ...draftColor, v: brightness.valueAsNumber / 100 }))

  function previewBoardColor(color) {
    setBoardColor(color)
    paintDirty = true
    scheduleFrame()
  }

  function chooseBoardColor(color) {
    boardColor = color
    previewBoardColor(color)
    for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === color))
    const isCustom = !swatches.some((swatch) => swatch.dataset.color === color)
    customSwatch.classList.toggle('is-current', isCustom)
    customSwatch.style.setProperty('--swatch', isCustom ? color : '')
  }

  for (const swatch of swatches) swatch.addEventListener('click', () => chooseBoardColor(swatch.dataset.color))
  customSwatch.addEventListener('click', () => {
    colorPicker.value = colorHex.value = boardColor
    updateColorWheel()
    colorDialog.showModal()
  })
  colorPicker.addEventListener('input', () => {
    colorHex.value = colorPicker.value
    updateColorWheel()
    previewBoardColor(colorPicker.value)
  })
  colorHex.addEventListener('input', () => {
    if (!colorHex.validity.valid) return
    colorPicker.value = `#${colorHex.value.replace(/^#/, '')}`
    updateColorWheel()
    previewBoardColor(colorPicker.value)
  })
  colorDialog.querySelector('form').addEventListener('submit', () => chooseBoardColor(colorPicker.value))
  byId('cancel-board-color').addEventListener('click', () => colorDialog.close())
  colorDialog.addEventListener('close', () => previewBoardColor(boardColor))

  function advanceScene(time) {
    sceneDirty = false
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 1 / 30) : 1 / 60
    let moving = false
    let flying = false
    for (const item of items) {
      if (!item.mesh.visible || (startupActive && item === starter)) continue
      if (item.flight) {
        if (reduceMotion.matches) freezeFlight(item)
        else {
          flying = true
          continue
        }
      }
      const holding = gesture?.item === item
      for (const key of channels) {
        if (reduceMotion.matches || (Math.abs(item.pose[key] - item.target[key]) < 0.0006 && Math.abs(item.velocity[key]) < 0.012)) {
          item.pose[key] = item.target[key]
          item.velocity[key] = 0
        } else {
          const frequency = holding ? (key === 'x' || key === 'y' ? 42 : 32) : 21
          const [value, speed] = spring(item.pose[key], item.target[key], item.velocity[key], frequency, dt)
          item.pose[key] = value
          item.velocity[key] = speed
          moving = true
        }
      }
      const { x, y, z, peel, loft } = item.pose
      item.mesh.position.set(x, y, Math.max(0, z))
      if (item.asset.kind === 'sticker') item.mesh.setPeel(...item.direction, peel, loft)
      else {
        const { solid } = item.mesh
        item.mesh.updateShade(Math.max(0, z))
        physics.park(item.collider, x, y, solid.position.z + Math.max(0, z), solid.quaternion, holding && gesture.moved)
      }
    }
    if (flying) {
      physics.step(dt)
      for (const item of items) {
        if (!item.flight) continue
        const { collider, mesh } = item
        const position = collider.interpolatedPosition
        mesh.position.set(position.x, position.y, 0)
        mesh.solid.position.z = Math.max(position.z, supportHeight(collider) - 0.022)
        mesh.solid.quaternion.copy(collider.interpolatedQuaternion)
        mesh.updateShade(0, Math.max(0, collider.aabb.lowerBound.z))
        if (physics.sleeping(collider)) freezeFlight(item)
      }
      moving = true
    }
    renderer.shadowMap.needsUpdate = true
    previousTime = moving ? time : 0
  }

  function freezeFlight(item) {
    const { collider, mesh } = item
    const asleep = physics.sleeping(collider)
    const { x, y, z } = asleep ? collider.position : collider.interpolatedPosition
    mesh.solid.quaternion.copy(asleep ? collider.quaternion : collider.interpolatedQuaternion)
    physics.park(collider, x, y, z, mesh.solid.quaternion)
    mesh.solid.position.z = supportHeight(collider) + 0.004
    const lift = asleep ? 0 : Math.max(0, z - mesh.solid.position.z)
    mesh.position.set(x, y, lift)
    mesh.updateShade(lift)
    Object.assign(item.pose, { x, y, z: lift })
    Object.assign(item.target, { x, y, z: 0 })
    item.flight = false
    syncRotation()
  }

  function itemRadius(item) {
    const { width, height, depth = 0 } = item.asset
    if (item.collider) {
      const { x, y, z } = item.mesh.solid.scale
      return Math.hypot(width * x, height * y, depth * z) / 2
    }
    return Math.hypot(width, height, depth) * item.mesh.scale.x / 2
  }

  function bound(item, x, y) {
    const radius = itemRadius(item)
    const maxX = Math.max(0, viewWidth * 0.5 - radius - 0.07)
    const maxY = Math.max(0, viewHeight * 0.5 - radius - 0.07)
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) }
  }

  function resize() {
    const { width, height } = canvas.getBoundingClientRect()
    if (!width || !height) return
    for (const item of items) if (item.flight) freezeFlight(item)
    const ratio = Math.min(devicePixelRatio, 1.65, Math.sqrt(2_600_000 / (width * height)))
    renderer.setPixelRatio(ratio)
    renderer.setSize(width, height, false)
    const scale = Math.min(width / 7.35, height / 7.35)
    const oldWidth = viewWidth || width / scale
    const oldHeight = viewHeight || height / scale
    viewWidth = width / scale
    viewHeight = height / scale
    Object.assign(camera, { left: -viewWidth / 2, right: viewWidth / 2, top: viewHeight / 2, bottom: -viewHeight / 2 })
    camera.updateProjectionMatrix()
    resizeBoard(viewWidth, viewHeight)
    physics.resize(viewWidth, viewHeight)
    for (const item of items) {
      const position = bound(item, item.target.x * viewWidth / oldWidth, item.target.y * viewHeight / oldHeight)
      Object.assign(item.target, position)
      Object.assign(item.pose, position)
    }
    restackStickers()
    requestRender()
  }

  function createItem(asset, x, y, { peel = 0, z = 0, loft = 0, angle = 0, direction = defaultDirection } = {}) {
    const isSticker = asset.kind === 'sticker'
    const mesh = isSticker ? createSticker(asset) : objectModel(asset, lightMaterial, contactMaterial)
    if (isSticker && !litMaterials.has(mesh.material)) {
      lightMaterial(mesh.material, true)
      lightMaterial(mesh.children[0].material)
      litMaterials.add(mesh.material)
    }
    const item = { id: ++nextId, asset, mesh, direction, velocity: {}, pose: { x, y, z, peel, loft } }
    if (!isSticker) {
      item.collider = physics.add(asset)
      item.transforms = { undo: [], redo: [] }
    }
    Object.assign(item.pose, bound(item, x, y))
    item.target = { ...item.pose }
    for (const key of channels) item.velocity[key] = 0
    mesh.rotation.z = angle
    placedMeshes.set(mesh, item)
    scene.add(mesh)
    items.push(item)
    requestRender()
    return item
  }

  function updateStarterIntro(progress) {
    if (!starter) return
    starter.mesh.visible = progress > 0
    if (!starter.mesh.visible) return
    const remaining = (1 - progress) ** 3
    const { x, y, z, peel, loft } = starter.target
    starter.mesh.position.set(x, y + remaining * 1.4, z + remaining * 0.3)
    starter.mesh.setPeel(...starter.direction, peel + remaining * 0.45, loft + remaining * 0.08)
    renderer.shadowMap.needsUpdate = true
  }

  function removeItem(item) {
    scene.remove(item.mesh)
    if (item.collider) physics.remove(item.collider)
    item.mesh.dispose()
    items.splice(items.indexOf(item), 1)
    if (selection === item) selection = null
    restackStickers()
    requestRender()
  }

  function pick(event) {
    const { width, height, left, top } = canvas.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2(2 * (event.clientX - left) / width - 1, 1 - 2 * (event.clientY - top) / height), camera)
    scene.updateMatrixWorld()
    const hit = raycaster.intersectObjects(items.filter(({ mesh }) => mesh.visible).map(({ mesh }) => mesh), true)[0]
    if (!hit) return null
    let object = hit.object
    while (!placedMeshes.has(object)) object = object.parent
    return { item: placedMeshes.get(object), uv: hit.uv }
  }

  function boardPoint(event) {
    const { width, height, left, top } = canvas.getBoundingClientRect()
    const u = (event.clientX - left) / width
    const v = (event.clientY - top) / height
    return { x: (u - 0.5) * viewWidth, y: (0.5 - v) * viewHeight, inside: u >= 0 && u <= 1 && v >= 0 && v <= 1 }
  }

  function select(item) {
    if (rotationPointer !== null && item !== selection) end(null, true)
    if (item !== selection) finishScaleInput()
    selection = item
    byId('selection-actions').hidden = !item
    byId('selection-name').textContent = item?.asset.name ?? ''
    const isSticker = item?.asset.kind === 'sticker'
    peelAction.hidden = !isSticker
    byId('sticker-size-control').hidden = !isSticker
    byId('rotation-control').hidden = !item?.collider
    undoTransform.hidden = redoTransform.hidden = !item?.collider
    if (item?.collider) showObjectTransform()
    if (isSticker) {
      showStickerSize(item)
      showStickerAngle(item)
    }
    const lifted = (item?.target.peel ?? 0) > 0.05
    byId('peel-label').textContent = lifted ? 'Press flat' : 'Peel corner'
    for (const button of boardItems.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.item) === item?.id))
    }
    syncRotation()
  }

  function syncRotation() {
    const solid = rotationToggle.checked && selection?.collider && !selection.flight && !gesture ? selection.mesh.solid : undefined
    if (rotation.object === solid) return
    if (solid) rotation.attach(solid)
    else rotation.detach()
  }

  function rotationPoint(event) {
    const { x, y } = boardPoint(event)
    return { x: 2 * x / viewWidth, y: 2 * y / viewHeight, button: event.button }
  }

  function groundTransform(resizing) {
    const { asset, collider, mesh, pose } = selection
    const { solid } = mesh
    if (resizing) {
      const { scale } = solid
      for (const axis of ['x', 'y', 'z']) scale[axis] = clamp(scale[axis] || 0.25, 0.25, 3)
      physics.scaleShape(collider, asset, scale.x, scale.y, scale.z)
      if (rotationPointer === null) Object.assign(selection.target, bound(selection, pose.x, pose.y))
    }
    physics.park(collider, pose.x, pose.y, solid.position.z + pose.z, solid.quaternion)
    solid.position.z = supportHeight(collider) + 0.009
    showObjectTransform()
    requestRender()
  }

  function showObjectTransform() {
    const { scale } = selection.mesh.solid
    const largest = Math.max(scale.x, scale.y, scale.z)
    objectScale.min = Math.min(300, 25 * largest / Math.min(scale.x, scale.y, scale.z))
    objectScale.value = largest * 100
    objectScale.disabled = Number(objectScale.min) >= 300
    const percentage = `${Math.round(largest * 100)}%`
    objectScale.setAttribute('aria-valuetext', percentage)
    byId('object-scale-value').textContent = percentage
    undoTransform.disabled = !selection.transforms.undo.length
    redoTransform.disabled = !selection.transforms.redo.length
  }

  function captureTransform(item, property) {
    return { property, value: item.mesh.solid[property].toArray() }
  }

  function recordTransform(item, before) {
    const current = item.mesh.solid[before.property].toArray()
    if (current.every((value, index) => Math.abs(value - before.value[index]) < 1e-7)) return
    const { undo, redo } = item.transforms
    undo.push(before)
    if (undo.length > 50) undo.shift()
    redo.length = 0
    if (item === selection) showObjectTransform()
  }

  function finishScaleInput() {
    if (!scaleBefore) return
    const before = scaleBefore
    scaleBefore = undefined
    recordTransform(selection, before)
  }

  objectScale.addEventListener('input', () => {
    if (!selection?.collider || gesture || rotationPointer !== null) return
    if (selection.flight) freezeFlight(selection)
    scaleBefore ??= captureTransform(selection, 'scale')
    const { scale } = selection.mesh.solid
    scale.multiplyScalar(objectScale.valueAsNumber / (100 * Math.max(scale.x, scale.y, scale.z)))
    groundTransform(true)
  })
  objectScale.addEventListener('change', finishScaleInput)
  objectScale.addEventListener('blur', finishScaleInput)
  objectScale.addEventListener('pointercancel', finishScaleInput)

  function replayTransform(from, to, message) {
    if (!selection?.collider || gesture || rotationPointer !== null) return
    finishScaleInput()
    const history = selection.transforms
    const entry = history[from].pop()
    if (!entry) return
    if (selection.flight) freezeFlight(selection)
    history[to].push(captureTransform(selection, entry.property))
    selection.mesh.solid[entry.property].fromArray(entry.value)
    groundTransform(entry.property === 'scale')
    status.textContent = message
  }

  undoTransform.addEventListener('click', () => replayTransform('undo', 'redo', 'Object transform undone.'))
  redoTransform.addEventListener('click', () => replayTransform('redo', 'undo', 'Object transform redone.'))

  rotation.addEventListener('change', () => {
    canvas.classList.toggle('is-rotating', Boolean(rotation.axis))
    requestRender()
  })
  rotation.addEventListener('objectChange', () => groundTransform(rotation.mode === 'scale'))
  rotationToggle.addEventListener('change', () => {
    if (rotationPointer !== null) end(null, true)
    byId('rotation-help').hidden = !rotationToggle.checked
    byId('gizmo-mode-field').hidden = !rotationToggle.checked
    syncRotation()
  })
  gizmoMode.addEventListener('change', () => {
    if (rotationPointer !== null) end(null, true)
    rotation.axis = null
    rotation.setMode(gizmoMode.value)
    byId('rotation-help').textContent = gizmoMode.value === 'scale'
      ? 'Drag an axis to resize it or a white handle to resize all axes. Press X, Y, or Z to grow and hold Shift to shrink.'
      : 'Drag a handle or press X, Y, or Z. Hold Shift to reverse.'
  })

  function showStickerSize(item) {
    stickerSize.value = Math.round(item.mesh.scale.x * 100)
    const percentage = `${stickerSize.value}%`
    stickerSize.setAttribute('aria-valuetext', percentage)
    byId('sticker-size-value').textContent = percentage
  }

  function showStickerAngle(item) {
    stickerAngle.value = Math.round(THREE.MathUtils.radToDeg(item.mesh.rotation.z))
    stickerAngle.setAttribute('aria-valuetext', `${stickerAngle.value} degrees`)
    byId('sticker-angle-value').textContent = `${stickerAngle.value}°`
  }

  function updateItems() {
    const count = items.filter((item) => item !== gesture?.pending)
    byId('board-count').textContent = String(count.length).padStart(2, '0')
    boardItems.replaceChildren(...count.map((item) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.item = item.id
      button.textContent = item.asset.name
      button.addEventListener('click', () => {
        select(item)
        status.textContent = `${item.asset.name} selected. Use the arrow keys to move it.`
      })
      return button
    }))
    select(selection)
  }

  function restackStickers() {
    const layers = []
    for (const item of items) {
      if (item.asset.kind !== 'sticker' || gesture?.item === item) continue
      item.target.z = 0
      const radius = itemRadius(item)
      const surface = paperHeight * item.mesh.scale.z
      for (const lower of layers) {
        const distance = Math.hypot(item.target.x - lower.item.target.x, item.target.y - lower.item.target.y)
        if (distance < radius + lower.radius) {
          const clearance = paperThickness * item.mesh.scale.z + 0.001
          item.target.z = Math.max(item.target.z, lower.item.target.z + lower.surface - surface + clearance)
        }
      }
      layers.push({ item, radius, surface })
    }
  }

  function paste(item, message, peel = 0) {
    Object.assign(item.target, { z: 0, peel: item.asset.kind === 'sticker' ? peel : 0, loft: 0 })
    if (item.asset.kind === 'sticker') {
      items.splice(items.indexOf(item), 1)
      items.push(item)
      restackStickers()
    }
    select(item)
    status.textContent = `${item.asset.name} ${message}.`
    requestRender()
  }

  function releaseItem(item, drag, message) {
    const velocity = !reduceMotion.matches && drag?.samples ? releaseVelocity(drag.samples) : null
    if (!velocity) {
      paste(item, message, drag?.original?.peel)
      return
    }
    const { solid } = item.mesh
    const { x, y, z } = item.pose
    physics.launch(item.collider, x, y, solid.position.z + z, solid.quaternion, velocity, drag.grip)
    item.flight = true
    for (const key of channels) item.velocity[key] = 0
    select(item)
    status.textContent = `${item.asset.name} thrown.`
    requestRender()
  }

  function placeItem(item, drag) {
    if (item.asset.kind === 'sticker') {
      const peel = stickerPlacements % 3 === 0 ? restingCurl : 0
      stickerPlacements += 1
      paste(item, 'placed', peel)
    } else {
      releaseItem(item, drag, 'placed')
    }
    updateItems()
  }

  function placeFromClick(asset) {
    const spots = [[0, 0], [0.25, 0.20], [-0.25, -0.16], [-0.26, 0.26], [0.26, -0.26], [0, -0.28]]
    const candidates = spots.map(([x, y]) => ({ x: x * viewWidth, y: y * viewHeight }))
    const point = candidates.find(({ x, y }) => items.every((item) => {
      return Math.hypot(item.target.x - x, item.target.y - y) > 0.69 * (1 + item.mesh.scale.x)
    })) ?? candidates[0]
    const item = createItem(asset, point.x, point.y, { z: 0.24, peel: asset.kind === 'sticker' ? 0.4 : 0, loft: 0.05 })
    placeItem(item)
  }

  function renderLibrary() {
    const assets = activeTab === 0 ? stickers : objects
    byId('asset-count').textContent = String(assets.length).padStart(2, '0')
    assetList.replaceChildren(...assets.map((asset) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'asset-card'
      button.dataset.asset = asset.id
      const preview = document.createElement('span')
      preview.className = 'asset-preview'
      const image = new Image()
      image.src = asset.preview
      image.alt = ''
      image.draggable = false
      preview.append(image)
      const name = document.createElement('span')
      name.className = 'asset-name'
      name.textContent = asset.name
      button.append(preview, name)
      button.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0 || gesture || rotationPointer !== null) return
        begin(event, { asset })
      })
      button.addEventListener('click', (event) => {
        if (event.detail === 0 && !gesture && rotationPointer === null) placeFromClick(asset)
      })
      return button
    }))
  }

  function switchTab(index) {
    activeTab = index
    tabs.forEach((tab, position) => {
      tab.setAttribute('aria-selected', String(index === position))
      tab.tabIndex = index === position ? 0 : -1
    })
    byId('library-panel').setAttribute('aria-labelledby', tabs[index].id)
    byId('gesture-hint').textContent = index === 0 ? 'Pull an edge to peel' : 'Flick to throw'
    refreshUpload()
    renderLibrary()
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => switchTab(index))
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
      switchTab(next)
      tabs[next].focus()
    })
  })

  function begin(event, state) {
    const { item } = state
    const source = event.currentTarget
    if (item?.flight) freezeFlight(item)
    const start = boardPoint(event)
    const prop = (item?.asset ?? state.asset).kind === 'object'
    gesture = {
      ...state, source, pointerId: event.pointerId, start,
      clientX: event.clientX, clientY: event.clientY, original: item && { ...item.target },
      originalDirection: item?.direction, moved: false, detached: false,
    }
    if (prop) {
      gesture.samples = []
      gesture.grip = item ? { x: start.x - item.pose.x, y: start.y - item.pose.y } : { x: 0, y: 0 }
      recordPointer(gesture.samples, start, event.timeStamp)
    }
    syncRotation()
    source.setPointerCapture(event.pointerId)
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || gesture || rotationPointer !== null) return
    canvas.classList.add('is-pointer-focused')
    if (rotation.object) {
      rotation.object.updateWorldMatrix(true, false)
      rotationHelper.updateMatrixWorld(true)
      const point = rotationPoint(event)
      rotation.pointerHover(point)
      rotation.pointerDown(point)
      if (rotation.dragging) {
        finishScaleInput()
        gizmoBefore = captureTransform(selection, rotation.mode === 'scale' ? 'scale' : 'quaternion')
        rotationPointer = event.pointerId
        canvas.setPointerCapture(event.pointerId)
        return
      }
    }
    const hit = pick(event)
    select(hit?.item ?? null)
    if (!hit) return
    const { item, uv } = hit
    if (item.asset.kind === 'object') {
      begin(event, { item })
      return
    }
    const direction = [(uv.x - 0.5) * item.asset.width, (uv.y - 0.5) * item.asset.height]
    begin(event, { item, direction: Math.hypot(...direction) > 0.095 ? direction : item.direction })
  })
  canvas.addEventListener('blur', () => canvas.classList.remove('is-pointer-focused'))

  canvas.addEventListener('pointermove', (event) => {
    if (gesture || rotationPointer !== null || event.pointerType === 'touch') return
    if (rotation.object) rotation.pointerHover(rotationPoint(event))
    if (!hoverEvent) {
      requestAnimationFrame(() => {
        canvas.classList.toggle('is-grabbable', Boolean(hoverEvent && !gesture && pick(hoverEvent)))
        hoverEvent = null
      })
    }
    hoverEvent = event
  })
  canvas.addEventListener('pointerleave', () => {
    if (rotationPointer === null) rotation.axis = null
    hoverEvent = null
    canvas.classList.remove('is-grabbable')
  })

  function move(event) {
    if (rotationPointer === event.pointerId) {
      rotation.pointerMove(rotationPoint(event))
      return
    }
    const drag = gesture
    if (!drag || event.pointerId !== drag.pointerId) return
    const point = boardPoint(event)
    if (drag.samples) recordPointer(drag.samples, point, event.timeStamp)
    const moved = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY)
    if (!drag.moved && moved < (event.pointerType === 'touch' ? 7 : 4)) return
    drag.moved = true
    const dx = point.x - drag.start.x
    const dy = point.y - drag.start.y
    if (drag.asset) {
      if (!drag.pending && point.inside) {
        const sticker = drag.asset.kind === 'sticker'
        drag.pending = createItem(drag.asset, point.x, point.y, { z: 0.25, peel: sticker ? 0.91 : 0, loft: 0.09 })
        drag.item = drag.pending
      }
      if (drag.pending) {
        drag.pending.mesh.visible = point.inside
        Object.assign(drag.pending.target, bound(drag.pending, point.x, point.y))
      }
    } else {
      const { item, original } = drag
      if (item.asset.kind === 'sticker') {
        const distance = Math.hypot(dx, dy)
        const length = Math.max(item.asset.width, item.asset.height) * item.mesh.scale.x
        const amount = Math.min(1, original.peel + distance / (length * 0.69))
        if (!drag.detached) {
          item.direction = drag.direction
          item.target.peel = amount
          item.target.loft = 0.16 * amount
          if (amount >= 1) drag.detached = true
        }
        if (drag.detached) {
          item.target.z = 0.23
          item.target.peel = 0.94
          Object.assign(item.target, bound(item, original.x + dx, original.y + dy))
        }
      } else {
        item.target.z = 0.22
        Object.assign(item.target, bound(item, original.x + dx, original.y + dy))
      }
    }
    stage.classList.toggle('is-dragging', Boolean(drag.item) && point.inside)
    requestRender()
  }

  function end(event, cancelled = false) {
    if (rotationPointer !== null && (!event || event.pointerId === rotationPointer)) {
      const pointerId = rotationPointer
      if (cancelled) rotation.reset()
      rotationPointer = null
      rotation.pointerUp(null)
      if (!cancelled && rotation.mode === 'scale') {
        Object.assign(selection.target, bound(selection, selection.pose.x, selection.pose.y))
        requestRender()
      }
      if (!cancelled) recordTransform(selection, gizmoBefore)
      gizmoBefore = undefined
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId)
      return
    }
    const drag = gesture
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    if (!cancelled && event) move(event)
    gesture = null
    if (drag.source.hasPointerCapture(drag.pointerId)) drag.source.releasePointerCapture(drag.pointerId)
    stage.classList.remove('is-dragging')
    const inside = !cancelled && event && boardPoint(event).inside

    if (drag.asset) {
      if (drag.pending && inside) {
        placeItem(drag.pending, drag)
      } else if (drag.pending) removeItem(drag.pending)
      else if (!cancelled && !drag.moved) placeFromClick(drag.asset)
    } else if (drag.moved) {
      if (inside && (drag.detached || drag.item.asset.kind === 'object')) releaseItem(drag.item, drag, 'repositioned')
      else {
        Object.assign(drag.item.target, drag.original)
        drag.item.direction = drag.originalDirection
        select(drag.item)
        requestRender()
      }
    }
    syncRotation()
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', (event) => end(event))
  window.addEventListener('pointercancel', (event) => end(event, true))
  window.addEventListener('lostpointercapture', (event) => end(event, true))
  window.addEventListener('blur', () => end(null, true))

  stickerSize.addEventListener('input', () => {
    if (selection?.asset.kind !== 'sticker') return
    if (!gesture) {
      selection.mesh.scale.setScalar(stickerSize.valueAsNumber / 100)
      Object.assign(selection.target, bound(selection, selection.target.x, selection.target.y))
      Object.assign(selection.pose, bound(selection, selection.pose.x, selection.pose.y))
      restackStickers()
      requestRender()
    }
    showStickerSize(selection)
  })

  function setStickerAngle(degrees) {
    if (selection?.asset.kind !== 'sticker') return
    if (!gesture) {
      selection.mesh.rotation.z = THREE.MathUtils.degToRad(degrees)
      requestRender()
    }
    showStickerAngle(selection)
  }

  stickerAngle.addEventListener('input', () => setStickerAngle(stickerAngle.valueAsNumber))
  byId('reset-sticker-angle').addEventListener('click', () => setStickerAngle(0))

  peelAction.addEventListener('click', () => {
    if (selection?.asset.kind !== 'sticker' || gesture) return
    selection.target.peel = selection.target.peel > 0.05 ? 0 : restingCurl
    selection.target.loft = 0
    select(selection)
    status.textContent = selection.target.peel ? `${selection.asset.name} corner lifted.` : `${selection.asset.name} pressed flat.`
    requestRender()
  })

  function deleteSelection() {
    if (!selection || gesture || rotationPointer !== null) return
    finishScaleInput()
    status.textContent = `${selection.asset.name} removed.`
    removeItem(selection)
    updateItems()
    canvas.focus()
  }

  byId('remove-action').addEventListener('click', deleteSelection)
  document.addEventListener('keydown', (event) => {
    canvas.classList.remove('is-pointer-focused')
    if (colorDialog.open) return
    if (event.key === 'Escape') {
      if (gesture || rotationPointer !== null) end(null, true)
      else select(null)
      return
    }
    if (!selection || gesture || rotationPointer !== null) return
    const onBoard = event.target === canvas || boardItems.contains(event.target)
    const axis = rotationAxes.get(event.key.toLowerCase())
    if (rotation.object && axis && (onBoard || event.target === rotationToggle || event.target === gizmoMode) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const direction = event.shiftKey ? -1 : 1
      finishScaleInput()
      const resizing = rotation.mode === 'scale'
      const before = captureTransform(selection, resizing ? 'scale' : 'quaternion')
      if (resizing) rotation.object.scale[event.key.toLowerCase()] *= 1.1 ** direction
      else rotation.object.rotateOnWorldAxis(axis, direction * Math.PI / 12)
      groundTransform(resizing)
      recordTransform(selection, before)
      return
    }
    if (!onBoard) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteSelection()
      return
    }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] }[event.key]
    if (!direction) return
    event.preventDefault()
    if (selection.flight) freezeFlight(selection)
    const step = event.shiftKey ? 0.32 : 0.08
    Object.assign(selection.target, bound(selection, selection.target.x + direction[0] * step, selection.target.y + direction[1] * step))
    paste(selection, 'moved', selection.target.peel)
  })

  function refreshUpload() {
    const upload = uploads[activeTab]
    byId('upload-title').textContent = upload.title
    byId('upload-description').textContent = upload.hint ?? 'Browse or drop a file here'
    uploadInput.accept = upload.accept
    uploadInput.setAttribute('aria-label', upload.label)
    uploadArea.setAttribute('aria-busy', String(Boolean(upload.busy)))
    uploadStatus.textContent = upload.message ?? ''
  }

  async function upload(file) {
    const target = uploads[activeTab]
    if (!file || target.busy) return
    target.busy = true
    target.message = `Preparing ${target.noun}…`
    refreshUpload()
    try {
      const asset = await target.load(file)
      target.assets.push(asset)
      if (uploads[activeTab] === target) renderLibrary()
      target.message = `${asset.name} added. Drag it onto the board.`
    } catch (error) {
      target.message = error.message
    } finally {
      target.busy = false
      if (uploads[activeTab] === target) refreshUpload()
    }
  }

  byId('upload').addEventListener('click', () => uploadInput.click())
  uploadInput.addEventListener('change', () => {
    upload(uploadInput.files[0])
    uploadInput.value = ''
  })
  uploadArea.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    uploadArea.classList.add('is-dragover')
  })
  uploadArea.addEventListener('dragleave', (event) => {
    if (!uploadArea.contains(event.relatedTarget)) uploadArea.classList.remove('is-dragover')
  })
  uploadArea.addEventListener('drop', (event) => {
    event.preventDefault()
    uploadArea.classList.remove('is-dragover')
    upload(event.dataTransfer.files[0])
  })

  new ResizeObserver(() => {
    if (gesture || rotationPointer !== null) end(null, true)
    resize()
  }).observe(stage)
  canvas.addEventListener('webglcontextrestored', requestRender)
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) finishStartup()
    lastPaint = 0
    requestRender()
  })
  document.addEventListener('visibilitychange', () => {
    lastPaint = 0
    if (document.hidden) {
      cancelAnimationFrame(frame)
      frame = 0
    } else requestRender()
  })
  resize()
  stickers.unshift(...await builtInStickers())
  starter = createItem(stickers[0], viewWidth * 0.168, -viewHeight * 0.115, { angle: -0.50, peel: restingCurl, direction: [-0.29, -1] })
  if (startupActive) updateStarterIntro(0)
  renderLibrary()
  updateItems()
}

start().catch((error) => {
  console.error(error)
  const message = document.createElement('p')
  message.className = 'stage-error'
  message.setAttribute('role', 'alert')
  message.textContent = 'The board could not start. Reload the page in a browser with WebGL 2 enabled.'
  stage.append(message)
})
