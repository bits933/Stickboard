import * as THREE from 'three';

const daylightIntensity = 5.5;

function projectionTexture(data, size) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function blurAxis(source, output, size, radius, step) {
  const lineStride = step === 1 ? size : 1;
  const samples = 2 * radius + 1;
  for (let line = 0; line < size; line++) {
    const start = line * lineStride;
    let sum = source[start] * (radius + 1);
    for (let tap = 1; tap <= radius; tap++) sum += source[start + tap * step];
    for (let i = 0; i < size; i++) {
      output[start + i * step] = sum / samples;
      const enter = Math.min(i + radius + 1, size - 1);
      const leave = Math.max(i - radius, 0);
      sum += source[start + enter * step] - source[start + leave * step];
    }
  }
}

function sunlightTexture() {
  const size = 256;
  const data = new Uint8Array(size * size);
  // Each lobe is [center X, center Y, length, width, strength, angle].
  const lobes = [
    [-0.19, 0.20, 0.38, 0.113, 1.20, 0.64],
    [0.22, 0.18, 0.28, 0.061, 0.70, 0.59],
    [0.05, -0.042, 0.23, 0.080, 0.58, 0.65],
    [0.36, -0.07, 0.22, 0.095, 0.80, 0.85],
    [-0.20, -0.23, 0.29, 0.113, 1.22, 0.62],
    [-0.21, -0.23, 0.13, 0.062, 0.95, 0.48],
    [0.14, -0.15, 0.20, 0.089, 0.34, 0.60],
    [0.07, -0.38, 0.19, 0.070, 0.48, 0.92],
    [0.49, -0.29, 0.29, 0.093, 0.54, 0.85],
  ].map(([x, y, length, width, strength, angle]) => ({
    x, y, length, width, strength, cos: Math.cos(angle), sin: Math.sin(angle),
  }));

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const x = column / (size - 1) - 0.5;
      const y = row / (size - 1) - 0.5;
      const ripple = 0.032 * Math.sin(16 * x + 9 * y) + 0.016 * Math.cos(26 * y - 14 * x)
        + 0.007 * Math.sin(30 * x + 19 * y);
      const vignette = 1 / (1 + 4.5 * (x ** 4 + y ** 4) + 22 * x * x * y * y);
      let light = 0.016;

      for (const lobe of lobes) {
        const dx = x - lobe.x;
        const dy = y - lobe.y + ripple;
        const along = (dx * lobe.cos + dy * lobe.sin) / lobe.length;
        const across = (-dx * lobe.sin + dy * lobe.cos) / (lobe.width * 1.17);
        light += lobe.strength * Math.exp(-(along * along + across * across));
      }

      data[row * size + column] = Math.round(255 * (1 - Math.exp(-1.28 * light)) * vignette);
    }
  }

  return projectionTexture(data, size);
}

function patternedTexture(pattern) {
  const size = 128;
  const data = new Uint8Array(size * size);
  const { smoothstep } = THREE.MathUtils;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const x = column / (size - 1) - 0.5;
      const y = row / (size - 1) - 0.5;
      const u = x * 0.96 + y * 0.28;
      const v = y * 0.96 - x * 0.28;
      const spill = Math.exp(-(u * u * 12 + v * v * 10));
      let light = 0.91 * Math.exp(-(x * x * 18 + y * y * 15));
      if (pattern === 'window') {
        const frame = (1 - smoothstep(Math.abs(u), 0.18, 0.31)) * (1 - smoothstep(Math.abs(v), 0.24, 0.37));
        const panes = smoothstep(Math.abs(u), 0.003, 0.052) * smoothstep(Math.abs(v), 0.006, 0.056);
        light = 0.77 * frame * panes + 0.14 * spill;
      } else if (pattern === 'blinds') {
        const slats = smoothstep(Math.cos(v * 57), -0.58, 0.78);
        light = (0.19 + slats * 0.76) * spill;
      }
      data[row * size + column] = Math.round(255 * (0.012 + light));
    }
  }
  return projectionTexture(data, size);
}

const gridFragment = /* glsl */ `
  uniform vec3 boardInk;
  uniform vec3 boardHotTint;
  uniform float boardKeyPower;
  uniform float boardGridProgress;

  float boardHash(vec2 seed) {
    vec3 p = fract(vec3(seed.xyx) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  vec2 lineCoverage(vec2 distanceToLine, float width, vec2 pixel) {
    return 1.0 - smoothstep(vec2(width), vec2(width) + pixel, distanceToLine);
  }
`;

