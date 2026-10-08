// The open world: painted terrain, landmarks, scattered scenery, sky, day/night, colliders.
import * as THREE from "three";
import { spawn, sizeOf, rimLight, mergedGeometry, material } from "./assets.js";
import { Puppet } from "./puppet.js";
import { Props } from "./props.js";

export const WORLD_R = 270; // walkable radius
const NO_COLLIDERS = [];
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
export const PLACES = {
  mushroom: new THREE.Vector3(0, 0, 0),
  village: new THREE.Vector3(-58, 0, 48),
  oak: new THREE.Vector3(-40, 0, 6),
  woods: new THREE.Vector3(72, 0, -62),
  pond: new THREE.Vector3(-64, 0, -58),
  hill: new THREE.Vector3(74, 0, 70),
};
export const MUSHROOM_SCALE = 7;

// --- noise & terrain height ------------------------------------------------------------------
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const dist2 = (x, z, p) => Math.hypot(x - p.x, z - p.z);

// Dirt paths between the landmarks, and a stream running out of the Lily Pond to the edge of the world.
export const PATHS = [
  [[-48, 40], [-30, 26], [-14, 12], [-6, 5]],               // village -> Mushroom Tree
  [[-30, 26], [-36, 12]],                                  // -> Wizard Oak
  [[6, -4], [30, -25], [55, -48]],                          // -> Pine Woods
  [[6, 6], [35, 35], [60, 56]],                             // -> Oak Ring hill
  [[-6, -6], [-30, -30], [-46, -44]],                       // -> Lily Pond
  [[-62, 36], [-82, 0], [-76, -34]],                        // village -> pond, west
  [[0, -8], [4, -60], [2, -110], [-20, -150], [-38, -165]], // south, over the stream to the viewpoint
];
export const STREAM = [[-52, -80], [-36, -100], [-12, -112], [20, -110], [48, -100], [80, -112], [120, -130], [175, -152], [235, -178], [320, -210]];

function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
function polyDist(x, z, pl) {
  let d = Infinity;
  for (let i = 1; i < pl.length; i++) d = Math.min(d, segDist(x, z, pl[i - 1][0], pl[i - 1][1], pl[i][0], pl[i][1]));
  return d;
}
export function pathDist(x, z) {
  let d = Infinity;
  for (const p of PATHS) d = Math.min(d, polyDist(x, z, p));
  return d;
}
export function streamDist(x, z) { return polyDist(x, z, STREAM); }
/** 0..1: how much of a flower meadow this spot is. */
export function meadow(x, z) { return Math.max(0, Math.min(1, (vnoise(x / 46 + 3.3, z / 46 - 7.1) - 0.6) / 0.14)); }

/** Where the south path crosses the stream (the bridge), and the stream's direction there. */
function findBridge() {
  const P = PATHS[6];
  let best = null;
  for (let i = 1; i < P.length; i++) {
    for (let k = 0; k <= 60; k++) {
      const u = k / 60, x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * u, z = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * u;
      const d = streamDist(x, z);
      if (!best || d < best.d) best = { d, x, z, dir: [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]] };
    }
  }
  const l = Math.hypot(best.dir[0], best.dir[1]);
  return { x: best.x, z: best.z, dx: best.dir[0] / l, dz: best.dir[1] / l };
}

export function terrainHeight(x, z) {
  let h = 5 * vnoise(x / 70, z / 70) + 2.2 * vnoise(x / 28 + 9, z / 28 - 4) + 0.6 * vnoise(x / 9, z / 9);
  h -= 3.5;
  // Hilltop ring.
  const dh = dist2(x, z, PLACES.hill);
  h += 13 * Math.exp(-(dh * dh) / (2 * 26 * 26));
  // Rolling rim towards the edge of the world.
  const r = Math.hypot(x, z);
  h += 22 * sm(WORLD_R - 40, WORLD_R + 60, r);
  // Flat ground where things stand.
  for (const [p, rad] of [[PLACES.mushroom, 34], [PLACES.village, 30], [PLACES.oak, 10]]) {
    const f = 1 - sm(rad * 0.6, rad, dist2(x, z, p));
    h = h * (1 - f) + 0.3 * f;
  }
  // Pond basin with an island.
  const dp = dist2(x, z, PLACES.pond);
  h -= 4.2 * (1 - sm(14, 26, dp));
  h += 3.6 * (1 - sm(3, 7.5, dp));
  // The stream's channel, cut through everything else.
  const sd = polyDist(x, z, STREAM);
  if (sd < 7) h -= 2.3 * (1 - sm(1.6, 5.5, sd));
  // Paths are trodden a little lower than the meadow.
  const pd = pathDist(x, z);
  if (pd < 2.6) h -= 0.14 * (1 - sm(0.8, 2.4, pd));
  return h;
}
export const BRIDGE = findBridge();
export const WATER_Y = -1.6;

