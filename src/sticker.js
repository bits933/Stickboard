import {
  BufferGeometry, CanvasTexture, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, MathUtils, Mesh, MeshDepthMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, RGBADepthPacking, Sphere, SRGBColorSpace, Vector2, Vector3,
} from 'three';

export const paperHeight = 0.014;
export const paperThickness = 0.008;
const sharedMedia = new WeakMap();
export const restingCurl = 0.205;

const vinylFinish = /* glsl */ `
  uniform vec2 vinylFlakeGrid;

  vec3 flakeRandom(vec2 cell) {
    vec3 p = fract(vec3(cell.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yzz) * p.zyx);
  }
`;

const vinylReflection = /* glsl */ `
  vec3 halfAngle = normalize(vinylKeyDirection + geometryViewDir);
  vec3 stripDirection = cross(geometryViewDir, halfAngle);
  float stripLength = length(stripDirection);
  vec3 stripAxis = stripLength > 0.0001 ? stripDirection / stripLength : vec3(1.0, 0.0, 0.0);
  vec3 acrossStrip = cross(halfAngle, stripAxis);
  vec2 reflectionAngle = vec2(dot(normal, acrossStrip), dot(normal, stripAxis));
  float facing = smoothstep(0.25, 0.82, dot(normal, halfAngle));
  vec2 narrow = reflectionAngle * vec2(9.4, 3.1);
  vec2 soft = reflectionAngle * vec2(3.5, 2.1);
  float lacquer = (0.64 * exp2(-dot(narrow, narrow)) + 0.075 * exp2(-dot(soft, soft))) * facing;

  // Fixed UV flakes only flash when a tilted facet reflects the actual key toward the eye.
  vec2 flakePosition = vMapUv * vinylFlakeGrid;
  vec3 grain = flakeRandom(floor(flakePosition) + 7.0);
  vec2 center = 0.5 + 0.45 * (grain.xy - 0.5);
  vec2 grainPixel = fwidth(flakePosition);
  float footprint = max(grainPixel.x, grainPixel.y);
  float distanceToFlake = length(fract(flakePosition) - center);
  float grainSize = mix(0.10, 0.215, grain.z);
  float speck = 1.0 - smoothstep(grainSize, grainSize + min(footprint * 0.5, 0.22), distanceToFlake);
  vec3 tangent = normalize(cross(abs(normal.x) > 0.82 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), normal));
  vec3 flakeNormal = normalize(normal + (grain.x - 0.5) * 0.77 * tangent
    + (grain.y - 0.5) * 0.77 * cross(normal, tangent));
  float aligned = smoothstep(0.984, 0.9995, dot(flakeNormal, halfAngle)) * step(0.12, grain.z);
  float resolved = 1.0 - smoothstep(0.45, 0.90, footprint);
  vec3 foilTint = mix(vec3(0.68, 0.89, 1.22), vec3(1.16, 0.79, 0.52), grain.x);
  float glitterWindow = smoothstep(0.895, 0.952, dot(normal, halfAngle));
  float litFlake = smoothstep(0.68, 1.55, max(vinylKeyRadiance.r, vinylKeyRadiance.g));
  float glitter = gl_FrontFacing ? 3.0 * speck * aligned * glitterWindow * resolved * litFlake : 0.0;
  // Keep an overhead source from flattening the print into a clearcoat flare.
  float flatOverhead = (1.0 - smoothstep(0.08, 0.24, stripLength)) * smoothstep(0.86, 0.985, normal.z);
  float mirrorGain = mix(1.0, 0.00012, flatOverhead);
  reflectedLight.directSpecular *= mirrorGain;
  #ifdef USE_CLEARCOAT
    clearcoatSpecularDirect *= mirrorGain;
  #endif
  float lacquerGain = mix(1.0, 0.018, flatOverhead) * (gl_FrontFacing ? 1.0 : 0.30);
  reflectedLight.directSpecular += vinylKeyRadiance * (lacquer * lacquerGain + foilTint * glitter * mix(1.0, 0.35, flatOverhead));

  if (gl_FrontFacing) {
    // shortcut: approximate foil diffraction with broad color bands, use a spectral model for calibrated finishes.
    float foilPhase = dot(projection, vec2(1.8, -1.2)) + dot(normal.xy - halfAngle.xy, vec2(1.1, 0.85));
    foilPhase += dot(vMapUv, vec2(0.48, 0.26)) + 0.14 * sin(6.283185 * (vMapUv.y - 0.4 * vMapUv.x));
    vec3 foilColor = 0.5 + 0.5 * cos(6.283185 * (foilPhase + vec3(0.0, 0.67, 0.33)));
    float foilSheen = 0.105 * exp2(-1.45 * dot(soft, soft)) * facing * mix(1.0, 0.40, flatOverhead);
    reflectedLight.directSpecular += vinylKeyRadiance * foilColor * foilColor * foilSheen;
  }
`;

