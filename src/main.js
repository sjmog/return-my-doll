// Return My Doll: a watercolour open-world RPG starring the hand-painted Blender puppets.
import * as THREE from "three";
import { loadAssets } from "./assets.js";
import { World, PLACES, terrainHeight, WORLD_R } from "./world.js";
import { Hero, Enemy, HEROES } from "./actors.js";
import { FX } from "./fx.js";
import { UI, Dialogue } from "./ui.js";
import { Quests } from "./quests.js";
import { Activities } from "./activities.js";
import { Sound } from "./sound.js";
import { Combat } from "./combat.js";
import { Destruct } from "./destruct.js";
import { Post } from "./post.js";

const $ = (s) => document.querySelector(s);

class Party {
  constructor(game) {
    this.game = game;
    this.members = ["boy", "girl", "dragon", "doll"].map((id) => new Hero(game, id));
    this.byId = Object.fromEntries(this.members.map((h) => [h.id, h]));
    this.byId.boy.joined = this.byId.girl.joined = true;
    this.level = 1;
    this.xp = 0;
    this.acorns = 0;
    this.stars = 0;
  }
  nextXp() { return 80 + 60 * (this.level - 1); }
  gainXp(n) {
    this.xp += n;
    while (this.xp >= this.nextXp()) {
      this.xp -= this.nextXp();
      this.level++;
      for (const h of this.members) { h.maxHp = Math.round(h.def.hp * (1 + 0.12 * (this.level - 1))); if (!h.fainted) h.hp = h.maxHp; }
      this.game.sound.play("levelup");
      this.game.ui.toast(`Level up! Level ${this.level}: stronger, tougher, fully healed.`, "level");
      this.game.fx.burst(this.game.active.pos.clone().add(new THREE.Vector3(0, 1, 0)), "star", 40, { speed: 6 });
    }
  }
}

