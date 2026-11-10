import faceUrl from './art/static-face.svg'
import handPickedUrl from './art/hand-picked.webp'
import silverQueenUrl from './art/silver-queen.webp'
import wavySmileUrl from './art/wavy-smile.webp'
import vintageStampUrl from './art/vintage-stamp.webp'
import blockBusterUrl from './art/block-buster.webp'
import voltageUrl from './art/voltage.svg'
import vertigoUrl from './art/vertigo.svg'
import sideEyeUrl from './art/side-eye.svg'
import starstruckUrl from './art/starstruck.svg'
import bruhPinUrl from './art/bruh-pin.webp'
import bruhWordmarkUrl from './art/bruh-wordmark.png'
import berryCactusUrl from './art/berry-cactus.webp'
import heartSproutUrl from './art/heart-sprout.webp'
import flexCactusUrl from './art/flex-cactus.webp'
import beanieCactusUrl from './art/beanie-cactus.webp'
import deadpanDaisyUrl from './art/deadpan-daisy.webp'
import grumpyTulipUrl from './art/grumpy-tulip.webp'
import bubbleSucculentUrl from './art/bubble-succulent.webp'
import wideEyesUrl from './art/wide-eyes.webp'
import smileyDaisyUrl from './art/smiley-daisy.webp'
import cubeUrl from './art/cube.svg'
import cylinderUrl from './art/cylinder.svg'
import coneUrl from './art/cone.svg'
import rubiksCubeUrl from './art/rubiks-cube.svg'

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
let uploadId = 0

function vinylAsset(image, id, name, size) {
  const source = document.createElement('canvas')
  source.width = image.width
  source.height = image.height
  const context = source.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0)

  const { width, height } = source
  const { data } = context.getImageData(0, 0, width, height)
  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = y
    }
  }
  if (right < left) throw new Error('This PNG is fully transparent. Choose one with visible artwork.')

  const cropWidth = right - left + 1
  const cropHeight = bottom - top + 1
  const longestSide = Math.max(cropWidth, cropHeight)
  const scale = Math.min(1, 1024 / longestSide)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(cropWidth * scale))
  canvas.height = Math.max(1, Math.round(cropHeight * scale))
  const print = canvas.getContext('2d')
  print.imageSmoothingQuality = 'high'
  print.drawImage(source, left, top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
  source.width = source.height = 1

  const preview = document.createElement('canvas')
  const thumbnailScale = Math.min(1, 160 / Math.max(canvas.width, canvas.height))
  preview.width = Math.max(1, Math.round(canvas.width * thumbnailScale))
  preview.height = Math.max(1, Math.round(canvas.height * thumbnailScale))
  const thumbnail = preview.getContext('2d')
  thumbnail.imageSmoothingQuality = 'high'
  thumbnail.drawImage(canvas, 0, 0, preview.width, preview.height)

  return {
    id, name, canvas, kind: 'sticker', preview: preview.toDataURL(),
    width: size * cropWidth / longestSide, height: size * cropHeight / longestSide,
  }
}

export function builtInStickers() {
  return Promise.all([
    ['static-face', 'Static Face', faceUrl, 1.33],
    ['hand-picked', 'Hand Picked', handPickedUrl, 1.45],
    ['silver-queen', 'Silver Queen', silverQueenUrl, 1.45],
    ['wavy-smile', 'Wavy Smile', wavySmileUrl, 1.33],
    ['vintage-stamp', 'Vintage Stamp', vintageStampUrl, 1.36],
    ['block-buster', 'Block Buster', blockBusterUrl, 1.39],
    ['voltage', 'Voltage', voltageUrl, 1.33],
    ['vertigo', 'Vertigo', vertigoUrl, 1.33],
    ['side-eye', 'Side Eye', sideEyeUrl, 1.33],
    ['starstruck', 'Starstruck', starstruckUrl, 1.33],
    ['bruh-pin', 'Bruh Pin', bruhPinUrl, 1.45],
    ['bruh-wordmark', 'BRUH!', bruhWordmarkUrl, 1.58],
    ['berry-cactus', 'Berry Cactus', berryCactusUrl, 1.35],
    ['heart-sprout', 'Heart Sprout', heartSproutUrl, 1.45],
    ['flex-cactus', 'Flex Cactus', flexCactusUrl, 1.4],
    ['beanie-cactus', 'Beanie Cactus', beanieCactusUrl, 1.45],
    ['deadpan-daisy', 'Deadpan Daisy', deadpanDaisyUrl, 1.4],
    ['grumpy-tulip', 'Grumpy Tulip', grumpyTulipUrl, 1.45],
    ['bubble-succulent', 'Bubble Succulent', bubbleSucculentUrl, 1.35],
    ['wide-eyes', 'Wide Eyes', wideEyesUrl, 1.35],
    ['smiley-daisy', 'Smiley Daisy', smileyDaisyUrl, 1.4],
  ].map(async ([id, name, url, size]) => {
    const image = new Image()
    image.src = url
    await image.decode()
    return vinylAsset(image, id, name, size)
  }))
}

export const objects = [
  { id: 'cube', name: 'Cube', kind: 'object', preview: cubeUrl, width: 0.94, height: 0.94, depth: 0.82 },
  { id: 'cylinder', name: 'Cylinder', kind: 'object', preview: cylinderUrl, width: 0.96, height: 0.96, depth: 0.72 },
  { id: 'cone', name: 'Cone', kind: 'object', preview: coneUrl, width: 0.88, height: 0.88, depth: 1.02, tipRadius: 0.027 },
  { id: 'rubiks-cube', name: 'Rubik’s Cube', kind: 'object', preview: rubiksCubeUrl, width: 0.98, height: 0.98, depth: 0.98 },
]

export async function importSticker(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a PNG smaller than 12 MB.')
  const header = new DataView(await file.slice(0, 24).arrayBuffer())
  if (header.byteLength < 24 || !pngSignature.every((byte, index) => header.getUint8(index) === byte) || header.getUint32(12) !== 0x49484452) {
    throw new Error('Choose a valid PNG image.')
  }
  const width = header.getUint32(16)
  const height = header.getUint32(20)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) {
    throw new Error('Choose a PNG under 16 megapixels and 8192 pixels per side.')
  }
  const image = await createImageBitmap(file).catch(() => {
    throw new Error('This PNG could not be opened. Try exporting it again.')
  })
  try {
    const name = file.name.replace(/\.png$/i, '').trim().slice(0, 45) || 'Untitled sticker'
    return vinylAsset(image, `upload-${++uploadId}`, name, 1.34)
  } finally {
    image.close()
  }
}