const contourSegments = [[], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
  [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [1, 3], [0, 1], [3, 0], []];
const contourOffsets = [[1, 0.5], [1.5, 1], [1, 1.5], [0.5, 1]];

function traceOutline(pixels, width, height, cutoff, limit = 256) {
  const scale = Math.min(1, limit / Math.max(width, height));
  const cols = Math.max(1, Math.round(width * scale));
  const rows = Math.max(1, Math.round(height * scale));
  const stride = cols + 2;
  const mask = new Uint8Array(stride * (rows + 2));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const row = Math.floor((y + 0.5) * height / rows);
      const col = Math.floor((x + 0.5) * width / cols);
      mask[(y + 1) * stride + x + 1] = Number(pixels[4 * (row * width + col) + 3] >= cutoff);
    }
  }

  const outline = [];
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= cols; x += 1) {
      const i = y * stride + x;
      const pattern = mask[i] | mask[i + 1] << 1 | mask[i + stride + 1] << 2 | mask[i + stride] << 3;
      for (const edge of contourSegments[pattern]) {
        const [dx, dy] = contourOffsets[edge];
        outline.push((x + dx - 1) / cols - 0.5, 0.5 - (y + dy - 1) / rows);
      }
    }
  }
  // shortcut: cap contour detail for noisy PNG masks, increase the budget if exact micro-edges become necessary.
  return outline.length > 12_000 && limit > 32 ? traceOutline(pixels, width, height, cutoff, limit / 2) : outline;
}

