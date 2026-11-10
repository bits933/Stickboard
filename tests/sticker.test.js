import assert from 'node:assert/strict';
import test from 'node:test';
import { Raycaster, Vector3 } from 'three';
import { createSticker, paperThickness, restingCurl } from '../src/sticker.js';

function makeSticker(size, alphaAt) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      data[(y * size + x) * 4 + 3] = alphaAt(x, y);
    }
  }
  const canvas = { width: size, height: size, getContext: () => ({ getImageData: () => ({ data }) }) };
  return createSticker({ canvas, width: 1, height: 1 });
}

test('the resting curl leaves the print attached and preserves the length of the lifted vinyl', () => {
  const sticker = makeSticker(8, () => 255);
  const { position, normal } = sticker.geometry.attributes;
  const columns = sticker.geometry.parameters.widthSegments + 1;
  const centerRow = Math.floor(columns / 2) * columns;
  const edge = centerRow + columns - 1;
  const rest = position.getZ(centerRow);

  sticker.setPeel(1, 0, restingCurl);
  assert.equal(position.getZ(centerRow), rest);
  assert.ok(position.getZ(edge) > rest + 0.08);
  assert.ok(normal.getZ(edge) < -0.5);

  let sheetLength = 0;
  for (let i = centerRow + 1; i <= edge; i += 1) {
    sheetLength += Math.hypot(position.getX(i) - position.getX(i - 1), position.getZ(i) - position.getZ(i - 1));
  }
  assert.ok(Math.abs(sheetLength - 1) < 0.002);
  sticker.setPeel(1, 0, 0);
  assert.equal(position.getZ(edge), rest);
  sticker.dispose();
});

test('transparent artwork pixels do not intercept a pointer ray', () => {
  const sticker = makeSticker(16, (x, y) => Math.hypot(x - 7.5, y - 7.5) < 6 ? 255 : 0);
  const ray = new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(sticker).length > 0);
  ray.ray.origin.set(0.45, 0.45, 2);
  assert.equal(ray.intersectObject(sticker).length, 0);
  sticker.dispose();
});

test('paper walls follow both the outside and inside of a transparent cutout', () => {
  const sticker = makeSticker(32, (x, y) => {
    const radius = Math.hypot(x - 15.5, y - 15.5);
    return radius > 5 && radius < 13 ? 255 : 0;
  });
  const edge = sticker.children[0].geometry.attributes.position;
  const outlineRadii = Array.from({ length: edge.count / 2 }, (_, i) => Math.hypot(edge.getX(i * 2), edge.getY(i * 2)));
  assert.ok(outlineRadii.some((radius) => radius < 0.20));
  assert.ok(outlineRadii.some((radius) => radius > 0.37));

  sticker.setPeel(-1, -1, restingCurl);
  for (let i = 0; i < edge.count; i += 2) {
    const thickness = Math.hypot(edge.getX(i) - edge.getX(i + 1), edge.getY(i) - edge.getY(i + 1), edge.getZ(i) - edge.getZ(i + 1));
    assert.ok(Math.abs(thickness - paperThickness) < 0.000001);
  }
  assert.ok(edge.array.some((value, index) => index % 3 === 2 && value > 0.05));
  sticker.dispose();
});

test('a faint one-pixel upload still has vertical peel extent', () => {
  const sticker = makeSticker(1, () => 9);
  const { position } = sticker.geometry.attributes;
  const rest = position.getZ(0);
  sticker.setPeel(0, 1, 0.24);
  assert.ok(position.getZ(0) > rest + 0.08);
  sticker.dispose();
});