const gridSurface = /* glsl */ `
  vec2 p = boardWorldPosition.xy;
  vec2 pixel = max(fwidth(p), vec2(0.0001));
  vec2 majorDistance = abs(fract(p + 0.5) - 0.5);
  vec2 minorDistance = abs(fract(2.0 * p + 0.5) - 0.5) * 0.5;
  float marks = smoothstep(0.0, 0.24, boardGridProgress);
  float connect = smoothstep(0.34, 0.86, boardGridProgress);
  vec2 tip = mix(vec2(0.04), 0.5 + pixel.yx, connect);
  vec2 extension = 1.0 - smoothstep(tip - pixel.yx, tip, majorDistance.yx);
  vec2 major = lineCoverage(majorDistance, 0.0033, pixel * 0.68) * extension
    * smoothstep(0.34, 0.41, boardGridProgress);
  vec2 minor = lineCoverage(minorDistance, 0.0011, pixel * 0.62)
    * smoothstep(0.86, 1.0, boardGridProgress);

  vec2 arm = 1.0 - smoothstep(vec2(0.032), vec2(0.052), majorDistance);
  vec2 stem = 1.0 - smoothstep(vec2(0.005), vec2(0.005) + pixel, majorDistance);
  float crosshair = max(arm.x * stem.y, arm.y * stem.x) * marks;
  float halo = exp(-length(majorDistance) * 31.0) * 0.28 * marks;
  float ink = max(max(major.x, major.y) * 0.47, max(minor.x, minor.y) * 0.18);
  ink = max(ink, crosshair * 0.96);
  ink = min(1.0, ink + halo);

  float fibers = boardHash(floor(p * vec2(151.0, 219.0))) - 0.5;
  float film = boardHash(gl_FragCoord.xy) - 0.5;
  float pigment = 1.0 + 0.049 * fibers + 0.020 * film;
  float hot = smoothstep(0.24, 0.92, boardSunlight) * 0.28 * min(boardKeyPower, 1.0);
  vec3 painted = mix(diffuseColor.rgb, boardHotTint, hot) * pigment;
  diffuseColor.rgb = mix(painted, boardInk, ink);
`;

const projectedLighting = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n directLight.color *= boardSunlight;',
);

const diffusedBoardShadow = /* glsl */ `
  #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF )
    uniform vec2 boardShadowScale;

    float getBoardShadow(sampler2DShadow map, vec2 mapSize, float intensity, float bias, float radius, vec4 coord) {
      vec3 receiver = coord.xyz / coord.w;
      if (any(lessThan(receiver.xy, vec2(0.0))) || any(greaterThan(receiver.xy, vec2(1.0))) || receiver.z > 1.0) return 1.0;
      receiver.z += bias;
      vec2 texel = 1.0 / mapSize;
      float rotation = interleavedGradientNoise(gl_FragCoord.xy) * PI2;
      float searchRadius = max(radius, 0.138 * boardShadowScale.y);

      // shortcut: estimate blocker distance at two depths, use raw depth for a calibrated light size.
      float lifted = 0.0;
      for (int i = 0; i < 8; i++) {
        vec2 uv = receiver.xy + vogelDiskSample(i, 8, rotation) * texel * searchRadius;
        lifted += 1.0 - texture(map, vec3(uv, receiver.z - 0.24 * boardShadowScale.x));
      }
      if (lifted == 0.0) return getShadow(map, mapSize, intensity, bias, radius, coord);

      float distant = 0.0;
      for (int i = 0; i < 8; i++) {
        vec2 uv = receiver.xy + vogelDiskSample(i, 8, rotation) * texel * searchRadius;
        distant += 1.0 - texture(map, vec3(uv, receiver.z - 0.82 * boardShadowScale.x));
      }
      float spread = mix(0.045, 0.138, distant / lifted);
      float penumbra = mix(radius, max(radius, spread * boardShadowScale.y), smoothstep(0.0, 2.0, lifted));
      float visible = 0.0;
      for (int i = 0; i < 16; i++) {
        vec2 uv = receiver.xy + vogelDiskSample(i, 16, rotation) * texel * penumbra;
        visible += texture(map, vec3(uv, receiver.z));
      }
      return mix(1.0, visible / 16.0, intensity);
    }
  #else
    #define getBoardShadow getShadow
  #endif
`;

const boardLighting = projectedLighting.replace('getShadow( directionalShadowMap', 'getBoardShadow( directionalShadowMap');

// Cover the PCF footprint at grazing angles without offsetting the board's contact shadows.
const itemLighting = projectedLighting.replace(
  'directionalLightShadow = directionalLightShadows[ i ];',
  /* glsl */ `
    directionalLightShadow = directionalLightShadows[ i ];
    float facingSun = max(0.42, abs(dot(geometryNormal, directLight.direction)));
    float shadowSlope = sqrt(max(0.0, 1.0 - facingSun * facingSun)) / facingSun;
    directionalLightShadow.shadowBias -= boardShadowFootprint * shadowSlope;
  `,
);

