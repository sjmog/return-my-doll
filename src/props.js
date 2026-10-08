// Painterly props, mostly instanced: boulders and rim cliffs, bushes, mushroom clusters, meadow flowers,
// fences, a stone bridge, the village well, lanterns that glow at night, signposts, butterflies, birds,
// drifting pollen, and soft contact shadows under everyone.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { terrainHeight, pathDist, streamDist, meadow, PATHS, STREAM, BRIDGE, PLACES, WORLD_R, WATER_Y } from "./world.js";

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function canvasTex(w, h, draw, repeat = 1) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}
/** A white-ish watercolour wash with blotches; tinted per instance by instanceColor. */
function wash(seed, blotch = 0.12, spots = null) {
  const r = rng(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = r() * h, rad = 10 + r() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const v = 150 + r() * 90;
      gr.addColorStop(0, `rgba(${v},${v},${v},${blotch + r() * blotch})`);
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fill(); }
    }
    if (spots) {
      for (let i = 0; i < 26; i++) {
        g.fillStyle = spots; g.globalAlpha = 0.85;
        g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 10, 5 + r() * 8, r() * 3, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
    }
  });
}
function radialTex(inner, outer) {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 63);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}
function lumpy(geo, amt, seed) {
  // Jitter the vertices of a closed shape so it reads as hand-made.
  const r = rng(seed);
  const pos = geo.attributes.position, map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, 1 + (r() - 0.5) * amt);
    const s = map.get(k);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}
function paintMat(tex, opts = {}) {
  return new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color(0.16, 0.15, 0.15), emissiveMap: tex, ...opts });
}

export class Props {
  constructor(world) {
    this.world = world;
    this.scene = world.scene;
    this.low = world.low;
    this.r = rng(1234);
    this.time = { value: 0 };
    this.avoid = Object.values(PLACES).map((p) => [p, 22]);
    // What can be smashed: { kind, meshes: [InstancedMesh...], list } or { kind, group, collider }.
    this.destructibles = [];
    this.buildRocks();
    this.buildBushes();
    this.buildMushrooms();
    this.buildMeadowFlowers();
    this.buildFences();
    this.buildBridge();
    this.buildWell();
    this.buildWatermill();
    this.buildWashingLine();
    this.buildLanterns();
    this.buildSignposts();
    this.buildButterflies();
    this.buildBirds();
    this.buildPollen();
    this.buildLeaves();
    this.buildBlobs();
  }