class Game {
  constructor() {
    this.canvas = $("#game");
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    // 1.5x is plenty for a soft watercolour look (2x cost ~1.8x the pixels for little visible gain).
    this.maxPixelRatio = Math.min(devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(this.maxPixelRatio);
    this.fpsCap = (() => { try { return localStorage.getItem("rmd-fps") === "120" ? 120 : 60; } catch (e) { return 60; } })();
    this.low = new URLSearchParams(location.search).has("low"); // QA / slow machines
    this.renderer.shadowMap.enabled = !this.low;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.cam = { yaw: Math.PI * 0.85, pitch: 0.16, dist: 9, target: new THREE.Vector3() };
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.enemies = [];
    this.acorns = [];
    this.waves = [];
    this.cheats = { god: false };
    this.stats = { damage: 0 };
    this.speakers = {};
    this.paused = true;
    this.started = false;
    this.mapOpen = false;
    this.t = 0;
    this.sound = new Sound();
    this.perf = { upd: 0, cpu: 0, gpu: 0, frames: 0 };
    if (new URLSearchParams(location.search).has("fps") || new URLSearchParams(location.search).has("perf")) {
      this.showFps = document.createElement("div");
      this.showFps.id = "fps";
      this.showFps.style.cssText = "position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:30;font:800 13px Nunito,sans-serif;background:#3b3049;color:#fff;padding:3px 10px;border-radius:99px";
      document.body.appendChild(this.showFps);
    }
    addEventListener("resize", () => this.resize());
    this.resize();
  }

  async load() {
    await loadAssets((u) => { $("#loadbar i").style.width = `${Math.round(u * 100)}%`; });
    this.world = new World(this.scene, { low: this.low });
    if (!this.low) this.post = new Post(this); // watercolour post-processing (graphics track)
    this.fx = new FX(this.scene, this.camera, $("#overlay"));
    this.ui = new UI(this);
    this.dialogue = new Dialogue(this);
    this.party = new Party(this);
    const v = PLACES.village;
    // Start on the meadow side of the village, looking towards the Great Mushroom Tree.
    this.party.byId.boy.setPos(v.x + 12, v.z - 10);
    this.party.byId.girl.setPos(v.x + 10, v.z - 12);
    const toTree = PLACES.mushroom.clone().sub(v).setY(0).normalize();
    this.party.byId.boy.facing = this.party.byId.girl.facing = Math.atan2(toTree.x, toTree.z);
    this.cam.yaw = Math.atan2(-toTree.x, -toTree.z);
    this.active = this.party.byId.boy;
    this.speakers = { boy: this.party.byId.boy, girl: this.party.byId.girl, dragon: this.party.byId.dragon, doll: this.party.byId.doll };
    this.quests = new Quests(this);
    this.combat = new Combat(this);
    this.destruct = new Destruct(this);
    this.activities = new Activities(this);
    this.spawnWorldEnemies();
    this.ui.buildParty();
    this.ui.buildMoves();
    this.bindInput();
    $("#loading").hidden = true;
    $("#title").hidden = false;
    this.loop();
  }

  start(fresh = true) {
    if (this.started) return this.resume();
    this.started = true;
    this.sound.init().then(() => this.sound.setMusic("day"));
    $("#title").hidden = true;
    $("#hud").hidden = false;
    this.paused = false;
    const save = fresh ? null : this.loadSave();
    this.quests.setup(save);
    if (save) this.applySave(save);
    this.saveTimer = 10;
  }

  // --- saving ---------------------------------------------------------------------------------------
  loadSave() {
    try { return JSON.parse(localStorage.getItem("return-my-doll-save") || "null"); } catch (e) { return null; }
  }

  save() {
    const q = this.quests, p = this.party;
    if (!["oak", "drops", "biscuit", "fetch", "climb", "free"].includes(q.stage)) return;
    const data = {
      stage: q.stage, drops: q.drops.map((d) => d.got), stars: q.stars.map((s) => s.got), fetches: q.fetches,
      joined: p.members.filter((m) => m.joined).map((m) => m.id), level: p.level, xp: p.xp, acorns: p.acorns,
      pos: this.active.pos.toArray(), active: this.active.id, time: this.world.time, activities: this.activities.saveData(),
    };
    try { localStorage.setItem("return-my-doll-save", JSON.stringify(data)); } catch (e) { /* storage blocked: no saves */ }
  }

  applySave(s) {
    const p = this.party, q = this.quests;
    p.level = s.level; p.xp = s.xp; p.acorns = s.acorns;
    for (const m of p.members) { m.maxHp = Math.round(m.def.hp * (1 + 0.12 * (p.level - 1))); m.hp = m.maxHp; }
    for (const id of s.joined) p.byId[id].joined = true;
    s.drops.forEach((got, i) => { if (got) { q.drops[i].got = true; q.drops[i].obj.visible = false; } });
    if (s.stage !== "oak") for (const d of q.drops) if (!d.got) d.obj.visible = true;
    this.world.revealStairs(s.drops.filter(Boolean).length / 3);
    s.stars.forEach((got, i) => { if (got) { q.stars[i].got = true; q.stars[i].obj.visible = false; p.stars++; } });
    q.stage = s.stage === "fetch" ? "biscuit" : s.stage;
    const b = p.byId.dragon;
    if (b.joined || q.stage !== "biscuit") b.anim.sleep = false;
    if (p.byId.doll.joined) {
      p.byId.doll.anim.sit = false;
      if (q.dollGlow) { this.scene.remove(q.dollGlow); q.dollGlow = null; }
    }
    const [x, y, z] = s.pos;
    for (const m of p.members) if (m.joined) m.setPos(x + Math.random() * 2, z + Math.random() * 2, y + 0.5);
    this.active = p.byId[s.active] && p.byId[s.active].joined ? p.byId[s.active] : p.byId.boy;
    this.world.time = s.time;
    this.ui.buildParty();
    this.ui.buildMoves();
    q.setTracker();
    this.ui.toast("Welcome back! Your adventure continues.");
  }

  resume() {
    this.paused = false;
    $("#pause").hidden = true;
  }

  pause() {
    if (!this.started) return;
    this.paused = true;
    $("#pause").hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- spawning -----------------------------------------------------------------------------------
  spawnEnemy(kind, x, z, home) {
    const e = new Enemy(this, kind, x, z, home);
    this.enemies.push(e);
    return e;
  }

  spawnWorldEnemies() {
    const groups = [
      // Mixed groups, so different encounters want different heroes and tactics.
      [PLACES.woods, "pineling", 9, 30], [PLACES.woods, "thornwisp", 2, 24], [PLACES.woods, "knight", 1, 16],
      [PLACES.pond, "pineling", 5, 22], [PLACES.pond, "thornwisp", 1, 14],
      [PLACES.hill, "pineling", 3, 20], [PLACES.hill, "thornwisp", 2, 16], [PLACES.hill, "knight", 1, 10],
      [new THREE.Vector3(40, 0, 40), "pineling", 3, 12], [new THREE.Vector3(-90, 0, -10), "pineling", 3, 12],
      [new THREE.Vector3(120, 0, -10), "pineling", 3, 16], [new THREE.Vector3(120, 0, -10), "knight", 1, 8],
      [new THREE.Vector3(-20, 0, 120), "thornwisp", 2, 12], [new THREE.Vector3(-20, 0, 120), "pineling", 2, 10],
    ];
    this.spawnGroups = groups;
    for (const [c, kind, n, r] of groups) for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, d = 4 + Math.random() * r;
      this.spawnEnemy(kind, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, c);
    }
  }

  respawnTick(dt) {
    this.respawnTimer = (this.respawnTimer || 30) - dt;
    if (this.respawnTimer > 0) return;
    this.respawnTimer = 30;
    this.enemies = this.enemies.filter((e) => e.alive);
    for (const [c, kind, n, r] of this.spawnGroups) {
      const alive = this.enemies.filter((e) => e.kind === kind && e.home.distanceTo(c) < 1).length;
      if (alive < n && c.distanceTo(this.active.pos) > 50) {
        const a = Math.random() * 6.28, d = 4 + Math.random() * r;
        this.spawnEnemy(kind, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, c);
      }
    }
  }

  dropAcorn(pos) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshLambertMaterial({ color: "#b07a48", emissive: "#3a2410" }));
    m.position.copy(pos).setY(this.world.groundAt(pos.x, pos.z) + 0.35);
    m.castShadow = true;
    this.scene.add(m);
    this.acorns.push(m);
  }

  shockwave(pos, radius, dmg) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: "#9fd18a", transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).setY(pos.y + 0.15);
    this.scene.add(ring);
    this.waves.push({ ring, pos: pos.clone(), r: 0, max: radius, dmg, hit: new Set() });
  }

  // --- helpers ----------------------------------------------------------------------------------
  nearestEnemy(p, range, dir) {
    let best = null, bd = range;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const to = e.pos.clone().sub(p);
      const d = to.length();
      if (dir && d > 2 && to.setY(0).normalize().dot(dir) < 0.5) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  nearestHero(p) {
    let best = null, bd = Infinity;
    for (const h of this.party.members) {
      if (!h.joined || h.fainted) continue;
      const d = h.pos.distanceTo(p);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  cameraForward() {
    return new THREE.Vector3(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
  }

  switchTo(id) {
    const h = this.party.byId[id];
    if (!h || !h.joined || h === this.active) return;
    if (h.fainted) return this.ui.toast(`${h.def.name} needs a rest first.`);
    this.active = h;
    this.ui.buildMoves();
    this.fx.burst(h.pos.clone().add(new THREE.Vector3(0, 1, 0)), "sparkle", 14);
    this.sound.play(id === "dragon" ? "bark" : id === "doll" ? "doll" : "talk", { vol: 0.6 });
  }

  onHeroFainted(h) {
    if (h !== this.active) return;
    const next = this.party.members.find((m) => m.joined && !m.fainted);
    if (next) { this.active = next; this.ui.buildMoves(); }
    else this.wipe();
  }

  wipe() {
    $("#fade").classList.add("on");
    this.ui.toast("Everyone fainted… back to the cottage for a cup of cocoa.");
    setTimeout(() => {
      const v = PLACES.village;
      for (const h of this.party.members) if (h.joined) { h.fainted = false; h.anim.sleep = false; h.hp = h.maxHp; h.setPos(v.x + 6 + Math.random() * 3, v.z - 6 + Math.random() * 3); }
      this.active = this.party.members.find((m) => m.joined);
      this.ui.buildMoves();
      this.combat?.clear();
      if (this.boss && this.boss.alive) { this.boss.brain?.dispose(); this.boss.hp = this.boss.maxHp; this.boss.started = false; this.quests.stage = "climb"; this.quests.setTracker(); this.ui.boss(null); this.scene.remove(this.boss.holder); this.boss.alive = false; this.boss = null; this.sound.setMusic("day"); }
      $("#fade").classList.remove("on");
    }, 1600);
  }

  onEnemyDefeated(e) {
    if (e.kind === "boss") this.quests.bossDefeated();
  }

  onAggro() {}

  showEnding() {
    $("#ending").hidden = false;
    setTimeout(() => { $("#ending").hidden = true; }, 9000);
  }

  // --- input ------------------------------------------------------------------------------------
  bindInput() {
    addEventListener("keydown", (e) => {
      if (e.repeat && !["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) return;
      this.keys.add(e.code);
      if (!this.started) { if (e.code === "Enter" || e.code === "Space") this.start(!this.loadSave()); return; }
      if (this.dialogue.open) {
        if (["Space", "KeyE", "Enter"].includes(e.code)) { e.preventDefault(); this.dialogue.advance(); }
        return;
      }
      if (e.code === "Escape") { this.paused ? this.resume() : this.pause(); return; }
      if (this.paused) return;
      const h = this.active;
      if (e.code === "Space") { e.preventDefault(); h.jump(); }
      if (e.code === "KeyJ") this.attack("primary");
      if (e.code === "KeyK") this.attack("special");
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.attack("mobility");
      if (e.code === "KeyE") { const it = this.quests.interaction(); if (it) it.action(); }
      if (e.code === "KeyM") { this.mapOpen = !this.mapOpen; $("#minimap").classList.toggle("big", this.mapOpen); }
      if (e.code === "KeyH") $("#help").hidden = !$("#help").hidden;
      if (e.code === "Tab") {
        e.preventDefault();
        const joined = this.party.members.filter((m) => m.joined && !m.fainted);
        this.switchTo(joined[(joined.indexOf(this.active) + 1) % joined.length].id);
      }
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
      if (n !== undefined) { const j = this.party.members.filter((m) => m.joined); if (j[n]) this.switchTo(j[n].id); }
      if (e.code === "KeyQ") { this.party.acorns > 0 ? this.eatAcorn() : this.ui.toast("No acorns. Pinelings sometimes drop them."); }
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.started || this.paused) return;
      if (this.dialogue.open) { this.dialogue.advance(); return; }
      if (!document.pointerLockElement) { this.canvas.requestPointerLock?.(); }
      if (e.button === 0) this.attack("primary");
      if (e.button === 2) this.attack("special");
      this.mouse[e.button === 0 ? "left" : "right"] = true;
    });
    addEventListener("mouseup", (e) => { this.mouse[e.button === 0 ? "left" : "right"] = false; });
    addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== this.canvas && !(e.buttons && e.target === this.canvas)) return;
      this.lastLook = performance.now();
      this.cam.yaw -= e.movementX * 0.0032;
      this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch + e.movementY * 0.0026, -0.25, 1.2);
    });
    document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && this.started && !this.paused && !this.dialogue.open) this.pause(); });
    this.canvas.addEventListener("wheel", (e) => { this.cam.dist = THREE.MathUtils.clamp(this.cam.dist + e.deltaY * 0.01, 4, 22); }, { passive: true });
    $("#start").onclick = () => this.start(true);
    if (this.loadSave()) {
      $("#continue").hidden = false;
      $("#start").textContent = "New adventure";
      $("#start").classList.add("ghost");
      $("#continue").onclick = () => this.start(false);
    }
    $("#resume").onclick = () => this.resume();
    const fpsLabel = () => { $("#fpsbtn").textContent = this.fpsCap === 120 ? "🎞 120 fps (smoothest)" : "🎞 60 fps (cool & quiet)"; };
    fpsLabel();
    $("#fpsbtn").onclick = () => {
      this.fpsCap = this.fpsCap === 120 ? 60 : 120;
      try { localStorage.setItem("rmd-fps", String(this.fpsCap)); } catch (e) { /* no storage */ }
      fpsLabel();
    };
    $("#mute").onclick = () => { $("#mute").textContent = this.sound.toggleMute() ? "🔇 Sound off" : "🔊 Sound on"; };
  }

  attack(key) {
    if (this.paused || this.dialogue.open) return;
    const aim = this.cameraForward();
    // Aim at the nearest enemy roughly in front of the camera, if there is one.
    const foe = this.nearestEnemy(this.active.pos, key === "primary" ? 16 : 10, aim);
    const dir = foe ? foe.pos.clone().sub(this.active.pos).setY(0).normalize() : (this.inputMove().lengthSq() > 0.01 && key !== "primary" ? this.inputMove() : aim);
    this.active.use(key, dir);
  }

  eatAcorn() {
    this.party.acorns--;
    for (const h of this.party.members) if (h.joined) h.heal(h.maxHp * 0.3);
    this.sound.play("heal", { vol: 0.6 });
  }

  inputMove() {
    const f = this.cameraForward(), r = new THREE.Vector3(-f.z, 0, f.x);
    const v = new THREE.Vector3();
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) v.add(f);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) v.sub(f);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) v.add(r);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) v.sub(r);
    if (this.botMove) v.add(this.botMove);
    return v.lengthSq() > 0 ? v.normalize() : v;
  }

  // --- frame ----------------------------------------------------------------------------------------
  loop() {
    // Fixed 60 Hz simulation steps (several per frame on slow machines) so game time keeps pace
    // with real time; rendering happens once per frame.
    // Rendering is capped (60 fps by default, ~20 when idle or in the background) and characters are
    // drawn interpolated between simulation steps, so motion stays smooth at any frame rate.
    const STEP = 1 / 60;
    let acc = 0, last = performance.now(), lastRender = 0;
    const frame = (now = performance.now()) => {
      requestAnimationFrame(frame);
      const idle = !this.started || this.paused || document.hidden || !document.hasFocus();
      const cap = idle ? 20 : this.fpsCap;
      if (now - lastRender < 1000 / cap - 2) return;
      lastRender = now;
      const real = Math.min(0.25, (now - last) / 1000);
      last = now;
      acc += real;
      let steps = 0;
      const tU = performance.now();
      const live = this.started && !this.paused;
      while (acc >= STEP && steps < 4) {
        if (live) {
          this.restoreSim();
          this.update(STEP);
          this.recordSim();
        } else if (this.world) this.world.update(STEP * 0.2, this.t, this.active?.pos || new THREE.Vector3());
        acc -= STEP;
        steps++;
      }
      if (steps === 4) acc = Math.min(acc, STEP);
      if (live) this.interpolate(acc / STEP);
      this.adaptResolution(real);
      const tR = performance.now();
      if (this.world) {
        this.updateCamera(real); this.ui?.update(0);
        // Shadows redraw at 30 Hz: at 60 fps a one-frame lag is invisible and it halves the shadow pass.
        this.renderer.shadowMap.autoUpdate = false;
        this.shadowFrame = (this.shadowFrame || 0) + 1;
        // (Always on the first frames, so the shadow map exists before anything samples it.)
        if (this.shadowFrame < 4 || this.shadowFrame % 2 === 0) this.renderer.shadowMap.needsUpdate = true;
        this.gpuBegin();
        if (this.post) this.post.render(real); else this.renderer.render(this.scene, this.camera);
        this.gpuEnd();
      }
      const tE = performance.now();
      const k = 0.08;
      this.perf.upd += k * ((tR - tU) - this.perf.upd);
      this.perf.cpu += k * ((tE - tR) - this.perf.cpu);
      this.fps = 0.9 * (this.fps || 60) + 0.1 / Math.max(real, 1e-3);
      if (this.showFps && (this.fpsTick = (this.fpsTick || 0) + real) > 0.5) {
        this.fpsTick = 0;
        const pr = this.renderer.getPixelRatio(), sz = this.renderer.getSize(new THREE.Vector2());
        this.showFps.textContent = `${Math.round(this.fps)} fps · sim ${this.perf.upd.toFixed(1)} ms · cpu render ${this.perf.cpu.toFixed(1)} ms · gpu ${this.perf.gpu.toFixed(1)} ms · ${Math.round(sz.x * pr)}×${Math.round(sz.y * pr)} @${pr.toFixed(2)} · ${this.renderer.info.render.calls} draws · ${(this.renderer.info.render.triangles / 1e6).toFixed(2)}M tris`;
        document.body.dataset.perf = this.showFps.textContent;
      }
    };
    frame();
  }

  // --- smooth motion: draw actors between their last two simulated states ---------------------------
  movers() {
    const list = this._movers || (this._movers = []);
    list.length = 0;
    for (const m of this.party.members) list.push(m);
    for (const e of this.enemies) if (e.alive && e.holder) list.push(e);
    return list;
  }

  recordSim() {
    for (const a of this.movers()) {
      const h = a.holder;
      if (!a._simP) { a._simP = h.position.clone(); a._prevP = h.position.clone(); a._simR = h.rotation.y; a._prevR = h.rotation.y; continue; }
      a._prevP.copy(a._simP); a._prevR = a._simR;
      a._simP.copy(h.position); a._simR = h.rotation.y;
      // Teleports and respawns shouldn't smear across the map.
      if (a._prevP.distanceToSquared(a._simP) > 9) a._prevP.copy(a._simP);
    }
  }

  restoreSim() {
    for (const a of this.movers()) if (a._simP) { a.holder.position.copy(a._simP); a.holder.rotation.y = a._simR; }
  }

  interpolate(alpha) {
    for (const a of this.movers()) {
      if (!a._simP) continue;
      a.holder.position.lerpVectors(a._prevP, a._simP, alpha);
      const d = Math.atan2(Math.sin(a._simR - a._prevR), Math.cos(a._simR - a._prevR));
      a.holder.rotation.y = a._prevR + d * alpha;
    }
  }

  // --- adaptive resolution: drop pixels when the GPU or frame time is struggling, restore when calm ---
  adaptResolution(real) {
    const ad = this.adapt || (this.adapt = { t: 0, slow: 0, fast: 0 });
    ad.t += real;
    const budget = 1 / this.fpsCap;
    if (real > budget * 1.3 || this.perf.gpu > budget * 1000 * 0.75) ad.slow += real; else ad.fast += real;
    if (ad.t < 2) return;
    const pr = this.renderer.getPixelRatio();
    let next = pr;
    if (ad.slow > 1.0) next = Math.max(0.75, pr - 0.15);
    else if (ad.fast > 1.9 && this.perf.gpu < budget * 1000 * 0.45) next = Math.min(this.maxPixelRatio, pr + 0.1);
    ad.t = ad.slow = ad.fast = 0;
    if (Math.abs(next - pr) > 0.01) { this.renderer.setPixelRatio(next); this.resize(); }
  }

  // GPU time per frame via EXT_disjoint_timer_query_webgl2 (one query in flight at a time).
  gpuBegin() {
    const gl = this.renderer.getContext();
    this.timerExt ??= gl.getExtension("EXT_disjoint_timer_query_webgl2") || false;
    if (!this.timerExt) return;
    if (this.gpuQuery) {
      const avail = gl.getQueryParameter(this.gpuQuery, gl.QUERY_RESULT_AVAILABLE);
      if (!avail) { this.gpuSkip = true; return; }
      if (!gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)) {
        const ms = gl.getQueryParameter(this.gpuQuery, gl.QUERY_RESULT) / 1e6;
        this.perf.gpu += 0.15 * (ms - this.perf.gpu);
      }
      gl.deleteQuery(this.gpuQuery);
      this.gpuQuery = null;
    }
    this.gpuSkip = false;
    this.gpuQuery = gl.createQuery();
    gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.gpuQuery);
  }

  gpuEnd() {
    if (!this.timerExt || this.gpuSkip || !this.gpuQuery) return;
    const gl = this.renderer.getContext();
    gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
  }

  update(dt) {
    if (this.combat) dt = this.combat.timeScale(dt); // hit-stop and slow motion
    this.t += dt;
    const t = this.t;
    const talking = this.dialogue.open;
    this.dialogue.update(dt);
    const h = this.active;
    if (this.bot) this.bot(dt); // QA autopilot hook
    const move = talking ? new THREE.Vector3() : this.inputMove();
    const input = { move, run: !this.keys.has("AltLeft"), descend: this.keys.has("KeyC") || this.keys.has("ControlLeft"), glide: this.keys.has("Space") };
    // Held mouse buttons keep firing rapid moves.
    if (!talking && this.mouse.left && (h.id === "dragon" || h.id === "doll")) this.attack("primary");
    for (const m of this.party.members) {
      if (!m.joined) continue;
      m.update(dt, t, m === h ? input : null);
    }
    if (!talking) {
      const p = h.pos;
      for (const e of this.enemies) {
        // Far-off enemies that aren't chasing anyone sleep: no AI, not drawn.
        const far = e.kind !== "boss" && e.state !== "chase" && (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2 > 140 * 140;
        if (e.holder) e.holder.visible = e.alive && !far;
        if (!far) e.update(dt, t);
      }
    }
    if (this.combat) this.combat.update(dt, t, talking);
    this.destruct?.update(dt, t);
    this.quests.update(dt, t);
    this.fx.update(dt, (p) => this.projectileHit(p));
    // Shockwaves.
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += dt * 9;
      w.ring.scale.setScalar(w.r);
      w.ring.material.opacity = 0.8 * (1 - w.r / w.max);
      for (const m of this.party.members) {
        if (!m.joined || w.hit.has(m)) continue;
        const d = Math.hypot(m.pos.x - w.pos.x, m.pos.z - w.pos.z);
        if (Math.abs(d - w.r) < 0.8 && m.pos.y - this.world.groundAt(m.pos.x, m.pos.z) < 0.6) { w.hit.add(m); m.takeDamage(w.dmg, w.pos); }
      }
      if (w.r >= w.max) { this.scene.remove(w.ring); this.waves.splice(i, 1); }
    }
    // Acorns.
    for (let i = this.acorns.length - 1; i >= 0; i--) {
      const a = this.acorns[i];
      a.rotation.y += dt * 2;
      if (a.position.distanceTo(h.pos) < 1.6) { this.party.acorns++; this.sound.play("pickup", { vol: 0.4 }); this.ui.toast("Acorn! Press Q to share a snack and heal."); this.scene.remove(a); this.acorns.splice(i, 1); }
    }
    this.respawnTick(dt);
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) { this.saveTimer = 10; this.save(); }
    this.world.update(dt, t, h.pos, this);
    // Music follows the mood.
    if (this.quests.stage !== "boss" && this.quests.stage !== "ending") {
      const fighting = this.enemies.some((e) => e.alive && e.state === "chase" && e.pos.distanceTo(h.pos) < 22);
      this.sound.setMusic(fighting ? "battle" : this.world.isNight ? "night" : "day");
    }
    // Prompt for E.
    const it = talking ? null : this.quests.interaction();
    $("#prompt").hidden = !it;
    if (it) $("#prompt span").textContent = it.label;
    this.ui.tick(dt);
  }

  projectileHit(p) {
    if (p.from === "player") {
      if (this.boss && this.boss.brain && this.boss.brain.projectileHook(p)) return "hostage"; // Dolly is in the way
      for (const e of this.enemies) {
        if (!e.alive || (p.hitSet && p.hitSet.has(e))) continue;
        const c = e.pos.clone().add(new THREE.Vector3(0, e.kind === "boss" ? 3 : e.kind === "thornwisp" ? 0 : 0.8, 0));
        if (c.distanceTo(p.pos) < e.radius + p.radius) {
          e.takeDamage(p.damage, p.pos.clone().sub(p.vel.clone().normalize()), 3, p);
          if (p.pierce) { (p.hitSet ||= new Set()).add(e); return null; }
          return e;
        }
      }
    } else {
      for (const m of this.party.members) {
        if (!m.joined || m.fainted) continue;
        if (m.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(p.pos) < m.radius + p.radius) { const r = m.takeDamage(p.damage, p.pos, { projectile: p }); return r === "reflected" ? null : m; }
      }
    }
    if (p.pos.y < this.world.groundAt(p.pos.x, p.pos.z) - 0.2) return "ground";
    return null;
  }

  updateCamera(dt) {
    const h = this.active;
    if (!h) return;
    const flying = h.def.flies && h.anim.flying;
    const want = h.holder.position.clone().add(new THREE.Vector3(0, h.id === "doll" ? 0.8 : flying ? 2.2 : 1.7, 0));
    this.cam.target.lerp(want, Math.min(1, dt * 10));
    // Boss fight: if you haven't touched the mouse for a moment, gently swing round to keep the
    // Great Pine in view (your own camera moves always win).
    const boss = this.boss;
    if (boss && boss.alive && boss.started && !this.camFocus && performance.now() - (this.lastLook || 0) > 1500) {
      const dx = boss.pos.x - h.pos.x, dz = boss.pos.z - h.pos.z;
      const want = Math.atan2(-dx, -dz) + 0.35;
      let dy = Math.atan2(Math.sin(want - this.cam.yaw), Math.cos(want - this.cam.yaw));
      if (Math.abs(dy) > 0.3) this.cam.yaw += dy * Math.min(1, dt * 1.6);
    }
    let dist = this.cam.dist * (h.id === "dragon" ? 1.5 : h.id === "doll" ? 0.7 : 1);
    if (this.boss && this.boss.alive) dist = Math.max(dist, 15);
    const dir = new THREE.Vector3(Math.sin(this.cam.yaw) * Math.cos(this.cam.pitch), Math.sin(this.cam.pitch), Math.cos(this.cam.yaw) * Math.cos(this.cam.pitch));
    // Pull the camera in front of trunks and walls rather than through them.
    const pt = new THREE.Vector3();
    for (let d = 1.2; d < dist; d += 0.4) {
      pt.copy(this.cam.target).addScaledVector(dir, d);
      if (this.world.colliders.some((c) => pt.y < c.top && Math.hypot(pt.x - c.x, pt.z - c.z) < c.r + 0.35)) { dist = Math.max(1.2, d - 0.4); break; }
    }
    this.camDist = 0.85 * (this.camDist || dist) + 0.15 * dist;
    if (dist < this.camDist) this.camDist = dist;
    const pos = this.cam.target.clone().addScaledVector(dir, this.camDist);
    const gmin = terrainHeight(pos.x, pos.z) + 0.6;
    if (pos.y < gmin) pos.y = gmin;
    // Cinematic look during some dialogue lines: stand behind the hero and look at the subject.
    if (this.camFocus) {
      const to = this.camFocus.clone().sub(h.pos).setY(0).normalize();
      const want = h.pos.clone().addScaledVector(to, -8).add(new THREE.Vector3(0, 2.2, 0));
      this.camLook = (this.camLook || this.cam.target.clone()).lerp(this.camFocus, Math.min(1, dt * 2.5));
      this.camPos = (this.camPos || pos.clone()).lerp(want, Math.min(1, dt * 2.5));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.combat?.applyShake(this.camera, dt);
      return;
    }
    this.camLook = null;
    this.camPos = null;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.cam.target);
    this.combat?.applyShake(this.camera, dt);
  }
}

const game = new Game();
window.__game = game; // used by the QA script
game.load().catch((e) => { $("#loading").innerHTML = `<p class="err">Couldn't load the game: ${e.message}</p>`; console.error(e); });