const vinylLighting = `vec3 vinylKeyDirection = vec3(0.0, 0.0, 1.0);
  vec3 vinylKeyRadiance = vec3(0.0);
` + itemLighting.replace(
  /(#if defined\( USE_SHADOWMAP \) && \( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS \)[\s\S]*?#endif)/,
  '$1\n vinylKeyDirection = directLight.direction;\n vinylKeyRadiance = directLight.color;',
);

export function createBoard(scene) {
  const sunlight = new THREE.DirectionalLight('#fff5e3', daylightIntensity);
  sunlight.position.set(11, 9, 8);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.near = 0.5;
  sunlight.shadow.camera.far = 38;
  sunlight.shadow.bias = -0.000035;
  sunlight.shadow.normalBias = 0.0015;
  sunlight.shadow.radius = 3.25;
  sunlight.shadow.intensity = 0.88;

  const fill = new THREE.HemisphereLight('#e4f3fc', '#42644b', 0.78);
  fill.position.set(-2, 1, 5);
  scene.add(sunlight, fill);

  const viewSize = { value: new THREE.Vector2(1, 1) };
  const cookie = { value: sunlightTexture() };
  const patterns = new Map([['dappled', cookie.value]]);
  const blurScratch = new Float32Array(cookie.value.image.data.length);
  let blurredCookie;
  let blur = 0;
  const placement = new THREE.Vector2(1, 1);
  const projectionShift = { value: new THREE.Vector2() };
  const keyPower = { value: 1 };
  const gridProgress = { value: 1 };
  let lightProgress = 1;
  let lightIntensity = 1;
  let pattern = 'dappled';
  const lightDrift = { value: new THREE.Vector3() };
  const sunSlope = { value: new THREE.Vector2(sunlight.position.x, sunlight.position.y).divideScalar(sunlight.position.z) };
  const shadowFootprint = { value: 0 };
  const shadowScale = { value: new THREE.Vector2() };
  const boardInk = { value: new THREE.Color('#edf1c5') };
  const boardHotTint = { value: new THREE.Color('#bcc972') };
  const warmWhite = new THREE.Color('#f4f0da');

  function applyLighting(material, surface) {
    const compileMaterial = material.onBeforeCompile;
    const materialKey = material.customProgramCacheKey();
    const paintedGrid = surface === 'board';
    material.customProgramCacheKey = () => `${materialKey}:${surface}`;
    material.onBeforeCompile = (shader, renderer) => {
      compileMaterial.call(material, shader, renderer);
      Object.assign(shader.uniforms, {
        boardViewSize: viewSize, boardCookie: cookie, boardLightDrift: lightDrift, boardProjectionShift: projectionShift,
        boardSunSlope: sunSlope, boardShadowFootprint: shadowFootprint,
      });
      shader.vertexShader = 'varying vec3 boardWorldPosition;\n' + shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
          #include <worldpos_vertex>
          vec4 projectedPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            projectedPosition = instanceMatrix * projectedPosition;
          #endif
          boardWorldPosition = (modelMatrix * projectedPosition).xyz;
        `,
      );
      shader.fragmentShader = /* glsl */ `
        varying vec3 boardWorldPosition;
        uniform vec2 boardViewSize;
        uniform sampler2D boardCookie;
        uniform vec3 boardLightDrift;
        uniform vec2 boardProjectionShift;
        uniform vec2 boardSunSlope;
        uniform float boardShadowFootprint;
      ` + shader.fragmentShader
        .replace('#include <color_fragment>', /* glsl */ `
          vec2 projected = boardWorldPosition.xy - boardWorldPosition.z * boardSunSlope;
          vec2 windowUV = projected / boardViewSize;
          vec2 sway = vec2(-windowUV.y, windowUV.x) * boardLightDrift.z;
          vec2 projection = windowUV + boardProjectionShift + boardLightDrift.xy + sway;
          float falloff = 1.0 - smoothstep(0.50, 0.66, max(abs(projection.x), abs(projection.y)));
          float boardSunlight = texture2D(boardCookie, projection + 0.5).r * falloff;
          #include <color_fragment>
        `)
        .replace('#include <lights_fragment_begin>', paintedGrid ? boardLighting : surface === 'vinyl' ? vinylLighting : itemLighting);

      if (paintedGrid) {
        Object.assign(shader.uniforms, { boardInk, boardHotTint, boardKeyPower: keyPower, boardGridProgress: gridProgress, boardShadowScale: shadowScale });
        shader.fragmentShader = gridFragment + shader.fragmentShader.replace(
          '#include <shadowmap_pars_fragment>',
          '#include <shadowmap_pars_fragment>\n' + diffusedBoardShadow,
        ).replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n' + gridSurface,
        );
      }
    };
    return material;
  }

  const material = applyLighting(new THREE.MeshStandardMaterial({ color: '#5b843e', roughness: 0.86 }), 'board');
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.receiveShadow = true;
  scene.add(mesh);

  function shiftProjection() {
    const { x, y } = placement;
    if (pattern === 'dappled') projectionShift.value.set(0.13 * (1 - x), 0.12 * (1 - y));
    else projectionShift.value.set(-0.22 * x, -0.20 * y);
  }

  function updateCookie() {
    const sharp = patterns.get(pattern);
    const { data, width } = sharp.image;
    const radius = Math.round(blur * width * 0.11);
    if (!radius) {
      cookie.value = sharp;
      return;
    }
    if (blurredCookie?.image.width !== width) {
      blurredCookie?.dispose();
      blurredCookie = projectionTexture(new Uint8ClampedArray(data.length), width);
    }
    const output = blurredCookie.image.data;
    // Three box passes approximate a Gaussian without extra samples in the render loop.
    for (let pass = 0; pass < 3; pass++) {
      blurAxis(pass === 0 ? data : output, blurScratch, width, radius, 1);
      blurAxis(blurScratch, output, width, radius, width);
    }
    blurredCookie.needsUpdate = true;
    cookie.value = blurredCookie;
  }

  function setLightPattern(name) {
    pattern = name;
    if (!patterns.has(name)) patterns.set(name, patternedTexture(name));
    updateCookie();
    shiftProjection();
  }

  function setLightBlur(amount) {
    blur = THREE.MathUtils.clamp(amount, 0, 1);
    updateCookie();
  }

  function setLightIntensity(intensity) {
    lightIntensity = intensity;
    keyPower.value = intensity * lightProgress;
    sunlight.intensity = daylightIntensity * keyPower.value;
  }

  function setStartup(grid, light) {
    gridProgress.value = THREE.MathUtils.clamp(grid, 0, 1);
    lightProgress = THREE.MathUtils.clamp(light, 0, 1);
    setLightIntensity(lightIntensity);
  }

  function setLightPlacement(x, y) {
    placement.set(x, y);
    sunlight.position.set(11 * x, 9 * y, 8);
    sunSlope.value.set(sunlight.position.x, sunlight.position.y).divideScalar(sunlight.position.z);
    shiftProjection();
  }

  function setColor(hex) {
    const base = material.color.set(hex);
    if (hex === '#5b843e') {
      boardInk.value.set('#edf1c5');
      boardHotTint.value.set('#bcc972');
      return;
    }
    const brightness = base.r * 0.2126 + base.g * 0.7152 + base.b * 0.0722;
    boardInk.value.copy(base);
    if (brightness > 0.52) boardInk.value.multiplyScalar(0.50);
    else boardInk.value.lerp(warmWhite, 0.76);
    boardHotTint.value.copy(base).lerp(warmWhite, 0.21);
  }

  function resize(width, height) {
    viewSize.value.set(width, height);
    mesh.scale.set(width * 1.02, height * 1.02, 1);

    const bounds = Math.hypot(width, height) / 2 + 1.4;
    Object.assign(sunlight.shadow.camera, {
      left: -bounds, right: bounds, top: bounds, bottom: -bounds,
    });
    const depthRange = sunlight.shadow.camera.far - sunlight.shadow.camera.near;
    shadowScale.value.set(1 / depthRange, sunlight.shadow.mapSize.x / (2 * bounds));
    shadowFootprint.value = (sunlight.shadow.radius + 1) * (2 * bounds / sunlight.shadow.mapSize.x) / depthRange;
    sunlight.shadow.camera.updateProjectionMatrix();
  }

  function driftLight(seconds) {
    lightDrift.value.set(
      0.011 * Math.sin(seconds * 0.34) + 0.004 * Math.sin(seconds * 0.17),
      0.007 * Math.sin(seconds * 0.27) - 0.004 * Math.sin(seconds * 0.46),
      0.015 * Math.sin(seconds * 0.21),
    );
  }

  return { mesh, resize, setColor, driftLight, setLightPattern, setLightIntensity, setLightPlacement, setLightBlur, setStartup,
    lightMaterial: (material, vinyl = false) => applyLighting(material, vinyl ? 'vinyl' : 'prop') };
}
