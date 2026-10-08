// Everything physical can be knocked about: trees topple, fences splinter, rocks crack, cottages crumble
// in stages. Debris is pooled and instanced; broken things repaint themselves back a little later, and the
// story's landmarks only wobble (and complain).
import * as THREE from "three";
import { spawn } from "./assets.js";
import { PLACES, terrainHeight } from "./world.js";

const CELL = 8;
const ZERO = new THREE.Matrix4().makeScale(1e-5, 1e-5, 1e-5);
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _axis = new THREE.Vector3(), _c = new THREE.Color();

// hp (by scale s), hit radius r, height h, debris style, how it breaks.
const KINDS = {
  rock: { hp: (s) => 22 * s, r: (s) => s * 0.85, h: (s) => s * 1.1, debris: "stone", sound: "boss_slam", vol: 0.22, rate: 1.6 },
  bush: { hp: (s) => 9 * s, r: (s) => s * 0.75, h: (s) => s * 1.1, debris: "leaf", sound: "pine_die", vol: 0.35, rate: 1.4 },
  mushroom: { hp: () => 7, r: (s) => s * 0.55, h: (s) => s * 0.6, debris: "spore", sound: "doll", vol: 0.35, rate: 0.7 },
  fence_post: { hp: () => 9, r: () => 0.3, h: () => 1.1, debris: "plank", sound: "hit", vol: 0.45, rate: 0.8 },
  fence_rail: { hp: () => 5, r: (s, it) => (it?.sx || 2) * 0.5, h: () => 0.4, debris: "plank", sound: "hit", vol: 0.35, rate: 1.1 },
  lantern: { hp: () => 10, r: () => 0.35, h: () => 2.3, debris: "glass", sound: "pickup", vol: 0.35, rate: 2.2 },
  signpost: { hp: () => 14, r: () => 0.7, h: () => 2.4, debris: "plank", sound: "hit", vol: 0.5, rate: 0.7 },
  well: { hp: () => 70, r: () => 1.6, h: () => 2.8, debris: "stone", sound: "boss_slam", vol: 0.5, rate: 1.1, staged: true },
  mill: { hp: () => 260, r: () => 3.5, h: () => 5.5, debris: "plaster", sound: "boss_slam", vol: 0.7, rate: 0.9, staged: true },
  laundry: { hp: () => 3, r: () => 0.55, h: () => 2.4, debris: "cloth", sound: "fetch_throw", vol: 0.4, rate: 1.3 },
  line_post: { hp: () => 8, r: () => 0.3, h: () => 2.4, debris: "plank", sound: "hit", vol: 0.4, rate: 0.9 },
  tree_oak: { hp: (s) => 55 * s, r: (s) => 0.45 * s, h: (s) => 5 * s, debris: "leaf", topple: true, drop: 0.35 },
  tree_pine: { hp: (s) => 42 * s, r: (s) => 0.4 * s, h: (s) => 5.6 * s, debris: "needle", topple: true, drop: 0.15 },
  tree_magic: { hp: (s) => 38 * s, r: (s) => 0.45 * s, h: (s) => 4 * s, debris: "spore", topple: true, drop: 0.2 },
  house: { hp: (s) => 200 * s, r: (s) => 1.9 * s, h: (s) => 4.4 * s, debris: "plaster", sound: "boss_slam", vol: 0.8, rate: 0.8, staged: true, crumble: true, drop: 1 },
};

const COLORS = {
  stone: ["#c9c2cf", "#bdb8c4", "#d2c8bf", "#b7b9c6"],
  leaf: ["#9cc58a", "#86b47c", "#b2d39a", "#e4a35b", "#c9d36f"],
  needle: ["#7fb07a", "#6e9f6c", "#93c08a", "#a8cf96"],
  spore: ["#f2a3c4", "#ef8f8f", "#c9a7e6", "#f3eadb", "#ffd1e0"],
  plank: ["#cdb08f", "#c6a684", "#b58a68", "#d9bf9c"],
  glass: ["#ffe8b0", "#fff6d8", "#ffd27a"],
  plaster: ["#f3e7d3", "#e9c77a", "#e69a7c", "#d8c2a6", "#e3a17f"],
  cloth: ["#ffc4d6", "#bfe0ff", "#fff1b0", "#d9c6f5", "#c8ecc0"],
};