function prepareMedia(canvas) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  let peakAlpha = 0;
  for (let i = 3; i < data.length; i += 4) peakAlpha = Math.max(peakAlpha, data[i]);
  if (peakAlpha === 0) throw new Error('A sticker needs visible artwork.');
  const cutoffByte = Math.min(82, peakAlpha * 0.5);
  const alphaTest = cutoffByte / 255;
  const silhouette = [];
  for (let row = 0; row < height; row += 1) {
    let left = width;
    let right = -1;
    for (let col = 0; col < width; col += 1) {
      if (data[4 * (row * width + col) + 3] >= cutoffByte) {
        left = Math.min(left, col);
        right = col;
      }
    }
    if (right < left) continue;
    const y = 0.5 - (row + 0.5) / height;
    silhouette.push(left / width - 0.5, y, (right + 1) / width - 0.5, y);
  }

  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;

  const material = new MeshPhysicalMaterial({
    map, alphaTest, alphaToCoverage: true, side: DoubleSide,
    roughness: 0.39, clearcoat: 0.83, clearcoatRoughness: 0.16,
  });
  material.onBeforeCompile = (shader) => {
    const flakeScale = 57 / Math.max(width, height);
    shader.uniforms.vinylFlakeGrid = { value: new Vector2(Math.max(1, width * flakeScale), Math.max(1, height * flakeScale)) };
    shader.fragmentShader = vinylFinish + shader.fragmentShader
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.86, 0.76, 0.62);
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        if (!gl_FrontFacing) roughnessFactor = 0.26;
      `)
      .replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        ${vinylReflection}
        if (!gl_FrontFacing) {
          float adhesiveRim = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 2.8);
          float bounce = dot(vinylKeyRadiance, vec3(0.30, 0.58, 0.12));
          reflectedLight.indirectDiffuse += vec3(0.20, 0.16, 0.10)
            + adhesiveRim * vec3(0.42, 0.35, 0.23) * (0.42 + bounce * 0.39);
        }
      `);
  };
  const depth = new MeshDepthMaterial({ map, alphaTest, side: DoubleSide, depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    // Three substitutes a 0.5 shadow cutoff when the visible material uses alpha-to-coverage.
    shader.uniforms.stickerAlphaCutoff = { value: alphaTest };
    shader.fragmentShader = 'uniform float stickerAlphaCutoff;\n' + shader.fragmentShader.replace(
      '#include <alphatest_fragment>', 'if (diffuseColor.a < stickerAlphaCutoff) discard;',
    );
  };
  const edgeMaterial = new MeshStandardMaterial({ color: '#d7c9ad', roughness: 0.85, side: DoubleSide });
  const outline = traceOutline(data, width, height, cutoffByte);
  const media = { map, material, depth, edgeMaterial, outline, silhouette, pixels: data, cutoffByte, count: 0 };
  sharedMedia.set(canvas, media);
  return media;
}