// --- painted canvas textures -------------------------------------------------------------------
function canvasTex(w, h, draw, repeat = null) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}
function washTexture() {
  // Soft watercolour blotches and paper grain, tiled over the ground.
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + Math.random() * 0.08;
      gr.addColorStop(0, `rgba(${200 + Math.random() * 40},${215 + Math.random() * 30},${170 + Math.random() * 40},${a})`);
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill(); }
    }
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }, 40);
}
function strokeTexture() {
  // R: short brush strokes; G: broad wash blotches. Both tile.
  const N = 512;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  g.fillStyle = "rgb(128,128,0)"; g.fillRect(0, 0, N, N);
  let k = 7;
  const r = () => { k = (k * 16807) % 2147483647; return k / 2147483647; };
  for (let i = 0; i < 900; i++) {
    const x = r() * N, y = r() * N, len = 8 + r() * 26, a = r() * Math.PI, v = Math.floor(r() * 255);
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
      g.strokeStyle = `rgba(${v},128,0,0.28)`; g.lineWidth = 2 + r() * 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len); g.stroke();
    }
  }
  const img = g.getImageData(0, 0, N, N);
  // Broad blotches in G.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N * 6.283, v = y / N * 6.283;
    const b = 0.5 + 0.25 * Math.sin(u * 2 + Math.sin(v * 3) * 1.3) * Math.cos(v * 2 + Math.sin(u * 1.7)) + 0.25 * Math.sin(u * 5 + v * 3);
    img.data[(y * N + x) * 4 + 1] = Math.max(0, Math.min(255, b * 255));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function tuftTexture(colors) {
  return canvasTex(128, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = 20 + Math.random() * 88, lean = (Math.random() - 0.5) * 40;
      g.strokeStyle = colors[i % colors.length];
      g.globalAlpha = 0.55 + Math.random() * 0.4;
      g.lineWidth = 2 + Math.random() * 3;
      g.lineCap = "round";
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + lean * 0.3, h * 0.5, x + lean, 10 + Math.random() * 40); g.stroke();
    }
  });
}
function blobTexture(rgb) {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.5, `rgba(${rgb},0.6)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
function cloudTexture(seed = 1) {
  let k = seed;
  const r = () => { k = (k * 16807) % 2147483647; return k / 2147483647; };
  return canvasTex(256, 128, (g, w, h) => {
    const puffs = [];
    for (let i = 0; i < 22; i++) puffs.push([30 + r() * 196, 60 + (r() - 0.5) * 30 - Math.sin((i / 22) * Math.PI) * 20, 14 + r() * 23]);
    // Shaded undersides first, then bright tops offset upwards.
    for (const [x, y, rad] of puffs) {
      const gr = g.createRadialGradient(x, y + 5, 0, x, y + 5, rad);
      gr.addColorStop(0, "rgba(214,206,226,0.85)"); gr.addColorStop(1, "rgba(214,206,226,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y + 5, rad, 0, 7); g.fill();
    }
    for (const [x, y, rad] of puffs) {
      const gr = g.createRadialGradient(x - rad * 0.2, y - rad * 0.3, 0, x, y - 3, rad * 0.9);
      gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.6, "rgba(255,253,250,0.6)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y - 3, rad * 0.9, 0, 7); g.fill();
    }
    // Dry-brush speckle at the edges.
    const img = g.getImageData(0, 0, w, h);
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 10 && img.data[i] < 120 && r() < 0.35) img.data[i] *= 0.4;
    g.putImageData(img, 0, 0);
  });
}

// --- time of day ----------------------------------------------------------------------------------
const KEYS = [
  // t,    zenith,    horizon,   sun colour, sun I, hemi I
  [0.00, "#141633", "#3d4475", "#a8b8ff", 0.35, 0.6],
  [0.22, "#2a2f5e", "#c79bb8", "#ffc0a8", 0.5, 0.45],
  [0.30, "#b4c3ee", "#ffd6df", "#ffe0d0", 1.9, 1.3],
  [0.42, "#9fcdec", "#fbead2", "#fff4e0", 2.8, 1.7],
  [0.62, "#a6cdea", "#fbe7cf", "#fff0dc", 2.7, 1.65],
  [0.72, "#b9a8dc", "#ffc59a", "#ffc488", 2.1, 1.3],
  [0.80, "#6d5c9e", "#ff9f8a", "#ff9f7a", 1.1, 0.9],
  [0.88, "#1d2048", "#4a4a80", "#a8b8ff", 0.4, 0.6],
  [1.00, "#141633", "#3d4475", "#a8b8ff", 0.35, 0.6],
];
const cA = new THREE.Color(), cB = new THREE.Color();
function sampleTime(t) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] < t) i++;
  const [t0, z0, h0, s0, si0, hi0] = KEYS[i], [t1, z1, h1, s1, si1, hi1] = KEYS[i + 1];
  const u = (t - t0) / (t1 - t0);
  const mix = (a, b) => cA.set(a).lerp(cB.set(b), u).clone();
  return { zenith: mix(z0, z1), horizon: mix(h0, h1), sun: mix(s0, s1), sunI: si0 + (si1 - si0) * u, hemiI: hi0 + (hi1 - hi0) * u };
}

export class World {
  constructor(scene, { low = false } = {}) {
    this.scene = scene;
    this.low = low;
    this.colliders = []; // {x, z, r, top} solid cylinders
    this.platforms = []; // {x, z, r, y, visible} standable discs
    this.time = 0.33; // morning
    this.dayLength = 480; // seconds per day
    this.animated = [];
    this.cloudTime = { value: new THREE.Vector2() };
    this.windTime = { value: 0 };
    this.trees = [];
    this.scenery = []; // instanced static models: {kind, x, z, y, rot, scale, r, collider, mesh, index, matrix, hidden}
    const T = (label, f) => { const t0 = performance.now(); f(); console.log(`[load] ${label} ${Math.round(performance.now() - t0)}ms`); };
    T("sky", () => this.buildSky());
    T("lights", () => this.buildLights());
    T("terrain", () => this.buildTerrain());
    T("water", () => this.buildWater());
    T("landmarks", () => this.buildLandmarks());
    T("scatter", () => this.scatter());
    T("scenery", () => this.buildScenery());
    T("props", () => { this.props = new Props(this); });
    T("grass", () => this.buildGrass());
    T("fireflies", () => this.buildFireflies());
    T("ao", () => this.bakeAO());
  }

  // Sky dome with a gradient that follows the time of day, plus stars and clouds.
  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, night: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform float night; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){
          float y = max(vP.y, 0.0);
          vec3 c = mix(horizon, zenith, pow(smoothstep(0.0, 0.6, y), 0.8));
          vec3 cell = floor(vP*220.0);
          float st = step(0.9965, h(cell)) * smoothstep(0.05, 0.3, y) * night;
          c += vec3(st);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.scene.add(this.sky);
    const cts = [cloudTexture(3), cloudTexture(11), cloudTexture(29)];
    this.clouds = [];
    for (let i = 0; i < 34; i++) {
      const high = i >= 24;
      const m = new THREE.SpriteMaterial({ map: cts[i % 3], transparent: true, opacity: high ? 0.45 : 0.9, depthWrite: false, fog: false });
      const s = new THREE.Sprite(m);
      const a = Math.random() * Math.PI * 2, r = 240 + Math.random() * 380;
      s.position.set(Math.cos(a) * r, (high ? 130 : 60) + Math.random() * 60, Math.sin(a) * r);
      s.scale.set((high ? 220 : 130) + Math.random() * 100, (high ? 40 : 60) + Math.random() * 30, 1);
      this.scene.add(s);
      this.clouds.push(s);
    }
    this.scene.fog = new THREE.Fog(0xfbead2, 90, 520);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x9fbf8a, 0.9);
    this.scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xfff4e0, 2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 300;
    this.sunLight.shadow.bias = -0.0006;
    this.sunLight.shadow.normalBias = 0.04;
    this.scene.add(this.sunLight, this.sunLight.target);
    // The painted sun with a face, far in the sky.
    this.sunPuppet = spawn("sun", 9);
    this.scene.add(this.sunPuppet);
    this.sunPuppet.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = o.material.clone(); o.material.fog = false; } });
    // A soft halo behind the sun (bright enough to bloom).
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: blobTexture("255,240,210"), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
    this.sunGlow.scale.setScalar(150);
    this.scene.add(this.sunGlow);
  }

  buildTerrain() {
    const size = 700, seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = [];
    const grass1 = new THREE.Color("#a9d09b"), grass2 = new THREE.Color("#d6e6b4"), sand = new THREE.Color("#efe1bf"), hillc = new THREE.Color("#c2d8b4");
    const dirt = new THREE.Color("#e6d2aa"), dirt2 = new THREE.Color("#d7bf94"), bloom = new THREE.Color("#ecd9e2"), sun = new THREE.Color("#f1e9b7");
    const cool = new THREE.Color("#9fc6a6"), bank = new THREE.Color("#c9d9b0"), rock = new THREE.Color("#cbc3cc");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      const n = vnoise(x / 18, z / 18), n2 = vnoise(x / 6 + 40, z / 6 - 3);
      const c = grass1.clone().lerp(grass2, n * 0.9);
      c.lerp(cool, Math.max(0, vnoise(x / 60 - 9, z / 60 + 5) - 0.55) * 1.4); // cooler, lusher patches
      const m = meadow(x, z);
      if (m > 0) c.lerp(n2 > 0.5 ? bloom : sun, m * 0.45);
      const pd = pathDist(x, z);
      if (pd < 2.4) c.lerp(dirt.clone().lerp(dirt2, n2), (1 - sm(0.7 + n2 * 0.6, 2.4, pd)) * 0.9);
      const sd = streamDist(x, z);
      if (sd < 6) c.lerp(bank, (1 - sm(2.5, 6, sd)) * 0.6);
      if (y < WATER_Y + 0.8) c.lerp(sand, 0.8);
      if (y > 9) c.lerp(hillc, Math.min(1, (y - 9) / 10));
      const rim = Math.hypot(x, z);
      if (rim > WORLD_R + 2) c.lerp(rock, Math.min(0.7, (rim - WORLD_R) / 40));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: washTexture() });
    // Brushwork: two scales of soft directional strokes in world space, so the ground reads as painted.
    const strokes = strokeTexture();
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.strokeMap = { value: strokes };
      sh.uniforms.cloudTime = this.cloudTime;
      sh.vertexShader = "varying vec2 vGroundXZ;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        vGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
      sh.fragmentShader = "uniform sampler2D strokeMap; uniform vec2 cloudTime; varying vec2 vGroundXZ;\n" + sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
        float cloud = texture2D(strokeMap, vGroundXZ * 0.0035 + cloudTime).g;
        diffuseColor.rgb *= 1.0 - 0.16 * smoothstep(0.55, 0.75, cloud);
        float s1 = texture2D(strokeMap, vGroundXZ * 0.085).r;
        float s2 = texture2D(strokeMap, vGroundXZ * 0.021 + vec2(0.37, 0.11)).g;
        diffuseColor.rgb *= 0.86 + 0.16 * s1 + 0.1 * s2;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.04, 1.0, 0.92), s2 * 0.5);`);
    };
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  buildWater() {
    this.streamPts = STREAM;
    this.waterUniforms = {
      time: { value: 0 }, zenith: { value: new THREE.Color("#9fcdec") }, horizon: { value: new THREE.Color("#fbead2") },
      deep: { value: new THREE.Color("#7fb3cf") }, shallow: { value: new THREE.Color("#c3e4e4") }, night: { value: 0 },
    };
    const common = `
      uniform float time, night; uniform vec3 zenith, horizon, deep, shallow;
      varying vec3 vW; varying vec2 vUv;
      float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hsh(i), hsh(i+vec2(1,0)), f.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), f.x), f.y); }
      vec3 ripple(vec2 p, vec2 flow){
        float a = vn(p * 0.9 + flow * time) , b = vn(p * 2.1 - flow.yx * time * 1.3);
        return normalize(vec3((a - 0.5) * 0.6 + (b - 0.5) * 0.35, 1.0, (vn(p * 1.3 + 7.0 + flow * time) - 0.5) * 0.6));
      }
      vec3 paintWater(vec3 n, float shoreT, float depthT){
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(V, n), 0.0), 3.0);
        vec3 R = reflect(-V, n);
        vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.6, R.y));
        vec3 body = mix(shallow, deep, depthT);
        vec3 c = mix(body, sky, 0.25 + 0.55 * fres);
        float glint = pow(max(dot(R, normalize(vec3(0.4, 0.7, 0.3))), 0.0), 60.0) * (1.0 - night);
        c += glint * 0.6;
        // Soft foam where the water meets the bank, broken up like dry-brush.
        float foam = smoothstep(0.0, 1.0, shoreT) * smoothstep(0.35, 0.75, vn(vW.xz * 1.6 + time * 0.3));
        c = mix(c, vec3(1.0), foam * 0.55);
        return c * mix(1.0, 0.45, night);
      }`;
    const vert = `varying vec3 vW; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`;
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true, fog: true, uniforms: { ...THREE.UniformsLib.fog, ...this.waterUniforms },
      vertexShader: vert,
      fragmentShader: common + `
        #include <fog_pars_fragment>
        void main(){
          float r = length(vUv - 0.5) * 2.0;           // 0 centre .. 1 shore
          vec3 n = ripple(vW.xz * 0.6, vec2(0.05, 0.03));
          vec3 c = paintWater(n, smoothstep(0.8, 0.98, r), 1.0 - smoothstep(0.25, 0.9, r));
          float a = 0.9 * (1.0 - smoothstep(0.93, 1.0, r));
          gl_FragColor = vec4(c, a);
          #include <fog_fragment>
        }`,
    });
    const w = new THREE.Mesh(new THREE.CircleGeometry(28, 64), this.waterMat);
    w.rotation.x = -Math.PI / 2;
    w.position.set(PLACES.pond.x, WATER_Y, PLACES.pond.z);
    this.scene.add(w);
    // The stream: a ribbon following the channel, flowing away from the pond.
    const L = [], pts = [];
    const S = STREAM;
    for (let i = 1; i < S.length; i++) {
      const a = S[i - 1], b = S[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.ceil(len / 2);
      for (let k = 0; k < steps; k++) pts.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
    }
    pts.push(S[S.length - 1]);
    const pos = [], uv = [], idx = [];
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      const dx = q[0] - o[0], dz = q[1] - o[1], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l, hw = 2.6;
      if (i) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const y = Math.max(WATER_Y, terrainHeight(p[0], p[1]) + 0.7);
      pos.push(p[0] + nx * hw, y, p[1] + nz * hw, p[0] - nx * hw, y, p[1] - nz * hw);
      uv.push(0, along, 1, along);
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    sg.setIndex(idx);
    this.streamMat = new THREE.ShaderMaterial({
      transparent: true, fog: true, uniforms: { ...THREE.UniformsLib.fog, ...this.waterUniforms },
      vertexShader: vert,
      fragmentShader: common + `
        #include <fog_pars_fragment>
        void main(){
          float edge = abs(vUv.x - 0.5) * 2.0;
          vec2 flowUv = vec2(vUv.x * 3.0, vUv.y * 0.35 - time * 0.9);
          vec3 n = ripple(flowUv * 2.0, vec2(0.0, 0.0));
          vec3 c = paintWater(n, smoothstep(0.6, 0.95, edge), 0.5 - edge * 0.5);
          float streak = smoothstep(0.62, 0.95, vn(vec2(vUv.x * 9.0, vUv.y * 0.6 - time * 1.4)));
          c = mix(c, vec3(1.0), streak * 0.25);
          gl_FragColor = vec4(c, 0.85 * (1.0 - smoothstep(0.85, 1.0, edge)));
          #include <fog_fragment>
        }`,
    });
    const stream = new THREE.Mesh(sg, this.streamMat);
    stream.renderOrder = 1;
    this.scene.add(stream);
    this.animated.push((dt, t) => { this.waterUniforms.time.value = t; });
    // Lily pads, some with a flower.
    const padMat = new THREE.MeshLambertMaterial({ color: "#8fc38a", emissive: new THREE.Color(0.12, 0.16, 0.1) });
    const flowerMat = new THREE.MeshLambertMaterial({ color: "#ffd1e2", emissive: new THREE.Color(0.35, 0.25, 0.3) });
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 7, r = 9 + Math.random() * 15;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.8 + Math.random() * 0.7, 14, 0.3, 5.8), padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = Math.random() * 6;
      pad.position.set(PLACES.pond.x + Math.cos(a) * r, WATER_Y + 0.03, PLACES.pond.z + Math.sin(a) * r);
      this.scene.add(pad);
      if (i % 3 === 0) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.25, 7, 1, true), flowerMat);
        f.position.copy(pad.position).add(new THREE.Vector3(0.1, 0.12, 0));
        f.rotation.x = Math.PI;
        this.scene.add(f);
      }
    }
  }

  /**
   * Put a model in the world. Scenery is batched into one InstancedMesh per model (see buildScenery):
   * the return value is its entry in `this.scenery`. Landmarks pass `individual: true` and get a real
   * object hierarchy back (they animate or are looked up by quests).
   */
  place(name, x, z, { scale = 1, rot = Math.random() * 6.28, collide = 0.35, top = 4, individual = false } = {}) {
    if (!individual) {
      const y = terrainHeight(x, z);
      const collider = collide ? { x, z, r: collide * scale, top: y + top * scale } : null;
      if (collider) this.colliders.push(collider);
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(scale, scale, scale));
      const entry = { kind: name, x, z, y, rot, scale, r: collider ? collider.r : 0, collider, matrix, hidden: false };
      this.scenery.push(entry);
      return entry;
    }
    const o = spawn(name, scale);
    o.position.set(x, terrainHeight(x, z), z);
    o.rotation.y = rot;
    this.scene.add(o);
    if (collide) this.colliders.push({ x, z, r: collide * scale, top: o.position.y + top * scale });
    if (name.startsWith("tree") && scale < 3) this.trees.push({ o, inner: o.children[0], phase: Math.random() * 6, s: name === "tree_pine" ? 0.6 : 1 });
    return o;
  }

  buildLandmarks() {
    // The Great Mushroom Tree.
    const M = PLACES.mushroom;
    this.mushroom = this.place("tree_magic", M.x, M.z, { scale: MUSHROOM_SCALE, rot: 0.4, collide: 0.55, individual: true });
    const ms = sizeOf("tree_magic", MUSHROOM_SCALE);
    this.capY = terrainHeight(M.x, M.z) + ms.y * 0.93;
    // The cap is a big soft platform (its centre is offset with the stem's lean).
    const box = new THREE.Box3().setFromObject(this.mushroom);
    const capC = new THREE.Vector3(); box.getCenter(capC);
    this.capCentre = new THREE.Vector3(capC.x, this.capY, capC.z);
    this.capR = Math.min(ms.x, ms.z) * 0.5;
    this.platforms.push({ x: capC.x, z: capC.z, r: this.capR * 0.9, y: box.max.y - 0.6, visible: true, name: "cap" });
    this.capTop = box.max.y - 0.6;

    // Mushroom stairs: floating painted pads spiralling up the stem (revealed by the paint drops).
    this.stairs = [];
    const padMat = new THREE.MeshLambertMaterial({ color: "#f3b7c9", emissive: "#5a3a44" });
    // A spiral that hugs the stem low down and widens to end just outside the cap's rim, so the
    // last hop lands on top. Each step is a comfortable jump (~1.1 m up, ~3 m along).
    const base = terrainHeight(M.x, M.z);
    const n = Math.ceil((this.capTop - base) / 1.1);
    const r0 = 0.55 * MUSHROOM_SCALE + 3.2, r1 = this.capR + 1.7;
    let a = 1.2;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const r = r0 + (r1 - r0) * u * u;
      a += 3.0 / r;
      const y = base + 1.0 + u * (this.capTop + 0.2 - base - 1.0);
      const cx = M.x + (capC.x - M.x) * u, cz = M.z + (capC.z - M.z) * u;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.2, 0.35, 18), padMat);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      pad.position.set(x, y, z);
      pad.castShadow = true; pad.receiveShadow = true;
      pad.visible = false;
      this.scene.add(pad);
      const plat = { x, z, r: 1.55, y: y + 0.17, visible: false, mesh: pad };
      this.platforms.push(plat);
      this.stairs.push(plat);
    }

    // Village.
    const V = PLACES.village;
    this.cottage = this.place("house", V.x, V.z, { scale: 1.4, rot: 0.5, collide: 1.9, top: 4.5 });
    this.place("house", V.x - 14, V.z + 8, { scale: 1.15, rot: -0.4, collide: 1.9 });
    this.place("house", V.x + 12, V.z + 12, { scale: 1.2, rot: 2.6, collide: 1.9 });
    this.place("house", V.x - 4, V.z + 20, { scale: 1.0, rot: 3.3, collide: 1.9 });
    this.place("tree_oak", V.x + 18, V.z - 4, { scale: 1.1 });
    this.place("tree_magic", V.x - 18, V.z - 6, { scale: 1.2 });

    // Wizard Oak.
    const O = PLACES.oak;
    this.wizardOak = this.place("tree_oak", O.x, O.z, { scale: 2.3, rot: 2.4, collide: 0.5, individual: true });

    // Pine Woods.
    const W = PLACES.woods;
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * 7, r = 6 + Math.sqrt(Math.random()) * 40;
      const x = W.x + Math.cos(a) * r, z = W.z + Math.sin(a) * r;
      if (streamDist(x, z) < 6 || pathDist(x, z) < 3) continue;
      this.place("tree_pine", x, z, { scale: 0.9 + Math.random() * 0.8 });
    }

    // Hilltop ring of oaks.
    const H = PLACES.hill;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.place("tree_oak", H.x + Math.cos(a) * 11, H.z + Math.sin(a) * 11, { scale: 1.1, rot: -a });
    }
    this.place("tree_magic", PLACES.pond.x, PLACES.pond.z + 1.5, { scale: 0.9 });

    // The painted hills ring the horizon.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      const r = 330;
      const hl = new THREE.Object3D();
      hl.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
      hl.scale.setScalar(2.6);
      hl.lookAt(0, 8, 0);
      hl.updateMatrix();
      this.scenery.push({ kind: "hills", x: hl.position.x, z: hl.position.z, y: 8, rot: 0, scale: 2.6, r: 0, collider: null, matrix: hl.matrix.clone(), hidden: false, backdrop: true });
    }
  }

  scatter() {
    // Groves and lone trees elsewhere, away from landmarks.
    const avoid = Object.values(PLACES).map((p) => [p, 26]);
    let placed = 0, tries = 0;
    while (placed < 120 && tries++ < 3000) {
      const x = (Math.random() - 0.5) * 2 * (WORLD_R - 20), z = (Math.random() - 0.5) * 2 * (WORLD_R - 20);
      if (Math.hypot(x, z) > WORLD_R - 15) continue;
      if (avoid.some(([p, r]) => Math.hypot(x - p.x, z - p.z) < r + 8)) continue;
      if (terrainHeight(x, z) < WATER_Y + 0.5) continue;
      if (streamDist(x, z) < 7 || pathDist(x, z) < 4) continue;
      const kind = Math.random() < 0.55 ? "tree_oak" : Math.random() < 0.8 ? "tree_pine" : "tree_magic";
      this.place(kind, x, z, { scale: 0.8 + Math.random() * 0.7 });
      placed++;
    }
  }

  buildGrass() {
    const tex = tuftTexture(["#ffffff", "#f2f7ec", "#e6efdc", "#fbfdf7"]);
    const geo = new THREE.PlaneGeometry(0.9, 0.6);
    geo.translate(0, 0.28, 0);
    const g2 = geo.clone(); g2.rotateY(Math.PI / 2);
    const merged = new THREE.BufferGeometry();
    const p1 = geo.attributes.position.array, p2 = g2.attributes.position.array;
    merged.setAttribute("position", new THREE.Float32BufferAttribute([...p1, ...p2], 3));
    merged.setAttribute("uv", new THREE.Float32BufferAttribute([...geo.attributes.uv.array, ...g2.attributes.uv.array], 2));
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(p1.length + p2.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    merged.setIndex([...geo.index.array, ...Array.from(g2.index.array, (v) => v + 4)]);
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, emissive: new THREE.Color(0.06, 0.09, 0.04) });
    this.grassUniforms = { time: { value: 0 }, player: { value: new THREE.Vector3() }, gust: { value: new THREE.Vector2(0.05, 0.03) } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.grassUniforms);
      sh.vertexShader = "uniform float time; uniform vec3 player; uniform vec2 gust;\n" + sh.vertexShader.replace("#include <project_vertex>", `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec3 wpos = (modelMatrix * mvPosition).xyz;
        float hgt = clamp(position.y / 0.6, 0.0, 1.0);
        // Part around whoever is walking through.
        vec2 dd = wpos.xz - player.xz;
        float dl = length(dd);
        float push = (1.0 - smoothstep(0.25, 1.9, dl)) * hgt * step(abs(wpos.y - player.y), 2.5);
        wpos.xz += (dl > 0.001 ? dd / dl : vec2(0.0)) * push * 0.75;
        wpos.y -= push * 0.3;
        // Gusts roll across the meadow as travelling waves, plus a gentle flutter.
        float wave = sin(dot(wpos.xz, gust) - time * 1.25) * 0.5 + 0.5;
        float flutter = sin(time * 2.3 + wpos.x * 0.7 + wpos.z * 0.5) * 0.05;
        float bend = (flutter + wave * wave * wave * 0.32) * hgt;
        wpos.x += bend; wpos.z += bend * 0.55; wpos.y -= wave * wave * 0.06 * hgt;
        mvPosition = viewMatrix * vec4(wpos, 1.0);
        gl_Position = projectionMatrix * mvPosition;`);
      // Lighter tips, darker roots: reads as grass from far away.
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
        diffuseColor.rgb *= mix(0.72, 1.12, vMapUv.y);`);
    };
    const N = this.low ? 2500 : 26000;
    this.grass = new THREE.InstancedMesh(merged, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const greens = ["#8fc27a", "#a3cf86", "#86bb76", "#b4d690", "#9ac981", "#7fb771", "#c2dc98"];
    let n = 0, tries = 0;
    while (n < N && tries++ < N * 6) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (WORLD_R - 6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = terrainHeight(x, z);
      if (y < WATER_Y + 0.3) continue;
      const pd = pathDist(x, z);
      if (pd < 1.0 || (pd < 1.8 && Math.random() < 0.7) || streamDist(x, z) < 2.6) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
      const sc = 0.7 + Math.random() * 0.9 + meadow(x, z) * 0.3;
      m.compose(p.set(x, y - 0.05, z), q, s.set(sc, sc * (0.8 + Math.random() * 0.6), sc));
      this.grass.setMatrixAt(n, m);
      col.set(greens[Math.floor(Math.random() * greens.length)]);
      if (meadow(x, z) > 0.3 && Math.random() < 0.3) col.lerp(new THREE.Color("#e9e2b0"), 0.4);
      this.grass.setColorAt(n++, col);
    }
    this.grass.count = n;
    this.grass.receiveShadow = false;
    this.scene.add(this.grass);
    this.animated.push((dt, t) => { this.grassUniforms.time.value = t; });
  }

  buildFireflies() {
    const N = 160;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    this.ffSeed = [];
    for (let i = 0; i < N; i++) this.ffSeed.push([Math.random() * 60 - 30, Math.random() * 3 + 0.5, Math.random() * 60 - 30, Math.random() * 10]);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.35, map: blobTexture("255,236,150"), color: new THREE.Color(2.6, 2.3, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    }));
    this.fireflies.frustumCulled = false;
    this.scene.add(this.fireflies);
  }

  bakeAO() {
    const geo = this.ground.geometry, pos = geo.attributes.position, col = geo.attributes.color;
    const big = this.colliders.filter((c) => c.r > 0.25);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      let ao = 0;
      for (const c of big) {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d < c.r * 3.2 + 1.5) ao = Math.max(ao, 1 - d / (c.r * 3.2 + 1.5));
      }
      const avg = (terrainHeight(x + 3, z) + terrainHeight(x - 3, z) + terrainHeight(x, z + 3) + terrainHeight(x, z - 3)) / 4;
      const hollow = Math.max(0, Math.min(1, (avg - y) * 0.6));
      const k = 1 - 0.28 * ao - 0.12 * hollow;
      col.setXYZ(i, col.getX(i) * k, col.getY(i) * k * 1.01, col.getZ(i) * (k + 0.03 * ao));
    }
    col.needsUpdate = true;
  }

  // --- queries ----------------------------------------------------------------------------------
  /** Highest standable surface under (x, z) that's not far above `y` (default: just above the terrain). */
  groundAt(x, z, y) {
    let g = terrainHeight(x, z);
    if (y === undefined) y = g + 0.5; // placing something: the terrain, not the tops of platforms above
    for (const p of this.platforms) {
      if (!p.visible) continue;
      if (Math.hypot(x - p.x, z - p.z) < p.r && p.y <= y + 0.6 && p.y > g) g = p.y;
    }
    return g;
  }

  /** Push a circle of radius r at (x, z, y) out of solid colliders. */
  /** Colliders near (x, z), from a 16 m grid rebuilt whenever colliders are added. */
  nearColliders(x, z) {
    if (this.gridCount !== this.colliders.length) {
      this.grid = new Map();
      this.gridCount = this.colliders.length;
      for (const c of this.colliders) {
        const x0 = Math.floor((c.x - c.r) / 16), x1 = Math.floor((c.x + c.r) / 16);
        const z0 = Math.floor((c.z - c.r) / 16), z1 = Math.floor((c.z + c.r) / 16);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
          const k = gx * 4096 + gz;
          if (!this.grid.has(k)) this.grid.set(k, []);
          this.grid.get(k).push(c);
        }
      }
    }
    return this.grid.get(Math.floor(x / 16) * 4096 + Math.floor(z / 16)) || NO_COLLIDERS;
  }

  collide(pos, r) {
    // r is at most a couple of metres, so the cell under the centre plus colliders spanning into it is enough;
    // also check neighbouring cells when near a cell edge.
    const cx = Math.floor(pos.x / 16), cz = Math.floor(pos.z / 16);
    const fx = pos.x / 16 - cx, fz = pos.z / 16 - cz;
    const cells = [[0, 0]];
    if (fx < 0.2) cells.push([-1, 0]); else if (fx > 0.8) cells.push([1, 0]);
    if (fz < 0.2) cells.push([0, -1]); else if (fz > 0.8) cells.push([0, 1]);
    if (cells.length === 3) cells.push([cells[1][0], cells[2][1]]);
    for (const [ox, oz] of cells) for (const c of this.nearColliders((cx + ox) * 16 + 8, (cz + oz) * 16 + 8)) {
      if (c.off || pos.y > c.top) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
      if (d < min && d > 1e-4) { pos.x = c.x + (dx / d) * min; pos.z = c.z + (dz / d) * min; }
    }
    const d = Math.hypot(pos.x, pos.z);
    if (d > WORLD_R) { pos.x *= WORLD_R / d; pos.z *= WORLD_R / d; }
  }

  /** One InstancedMesh per scenery model, all parts merged (2 draws per model instead of 2 per part per copy). */
  buildScenery() {
    const byKind = {};
    for (const e of this.scenery) (byKind[e.kind] ||= []).push(e);
    this.sceneryMeshes = {};
    for (const [kind, list] of Object.entries(byKind)) {
      const base = material(kind);
      let mat = base;
      if (kind.startsWith("tree")) {
        // Trees lean with the gusts in the vertex shader (the grass and trees share the wind).
        mat = base.clone();
        const orig = base.onBeforeCompile;
        mat.onBeforeCompile = (sh, r) => {
          orig?.(sh, r);
          sh.uniforms.windTime = this.windTime;
          sh.vertexShader = "uniform float windTime;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec3 ip = instanceMatrix[3].xyz;
              float wave = sin(ip.x * 0.05 + ip.z * 0.03 - windTime * 1.25) * 0.5 + 0.5;
              float sway = (0.006 + wave * wave * wave * 0.02) * ${kind === "tree_pine" ? "0.6" : "1.0"};
              float bend = max(position.y, 0.0);
              float ph = ip.x * 0.37 + ip.z * 0.21;
              transformed.x += bend * bend * (sway + sin(windTime * 1.7 + ph) * 0.004) * 0.18;
              transformed.z += bend * bend * sin(windTime * 1.1 + ph) * sway * 0.11;
            #endif`);
        };
        mat.customProgramCacheKey = () => "sway-" + kind;
      }
      const mesh = new THREE.InstancedMesh(mergedGeometry(kind), mat, list.length);
      list.forEach((e, i) => { e.mesh = mesh; e.index = i; mesh.setMatrixAt(i, e.matrix); });
      mesh.castShadow = !list[0].backdrop;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.sceneryMeshes[kind] = mesh;
    }
  }

  hideScenery(e) {
    if (e.hidden) return;
    e.hidden = true;
    e.mesh.setMatrixAt(e.index, ZERO_MATRIX);
    e.mesh.instanceMatrix.needsUpdate = true;
    if (e.collider) e.collider.off = true;
  }

  showScenery(e) {
    if (!e.hidden) return;
    e.hidden = false;
    e.mesh.setMatrixAt(e.index, e.matrix);
    e.mesh.instanceMatrix.needsUpdate = true;
    if (e.collider) e.collider.off = false;
  }

  revealStairs(progress) {
    const n = Math.round(this.stairs.length * progress);
    this.stairs.forEach((s, i) => { s.visible = i < n; s.mesh.visible = i < n; });
  }

  // --- per frame ----------------------------------------------------------------------------------
  update(dt, t, focus, game) {
    this.time = (this.time + dt / this.dayLength) % 1;
    const k = sampleTime(this.time);
    this.skyMat.uniforms.zenith.value.copy(k.zenith);
    this.skyMat.uniforms.horizon.value.copy(k.horizon);
    const night = 1 - THREE.MathUtils.smoothstep(k.sunI, 0.45, 1.2);
    this.isNight = night > 0.5;
    this.night = night;
    this.skyMat.uniforms.night.value = night;
    this.scene.fog.color.copy(k.horizon);
    this.hemi.intensity = k.hemiI;
    this.hemi.color.copy(k.zenith).lerp(new THREE.Color(1, 1, 1), 0.7);
    this.sunLight.intensity = k.sunI;
    this.sunLight.color.copy(k.sun);
    // Sun arcs across the sky (by night the light is moonlight from the opposite side).
    const ang = (this.time - 0.25) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();
    const lightDir = dir.y > 0 ? dir : dir.clone().negate();
    this.sunLight.position.copy(focus).addScaledVector(lightDir, 120);
    this.sunLight.target.position.copy(focus);
    this.sunPuppet.position.copy(focus).addScaledVector(dir, 620);
    this.sunPuppet.visible = dir.y > -0.1;
    this.sunPuppet.lookAt(focus);
    for (const c of this.clouds) {
      c.position.x += dt * 1.2;
      if (c.position.x > 600) c.position.x = -600;
      c.material.opacity = 0.85 - night * 0.6;
    }
    this.sky.position.copy(focus);
    // Fireflies around the player at dusk and night.
    const ff = this.fireflies.geometry.attributes.position;
    for (let i = 0; i < this.ffSeed.length; i++) {
      const [x, y, z, s] = this.ffSeed[i];
      const fx = focus.x + x + Math.sin(t * 0.3 + s) * 2, fz = focus.z + z + Math.cos(t * 0.27 + s) * 2;
      ff.setXYZ(i, fx, terrainHeight(fx, fz) + y + Math.sin(t * 0.9 + s) * 0.4, fz);
    }
    ff.needsUpdate = true;
    this.fireflies.material.opacity = night * (0.7 + 0.3 * Math.sin(t * 3));
    for (const f of this.animated) f(dt, t);
    this.cloudTime.value.set(t * 0.0021, t * 0.0013);
    this.windTime.value = t;
    // Individual trees (landmarks) near the player lean with the gusts too.
    for (const tr of this.trees) {
      const p = tr.o.position;
      if (Math.abs(p.x - focus.x) > 90 || Math.abs(p.z - focus.z) > 90) continue;
      const wave = Math.sin(p.x * 0.05 + p.z * 0.03 - t * 1.25) * 0.5 + 0.5;
      const sway = (0.006 + wave * wave * wave * 0.02) * tr.s;
      tr.inner.rotation.x = Math.sin(t * 1.1 + tr.phase) * sway * 0.6;
      tr.inner.rotation.z = -(sway + Math.sin(t * 1.7 + tr.phase) * 0.004);
    }
    this.grassUniforms.player.value.copy(game?.active?.pos || focus);
    this.waterUniforms.zenith.value.copy(k.zenith);
    this.waterUniforms.horizon.value.copy(k.horizon);
    this.waterUniforms.night.value = night;
    if (this.sunGlow) {
      this.sunGlow.position.copy(this.sunPuppet.position).addScaledVector(dir, 5);
      this.sunGlow.visible = this.sunPuppet.visible;
      this.sunGlow.material.color.copy(k.sun).multiplyScalar(1.6);
    }
    for (const c of this.clouds) c.material.color.copy(k.horizon).lerp(new THREE.Color(1, 1, 1), 0.55 - night * 0.3);
    this.props?.update(dt, t, focus, game);
    rimLight.value.copy(k.sun).multiplyScalar(0.16 + 0.22 * k.sunI / 2.8).lerp(new THREE.Color(0.18, 0.22, 0.38), night * 0.8);
  }
}