const OAK_LINES = [
  "Ow. Rude. I'm a wizard, not a whack-a-mole. Go hit a toadstool, there's a good little soul.",
  "Four hundred years of bark and brain, and you treat me like a drum. Again.",
  "Strike me once, I'll call it play. Strike me twice: go away.",
  "Enchanted bark, my small assailant. I'm sturdier than you are gallant.",
];
const SHROOM_LINES = ["*boing*", "*the Great Mushroom Tree wobbles, unbothered*", "*boooing*"];
const HOME_LINES = ["Not the cottage! Grandpa's teapot is in there!", "That's our HOME. Hit a fence or something."];
const HIDE_LINES = ["Oi! That's my best hiding spot. Hands off.", "If you knock that down, where will I hide? In plain sight? Please."];

/** A pool of instanced debris pieces of one shape, with cheap bouncing physics. */
class DebrisPool {
  constructor(scene, geo, cap, { side = THREE.FrontSide, flat = false } = {}) {
    const mat = new THREE.MeshLambertMaterial({ side, flatShading: flat, emissive: new THREE.Color(0.22, 0.2, 0.2) });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.cap = cap;
    this.items = Array.from({ length: cap }, () => ({ live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1, life: 0, age: 0 }));
    for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, ZERO); this.mesh.setColorAt(i, new THREE.Color(1, 1, 1)); }
    this.next = 0;
    this.live = 0;
    scene.add(this.mesh);
  }

  spawn(pos, vel, size, color, life = 2.6) {
    // Reuse the oldest slot when full: the cap is the hard ceiling on cost.
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    const it = this.items[i];
    if (!it.live) this.live++;
    it.live = true;
    it.p.copy(pos);
    it.v.copy(vel);
    it.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    it.w.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    it.s = size;
    it.life = life * (0.7 + Math.random() * 0.6);
    it.age = 0;
    this.mesh.setColorAt(i, _c.set(color));
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt, drag = 0.0) {
    if (!this.live) return;
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      const it = this.items[i];
      if (!it.live) continue;
      any = true;
      it.age += dt;
      if (it.age >= it.life) { it.live = false; this.live--; this.mesh.setMatrixAt(i, ZERO); continue; }
      it.v.y -= (drag ? 6 : 18) * dt;
      if (drag) { it.v.x *= 1 - drag * dt; it.v.z *= 1 - drag * dt; it.v.x += Math.sin(it.age * 3 + i) * dt * 2; }
      it.p.addScaledVector(it.v, dt);
      const gy = terrainHeight(it.p.x, it.p.z) + it.s * 0.3;
      if (it.p.y < gy) {
        it.p.y = gy;
        if (it.v.y < -1.5) { it.v.y *= -0.32; it.v.x *= 0.6; it.v.z *= 0.6; it.w.multiplyScalar(0.6); } else { it.v.set(it.v.x * 0.85, 0, it.v.z * 0.85); it.w.multiplyScalar(0.9); }
      }
      it.r.x += it.w.x * dt; it.r.y += it.w.y * dt; it.r.z += it.w.z * dt;
      const fade = Math.min(1, (it.life - it.age) / 0.6);
      _q.setFromEuler(it.r);
      _s.setScalar(it.s * fade);
      _m.compose(it.p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Destruct {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.entries = [];
    this.grid = new Map();
    this.anims = []; // active animations: { e, kind, t, ... }
    this.gone = [];
    this.wobbles = [];
    this.stats = { destroyed: {}, hits: 0, regrown: 0 };
    this.lastLine = 0;
    this.regrowTimer = 0;
    const s = game.scene;
    const chunk = new THREE.IcosahedronGeometry(0.22, 0);
    const plank = new THREE.BoxGeometry(0.5, 0.1, 0.12);
    const leaf = new THREE.PlaneGeometry(0.3, 0.2);
    this.pools = {
      chunk: new DebrisPool(s, chunk, 120, { flat: true }),
      plank: new DebrisPool(s, plank, 80),
      leaf: new DebrisPool(s, leaf, 160, { side: THREE.DoubleSide }),
    };
    this.register();
  }

  // --- registry ----------------------------------------------------------------------------------
  add(e) {
    e.max = e.hp;
    e.state = "ok";
    this.entries.push(e);
    const k = this.key(Math.floor(e.x / CELL), Math.floor(e.z / CELL));
    let cell = this.grid.get(k);
    if (!cell) this.grid.set(k, (cell = []));
    cell.push(e);
    return e;
  }

  key(ix, iz) { return (ix + 2048) * 4096 + (iz + 2048); }

  register() {
    const w = this.world, props = w.props;
    const V = PLACES.village;
    for (const d of props?.destructibles || []) {
      const K = KINDS[d.kind];
      if (d.meshes) {
        d.list.forEach((it, i) => {
          if (d.filter && !d.filter(it)) return;
          const s = it.s ?? 1;
          const mats = d.meshes.map((m) => { const mm = new THREE.Matrix4(); m.getMatrixAt(i, mm); return mm; });
          this.add({
            kind: d.kind, x: it.x, z: it.z, y: it.y, r: K.r(s, it), h: K.h(s, it), hp: K.hp(s), size: s,
            src: { type: "inst", meshes: d.meshes, i, mats }, collider: it.col || null,
            color: it.c, lamp: d.kind === "lantern" ? i : null,
          });
        });
      } else if (d.protected) {
        this.add({ kind: d.kind, x: d.at.x, z: d.at.z, y: d.at.y, r: d.r, h: 2.5, hp: 1, prot: "bridge", src: { type: "group", obj: d.group } });
      } else {
        const o = d.group;
        o.updateWorldMatrix(true, false);
        const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const K2 = KINDS[d.kind];
        this.add({
          kind: d.kind, x: p.x, z: p.z, y: d.kind === "laundry" || d.kind === "line_post" ? terrainHeight(p.x, p.z) : p.y,
          r: K2.r(1), h: K2.h(1), hp: K2.hp(1), size: 1, collider: d.collider || null, color: d.color,
          src: { type: "group", obj: o, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.clone() },
        });
      }
    }
    // Trees and cottages, batched by the world as instanced scenery.
    for (const sc of w.scenery || []) {
      const K = KINDS[sc.kind];
      if (!K) continue;
      const s = sc.scale || 1;
      const e = {
        kind: sc.kind, x: sc.x, z: sc.z, y: sc.y ?? terrainHeight(sc.x, sc.z), r: Math.max(K.r(s), sc.r || 0), h: K.h(s), hp: K.hp(s), size: s,
        src: { type: "scenery", sc },
      };
      const near = (p, d = 2.5) => Math.hypot(sc.x - p.x, sc.z - p.z) < d;
      // The story needs these: home (respawn, Dolly's roof) and Dolly's two favourite hiding spots.
      if (sc.kind === "house" && near(V)) e.prot = "home";
      if ((sc.kind === "tree_oak" && near({ x: V.x + 18, z: V.z - 4 })) || (sc.kind === "tree_magic" && near({ x: V.x - 18, z: V.z - 6 }))) e.prot = "hide";
      this.add(e);
    }
    // Landmarks stay standing but react.
    if (w.mushroom) this.add({ kind: "landmark", x: w.mushroom.position.x, z: w.mushroom.position.z, y: w.mushroom.position.y, r: 4.2, h: 30, hp: 1, prot: "mushroom", src: { type: "group", obj: w.mushroom } });
    if (w.wizardOak) this.add({ kind: "landmark", x: w.wizardOak.position.x, z: w.wizardOak.position.z, y: w.wizardOak.position.y, r: 1.5, h: 11, hp: 1, prot: "oak", src: { type: "group", obj: w.wizardOak } });
  }

  /** Visit entries whose hit circle overlaps (x, z, r). */
  query(x, z, r, fn) {
    const R = r + 4;
    const x0 = Math.floor((x - R) / CELL), x1 = Math.floor((x + R) / CELL);
    const z0 = Math.floor((z - R) / CELL), z1 = Math.floor((z + R) / CELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const cell = this.grid.get(this.key(ix, iz));
      if (!cell) continue;
      for (const e of cell) {
        if (e.state !== "ok") continue;
        const d = Math.hypot(e.x - x, e.z - z);
        if (d < r + e.r) fn(e, d);
      }
    }
  }

  // --- damage entry points -------------------------------------------------------------------------
  /** Melee arcs and area moves from heroes. */
  hitArea(centre, range, arc, forward, dmg, tag, attacker) {
    const y = attacker?.pos?.y ?? centre.y;
    this.query(centre.x, centre.z, range, (e, d) => {
      if (y < e.y - 1.5 || y > e.y + e.h + 1.5) return;
      if (arc < Math.PI * 2 && d > e.r + 0.4) {
        _v.set(e.x - centre.x, 0, e.z - centre.z).normalize();
        if (forward && forward.angleTo(_v) > arc / 2 + 0.25) return;
      }
      const dir = _v.set(e.x - centre.x, 0, e.z - centre.z);
      if (dir.lengthSq() < 1e-4 && forward) dir.copy(forward);
      this.damage(e, dmg * (tag === "heavy" || tag === "verse" || tag === "finisher" ? 1.4 : 1), dir.normalize(), tag);
    });
  }

  /** A point blast: projectiles, Fizz Pops, a charging knight. Returns how many things were hit. */
  hitPoint(pos, radius, dmg, dir, tag) {
    let n = 0;
    this.query(pos.x, pos.z, radius, (e) => {
      if (pos.y < e.y - 1 || pos.y > e.y + e.h + 1) return;
      const d = dir ? _axis.copy(dir).setY(0) : _axis.set(e.x - pos.x, 0, e.z - pos.z);
      if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
      this.damage(e, dmg, d.normalize(), tag);
      n++;
    });
    return n;
  }

  /** An enemy telegraph landing (pineling slams, root eruptions, shockwaves). */
  hitTelegraph(tg) {
    const c = this.game.combat;
    if (!c) return;
    const reach = tg.shape === "line" ? tg.length : tg.r || 3;
    const dmg = Math.max(tg.dmg || 0, 12);
    this.query(tg.pos.x, tg.pos.z, reach, (e) => {
      if (Math.abs((tg.y ?? e.y) - e.y) > e.h + 2) return;
      _p.set(e.x, e.y, e.z);
      if (!c.inside(tg, _p, e.r)) return;
      this.damage(e, dmg, _v.set(e.x - tg.pos.x, 0, e.z - tg.pos.z).normalize(), "enemy");
    });
  }

  damage(e, dmg, dir, tag) {
    if (e.state !== "ok" || !(dmg > 0)) return;
    const g = this.game;
    this.stats.hits++;
    if (e.prot) return this.protest(e, dir);
    e.hp -= dmg;
    e.lastDir = (e.lastDir || new THREE.Vector3()).copy(dir);
    const K = KINDS[e.kind];
    this.wobble(e, dir, K.topple ? 0.07 : 0.12);
    // A few chips fly with every hit; big things shed more as they weaken.
    this.debris(e, 2 + (K.staged ? 3 : 0), 0.6);
    if (K.sound) g.sound.play(K.sound, { vol: K.vol * 0.45, rate: K.rate * 1.2, gap: 0.08 });
    else g.sound.play("hit", { vol: 0.35, rate: 0.7, gap: 0.08 });
    if (K.staged) {
      const stage = Math.min(2, Math.floor((1 - e.hp / e.max) * 3));
      if (stage > (e.stage || 0)) {
        e.stage = stage;
        this.debris(e, 14, 1.2);
        g.fx.burst(_p.set(e.x, e.y + e.h * 0.7, e.z), "puff", 10, { color: "#efe2cc", speed: 3, life: 1.4 });
        g.combat?.shake(0.15 + stage * 0.08);
        g.sound.play("boss_slam", { vol: 0.35, rate: 1.1 });
      }
    }
    if (e.hp <= 0) this.destroy(e);
  }

  protest(e, dir) {
    const g = this.game;
    this.wobble(e, dir, e.prot === "mushroom" ? 0.012 : 0.03);
    if (e.prot === "oak" || e.prot === "mushroom" || e.prot === "hide") {
      g.fx.burst(_p.set(e.x, e.y + Math.min(e.h, 8) * 0.8, e.z), "leaf", 6, { speed: 2, life: 2.2, spread: 2.5 });
    } else g.fx.burst(_p.set(e.x, e.y + 1, e.z), "puff", 4, { color: "#efe2cc", speed: 1.5 });
    if (g.t - this.lastLine < 4.5) return;
    this.lastLine = g.t;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const at = { pos: new THREE.Vector3(e.x, e.y + (e.prot === "oak" ? 5 : e.prot === "mushroom" ? 3 : 2), e.z) };
    if (e.prot === "oak") g.ui.bubble(at, pick(OAK_LINES));
    else if (e.prot === "mushroom") g.ui.bubble(at, pick(SHROOM_LINES));
    else if (e.prot === "home") g.ui.bubble(g.active, pick(HOME_LINES));
    else if (e.prot === "hide" && g.party.byId.doll?.joined) g.ui.bubble(g.party.byId.doll, pick(HIDE_LINES));
  }

  // --- visuals -------------------------------------------------------------------------------------
  /** Spray `n` debris pieces from an entry, in its style. */
  debris(e, n, power = 1) {
    const K = KINDS[e.kind] || {};
    const style = K.debris || "stone";
    const cols = style === "spore" && e.color ? [e.color, "#f3eadb"] : style === "cloth" && e.color ? [e.color] : COLORS[style];
    const pool = style === "plank" ? this.pools.plank : style === "leaf" || style === "needle" || style === "spore" || style === "cloth" ? this.pools.leaf : this.pools.chunk;
    const big = Math.min(2.2, Math.max(0.6, e.size || 1));
    for (let i = 0; i < n; i++) {
      _p.set(e.x + (Math.random() - 0.5) * e.r * 1.6, e.y + Math.random() * Math.min(e.h, 6), e.z + (Math.random() - 0.5) * e.r * 1.6);
      _v.set((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5).multiplyScalar(power);
      if (e.lastDir) _v.addScaledVector(e.lastDir, 2.5 * power);
      const size = (style === "glass" ? 0.5 : style === "cloth" ? 2.2 : 1) * big * (0.6 + Math.random() * 0.7);
      pool.spawn(_p, _v, size, cols[i % cols.length], style === "leaf" || style === "spore" ? 3.2 : 2.6);
    }
    if (style === "glass") this.game.fx.burst(_p.set(e.x, e.y + 1.9, e.z), "sparkle", 10, { color: "#ffe8b0", speed: 3 });
  }

  wobble(e, dir, amount) {
    const old = this.wobbles.find((w) => w.e === e);
    if (old) { old.t = 0; old.amount = amount; old.dir.copy(dir); return; }
    this.wobbles.push({ e, t: 0, amount, dir: dir.clone() });
  }

  /** Place an entry's visible thing with an extra rotation/scale (wobble, grow-in). */
  pose(e, extraQ, scaleK = 1) {
    const src = e.src;
    if (src.type === "inst") {
      src.meshes.forEach((m, k) => {
        src.mats[k].decompose(_p, _q, _s);
        if (extraQ) _q.premultiply(extraQ);
        _s.multiplyScalar(scaleK);
        _m.compose(_p, _q, _s);
        m.setMatrixAt(src.i, _m);
        m.instanceMatrix.needsUpdate = true;
      });
    } else if (src.type === "group") {
      const o = src.obj;
      if (!src.quat) { src.pos = o.position.clone(); src.quat = o.quaternion.clone(); src.scale = o.scale.clone(); }
      o.quaternion.copy(src.quat);
      if (extraQ) o.quaternion.premultiply(extraQ);
      o.scale.copy(src.scale).multiplyScalar(scaleK);
    } else if (src.type === "scenery" && e.clone) {
      src.sc.matrix.decompose(_p, _q, _s);
      if (extraQ) _q.premultiply(extraQ);
      e.clone.position.copy(_p); e.clone.quaternion.copy(_q); e.clone.scale.copy(_s).multiplyScalar(scaleK);
    }
  }

  tiltQ(dir, angle) {
    _axis.set(dir.z, 0, -dir.x);
    if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0);
    return _q2.setFromAxisAngle(_axis.normalize(), angle);
  }

  /** A temporary full-detail copy of a batched scenery model, for animating it. */
  cloneOf(e) {
    const sc = e.src.sc;
    const c = spawn(sc.kind, 1);
    sc.matrix.decompose(_p, _q, _s);
    c.position.copy(_p); c.quaternion.copy(_q); c.scale.copy(_s);
    this.game.scene.add(c);
    return c;
  }

  // --- breaking ------------------------------------------------------------------------------------
  destroy(e) {
    const g = this.game, w = this.world, K = KINDS[e.kind];
    e.state = "dying";
    this.stats.destroyed[e.kind] = (this.stats.destroyed[e.kind] || 0) + 1;
    this.wobbles = this.wobbles.filter((x) => x.e !== e);
    // Paths open up straight away.
    if (e.src.type === "scenery") w.hideScenery?.(e.src.sc);
    else if (e.collider) e.collider.off = true;
    if (e.lamp != null && w.props?.lamps?.[e.lamp]) { const L = w.props.lamps[e.lamp]; e.lampY = L.y; L.y = -1e4; }
    const dir = e.lastDir || new THREE.Vector3(1, 0, 0);
    if (K.topple && e.src.type === "scenery") {
      e.clone = this.cloneOf(e);
      this.anims.push({ e, type: "topple", t: 0, dir: dir.clone() });
      g.sound.play("pine_hurt", { vol: 0.5, rate: 0.5 });
      return;
    }
    if (K.crumble && e.src.type === "scenery") {
      e.clone = this.cloneOf(e);
      this.anims.push({ e, type: "crumble", t: 0, dir: dir.clone() });
      g.sound.play("boss_roar", { vol: 0.25, rate: 1.6 });
      return;
    }
    this.hide(e);
    this.burst(e, 1);
    this.finish(e);
  }

  hide(e) {
    const src = e.src;
    if (src.type === "inst") { for (const m of src.meshes) { m.setMatrixAt(src.i, ZERO); m.instanceMatrix.needsUpdate = true; } }
    else if (src.type === "group") src.obj.visible = false;
  }

  /** The big break: debris, dust, shake and sound scaled to the thing's size. */
  burst(e, power) {
    const g = this.game, K = KINDS[e.kind];
    const size = Math.min(3, (e.r + e.h * 0.3));
    this.debris(e, Math.round(6 + size * 6), 1 + size * 0.15);
    g.fx.burst(_p.set(e.x, e.y + 0.4, e.z), "puff", Math.round(4 + size * 3), { color: "#efe2cc", speed: 2 + size, life: 1.2 });
    if (K.debris === "leaf" || K.debris === "needle") g.fx.burst(_p.set(e.x, e.y + e.h * 0.6, e.z), "leaf", 12, { speed: 4 });
    if (K.debris === "spore") g.fx.burst(_p.set(e.x, e.y + e.h * 0.6, e.z), "petal", 12, { speed: 3, color: e.color });
    g.combat?.shake(Math.min(0.5, 0.05 + size * 0.08) * power);
    if (K.sound) g.sound.play(K.sound, { vol: K.vol, rate: K.rate, gap: 0.05 });
  }

  finish(e) {
    const g = this.game, K = KINDS[e.kind];
    e.state = "gone";
    e.regrowAt = g.t + 90 + Math.random() * 90;
    this.gone.push(e);
    const at = new THREE.Vector3(e.x, e.y, e.z);
    if (K.drop && Math.random() < K.drop) for (let i = 0; i < (e.kind === "house" ? 2 : 1); i++) g.dropAcorn?.(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3)));
    if (Math.random() < 0.08) { g.fx.burst(at.clone().add(UP), "star", 12, { speed: 3 }); g.party?.gainXp?.(2); }
  }

  // --- regrowth ------------------------------------------------------------------------------------
  regrow(e) {
    const g = this.game, w = this.world;
    e.state = "growing";
    e.hp = e.max;
    e.stage = 0;
    e.lastDir = null;
    if (e.src.type === "scenery") {
      e.clone = this.cloneOf(e);
    } else if (e.src.type === "group") e.src.obj.visible = true;
    if (e.lamp != null && w.props?.lamps?.[e.lamp] && e.lampY != null) w.props.lamps[e.lamp].y = e.lampY;
    this.pose(e, null, 0.01);
    this.anims.push({ e, type: "grow", t: 0 });
    this.stats.regrown++;
  }

  // --- per frame -----------------------------------------------------------------------------------
  update(dt, t) {
    const g = this.game, w = this.world;
    // Projectiles chip at whatever they fly into (each piercing bubble hits a thing once).
    for (const p of g.fx.projectiles) {
      if (p.age > (p.life || 2)) continue;
      let hit = false;
      this.query(p.pos.x, p.pos.z, p.radius || 0.5, (e) => {
        if (hit && !p.pierce) return;
        if (p.pos.y < e.y - 0.5 || p.pos.y > e.y + e.h + 0.5) return;
        if (p.destructHit?.has(e)) return;
        (p.destructHit ||= new Set()).add(e);
        this.damage(e, p.damage || 6, _v.copy(p.vel).setY(0).normalize(), p.from === "player" ? "bolt" : "enemy");
        hit = true;
      });
      if (hit && !p.pierce) p.age = 1e3; // spent: fx removes it next tick
    }
    // Wobbles: a quick damped shake about the base.
    for (let i = this.wobbles.length - 1; i >= 0; i--) {
      const wb = this.wobbles[i];
      wb.t += dt;
      const done = wb.t > 0.45;
      const a = done ? 0 : Math.sin(wb.t * 38) * wb.amount * (1 - wb.t / 0.45);
      if (wb.e.src.type === "scenery") {
        // Batched scenery: wobble the instance itself.
        const sc = wb.e.src.sc;
        if (!sc.hidden && sc.mesh) {
          sc.matrix.decompose(_p, _q, _s);
          _q.premultiply(this.tiltQ(wb.dir, a));
          _m.compose(_p, _q, _s);
          sc.mesh.setMatrixAt(sc.index, _m);
          sc.mesh.instanceMatrix.needsUpdate = true;
        }
      } else if (wb.e.state === "ok") this.pose(wb.e, this.tiltQ(wb.dir, a), 1);
      if (done) this.wobbles.splice(i, 1);
    }
    // Toppling trees, crumbling cottages, regrowth.
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const an = this.anims[i], e = an.e;
      an.t += dt;
      if (an.type === "topple") {
        const T = 1.25;
        const u = Math.min(1, an.t / T);
        const ang = u * u * (Math.PI / 2 - 0.12);
        this.pose(e, this.tiltQ(an.dir, ang), 1);
        if (u >= 1 && !an.landed) {
          an.landed = true;
          // Thud: dust along the trunk, the crown bursts where it lands.
          for (let k = 1; k <= 4; k++) g.fx.burst(_p.set(e.x + an.dir.x * e.h * k / 5, e.y + 0.3, e.z + an.dir.z * e.h * k / 5), "puff", 3, { color: "#efe2cc", speed: 2, life: 1.2 });
          const crown = { ...e, x: e.x + an.dir.x * e.h * 0.75, z: e.z + an.dir.z * e.h * 0.75, y: e.y, h: 2.5, r: 2 };
          this.debris(crown, 22, 1.4);
          g.fx.burst(_p.set(crown.x, e.y + 1, crown.z), KINDS[e.kind].debris === "spore" ? "petal" : "leaf", 26, { speed: 5, color: e.color });
          g.combat?.shake(Math.min(0.55, 0.15 + e.h * 0.04));
          g.sound.play("boss_slam", { vol: 0.5, rate: 1.25 });
        }
        if (an.t > T + 0.5) {
          const k = Math.max(0.01, 1 - (an.t - T - 0.5) / 0.5);
          this.pose(e, this.tiltQ(an.dir, Math.PI / 2 - 0.12), k);
          if (k <= 0.01) { g.scene.remove(e.clone); e.clone = null; this.anims.splice(i, 1); this.finish(e); }
        }
      } else if (an.type === "crumble") {
        const T = 1.4;
        const u = Math.min(1, an.t / T);
        if (e.clone) {
          e.src.sc.matrix.decompose(_p, _q, _s);
          e.clone.position.set(_p.x + Math.sin(an.t * 45) * 0.06 * (1 - u), _p.y - u * u * e.h * 0.85, _p.z);
          e.clone.scale.set(_s.x * (1 + u * 0.15), _s.y * (1 - u * 0.6), _s.z * (1 + u * 0.15));
          e.clone.quaternion.copy(_q).premultiply(this.tiltQ(an.dir, u * 0.18));
        }
        if (Math.random() < dt * 30) this.debris(e, 2, 1.1);
        if (Math.random() < dt * 12) g.fx.burst(_p.set(e.x + (Math.random() - 0.5) * e.r * 2, e.y + 0.5, e.z + (Math.random() - 0.5) * e.r * 2), "puff", 2, { color: "#efe2cc", speed: 2, life: 1.5 });
        if (u >= 1) { g.scene.remove(e.clone); e.clone = null; this.burst(e, 1.2); this.anims.splice(i, 1); this.finish(e); }
      } else if (an.type === "grow") {
        // Repainted: the thing blooms back with a scatter of watercolour dabs.
        const T = 1.3;
        const u = Math.min(1, an.t / T);
        const k = 1 - Math.pow(1 - u, 3) + Math.sin(u * Math.PI) * 0.08;
        this.pose(e, null, Math.max(0.01, k));
        if (Math.random() < dt * 20) g.fx.burst(_p.set(e.x + (Math.random() - 0.5) * e.r * 2, e.y + Math.random() * Math.min(e.h, 5), e.z + (Math.random() - 0.5) * e.r * 2), "sparkle", 1, { color: ["#ffc4d6", "#bfe0ff", "#fff1b0", "#c8ecc0"][Math.floor(Math.random() * 4)], speed: 1, life: 0.8 });
        if (u >= 1) {
          if (e.src.type === "scenery") { g.scene.remove(e.clone); e.clone = null; w.showScenery?.(e.src.sc); }
          else { this.pose(e, null, 1); if (e.collider) e.collider.off = false; }
          e.state = "ok";
          this.anims.splice(i, 1);
        }
      }
    }
    for (const p of Object.values(this.pools)) p.update(dt, p === this.pools.leaf ? 1.6 : 0);
    // Regrowth, a couple of times a second: only when nobody is close enough to see it (or stand in it).
    this.regrowTimer -= dt;
    if (this.regrowTimer <= 0 && this.gone.length) {
      this.regrowTimer = 0.5;
      const focus = g.active?.pos;
      for (let i = this.gone.length - 1; i >= 0; i--) {
        const e = this.gone[i];
        if (t < e.regrowAt) continue;
        if (focus && Math.hypot(focus.x - e.x, focus.z - e.z) < 28) continue;
        if (g.enemies.some((en) => en.alive && Math.hypot(en.pos.x - e.x, en.pos.z - e.z) < e.r + 1)) continue;
        this.gone.splice(i, 1);
        this.regrow(e);
      }
    }
  }

  /** Counts for QA and debugging. */
  summary() {
    const live = Object.fromEntries(Object.entries(this.pools).map(([k, p]) => [k, p.live]));
    const byKind = {};
    for (const e of this.entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    return { entries: this.entries.length, byKind, gone: this.gone.length, anims: this.anims.length, debris: live, stats: this.stats };
  }
}