  /** Find a spot away from landmarks, paths, the stream and water. */
  spot({ minPath = 3.5, minStream = 6, avoidScale = 1, near = null, radius = WORLD_R - 12, tries = 60 } = {}) {
    for (let k = 0; k < tries; k++) {
      let x, z;
      if (near) { const a = this.r() * 6.283, d = Math.sqrt(this.r()) * near[1]; x = near[0].x + Math.cos(a) * d; z = near[0].z + Math.sin(a) * d; }
      else { const a = this.r() * 6.283, d = Math.sqrt(this.r()) * radius; x = Math.cos(a) * d; z = Math.sin(a) * d; }
      if (Math.hypot(x, z) > WORLD_R - 6) continue;
      if (pathDist(x, z) < minPath || streamDist(x, z) < minStream) continue;
      if (this.avoid.some(([p, r]) => Math.hypot(x - p.x, z - p.z) < r * avoidScale)) continue;
      const y = terrainHeight(x, z);
      if (y < WATER_Y + 0.4) continue;
      if (this.world.colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.5)) continue;
      return [x, y, z];
    }
    return null;
  }

  instanced(geo, mat, list, { shadow = true, receive = true } = {}) {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((it, i) => {
      e.set(it.rx || 0, it.ry || 0, it.rz || 0);
      q.setFromEuler(e);
      mx.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx ?? it.s, it.sy ?? it.s, it.sz ?? it.s));
      m.setMatrixAt(i, mx);
      if (it.c) m.setColorAt(i, new THREE.Color(it.c));
    });
    m.castShadow = shadow;
    m.receiveShadow = receive;
    this.scene.add(m);
    return m;
  }

  // --- rocks, from pebbles to the cliffs that ring the world ---------------------------------------
  buildRocks() {
    const geos = [0, 1, 2].map((k) => {
      const g = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.45, 10 + k);
      g.scale(1, 0.62 + k * 0.1, 0.85);
      return g;
    });
    const mat = paintMat(wash(5, 0.16), { flatShading: true });
    const tints = ["#c9c2cf", "#bdb8c4", "#d2c8bf", "#b7b9c6", "#cfc6c9"];
    const lists = [[], [], []];
    for (let i = 0; i < 80; i++) {
      const p = this.spot({ minPath: 3, minStream: 4 });
      if (!p) continue;
      const s = 0.5 + this.r() ** 2 * 2.3;
      const it = { x: p[0], y: p[1] - s * 0.2, z: p[2], s, ry: this.r() * 6, c: tints[i % 5] };
      lists[i % 3].push(it);
      if (s > 1.2) { it.col = { x: p[0], z: p[2], r: s * 0.8, top: p[1] + s * 0.6 }; this.world.colliders.push(it.col); }
    }
    // Pebbles along the stream banks.
    for (let i = 0; i < 70; i++) {
      const seg = Math.floor(this.r() * 8), u = this.r();
      const S = this.world.streamPts;
      if (!S) break;
      const a = S[Math.min(S.length - 1, seg)], b = S[Math.min(S.length - 1, seg + 1)];
      const side = this.r() < 0.5 ? -1 : 1, off = 2.6 + this.r() * 1.8;
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const x = a[0] + dx * u + (-dz / l) * off * side, z = a[1] + dz * u + (dx / l) * off * side;
      const s = 0.18 + this.r() * 0.35;
      lists[i % 3].push({ x, y: terrainHeight(x, z) - 0.05, z, s, ry: this.r() * 6, c: tints[(i + 2) % 5] });
    }
    // Cliffs ringing the edge of the world.
    for (let i = 0; i < 110; i++) {
      const a = (i / 110) * Math.PI * 2 + this.r() * 0.04, d = WORLD_R + 6 + this.r() * 26;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, s = 4 + this.r() * 9;
      lists[i % 3].push({ x, y: terrainHeight(x, z) - s * 0.25, z, s, sy: s * (0.9 + this.r() * 0.9), ry: this.r() * 6, c: tints[i % 5] });
    }
    geos.forEach((g, k) => {
      const m = this.instanced(g, mat, lists[k]);
      // Field rocks break; pebbles and the rim cliffs are scenery.
      this.destructibles.push({ kind: "rock", meshes: [m], list: lists[k], filter: (it) => it.s >= 0.45 && it.s < 4 });
    });
  }

  // --- bushes ----------------------------------------------------------------------------------------
  buildBushes() {
    const parts = [];
    for (const [x, y, z, s] of [[0, 0.5, 0, 0.75], [0.6, 0.38, 0.15, 0.55], [-0.55, 0.36, 0.1, 0.5], [0.05, 0.4, -0.5, 0.5], [0.1, 0.85, 0.05, 0.45]]) {
      const g = lumpy(new THREE.IcosahedronGeometry(s, 1), 0.25, Math.round(x * 100 + 7));
      g.translate(x, y, z);
      parts.push(g);
    }
    const geo = mergeGeometries(parts);
    const leaf = paintMat(wash(21, 0.2));
    const bloom = paintMat(wash(22, 0.14, "#ffd1e0"));
    const greens = ["#9cc58a", "#8fbf86", "#a9cf92", "#86b47c", "#b2d39a"];
    const plain = [], flowering = [];
    for (let i = 0; i < 190; i++) {
      // Bushes like company: along paths, around trees, at the meadow edges.
      const p = this.r() < 0.45 ? this.spot({ minPath: 2.6, minStream: 4.5, avoidScale: 0.7 }) : this.spot({ minPath: 3, minStream: 4 });
      if (!p) continue;
      const s = 0.8 + this.r() * 1.0;
      const it = { x: p[0], y: p[1] - 0.15, z: p[2], s, sy: s * (0.8 + this.r() * 0.4), ry: this.r() * 6, c: greens[i % 5] };
      (this.r() < 0.28 ? flowering : plain).push(it);
    }
    this.destructibles.push({ kind: "bush", meshes: [this.instanced(geo, leaf, plain)], list: plain });
    this.destructibles.push({ kind: "bush", meshes: [this.instanced(geo, bloom, flowering.map((f) => ({ ...f, c: "#a8cf96" })))], list: flowering, flowering: true });
  }

  // --- mushroom clusters ------------------------------------------------------------------------------
  buildMushrooms() {
    const stems = [], caps = [];
    for (const [x, z, h, r] of [[0, 0, 0.55, 0.32], [0.45, 0.2, 0.36, 0.22], [-0.3, 0.35, 0.28, 0.18], [0.15, -0.38, 0.22, 0.15]]) {
      const st = new THREE.CylinderGeometry(r * 0.32, r * 0.42, h, 8); st.translate(x, h / 2, z); stems.push(st);
      const cp = new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); cp.scale(1, 0.75, 1); cp.translate(x, h - 0.02, z); caps.push(cp);
    }
    const stemMat = paintMat(wash(31, 0.08));
    const capMat = paintMat(wash(32, 0.06, "#fffaf0"));
    const capCols = ["#ef8f8f", "#f2a3c4", "#f3b07a", "#c9a7e6", "#f07f90"];
    const list = [];
    const near = [[PLACES.woods, 44], [PLACES.mushroom, 40], [PLACES.pond, 32], [PLACES.oak, 18]];
    for (let i = 0; i < 140; i++) {
      const p = i < 90 ? this.spot({ near: near[i % near.length], minPath: 2, minStream: 3, avoidScale: 0.35 }) : this.spot({ minPath: 2.5, minStream: 3 });
      if (!p) continue;
      const s = 0.8 + this.r() * 1.4;
      list.push({ x: p[0], y: p[1] - 0.05, z: p[2], s, ry: this.r() * 6, c: capCols[i % 5] });
    }
    const stemMesh = this.instanced(mergeGeometries(stems), stemMat, list.map((l) => ({ ...l, c: "#f3eadb" })));
    const capMesh = this.instanced(mergeGeometries(caps), capMat, list);
    this.destructibles.push({ kind: "mushroom", meshes: [stemMesh, capMesh], list });
  }

  // --- meadow flowers ----------------------------------------------------------------------------------
  buildMeadowFlowers() {
    // A tiny five-petal flower facing the sky, thousands of them where the meadows bloom.
    const shape = new THREE.Shape();
    for (let i = 0; i <= 50; i++) {
      const a = (i / 50) * Math.PI * 2, rr = 0.12 + 0.07 * Math.cos(a * 5);
      i ? shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const head = new THREE.ShapeGeometry(shape);
    head.rotateX(-Math.PI / 2 + 0.25);
    head.translate(0, 0.38, 0);
    const stalk = new THREE.CylinderGeometry(0.012, 0.015, 0.38, 3); stalk.translate(0, 0.19, 0);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: new THREE.Color(0.3, 0.28, 0.28) });
    const cols = ["#ffc4d6", "#fff0a8", "#ffffff", "#d9c6f5", "#ffd3a8", "#f7a8b8"];
    const heads = [];
    const N = this.low ? 800 : 5200;
    let tries = 0;
    while (heads.length < N && tries++ < N * 8) {
      const a = this.r() * 6.283, d = Math.sqrt(this.r()) * (WORLD_R - 10);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const m = meadow(x, z);
      if (this.r() > m * 0.9 + 0.03) continue;
      if (pathDist(x, z) < 1.4 || streamDist(x, z) < 3.5) continue;
      const y = terrainHeight(x, z);
      if (y < WATER_Y + 0.4) continue;
      const s = 0.7 + this.r() * 0.7;
      heads.push({ x, y, z, s, ry: this.r() * 6, c: cols[Math.floor(this.r() * cols.length)] });
    }
    this.instanced(head, mat, heads, { shadow: false });
    this.instanced(stalk, new THREE.MeshLambertMaterial({ color: "#8fbf7a" }), heads.map((h) => ({ ...h, c: undefined })), { shadow: false, receive: false });
  }

  // --- fences along the village paths ------------------------------------------------------------------
  buildFences() {
    const post = new THREE.BoxGeometry(0.16, 1.1, 0.16); post.translate(0, 0.55, 0);
    const rail = new THREE.BoxGeometry(1, 0.09, 0.07);
    const wood = paintMat(wash(41, 0.18));
    const posts = [], rails = [];
    const runs = [[PATHS[0], 0, 0.55, 2.4], [PATHS[5], 0, 0.6, -2.4], [PATHS[2], 0.45, 1, 2.6]];
    for (const [P, from, to, off] of runs) {
      const L = [];
      for (let i = 1; i < P.length; i++) L.push(Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const total = L.reduce((a, b) => a + b, 0);
      let prev = null;
      for (let d = total * from; d <= total * to; d += 2.4) {
        let k = 0, acc = 0;
        while (k < L.length - 1 && acc + L[k] < d) acc += L[k++];
        const u = (d - acc) / L[k], a = P[k], b = P[k + 1];
        const dx = (b[0] - a[0]) / L[k], dz = (b[1] - a[1]) / L[k];
        const x = a[0] + (b[0] - a[0]) * u - dz * off, z = a[1] + (b[1] - a[1]) * u + dx * off;
        if (streamDist(x, z) < 4 || this.world.colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.6)) { prev = null; continue; }
        const y = terrainHeight(x, z);
        const lean = (this.r() - 0.5) * 0.12;
        posts.push({ x, y: y - 0.05, z, s: 1, rz: lean, ry: this.r() * 0.3 });
        if (prev) {
          for (const h of [0.45, 0.85]) {
            const mx = (x + prev[0]) / 2, mz = (z + prev[2]) / 2, my = (y + prev[1]) / 2 + h;
            const len = Math.hypot(x - prev[0], z - prev[2]);
            rails.push({ x: mx, y: my, z: mz, s: 1, sx: len, sy: 1, sz: 1, ry: -Math.atan2(z - prev[2], x - prev[0]), rz: Math.atan2(y - prev[1], len) * 0.9 });
          }
        }
        prev = [x, y, z];
      }
    }
    this.destructibles.push({ kind: "fence_post", meshes: [this.instanced(post, wood, posts.map((p) => ({ ...p, c: "#cdb08f" })))], list: posts });
    this.destructibles.push({ kind: "fence_rail", meshes: [this.instanced(rail, wood, rails.map((p) => ({ ...p, c: "#c6a684" })))], list: rails });
  }

  // --- the stone bridge over the stream -----------------------------------------------------------------
  buildBridge() {
    const B = BRIDGE;
    // Hand-laid stones: irregular blocks with darker mortar and mossy patches.
    const blocksTex = canvasTex(256, 256, (g, w, h) => {
      const r = rng(77);
      g.fillStyle = "#b9aeb4"; g.fillRect(0, 0, w, h);
      for (let row = 0; row < 8; row++) {
        let x = -r() * 30;
        while (x < w) {
          const bw = 26 + r() * 30, y = row * 32;
          const v = 205 + r() * 35;
          g.fillStyle = `rgb(${v},${v - 6 - r() * 8},${v - 2})`;
          g.beginPath(); g.roundRect(x + 2, y + 2, bw - 4, 28, 6); g.fill();
          if (r() < 0.18) { g.fillStyle = "rgba(150,190,120,0.55)"; g.beginPath(); g.ellipse(x + bw * 0.5, y + 22, bw * 0.4, 7, 0, 0, 7); g.fill(); }
          x += bw;
        }
      }
    }, 1);
    blocksTex.repeat.set(3, 1);
    const stone = paintMat(blocksTex, { flatShading: true });
    const L = 13, W = 3.2, archH = 1.2;
    const y0 = Math.max(terrainHeight(B.x - B.dx * L / 2, B.z - B.dz * L / 2), terrainHeight(B.x + B.dx * L / 2, B.z + B.dz * L / 2));
    const group = new THREE.Group();
    const blocks = [];
    const n = 13;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), along = (u - 0.5) * L;
      const y = y0 + archH * Math.sin(Math.PI * u);
      const slab = new THREE.BoxGeometry(L / n + 0.08, 0.45, W);
      slab.rotateZ(Math.cos(Math.PI * u) * 0.22);
      slab.translate(along, y - 0.1, 0);
      blocks.push(slab);
      for (const side of [-1, 1]) {
        const wall = new THREE.BoxGeometry(L / n + 0.05, 0.55, 0.32);
        wall.rotateZ(Math.cos(Math.PI * u) * 0.22);
        wall.translate(along, y + 0.38, side * (W / 2 - 0.12));
        blocks.push(lumpy(wall, 0.06, i * 3 + side + 9));
      }
      // Keep the deck walkable.
      const wx = B.x + B.dx * along, wz = B.z + B.dz * along;
      this.world.platforms.push({ x: wx, z: wz, r: 1.45, y: y + 0.12, visible: true, name: "bridge" });
    }
    // The arch underneath.
    const arch = new THREE.TorusGeometry(L * 0.36, 0.55, 6, 18, Math.PI);
    arch.scale(1, 0.55, 2.6);
    arch.translate(0, y0 - 0.4, 0);
    blocks.push(arch);
    const geo = mergeGeometries(blocks.map((b) => b.index ? b.toNonIndexed() : b));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, stone);
    mesh.material.color = new THREE.Color("#f0e6e0");
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    group.position.set(B.x, 0, B.z);
    group.rotation.y = -Math.atan2(B.dz, B.dx);
    this.scene.add(group);
    // Sturdy: the bridge carries the path (and its walkable deck), so it only shrugs off dust.
    this.destructibles.push({ kind: "bridge", group, protected: true, at: new THREE.Vector3(B.x, y0, B.z), r: L / 2 });
  }

  // --- the village well -----------------------------------------------------------------------------------
  buildWell() {
    const V = PLACES.village;
    const x = V.x + 4, z = V.z + 10, y = terrainHeight(x, z);
    const g = new THREE.Group();
    const stone = paintMat(wash(61, 0.2), { flatShading: true, color: new THREE.Color("#d8d0cb") });
    const wood = paintMat(wash(62, 0.2), { color: new THREE.Color("#c9a37f") });
    const roofM = paintMat(wash(63, 0.18), { color: new THREE.Color("#e3a17f") });
    const ring = new THREE.Mesh(lumpy(new THREE.CylinderGeometry(1.2, 1.3, 1.0, 14, 2, true), 0.08, 3), stone);
    ring.position.y = 0.5; ring.material.side = THREE.DoubleSide;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.16, 6, 18), stone); lip.rotation.x = Math.PI / 2; lip.position.y = 1.0;
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.1, 18), new THREE.MeshLambertMaterial({ color: "#6f9fbf", emissive: "#203848" })); water.rotation.x = -Math.PI / 2; water.position.y = 0.55;
    g.add(ring, lip, water);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), wood); p.position.set(s * 1.1, 1.1, 0); g.add(p); }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.5, 6), wood); beam.rotation.z = Math.PI / 2; beam.position.y = 1.9; g.add(beam);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.0, 4), roofM); roof.position.y = 2.6; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.75); g.add(roof);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.3, 8), wood); bucket.position.set(0, 1.4, 0); g.add(bucket);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(x, y, z);
    this.scene.add(g);
    const col = { x, z, r: 1.5, top: y + 2.8 };
    this.world.colliders.push(col);
    this.well = new THREE.Vector3(x, y, z);
    this.destructibles.push({ kind: "well", group: g, collider: col });
  }

  // --- a watermill on the stream, its wheel turning ------------------------------------------------------
  buildWatermill() {
    const a = STREAM[5], b = STREAM[6];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const tx = dx / l, tz = dz / l, nx = -tz, nz = tx; // along the stream, and across it (north bank side)
    const cx = a[0] + tx * 10 + nx * 6.5, cz = a[1] + tz * 10 + nz * 6.5;
    const y = terrainHeight(cx, cz);
    const g = new THREE.Group();
    const plaster = paintMat(wash(81, 0.12), { color: new THREE.Color("#f3e7d3") });
    const timber = paintMat(wash(82, 0.2), { color: new THREE.Color("#b58a68") });
    const tiles = paintMat(wash(83, 0.18), { color: new THREE.Color("#e69a7c"), flatShading: true });
    const base = new THREE.Mesh(lumpy(new THREE.BoxGeometry(5, 3.6, 4.4, 2, 2, 2), 0.04, 5), plaster); base.position.y = 1.7; g.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 2.4, 4, 1), tiles); roof.position.y = 4.6; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.82); g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.12), timber); door.position.set(0, 0.95, 2.22); g.add(door);
    for (const sx of [-1.6, 1.6]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.12), new THREE.MeshLambertMaterial({ color: "#ffe4a8", emissive: new THREE.Color(0.35, 0.28, 0.12) })); w.position.set(sx, 2.3, 2.22); g.add(w); }
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), plaster); chimney.position.set(1.4, 5.0, -0.8); g.add(chimney);
    // The wheel sits in the water on the stream side, turning with the current.
    this.wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.12, 6, 24), timber);
    const rim2 = rim.clone(); rim2.position.z = 0.9;
    this.wheel.add(rim, rim2);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 1.05), timber);
      paddle.position.set(Math.cos(ang) * 1.9, Math.sin(ang) * 1.9, 0.45); paddle.rotation.z = ang;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 0.08), timber);
      spoke.position.set(Math.cos(ang) * 1.0, Math.sin(ang) * 1.0, 0.45); spoke.rotation.z = ang + Math.PI / 2;
      this.wheel.add(paddle, spoke);
    }
    this.wheel.position.set(0, 1.1, -4.7); // axis points across the stream, paddles dip into the current
    g.add(this.wheel);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(cx, y, cz);
    g.rotation.y = Math.atan2(nx, nz); // front door faces away from the stream
    this.scene.add(g);
    const col = { x: cx, z: cz, r: 3.2, top: y + 5.5 };
    this.world.colliders.push(col);
    this.mill = g;
    this.destructibles.push({ kind: "mill", group: g, collider: col });
  }

  // --- a washing line between two village houses, flapping in the breeze ----------------------------------
  buildWashingLine() {
    const V = PLACES.village;
    const A = new THREE.Vector3(V.x - 9, 0, V.z + 3), B = new THREE.Vector3(V.x - 1, 0, V.z + 6);
    A.y = terrainHeight(A.x, A.z); B.y = terrainHeight(B.x, B.z);
    const wood = paintMat(wash(91, 0.2), { color: new THREE.Color("#b58a68") });
    for (const P of [A, B]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6), wood);
      post.position.set(P.x, P.y + 1.2, P.z); post.castShadow = true;
      this.scene.add(post);
      this.destructibles.push({ kind: "line_post", group: post });
    }
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12, p = A.clone().lerp(B, u);
      p.y = A.y + (B.y - A.y) * u + 2.3 - Math.sin(Math.PI * u) * 0.35;
      pts.push(p);
    }
    const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.015, 4), new THREE.MeshLambertMaterial({ color: "#f5efe3" }));
    this.scene.add(line);
    this.laundryLine = line;
    const cloths = ["#ffc4d6", "#bfe0ff", "#fff1b0", "#d9c6f5", "#c8ecc0"];
    this.laundry = [];
    for (let i = 0; i < 5; i++) {
      const u = 0.15 + i * 0.17, p = A.clone().lerp(B, u);
      p.y = A.y + (B.y - A.y) * u + 2.3 - Math.sin(Math.PI * u) * 0.35;
      const geo = new THREE.PlaneGeometry(0.75, 0.9, 4, 4); geo.translate(0, -0.45, 0);
      const m = new THREE.Mesh(geo, paintMat(wash(95 + i, 0.1), { color: new THREE.Color(cloths[i]), side: THREE.DoubleSide }));
      m.position.copy(p);
      m.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x);
      m.castShadow = true;
      this.scene.add(m);
      this.laundry.push({ m, base: geo.attributes.position.array.slice(), phase: i * 1.3 });
      this.destructibles.push({ kind: "laundry", group: m, color: cloths[i] });
    }
  }

  // --- lanterns that glow at night ------------------------------------------------------------------------
  buildLanterns() {
    const spots = [];
    for (const P of PATHS) {
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 8; d < L; d += 17) {
          const u = d / L, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, side = spots.length % 2 ? 1 : -1;
          const x = a[0] + (b[0] - a[0]) * u - dz * 2.1 * side, z = a[1] + (b[1] - a[1]) * u + dx * 2.1 * side;
          if (streamDist(x, z) < 4 || this.world.colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 0.8)) continue;
          spots.push([x, terrainHeight(x, z), z]);
        }
      }
    }
    const post = new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6); post.translate(0, 1.1, 0);
    const arm = new THREE.BoxGeometry(0.5, 0.06, 0.06); arm.translate(0.2, 2.1, 0);
    const lamp = new THREE.CylinderGeometry(0.16, 0.2, 0.36, 6); lamp.translate(0.42, 1.88, 0);
    const cap = new THREE.ConeGeometry(0.24, 0.18, 6); cap.translate(0.42, 2.12, 0);
    const iron = new THREE.MeshLambertMaterial({ color: "#5d5266" });
    this.lampMat = new THREE.MeshLambertMaterial({ color: "#ffe8b0", emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0.2 });
    const list = spots.map(([x, y, z]) => ({ x, y, z, s: 1, ry: this.r() * 6 }));
    const ironMesh = this.instanced(mergeGeometries([post, arm, cap]), iron, list);
    const lampMesh = this.instanced(lamp, this.lampMat, list, { shadow: false });
    this.destructibles.push({ kind: "lantern", meshes: [ironMesh, lampMesh], list });
    this.lamps = list.map((l) => new THREE.Vector3(l.x + Math.cos(-l.ry) * 0.42, l.y + 1.88, l.z + Math.sin(-l.ry) * 0.42));
    // A small pool of warm lights follows the player to the nearest lanterns (cheap and constant).
    this.lampLights = [];
    for (let i = 0; i < 4; i++) {
      const L = new THREE.PointLight("#ffc27a", 0, 13, 1.6);
      this.scene.add(L);
      this.lampLights.push(L);
    }
  }

  // --- signposts ----------------------------------------------------------------------------------------------
  buildSignposts() {
    const wood = paintMat(wash(71, 0.2), { color: new THREE.Color("#cfae8a") });
    const signs = [
      [-27, 22, [["Mushroom Tree", 0.3], ["Village", 2.6], ["Wizard Oak", -1.6]]],
      [6, -10, [["Pine Woods", -0.7], ["Lily Pond", 3.9], ["South Bridge", 4.75]]],
      [9, 9, [["Oak Ring", 0.8], ["Village", 2.5]]],
      [-60, 30, [["Lily Pond", 4.5], ["Mushroom Tree", 0.6]]],
    ];
    for (const [x, z, boards] of signs) {
      const y = terrainHeight(x, z);
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.4, 6), wood); p.position.y = 1.2; g.add(p);
      boards.forEach(([label, ang], i) => {
        const tex = canvasTex(256, 64, (c, w, h) => {
          c.fillStyle = "#f2e4cc"; c.fillRect(0, 0, w, h);
          c.strokeStyle = "#8a6a55"; c.lineWidth = 4; c.strokeRect(3, 3, w - 6, h - 6);
          c.fillStyle = "#4a3a52"; c.font = "italic 30px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
          c.fillText(label, w / 2, h / 2 + 2);
        });
        tex.repeat.set(1, 1);
        const bm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.36, 0.06), [wood, wood, wood, wood, new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color(0.25, 0.23, 0.22), emissiveMap: tex }), new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color(0.25, 0.23, 0.22), emissiveMap: tex })]);
        bm.geometry.translate(0.6, 0, 0);
        bm.position.y = 2.05 - i * 0.42;
        bm.rotation.y = ang;
        g.add(bm);
      });
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      g.position.set(x, y, z);
      this.scene.add(g);
      this.destructibles.push({ kind: "signpost", group: g });
    }
  }

  // --- butterflies and birds ------------------------------------------------------------------------------------
  flapper(geo, count, colors, { size = 1, speed = 9, emissive = 0.45 } = {}) {
    // Wings fold about the body axis in the vertex shader; each instance has its own phase.
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = this.r() * 10;
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: new THREE.Color(emissive, emissive, emissive) });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.time = this.time;
      sh.vertexShader = "uniform float time; attribute float aPhase;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        float fl = sin(time * ${speed.toFixed(1)} + aPhase) * 0.9;
        float side = sign(transformed.x);
        float ang = fl * side;
        float ax = abs(transformed.x);
        transformed.x = side * ax * cos(fl);
        transformed.y += ax * sin(fl);`);
    };
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    this.scene.add(mesh);
    return mesh;
  }

  buildButterflies() {
    const wing = new THREE.Shape();
    wing.moveTo(0, 0); wing.bezierCurveTo(0.1, 0.25, 0.32, 0.26, 0.3, 0.06); wing.bezierCurveTo(0.34, -0.1, 0.12, -0.2, 0, 0);
    const right = new THREE.ShapeGeometry(wing);
    const left = right.clone(); left.scale(-1, 1, 1);
    const geo = mergeGeometries([right, left]);
    geo.rotateX(-Math.PI / 2);
    const N = this.low ? 12 : 46;
    this.butterflies = this.flapper(geo, N, ["#ffd1e2", "#fff0a0", "#cfe6ff", "#e3cdfa", "#ffffff", "#ffc69c"], { speed: 11, emissive: 0.55 });
    this.bf = Array.from({ length: N }, () => ({ home: new THREE.Vector3(), a: this.r() * 6, s: 0.6 + this.r() * 0.8, r: 1 + this.r() * 3, h: 0.6 + this.r() * 1.6, set: false }));
  }

  buildBirds() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.25, -0.9, 0.05, -0.15, 0, 0, -0.1, 0, 0, 0.25, 0, 0, -0.1, 0.9, 0.05, -0.15], 3));
    g.computeVertexNormals();
    this.birds = this.flapper(g, 24, ["#6d6280", "#7a6f8c", "#5f5675"], { speed: 6, emissive: 0.2 });
    this.flocks = [0, 1, 2].map((k) => ({ c: new THREE.Vector3((k - 1) * 120, 48 + k * 9, (k % 2 ? -1 : 1) * 80), r: 70 + k * 25, w: (k % 2 ? -1 : 1) * (0.06 + k * 0.02), a: k * 2 }));
  }

  buildPollen() {
    const N = this.low ? 60 : 260;
    const geo = new THREE.BufferGeometry();
    this.pollenSeed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) this.pollenSeed[i] = this.r();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.pollen = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.14, map: radialTex("rgba(255,255,255,1)", "rgba(255,255,255,0)"), color: new THREE.Color(2.2, 2.0, 1.4),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.pollen.frustumCulled = false;
    this.scene.add(this.pollen);
  }

  buildLeaves() {
    // Leaves let go of the trees near the player and tumble down on the breeze.
    const N = this.low ? 20 : 90;
    const leaf = new THREE.PlaneGeometry(0.22, 0.13);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, emissive: new THREE.Color(0.25, 0.2, 0.12) });
    this.leaves = new THREE.InstancedMesh(leaf, mat, N);
    this.leaves.frustumCulled = false;
    const cols = ["#e4a35b", "#c9d36f", "#e8c46a", "#d98a5a", "#a9cc72"];
    for (let i = 0; i < N; i++) this.leaves.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    this.scene.add(this.leaves);
    this.leafState = Array.from({ length: N }, () => ({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), life: 0 }));
  }

  buildBlobs() {
    // Soft contact shadows under heroes and enemies (they ground the puppets even where shadows are off).
    const tex = radialTex("rgba(40,28,52,0.55)", "rgba(40,28,52,0)");
    this.blobMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    this.blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.blobs = [];
  }

  // --- per frame ---------------------------------------------------------------------------------------------
  update(dt, t, focus, game) {
    this.time.value = t;
    const w = this.world, night = w.night || 0;
    // Butterflies flutter by day around the player, birds circle overhead.
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const day = 1 - night;
    this.bf.forEach((b, i) => {
      if (!b.set || b.home.distanceTo(focus) > 45) {
        const a = this.r() * 6.28, d = 8 + this.r() * 30;
        b.home.set(focus.x + Math.cos(a) * d, 0, focus.z + Math.sin(a) * d);
        b.home.y = terrainHeight(b.home.x, b.home.z);
        b.set = true;
      }
      b.a += dt * b.s;
      v.set(b.home.x + Math.cos(b.a) * b.r + Math.sin(b.a * 2.3) * 0.6, b.home.y + b.h + Math.sin(b.a * 3.1) * 0.35, b.home.z + Math.sin(b.a * 1.3) * b.r);
      q.setFromEuler(new THREE.Euler(0, -b.a + Math.PI / 2, Math.sin(b.a * 2) * 0.2));
      s.setScalar(day > 0.3 ? 0.8 : 0.0001);
      m4.compose(v, q, s);
      this.butterflies.setMatrixAt(i, m4);
    });
    this.butterflies.instanceMatrix.needsUpdate = true;
    let k = 0;
    for (const f of this.flocks) {
      f.a += dt * f.w;
      for (let i = 0; i < 8; i++, k++) {
        const a = f.a + i * 0.045 * Math.sign(f.w), rr = f.r + (i % 2 ? 4 : -4) * Math.ceil(i / 2);
        v.set(f.c.x + Math.cos(a) * rr, f.c.y + Math.sin(t * 0.7 + i) * 1.2 + (i % 3), f.c.z + Math.sin(a) * rr);
        q.setFromEuler(new THREE.Euler(0, -a + (f.w > 0 ? 0 : Math.PI), 0));
        s.setScalar(2.2);
        m4.compose(v, q, s);
        this.birds.setMatrixAt(k, m4);
      }
    }
    this.birds.instanceMatrix.needsUpdate = true;
    // Pollen drifts in the sunlight. Each mote has a fixed place in a 40 m pattern tiled across the
    // world (so you walk through it); only the tile nearest the player is drawn, wrapping at 20 m.
    const pp = this.pollen.geometry.attributes.position, S = this.pollenSeed;
    const wrap = (v, c) => c + ((((v - c + 20) % 40) + 40) % 40) - 20;
    for (let i = 0; i < pp.count; i++) {
      const x = wrap(S[i * 4] * 40, focus.x) + Math.sin(t * 0.21 + S[i * 4 + 3] * 30) * 2.5;
      const z = wrap(S[i * 4 + 1] * 40, focus.z) + Math.cos(t * 0.17 + S[i * 4 + 3] * 20) * 2.5;
      const y = terrainHeight(x, z) + 0.4 + ((S[i * 4 + 2] * 4 + t * 0.15 * (0.5 + S[i * 4 + 3])) % 4);
      pp.setXYZ(i, x, y, z);
    }
    pp.needsUpdate = true;
    this.pollen.material.opacity = 0.75 * day;
    // Lanterns: glow at dusk and night; the four nearest the player cast real light.
    const glow = THREE.MathUtils.smoothstep(night, 0.25, 0.7);
    this.lampMat.emissiveIntensity = 0.2 + glow * 3.4;
    if (glow > 0.01) {
      const near = this.lamps.map((p) => [p.distanceToSquared(focus), p]).sort((a, b) => a[0] - b[0]).slice(0, 4);
      this.lampLights.forEach((L, i) => { if (near[i]) { L.position.copy(near[i][1]); L.intensity = glow * 9; } });
    } else this.lampLights.forEach((L) => { L.intensity = 0; });
    if (this.wheel) this.wheel.rotation.z -= dt * 0.6;
    // Laundry billows with the gusts.
    if (this.laundry && focus.distanceTo(PLACES.village) < 90) {
      for (const L of this.laundry) {
        const pos = L.m.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = L.base[i * 3], y = L.base[i * 3 + 1];
          const hang = -y; // 0 at the line, up to 0.9 at the hem
          pos.setZ(i, Math.sin(t * 3 + L.phase + x * 3) * 0.12 * hang + (0.25 + 0.2 * Math.sin(t * 1.25 + L.phase)) * hang);
        }
        pos.needsUpdate = true;
      }
    }
    // Falling leaves from the nearest trees.
    if (this.leaves) {
      const trees = w.trees.filter((tr) => Math.abs(tr.o.position.x - focus.x) < 40 && Math.abs(tr.o.position.z - focus.z) < 40);
      const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
      this.leafState.forEach((L, i) => {
        L.life -= dt;
        if (L.life <= 0 && trees.length && this.r() < dt * 2) {
          const tr = trees[Math.floor(this.r() * trees.length)];
          const top = tr.o.position.y + 3.5 * tr.o.scale.y;
          L.p.set(tr.o.position.x + (this.r() - 0.5) * 4, top + this.r() * 1.5, tr.o.position.z + (this.r() - 0.5) * 4);
          L.v.set((this.r() - 0.3) * 0.8, -0.6 - this.r() * 0.4, (this.r() - 0.3) * 0.6);
          L.spin.set(this.r() * 4, this.r() * 3, this.r() * 4);
          L.life = 9;
        }
        if (L.life > 0) {
          L.p.addScaledVector(L.v, dt);
          L.p.x += Math.sin(t * 1.3 + i) * dt * 0.6;
          const g = terrainHeight(L.p.x, L.p.z) + 0.03;
          if (L.p.y <= g) { L.p.y = g; L.v.set(0, 0, 0); L.spin.set(0, 0, 0); L.rot.x = -Math.PI / 2; }
          else { L.rot.x += L.spin.x * dt; L.rot.y += L.spin.y * dt; L.rot.z += L.spin.z * dt; }
        }
        qq.setFromEuler(L.rot);
        m.compose(L.p, qq, L.life > 0 ? one : new THREE.Vector3(0.0001, 0.0001, 0.0001));
        this.leaves.setMatrixAt(i, m);
      });
      this.leaves.instanceMatrix.needsUpdate = true;
    }
    // Contact shadows.
    if (game) {
      const who = [];
      for (const h of game.party?.members || []) if (h.joined || h.anim?.sleep || h.anim?.sit) who.push([h.pos, h.radius * 2.4]);
      for (const e of game.enemies || []) if (e.alive && e.kind !== "thornwisp" && e.pos.distanceTo(focus) < 70) who.push([e.pos, e.radius * 2.2]);
      while (this.blobs.length < who.length) {
        const b = new THREE.Mesh(this.blobGeo, this.blobMat);
        b.renderOrder = 1;
        this.scene.add(b);
        this.blobs.push(b);
      }
      this.blobs.forEach((b, i) => {
        const it = who[i];
        b.visible = !!it;
        if (!it) return;
        const g = w.groundAt(it[0].x, it[0].z, it[0].y + 0.2);
        const lift = Math.max(0, it[0].y - g);
        b.position.set(it[0].x, g + 0.06, it[0].z);
        b.scale.setScalar(it[1] * (1 - Math.min(0.5, lift * 0.08)));
        b.material.opacity = 1;
      });
    }
  }
}