export function createSticker({ canvas, width, height }) {
  const media = sharedMedia.get(canvas) ?? prepareMedia(canvas);
  media.count += 1;
  const geometry = new PlaneGeometry(width, height, 48, 48);
  const flat = geometry.attributes.position.array;
  const faceCount = geometry.attributes.position.count;
  const position = new Float32BufferAttribute(faceCount * 6, 3).setUsage(DynamicDrawUsage);
  const normal = new Float32BufferAttribute(faceCount * 6, 3).setUsage(DynamicDrawUsage);
  const uv = [...geometry.attributes.uv.array, ...geometry.attributes.uv.array];
  const indices = geometry.index.array;
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex([...indices, ...Array.from(indices, (index) => index + faceCount)]);
  const radius = Math.hypot(width, height) + paperHeight;
  geometry.boundingSphere = new Sphere(new Vector3(), radius);

  const mesh = new Mesh(geometry, media.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = media.depth;

  const edgeGeometry = new BufferGeometry();
  const edgePosition = new Float32BufferAttribute(media.outline.length * 3, 3).setUsage(DynamicDrawUsage);
  const edgeIndices = [];
  for (let i = 0; i < edgePosition.count; i += 4) edgeIndices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  edgeGeometry.setAttribute('position', edgePosition);
  edgeGeometry.setAttribute('normal', new Float32BufferAttribute(edgePosition.count * 3, 3).setUsage(DynamicDrawUsage));
  edgeGeometry.setIndex(edgeIndices);
  edgeGeometry.boundingSphere = new Sphere(new Vector3(), radius);
  const edge = new Mesh(edgeGeometry, media.edgeMaterial);
  edge.castShadow = edge.receiveShadow = true;
  edge.raycast = () => {};
  mesh.add(edge);

  mesh.raycast = (raycaster, intersections) => {
    const start = intersections.length;
    Mesh.prototype.raycast.call(mesh, raycaster, intersections);
    for (let i = intersections.length - 1; i >= start; i -= 1) {
      const { x, y } = intersections[i].uv;
      const col = MathUtils.clamp(Math.floor(x * canvas.width), 0, canvas.width - 1);
      const row = MathUtils.clamp(Math.floor((1 - y) * canvas.height), 0, canvas.height - 1);
      if (media.pixels[4 * (row * canvas.width + col) + 3] < media.cutoffByte) intersections.splice(i, 1);
    }
  };

  let lastX;
  let lastY;
  let lastProgress;
  let lastLift;
  let start;
  let span;
  const point = new Vector3();
  const direction = new Vector3();

  mesh.setPeel = (directionX, directionY, amount, extraLift = 0) => {
    const progress = MathUtils.clamp(amount, 0, 1);
    const lift = Math.max(extraLift, 0);
    const length = Math.hypot(directionX, directionY);
    const x = length > 0 ? directionX / length : 1;
    const y = length > 0 ? directionY / length : 0;
    if (x === lastX && y === lastY && progress === lastProgress && lift === lastLift) return;

    if (x !== lastX || y !== lastY) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < media.silhouette.length; i += 2) {
        const along = media.silhouette[i] * width * x + media.silhouette[i + 1] * height * y;
        min = Math.min(min, along);
        max = Math.max(max, along);
      }
      const halfRow = Math.abs(y) * height / (2 * canvas.height);
      start = max + halfRow;
      span = max - min + 2 * halfRow;
    }

    const travel = span * progress;
    const crease = start - travel;
    const bendRadius = span * (0.076 + 0.24 * progress * progress);
    const release = MathUtils.smoothstep(progress, 0.69, 1);
    const curl = MathUtils.lerp(2.64, 0.44, release);
    const arc = bendRadius * curl;

    function bend(px, py) {
      const distance = px * x + py * y - crease;
      if (!(travel > 0 && distance > 0)) {
        point.set(px, py, paperHeight);
        direction.set(0, 0, 1);
        return;
      }

      // The arc and its tangent have the same length as the original vinyl strip.
      const angle = Math.min(distance / bendRadius, curl);
      const sine = Math.sin(angle);
      const cosine = Math.cos(angle);
      const tail = Math.max(0, distance - arc);
      const tuck = bendRadius * sine + tail * cosine - distance;
      const rise = bendRadius * (1 - cosine) + tail * sine;
      const tip = Math.min(distance / travel, 1);
      const extra = lift * tip * tip * (3 - 2 * tip);
      const slope = sine + (6 * lift / travel) * tip * (1 - tip);
      const inverseNormalLength = 1 / Math.hypot(slope, cosine);
      point.set(px + x * tuck, py + y * tuck, paperHeight + rise + extra);
      direction.set(-x * slope * inverseNormalLength, -y * slope * inverseNormalLength, cosine * inverseNormalLength);
    }

    function writeLayers(attribute, front, back) {
      attribute.setXYZ(front, point.x, point.y, point.z);
      attribute.setXYZ(back, point.x - direction.x * paperThickness, point.y - direction.y * paperThickness,
        point.z - direction.z * paperThickness);
    }

    for (let i = 0; i < faceCount; i += 1) {
      bend(flat[3 * i], flat[3 * i + 1]);
      writeLayers(position, i, i + faceCount);
      normal.setXYZ(i, direction.x, direction.y, direction.z);
      normal.setXYZ(i + faceCount, direction.x, direction.y, direction.z);
    }
    for (let i = 0; i < media.outline.length; i += 2) {
      bend(media.outline[i] * width, media.outline[i + 1] * height);
      writeLayers(edgePosition, i, i + 1);
    }

    position.needsUpdate = true;
    normal.needsUpdate = true;
    edgePosition.needsUpdate = true;
    edgeGeometry.computeVertexNormals();
    geometry.boundingSphere.radius = radius + lift;
    edgeGeometry.boundingSphere.radius = radius + lift;
    lastX = x;
    lastY = y;
    lastProgress = progress;
    lastLift = lift;
  };

  mesh.dispose = () => {
    geometry.dispose();
    edgeGeometry.dispose();
    media.count -= 1;
    if (media.count === 0) {
      media.map.dispose();
      media.material.dispose();
      media.depth.dispose();
      media.edgeMaterial.dispose();
      sharedMedia.delete(canvas);
    }
  };

  mesh.setPeel(1, 0, 0);
  return mesh;
}
