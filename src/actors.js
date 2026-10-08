// Heroes (playable or following as companions), enemies with pack tactics, and the boss shell.
import * as THREE from "three";
import { spawn } from "./assets.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Puppet } from "./puppet.js";
import { COSTS } from "./combat.js";
import { BossBrain } from "./boss.js";
import { terrainHeight } from "./world.js";

const UP = new THREE.Vector3(0, 1, 0);
const GRAV = 22;
const VERSES = [
  "Stand back, you twig, or feel my verse!",
  "Roses are red, your bark is worse!",
  "I rhyme in fives, I strike in threes!",
  "Begone, you bothersome bunch of trees!",
  "My words have wings, my stick has bite!",
  "Return my doll, or lose this fight!",
];

export const HEROES = {
  boy: {
    name: "The Boy", model: "boy", scale: 1.15, speed: 5.2, run: 8.2, hp: 100, radius: 0.45, jumps: 1, puppet: "kid",
    moves: [
      { key: "primary", name: "Stick Swipe", cd: 0.42, icon: "🪵", desc: "3-hit combo · hold to whirl" },
      { key: "special", name: "Verse Shout", cd: 7, icon: "📜", desc: "Shockwave · breaks shields" },
      { key: "mobility", name: "Roll", cd: 0.7, icon: "💨", desc: "Dodge roll" },
      { key: "guard", name: "Parry", cd: 0.9, icon: "🛡️", desc: "F · reflect thorns" },
    ],
  },
  girl: {
    name: "The Girl", model: "girl", scale: 1.15, speed: 5.2, run: 8.2, hp: 85, radius: 0.45, jumps: 2, puppet: "kid",
    moves: [
      { key: "primary", name: "Sparkle Bolt", cd: 0.5, icon: "✨", desc: "Homing · hold for starburst" },
      { key: "special", name: "Bloom", cd: 12, icon: "🌸", desc: "Heal the party" },
      { key: "mobility", name: "Blink", cd: 1.6, icon: "🌀", desc: "Short teleport" },
      { key: "guard", name: "Ward", cd: 8, icon: "🫧", desc: "F · bubble eats a hit" },
    ],
  },
  dragon: {
    name: "Biscuit", model: "dragon", scale: 0.95, speed: 6, run: 10, hp: 160, radius: 1.1, jumps: 99, puppet: "dragon", flies: true,
    moves: [
      { key: "primary", name: "Bubble Breath", cd: 0.3, icon: "🫧", desc: "Bubbles · Girl's bolts pop them" },
      { key: "special", name: "Tail Spin", cd: 5, icon: "🌪️", desc: "Spin attack" },
      { key: "mobility", name: "Swoop", cd: 1.2, icon: "🪽", desc: "Dash forward" },
      { key: "guard", name: "Big Woof", cd: 10, icon: "📣", desc: "F · enemies chase Biscuit" },
    ],
  },
  doll: {
    name: "Dolly", model: "girl", scale: 0.42, speed: 6.4, run: 9.5, hp: 70, radius: 0.3, jumps: 3, puppet: "doll",
    moves: [
      { key: "primary", name: "Button Toss", cd: 0.24, icon: "🔘", desc: "Rapid buttons" },
      { key: "special", name: "Stitch Snare", cd: 9, icon: "🧵", desc: "Roots · Verse unravels" },
      { key: "mobility", name: "Tumble", cd: 0.7, icon: "🎀", desc: "Quick hop-dash" },
      { key: "guard", name: "Play Dead", cd: 10, icon: "🧸", desc: "F · ignored, then ambush" },
    ],
  },
};

export class Actor {
  constructor(game, model, scale, puppetKind) {
    this.game = game;
    this.holder = spawn(model, scale);
    this.puppet = new Puppet(this.holder, puppetKind);
    game.scene.add(this.holder);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.onGround = true;
    this.alive = true;
    this.hurt = 0;
    this.anim = { attack: -1, attackKind: null, cast: -1, talk: false, wave: false, cheer: false, sit: false, sleep: false, flap: false, flying: false };
  }

  setPos(x, z, y) {
    this.pos.set(x, y ?? this.game.world.groundAt(x, z), z);
  }

  physics(dt, { gravity = GRAV, flying = false } = {}) {
    const w = this.game.world;
    if (!flying || this.onGround) this.vel.y -= gravity * dt;
    // Water drags at the legs: wading slows you more the deeper it gets, swimming is slowest.
    const drag = !this.waterDepth ? 1 : this.swimming ? 0.55 : Math.max(0.6, 1 - this.waterDepth * 0.45);
    const fallSpeed = this.vel.y;
    this.pos.x += this.vel.x * dt * drag;
    this.pos.z += this.vel.z * dt * drag;
    this.pos.y += this.vel.y * dt;
    w.collide(this.pos, this.radius);
    const g = w.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const wasAir = !this.onGround;
    if (this.pos.y <= g) {
      this.pos.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
      if (wasAir && this.onLand) this.onLand();
    } else {
      this.onGround = this.pos.y - g < 0.05;
    }
    this.inWater(dt, g, fallSpeed);
    this.holder.position.copy(this.pos);
    this.holder.rotation.y = this.facing;
  }

  /** Wade through shallows, swim (float chest-deep) in deep water, splash on the way in, leave rings. */
  inWater(dt, ground, fallSpeed) {
    const game = this.game, w = game.world;
    const surface = w.waterAt(this.pos.x, this.pos.z), depth = surface - ground;
    const wasWet = this.waterDepth > 0;
    if (depth < 0.08 || this.pos.y > surface + 0.1) { this.waterDepth = 0; this.swimming = false; return; }
    this.waterDepth = depth;
    if (!wasWet && fallSpeed < -4) {
      w.addRipple(this.pos.x, this.pos.z, 1.6);
      game.fx.burst(new THREE.Vector3(this.pos.x, surface, this.pos.z), "puff", 18, { color: "#e4f4ff", up: 5, speed: 2.6, life: 0.8, size: 0.32 });
      if (this === game.active) game.sound.play("splash", { vol: 0.7, gap: 0.3 });
    }
    const swimDepth = this.id === "doll" ? 0.55 : 0.95;
    this.swimming = depth > swimDepth;
    if (this.swimming) {
      const floatY = surface - swimDepth + Math.sin((game.t || 0) * 3 + this.pos.x) * 0.04;
      if (this.pos.y < floatY) { this.pos.y = floatY; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; }
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.rippleTimer = (this.rippleTimer || 0) - dt;
    if (this.rippleTimer <= 0 && (speed > 0.8 || this.swimming)) {
      this.rippleTimer = this.swimming ? 0.5 : 0.38;
      w.addRipple(this.pos.x, this.pos.z, speed > 0.8 ? 0.7 : 0.3);
      if (this === game.active && speed > 0.8) game.sound.play("wade", { vol: 0.3, gap: 0.3 });
    }
  }

  faceTowards(dx, dz, dt, rate = 12) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
    const want = Math.atan2(dx, dz);
    let d = want - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * Math.min(1, dt * rate);
  }

  forward() {
    return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  animate(t, speed, running) {
    this.puppet.apply({ t, speed, running, air: !this.onGround, vy: this.vel.y, hurt: this.hurt, ...this.anim });
  }

  remove() {
    this.game.scene.remove(this.holder);
  }
}

// --- heroes ------------------------------------------------------------------------------------

export class Hero extends Actor {
  constructor(game, id) {
    const d = HEROES[id];
    super(game, d.model, d.scale, d.puppet);
    this.id = id;
    this.def = d;
    this.radius = d.radius;
    this.maxHp = d.hp;
    this.hp = d.hp;
    this.cd = { primary: 0, special: 0, mobility: 0, guard: 0 };
    this.stamina = 100;
    this.jumpsLeft = d.jumps;
    this.combo = 0;
    this.comboTimer = 0;
    this.invuln = 0;
    this.dash = 0;
    this.fainted = false;
    this.faintTimer = 0;
    this.spin = 0;
    this.joined = false;
    this.parry = 0;
    this.ward = 0;
    this.counter = 0;
    this.playingDead = 0;
    if (id === "doll") {
      this.holder.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0.42, 0.3, 0.36); } });
    }
    if (id === "girl") {
      this.wardMesh = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 16),
        new THREE.MeshBasicMaterial({ color: "#cdb7ff", transparent: true, opacity: 0.28, depthWrite: false }));
      this.wardMesh.position.y = 1.0;
      this.wardMesh.visible = false;
      this.holder.add(this.wardMesh);
    }
    this.onLand = () => { if (this.game.active === this) this.game.sound.play("land", { vol: 0.35 }); this.jumpsLeft = this.def.jumps; };
  }

  get damageMul() {
    const lvl = 1 + 0.12 * (this.game.party.level - 1);
    const companion = this.game.active === this ? 1 : 0.6; // the player's choices should matter most
    return lvl * companion * (this.counter > 0 ? 1.6 : 1);
  }

  /** All incoming damage goes through combat (dodges, parries, wards). */
  takeDamage(n, from, src = {}) {
    if (this.game.combat) return this.game.combat.hitHero(this, n, from, src);
    return this.applyDamage(n, from, src);
  }

  applyDamage(n, from, src = {}) {
    if (this.fainted) return false;
    this.hp -= n;
    this.hurt = 1;
    this.invuln = 0.45;
    this.game.fx.number(this.pos, `-${Math.round(n)}`, "#ff8f9e");
    if (from) {
      const k = this.pos.clone().sub(from).setY(0).normalize().multiplyScalar(src.knock ?? 6);
      this.vel.x += k.x; this.vel.z += k.z; this.vel.y = Math.max(this.vel.y, src.lift ?? 3);
      this.onGround = false;
    }
    if (this.game.active === this) this.game.sound.play("hurt", { vol: 0.6 });
    if (this.playingDead > 0) this.playingDead = 0;
    if (this.hp <= 0) this.faint();
    return true;
  }

  faint() {
    this.hp = 0;
    this.fainted = true;
    this.faintTimer = 45; // friends can help them up much sooner (hold E)
    this.anim.sleep = true;
    this.game.ui.toast(`${this.def.name} fainted! Hold E beside them to help them up.`);
    this.game.onHeroFainted(this);
  }

  revive(frac = 0.5) {
    if (!this.fainted) return;
    this.fainted = false;
    this.anim.sleep = false;
    this.hp = Math.max(1, this.maxHp * frac);
    this.invuln = 1;
    this.game.fx.burst(this.pos.clone().add(UP), "heal", 20);
  }

  heal(n) {
    if (this.fainted) { this.revive(0.35); return; }
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    if (this.hp > before) this.game.fx.number(this.pos, `+${Math.round(this.hp - before)}`, "#9ff0b4");
  }

  // --- moves ---
  use(key, aim) {
    if (this.fainted || this.cd[key] > 0 || this.carried) return false;
    const combat = this.game.combat;
    const isPlayer = this.game.active === this;
    const cost = COSTS[key] || 0;
    if (cost && combat && isPlayer && !combat.spend(this, cost)) return false;
    const m = this.def.moves.find((x) => x.key === key);
    this.cd[key] = m.cd * (isPlayer ? 1 : 1.6);
    if (aim) this.facing = Math.atan2(aim.x, aim.z);
    if (key === "mobility") this.lastDodge = this.game.t;
    if (this.playingDead > 0) this.playingDead = 0;
    this[`${this.id}_${key}`](aim || this.forward());
    return true;
  }

  src(tag) { return { tag, melee: this, hero: this }; }

  meleeHit(range, arc, dmg, knock, centre, tag) {
    const g = this.game;
    let hits = 0;
    const f = this.forward();
    for (const e of g.enemies) {
      if (!e.alive || e.burrowed) continue;
      const to = e.pos.clone().sub(centre || this.pos);
      to.y = 0;
      const d = to.length() - e.radius;
      if (d > range) continue;
      if (Math.abs(e.pos.y - this.pos.y) > (e.kind === "boss" ? 6 : 2.5)) continue;
      if (arc < Math.PI * 2 && d > 0.3 && f.angleTo(to.normalize()) > arc / 2) continue;
      if (e.takeDamage(dmg * this.damageMul, this.pos, knock, this.src(tag)) !== false) hits++;
    }
    if (hits && g.active === this && g.combat) g.combat.hitstop(tag === "finisher" || tag === "heavy" ? 0.09 : 0.045);
    g.destruct?.hitArea(centre || this.pos, range, arc, f, dmg * this.damageMul, tag, this);
    return hits;
  }

  // Boy
  boy_primary() {
    this.combo = this.comboTimer > 0 ? (this.combo + 1) % 3 : 0;
    this.comboTimer = 0.8;
    this.anim.attack = 0; this.anim.attackKind = "swipe";
    const last = this.combo === 2;
    this.game.sound.play("swing", { rate: last ? 0.8 : 1 });
    setTimeout(() => {
      const n = this.meleeHit(2.4, Math.PI * 0.85, last ? 22 : 12, last ? 9 : 4, null, last ? "finisher" : "swipe");
      if (n) { this.game.sound.play("hit"); if (last && this.game.active === this) this.game.combat?.shake(0.25); }
      this.game.fx.burst(this.pos.clone().add(this.forward().multiplyScalar(1.4)).add(UP), "leaf", n ? 10 : 4, { speed: 3 });
    }, 120);
    if (last) this.vel.addScaledVector(this.forward(), 4);
  }
  boy_special() {
    this.anim.cast = 0;
    this.game.sound.play("verse");
    const line = VERSES[Math.floor(Math.random() * VERSES.length)];
    this.game.ui.bubble(this, line);
    const c = this.pos.clone().add(new THREE.Vector3(0, 1, 0));
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      this.game.fx.burst(c.clone().add(new THREE.Vector3(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5)), "star", 1,
        { speed: 9, life: 0.5, up: 0, size: 0.5 });
    }
    this.meleeHit(6.5, Math.PI * 2, 28, 14, null, "verse");
    if (this.game.active === this) this.game.combat?.shake(0.35);
  }
  boy_mobility() {
    this.dash = 0.3; this.invuln = 0.35;
    const d = this.inputDir && this.inputDir.lengthSq() > 0.01 ? this.inputDir.clone() : this.forward();
    this.vel.x = d.x * 16; this.vel.z = d.z * 16;
    this.facing = Math.atan2(d.x, d.z);
    this.game.sound.play("jump", { rate: 0.8 });
    this.game.fx.burst(this.pos.clone(), "puff", 6, { speed: 1, up: 0.5 });
  }
  boy_guard() { this.parryUp(); }
  parryUp() {
    const c = this.game.combat;
    if (this.cd.guard > 0 || (c && !c.spend(this, COSTS.guard))) return;
    this.cd.guard = 0.9;
    this.parry = 0.32;
    this.anim.attack = 0; this.anim.attackKind = "bolt";
    this.game.sound.play("swing", { rate: 1.4, vol: 0.5 });
  }

  // Girl
  girl_primary(aim) {
    this.anim.attack = 0; this.anim.attackKind = "bolt";
    this.game.sound.play("bolt", { vol: 0.7 });
    const start = this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(aim, 0.6);
    this.game.fx.shoot({
      pos: start, vel: aim.clone().setY(0.05).normalize().multiplyScalar(20), radius: 0.6, from: "player",
      color: "#fff0a8", size: 0.8, life: 1.4, homing: 5, target: this.focusTarget(aim), tag: "bolt", hero: this,
      damage: 11 * this.damageMul,
    });
  }
  girl_special() {
    this.anim.cast = 0;
    this.game.sound.play("heal");
    for (const h of this.game.party.members) {
      if (!h.joined) continue;
      h.heal(h.maxHp * 0.4);
      this.game.fx.burst(h.pos.clone().add(UP), "petal", 24, { speed: 3, life: 1.6 });
    }
    this.game.fx.burst(this.pos.clone().add(UP), "heal", 30, { speed: 4 });
    this.meleeHit(4, Math.PI * 2, 8, 6, null, "bloom");
  }
  girl_mobility() {
    const d = this.inputDir && this.inputDir.lengthSq() > 0.01 ? this.inputDir.clone() : this.forward();
    this.game.fx.burst(this.pos.clone().add(UP), "sparkle", 18, { color: "#cdb7ff" });
    const to = this.pos.clone().addScaledVector(d, 7);
    this.game.world.collide(to, this.radius);
    to.y = Math.max(this.pos.y, this.game.world.groundAt(to.x, to.z, this.pos.y + 1));
    this.pos.copy(to);
    this.invuln = 0.3;
    this.game.sound.play("blink");
    this.game.fx.burst(this.pos.clone().add(UP), "sparkle", 18, { color: "#cdb7ff" });
  }
  girl_guard() { this.wardUp(); }
  wardUp() {
    const c = this.game.combat;
    if (this.cd.guard > 0 || (c && !c.spend(this, COSTS.guard))) return;
    this.cd.guard = 8;
    this.ward = 4;
    this.wardMesh.visible = true;
    this.anim.cast = 0;
    this.game.sound.play("heal", { vol: 0.4, rate: 1.3 });
  }

  // Biscuit
  dragon_primary(aim) {
    this.anim.attack = 0; this.anim.attackKind = "breath";
    this.game.sound.play("breath", { vol: 0.5, gap: 0.5 });
    const mouth = this.pos.clone().add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(this.forward(), 2.2);
    for (let i = 0; i < 2; i++) {
      const v = aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.4) * 0.3, (Math.random() - 0.5) * 0.5)).normalize().multiplyScalar(10 + Math.random() * 4);
      this.game.fx.burst(mouth, "sparkle", 1, { color: ["#bfe6ff", "#ffd1ec", "#d6ffd0"][i], speed: 0.1, life: 0.2, size: 0.8 });
      this.game.fx.shoot({ pos: mouth.clone(), vel: v, radius: 1.0, from: "player", color: ["#bfe6ff", "#ffd1ec", "#d6ffd0"][i],
        size: 1.1, life: 0.55, damage: 4 * this.damageMul, trail: "puff", pierce: true, tag: "bubble", hero: this });
    }
  }
  dragon_special() {
    this.spin = 0.6;
    this.game.sound.play("tailspin");
    this.meleeHit(4.8, Math.PI * 2, 24, 12, null, "heavy");
    this.game.fx.burst(this.pos.clone().add(UP), "leaf", 24, { speed: 7, up: 1 });
  }
  dragon_mobility() {
    const f = this.inputDir && this.inputDir.lengthSq() > 0.01 ? this.inputDir.clone() : this.forward();
    this.vel.x = f.x * 24; this.vel.z = f.z * 24;
    this.dash = 0.35; this.invuln = 0.3;
    this.game.sound.play("flap");
    this.game.fx.burst(this.pos.clone().add(UP), "puff", 10, { speed: 2 });
  }
  dragon_guard() { this.roarTaunt(); }
  roarTaunt() {
    if (this.cd.guard > 0) return;
    this.cd.guard = 10;
    this.game.sound.play("bark");
    this.game.ui.bubble(this, "WOOF! Over here! Look at me! I'm the biggest!");
    for (const e of this.game.enemies) if (e.alive && e.kind !== "boss" && e.pos.distanceTo(this.pos) < 16) { e.taunt = 5; e.taunter = this; e.state = "chase"; }
    this.game.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), "star", 20, { speed: 6 });
  }

  // Dolly
  doll_primary(aim) {
    this.anim.attack = 0; this.anim.attackKind = "button";
    this.game.sound.play("button", { vol: 0.6 });
    const start = this.pos.clone().add(new THREE.Vector3(0, 0.5, 0));
    this.game.fx.shoot({ pos: start, vel: aim.clone().setY(0.12).normalize().multiplyScalar(24), radius: 0.5, from: "player",
      color: ["#ff9fb8", "#9fd8ff", "#ffe08f"][Math.floor(Math.random() * 3)], size: 0.45, life: 1, damage: 7 * this.damageMul, gravity: 6, tag: "button", hero: this });
  }
  doll_special() {
    this.anim.cast = 0;
    this.game.sound.play("doll");
    this.game.sound.play("portal", { vol: 0.4 });
    for (const e of this.game.enemies) {
      if (e.alive && !e.burrowed && e.pos.distanceTo(this.pos) < 8) {
        e.rooted = 4;
        e.takeDamage(6 * this.damageMul, this.pos, 0, this.src("snare"));
        this.game.fx.burst(e.pos.clone().add(UP), "sparkle", 14, { color: "#ffb3d1" });
      }
    }
    this.game.fx.burst(this.pos.clone().add(UP), "petal", 30, { speed: 6 });
  }
  doll_mobility() {
    const f = this.inputDir && this.inputDir.lengthSq() > 0.01 ? this.inputDir.clone() : this.forward();
    this.vel.x = f.x * 13; this.vel.z = f.z * 13; this.vel.y = 6;
    this.dash = 0.25; this.invuln = 0.25;
    this.game.sound.play("doll");
  }
  doll_guard() { this.playDead(); }
  playDead() {
    if (this.cd.guard > 0) return;
    this.cd.guard = 10;
    this.playingDead = 3;
    this.anim.sleep = true;
    this.game.ui.bubble(this, "*flop*  (I'm just a doll. A normal doll. Nothing to see.)");
    this.game.sound.play("doll", { rate: 0.7 });
    setTimeout(() => {
      this.anim.sleep = this.fainted;
      if (!this.fainted) { this.counter = 2.5; this.game.fx.number(this.pos, "Surprise!", "#ffb3d1"); }
    }, 3000);
  }

  /** Charged (held) primary: the Boy's whirl and the Girl's starburst. */
  charged(dir) {
    const g = this.game;
    this.facing = Math.atan2(dir.x, dir.z);
    if (this.id === "boy") {
      this.spin = 0.45;
      g.sound.play("tailspin", { rate: 1.3 });
      const n = this.meleeHit(3.4, Math.PI * 2, 32, 11, null, "heavy");
      g.fx.burst(this.pos.clone().add(UP), "leaf", 30, { speed: 8 });
      g.combat?.shake(0.4);
      if (n) g.sound.play("hit", { rate: 0.7 });
    } else if (this.id === "girl") {
      this.anim.cast = 0;
      g.sound.play("bolt", { rate: 0.8 });
      for (let i = -2; i <= 2; i++) {
        const v = dir.clone().applyAxisAngle(UP, i * 0.28).setY(0.08).normalize().multiplyScalar(17);
        g.fx.shoot({ pos: this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), vel: v, radius: 0.6, from: "player", color: "#ffe9a8",
          size: 0.85, life: 1.6, homing: 3, target: g.nearestEnemy(this.pos.clone().addScaledVector(v.clone().setY(0).normalize(), 8), 12), tag: "bolt", hero: this, damage: 10 * this.damageMul });
      }
    }
  }

  focusTarget(aim) {
    const g = this.game, c = g.combat;
    if (g.active !== this && c && c.order === "attack" && c.focus && c.focus.alive && c.focus.pos.distanceTo(this.pos) < 24) return c.focus;
    return g.nearestEnemy(this.pos, 22, aim);
  }

  jump() {
    if (this.fainted || this.carried) return;
    if (this.def.flies) {
      // Dragon: every press is a wingbeat.
      this.vel.y = Math.max(this.vel.y, 0) + 7.5;
      this.vel.y = Math.min(this.vel.y, 11);
      this.anim.flying = true;
      this.anim.flap = true;
      this.flapTimer = 0.5;
      this.game.sound.play("flap", { vol: 0.6, gap: 0.15 });
      return;
    }
    if (this.onGround) this.jumpsLeft = this.def.jumps;
    if (this.jumpsLeft <= 0) return;
    this.jumpsLeft--;
    this.vel.y = this.id === "doll" ? 8.5 : 8.2;
    this.onGround = false;
    this.game.sound.play("jump", { vol: 0.6 });
    if (this.jumpsLeft < this.def.jumps - 1) this.game.fx.burst(this.pos.clone(), "sparkle", 8, { color: "#fff" });
  }

  update(dt, t, input) {
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.comboTimer -= dt;
    this.invuln -= dt;
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.dash -= dt;
    this.flapTimer = (this.flapTimer || 0) - dt;
    if (this.flapTimer <= 0) this.anim.flap = false;
    if (this.anim.attack >= 0) { this.anim.attack += dt / 0.35; if (this.anim.attack > 1) this.anim.attack = -1; }
    if (this.anim.cast >= 0) { this.anim.cast += dt / 0.6; if (this.anim.cast > 1) this.anim.cast = -1; }
    if (this.carried) {
      // Held by the boss, falling, or riding: someone else moves us.
      this.holder.position.copy(this.pos);
      this.holder.rotation.y = this.facing;
      this.animate(t, 0, false);
      return;
    }
    if (this.fainted) {
      this.faintTimer -= dt;
      if (this.faintTimer <= 0) this.revive(0.25);
      this.vel.x *= 0.8; this.vel.z *= 0.8;
      this.physics(dt);
      this.animate(t, 0, false);
      return;
    }
    let speed = 0, running = false;
    const flying = this.def.flies && this.anim.flying;
    const combat = this.game.combat;
    if (input) {
      // Player control (frozen while helping a friend up or playing dead).
      const frozen = (combat && combat.isReviving(this)) || this.playingDead > 0;
      const move = frozen ? new THREE.Vector3() : input.move;
      this.inputDir = move;
      running = input.run;
      const target = (running ? this.def.run : this.def.speed) * (flying ? 1.5 : 1);
      if (this.dash <= 0) {
        const accel = this.onGround ? 14 : 5;
        this.vel.x += (move.x * target - this.vel.x) * Math.min(1, dt * accel);
        this.vel.z += (move.z * target - this.vel.z) * Math.min(1, dt * accel);
      }
      if (move.lengthSq() > 0.01 && this.anim.attack < 0) this.faceTowards(move.x, move.z, dt);
      if (flying && input.descend) this.vel.y = Math.min(this.vel.y, -6);
    } else if (this.joined) {
      if (this.playingDead > 0) { this.vel.x *= 0.8; this.vel.z *= 0.8; }
      else this.companionAI(dt);
    }
    if (this.spin > 0) { this.spin -= dt; this.facing += dt * 22; }
    speed = Math.hypot(this.vel.x, this.vel.z);
    const gravity = flying ? (this.anim.flap ? 6 : 9) : GRAV;
    this.physics(dt, { gravity });
    if (this.def.flies && this.onGround && this.vel.y <= 0) this.anim.flying = false;
    if (this.def.flies && flying && this.vel.y < -2 && input && input.glide) this.vel.y = -2; // glide
    this.animate(t, speed, running || speed > this.def.speed * 1.2);
  }

  companionAI(dt) {
    const g = this.game, lead = g.active, c = g.combat;
    if (!lead) return;
    const order = c ? c.order : "attack";
    const slot = new THREE.Vector3(...({ boy: [-2, 0, -2.2], girl: [2, 0, -2.2], dragon: [0, 0, -4.5], doll: [1, 0, -1.4] }[this.id]));
    slot.applyAxisAngle(UP, lead.facing).add(lead.pos);
    let goal = order === "hold" && c.holdPos ? c.holdPos.clone().add(new THREE.Vector3(...({ boy: [-1.5, 0, 0], girl: [1.5, 0, 0], dragon: [0, 0, 2.5], doll: [0.8, 0, -1] }[this.id]))) : slot;
    const ranged = this.id === "girl" || this.id === "doll";
    // Who to fight depends on orders: focus the player's target, defend only, or hold a spot.
    let foe = null;
    if (!g.dialogue.open && !(c && c.calm)) {
      if (order === "attack") foe = (c && c.focus && c.focus.alive && c.focus.pos.distanceTo(this.pos) < 22 && !c.focus.burrowed) ? c.focus : g.nearestEnemy(this.pos, ranged ? 16 : 11);
      else if (order === "follow") foe = g.nearestEnemy(this.pos, 3.5);
      else foe = g.nearestEnemy(this.pos, ranged ? 14 : 3.5);
    }
    if (foe && foe.burrowed) foe = null;
    if (foe) {
      const d = foe.pos.distanceTo(this.pos);
      const want = ranged ? 9 : this.id === "dragon" ? 4 : 1.8;
      if (order !== "hold") goal = d > want ? foe.pos : this.pos;
      const aim = foe.pos.clone().sub(this.pos).setY(0).normalize();
      if (d < want + 2.5) {
        this.faceTowards(aim.x, aim.z, dt);
        if (this.cd.primary <= 0) this.use("primary", aim);
      }
    }
    // The Girl heals when friends are hurting.
    if (this.id === "girl" && this.cd.special <= 0 && g.party.members.some((m) => m.joined && (m.fainted || m.hp < m.maxHp * 0.45))) this.use("special");
    let to = goal.clone().sub(this.pos); to.y = 0;
    // Step out of incoming attacks.
    const danger = c && c.danger(this.pos, this.radius, 0.9);
    if (danger) {
      const away = this.pos.clone().sub(danger.pos).setY(0);
      if (danger.shape === "line") away.copy(new THREE.Vector3(danger.dir.z, 0, -danger.dir.x)).multiplyScalar(Math.sign(away.x * danger.dir.z - away.z * danger.dir.x) || 1);
      to = away.normalize().multiplyScalar(6);
    }
    const dist = to.length();
    if (dist > 60) { this.pos.copy(lead.pos).addScaledVector(lead.forward(), -3); this.pos.y = g.world.groundAt(this.pos.x, this.pos.z, lead.pos.y + 1); }
    const sp = danger ? this.def.run : dist > 8 ? this.def.run : dist > 1.2 ? this.def.speed : 0;
    const dir = dist > 0.01 ? to.normalize() : to;
    this.vel.x += (dir.x * sp - this.vel.x) * Math.min(1, dt * 8);
    this.vel.z += (dir.z * sp - this.vel.z) * Math.min(1, dt * 8);
    if (sp > 0 && !foe) this.faceTowards(dir.x, dir.z, dt, 8);
    // Hop up to the leader if they're on a platform above.
    if (this.onGround && lead.pos.y - this.pos.y > 1.2 && to.length() < 4) {
      if (this.def.flies) { this.anim.flying = true; this.vel.y = 7; } else { this.pos.copy(lead.pos).addScaledVector(lead.forward(), -1.5); }
    }
    if (this.def.flies && lead.pos.y - this.pos.y > 3) { this.anim.flying = true; this.anim.flap = true; this.flapTimer = 0.3; this.vel.y = Math.max(this.vel.y, 4); }
  }
}

// --- enemies -------------------------------------------------------------------------------------

export const ENEMIES = {
  pineling: { model: "tree_pine", scale: 0.33, hp: 34, speed: 3.8, dmg: 9, xp: 14, radius: 0.7, aggro: 15, reach: 1.6 },
  thornwisp: { model: null, scale: 1, hp: 26, speed: 4.2, dmg: 8, xp: 18, radius: 0.6, aggro: 20, reach: 11 },
  knight: { model: "tree_oak", scale: 0.42, hp: 150, speed: 2.5, dmg: 16, xp: 45, radius: 1.05, aggro: 16, reach: 2.4 },
  boss: { model: "tree_pine", scale: 1.25, hp: 8000, speed: 2.2, dmg: 16, xp: 400, radius: 2.6, aggro: 60, reach: 4 },
};

// Googly eyes: whites, pupils and (angry) brows each merged into one shared geometry, so every enemy
// adds 2-3 draw calls instead of 6 and no new materials.
const EYE_WHITE = new THREE.MeshLambertMaterial({ color: "#fffaf0", emissive: "#555" });
const EYE_BLACK = new THREE.MeshBasicMaterial({ color: "#2b2238" });
let eyeGeos = null;
function eyeGeometries() {
  if (eyeGeos) return eyeGeos;
  const whites = [], pupils = [], brows = [];
  for (const side of [-1, 1]) {
    whites.push(new THREE.SphereGeometry(0.32, 12, 10).translate(side * 0.38, 0, 0));
    pupils.push(new THREE.SphereGeometry(0.15, 10, 8).translate(side * 0.38, -0.02, 0.24));
    brows.push(new THREE.BoxGeometry(0.42, 0.08, 0.08).rotateZ(side * -0.45).translate(side * 0.36, 0.3, 0.2));
  }
  eyeGeos = { whites: mergeGeometries(whites), pupils: mergeGeometries(pupils), brows: mergeGeometries(brows) };
  return eyeGeos;
}

function googlyEyes(holder, scale, angry = true) {
  const G = eyeGeometries();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(G.whites, EYE_WHITE), new THREE.Mesh(G.pupils, EYE_BLACK));
  if (angry) {
    const brows = new THREE.Mesh(G.brows, EYE_BLACK);
    brows.userData.brows = true;
    g.add(brows);
  }
  g.scale.setScalar(scale);
  holder.add(g);
  return g;
}

const thornShieldGeo = new THREE.IcosahedronGeometry(1, 1);
const thornShieldMat = new THREE.MeshBasicMaterial({ color: "#b98ae0", wireframe: true, transparent: true, opacity: 0.75 });
const dizzyMat = new THREE.MeshBasicMaterial({ color: "#ffe27a" });

export class Enemy {
  constructor(game, kind, x, z, home) {
    this.game = game;
    this.kind = kind;
    this.def = ENEMIES[kind];
    this.pos = new THREE.Vector3(x, game.world.groundAt(x, z), z);
    this.home = home ? home.clone() : this.pos.clone();
    this.vel = new THREE.Vector3();
    this.radius = this.def.radius;
    this.maxHp = this.def.hp * (1 + 0.15 * (game.party.level - 1) * (kind === "boss" ? 0 : 1));
    this.hp = this.maxHp;
    this.alive = true;
    this.facing = Math.random() * 6;
    this.cool = 1 + Math.random();
    this.rooted = 0;
    this.stun = 0;
    this.bubbled = 0;
    this.thornShield = 0;
    this.taunt = 0;
    this.hurt = 0;
    this.flash = 0;
    this.state = "idle";
    this.wander = 0;
    this.burrowCd = 4 + Math.random() * 6;
    this.shieldCd = 3 + Math.random() * 4;
    this.chargeCd = 3;
    this.mats = [];
    if (this.def.model) {
      this.holder = spawn(this.def.model, this.def.scale);
      this.puppet = new Puppet(this.holder, "pine");
      // Own materials so hits can flash just this one.
      this.holder.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); this.mats.push({ m: o.material, e: o.material.emissive.clone() }); } });
      if (kind === "knight") {
        this.eyes = googlyEyes(this.holder.children[0], 1.6, true);
        this.eyes.position.set(0, 2.4, 1.7);
        // A round wooden shield held in front.
        this.shield = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.3, 24), new THREE.MeshLambertMaterial({ color: "#a2734a", emissive: "#3a2410" }));
        disc.rotation.x = Math.PI / 2;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.16, 8, 28), new THREE.MeshLambertMaterial({ color: "#d9c27a", emissive: "#4a3a10" }));
        const boss = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), new THREE.MeshLambertMaterial({ color: "#e8d58a", emissive: "#4a3a10" }));
        boss.position.z = 0.2;
        this.shield.add(disc, rim, boss);
        this.shield.position.set(0, 1.9, 2.4);
        this.holder.children[0].add(this.shield);
      } else {
        this.eyes = googlyEyes(this.holder.children[0], kind === "boss" ? 1.3 : 1.1, true);
        this.eyes.position.set(0, 2.3, 1.15);
      }
    } else {
      // Thorn wisp: a glowing bramble orb.
      this.holder = new THREE.Group();
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshLambertMaterial({ color: "#c9a0e8", emissive: "#6a3d8a" }));
      const spikes = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), new THREE.MeshLambertMaterial({ color: "#7a5a9a", wireframe: true }));
      this.holder.add(core, spikes);
      this.mats.push({ m: core.material, e: core.material.emissive.clone() });
      this.spikes = spikes;
      const eyes = googlyEyes(this.holder, 0.55, true);
      eyes.position.set(0, 0.05, 0.42);
      this.puppet = null;
    }
    this.holder.position.copy(this.pos);
    game.scene.add(this.holder);
    if (kind === "boss") this.brain = new BossBrain(this);
  }

  get height() { return { pineling: 1.8, thornwisp: 0, knight: 2.3, boss: 7 }[this.kind]; }

  stunFor(s) {
    this.stun = Math.max(this.stun, s);
    this.windup = null;
  }

  /** Damage from heroes. Returns false if it was blocked. */
  takeDamage(n, from, knock = 4, src = {}) {
    if (!this.alive || this.burrowed) return false;
    const g = this.game;
    const proj = src && src.vel ? src : src.projectile;
    const tag = src.tag;
    const hero = src.hero || src.melee || (proj && proj.hero);
    // Thorn shields stop projectiles; two melee hits shatter them.
    if (this.thornShield > 0) {
      if (proj) { g.fx.number(this.pos.clone().add(UP), "Blocked", "#d7b5ff"); g.fx.burst(this.pos.clone().add(UP), "sparkle", 6, { color: "#d7b5ff" }); return false; }
      this.shieldHits = (this.shieldHits || 0) + 1;
      if (this.shieldHits >= 2 || tag === "verse" || tag === "heavy") { this.thornShield = 0; g.fx.burst(this.pos.clone().add(UP), "sparkle", 20, { color: "#d7b5ff", speed: 5 }); g.fx.number(this.pos, "Shield broken!", "#d7b5ff"); }
      else { g.fx.number(this.pos.clone().add(UP), "Crack!", "#d7b5ff"); return false; }
    }
    // The knight's shield blocks anything from the front, unless it's a Verse Shout or a heavy blow.
    if (this.kind === "knight" && from && this.shieldDown <= 0 && this.stun <= 0) {
      const toAttacker = from.clone().sub(this.pos).setY(0).normalize();
      if (this.forward().dot(toAttacker) > 0.3) {
        if (tag === "verse" || tag === "heavy" || tag === "reflect") {
          this.shieldDown = 6; this.stunFor(1.8);
          g.fx.number(this.pos.clone().add(new THREE.Vector3(0, 2.5, 0)), "Shield down!", "#ffe27a");
          g.combat?.shake(0.3); g.sound.play("boss_slam", { vol: 0.4, rate: 1.6 });
        } else {
          g.fx.number(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), "Clank!", "#e8d58a");
          g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(this.forward(), 1.6), "star", 8, { speed: 4, life: 0.3 });
          g.sound.play("hit", { rate: 1.8, vol: 0.5 });
          return false;
        }
      }
    }
    // Hero synergies.
    if (tag === "bolt" && this.bubbled > 0) this.fizzPop();
    if (tag === "verse" && this.rooted > 0) { n *= 2.2; this.vel.y += 9; g.fx.number(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), "Unravelled!", "#ffb3d1"); g.combat && g.combat.stats().synergies++; }
    if (tag === "finisher" && (this.stun > 0 || this.rooted > 0)) { n *= 1.8; g.fx.number(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), "Crack!", "#ffe9a8"); }
    if (tag === "bubble") this.bubbled = 4;
    if (this.kind === "boss") n = this.brain.modifyDamage(n, src, from);
    if (n <= 0) return false;
    this.hp -= n;
    g.stats.damage += n;
    this.hurt = 1;
    this.flash = 0.12;
    if (this.state === "idle") this.state = "chase";
    g.fx.number(this.pos.clone().add(new THREE.Vector3(0, this.kind === "boss" ? 4 : 0.5, 0)), Math.round(n), "#fff4c2");
    if (from && this.kind !== "boss") {
      const k = this.pos.clone().sub(from).setY(0).normalize().multiplyScalar(this.kind === "knight" ? knock * 0.35 : knock);
      this.vel.add(k); this.vel.y += knock * (this.kind === "knight" ? 0.1 : 0.3);
    }
    if (hero && hero === g.active && g.combat) g.combat.focus = this; // friends follow your lead
    g.sound.play(this.kind === "boss" || this.kind === "knight" ? "hit" : "pine_hurt", { vol: 0.5, gap: 0.1 });
    if (this.hp <= 0) this.die();
    return true;
  }

  fizzPop() {
    const g = this.game;
    this.bubbled = 0;
    g.fx.number(this.pos.clone().add(new THREE.Vector3(0, 2.2, 0)), "Fizz Pop!", "#bfe6ff");
    g.fx.burst(this.pos.clone().add(UP), "sparkle", 34, { color: "#bfe6ff", speed: 7 });
    g.sound.play("breath", { rate: 1.6, vol: 0.6 });
    g.combat?.shake(0.25);
    if (g.combat) g.combat.stats().synergies++;
    for (const e of g.enemies) {
      if (e.alive && e !== this && e.pos.distanceTo(this.pos) < 4) { e.takeDamage(18, this.pos, 6, { tag: "pop" }); e.stunFor(1.2); }
    }
    g.destruct?.hitPoint(this.pos, 4, 18, null, "pop");
    if (this.kind === "boss") { this.hp -= this.brain.modifyDamage(14, { tag: "pop" }); return; } // the sap shield applies
    this.stunFor(1.4);
    this.hp -= 14;
  }

  die() {
    this.alive = false;
    const g = this.game;
    g.sound.play("pine_die", { vol: 0.6 });
    g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), this.kind === "thornwisp" ? "sparkle" : "leaf", 26, { speed: 5, color: this.kind === "thornwisp" ? "#d7b5ff" : undefined });
    g.party.gainXp(this.def.xp);
    if (Math.random() < (this.kind === "knight" ? 0.8 : 0.25)) g.dropAcorn(this.pos);
    if (this.windupTg) this.windupTg.cancelled = true;
    if (this.shieldMesh) g.scene.remove(this.shieldMesh);
    if (this.dizzy) g.scene.remove(this.dizzy);
    if (this.kind === "boss") { this.brain.onDeath(); }
    g.onEnemyDefeated(this);
    if (this.kind === "boss") return;
    let k = 1;
    const base = this.def.model ? this.def.scale : 1;
    const fade = () => {
      k -= 0.06;
      this.holder.scale.setScalar(Math.max(0.01, k) * base);
      if (k > 0) requestAnimationFrame(fade); else g.scene.remove(this.holder);
    };
    fade();
  }

  forward() { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }

  faceTowards(v, dt, rate = 6) {
    if (v.lengthSq() < 1e-4) return;
    const want = Math.atan2(v.x, v.z);
    let dd = want - this.facing;
    dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    this.facing += dd * Math.min(1, dt * rate);
  }

  pickTarget() {
    const g = this.game;
    if (this.taunt > 0 && this.taunter && !this.taunter.fainted) return this.taunter;
    let best = null, bd = Infinity;
    for (const h of g.party.members) {
      if (!h.joined || h.fainted || h.playingDead > 0 || h.carried) continue;
      const d = h.pos.distanceTo(this.pos);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  /** Telegraphed attack: stand still for the wind-up, then it lands (unless we're stunned). */
  windupAttack(spec, then) {
    const g = this.game;
    if (!g.combat) return;
    this.windupTg = g.combat.telegraph({ owner: this, from: this.pos.clone(), ...spec, onFire: (tg) => { this.windupTg = null; if (then) then(tg); } });
    this.windup = spec.delay;
  }

  update(dt, t) {
    if (!this.alive) return;
    const g = this.game;
    if (this.kind === "boss") return this.brain.update(dt, t);
    this.hurt = Math.max(0, this.hurt - dt * 3);
    this.rooted -= dt; this.cool -= dt; this.stun -= dt; this.bubbled -= dt; this.taunt -= dt;
    this.thornShield -= dt; this.burrowCd -= dt; this.shieldCd -= dt; this.chargeCd -= dt;
    this.shieldDown = (this.shieldDown || 0) - dt;
    if (this.windup > 0) this.windup -= dt;
    if (this.flash > 0) this.flash -= dt;
    for (const { m, e } of this.mats) m.emissive.copy(this.flash > 0 ? new THREE.Color(1, 1, 1) : this.stun > 0 ? e.clone().lerp(new THREE.Color("#ffe9a8"), 0.35) : e);
    this.updateShieldFx(dt, t);
    if (this.burrowed) return this.burrowUpdate(dt, t);
    if (this.charging) return this.chargeUpdate(dt, t);
    const target = this.pickTarget();
    const dist = target ? target.pos.distanceTo(this.pos) : 1e9;
    if (this.state === "idle" && dist < this.def.aggro) { this.state = "chase"; g.onAggro(this); this.alertPack(); }
    if (this.state === "chase" && (dist > this.def.aggro * 2.2 || !target)) this.state = "idle";
    let move = new THREE.Vector3();
    const busy = this.stun > 0 || this.windup > 0 || g.dialogue.open || (g.combat && g.combat.calm);
    if (!busy && this.state === "retreat") move = this.retreatMove(dt);
    else if (!busy && this.state === "chase" && target) {
      if (this.kind === "thornwisp") move = this.wispTactics(dt, target, dist);
      else if (this.kind === "knight") move = this.knightTactics(dt, target, dist);
      else move = this.packTactics(dt, target, dist);
    } else if (!busy) {
      this.wander -= dt;
      if (this.wander <= 0) { this.wander = 2 + Math.random() * 3; this.wanderDir = Math.random() < 0.4 ? null : new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(); }
      if (this.wanderDir) move.copy(this.wanderDir).multiplyScalar(0.4);
      if (this.pos.distanceTo(this.home) > 14) move.copy(this.home).sub(this.pos).setY(0).normalize();
      if (this.wanderDir) this.faceTowards(move, dt);
    }
    if (this.rooted > 0 || this.anchored) move.set(0, 0, 0);
    const sp = this.def.speed * (this.state === "chase" || this.state === "retreat" ? (this.fleeing > 0 ? 1.7 : 1) : 0.6);
    this.fleeing = (this.fleeing || 0) - dt;
    this.vel.x += (move.x * sp - this.vel.x) * Math.min(1, dt * 6);
    this.vel.z += (move.z * sp - this.vel.z) * Math.min(1, dt * 6);
    if (this.kind === "thornwisp") {
      this.pos.addScaledVector(this.vel, dt);
      g.world.collide(this.pos, this.radius);
      this.pos.y = Math.max(g.world.groundAt(this.pos.x, this.pos.z), g.world.waterAt(this.pos.x, this.pos.z)) + 1.8 + Math.sin(t * 2 + this.home.x) * 0.4;
      this.holder.position.copy(this.pos);
      this.holder.rotation.y = this.facing;
      this.spikes.rotation.x += dt * 2; this.spikes.rotation.y += dt * 1.3;
      return;
    }
    this.vel.y -= GRAV * dt;
    const px = this.pos.x, pz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);
    g.world.collide(this.pos, this.radius);
    // Walking trees and knights stop at the water's edge (swimming away is a way out of a fight).
    const wet = (x, z) => g.world.waterAt(x, z) - terrainHeight(x, z);
    const d = wet(this.pos.x, this.pos.z);
    if (d > 0.45 && d > wet(px, pz)) { this.pos.x = px; this.pos.z = pz; this.vel.x = this.vel.z = 0; }
    const gr = g.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y < gr) { this.pos.y = gr; this.vel.y = 0; }
    this.holder.position.copy(this.pos);
    this.holder.rotation.y = this.facing;
    this.slam = this.slam >= 0 ? this.slam + dt / 0.4 : -1;
    if (this.slam > 1) this.slam = -1;
    if (this.shield) {
      const down = this.shieldDown > 0 || this.stun > 0;
      this.shield.rotation.x += ((down ? 1.1 : 0) - this.shield.rotation.x) * Math.min(1, dt * 8);
      this.shield.position.y += ((down ? 0.9 : 1.9) - this.shield.position.y) * Math.min(1, dt * 8);
    }
    this.puppet.apply({ t, speed: Math.hypot(this.vel.x, this.vel.z), hurt: Math.max(this.hurt, this.stun > 0 ? 0.6 : 0), attack: this.slam ?? -1, attackKind: "slam" });
  }

  updateShieldFx(dt, t) {
    const g = this.game;
    if (this.thornShield > 0) {
      if (!this.shieldMesh) {
        this.shieldMesh = new THREE.Mesh(thornShieldGeo, thornShieldMat);
        g.scene.add(this.shieldMesh);
      }
      const r = this.radius * 1.8 + 0.4;
      this.shieldMesh.scale.setScalar(r);
      this.shieldMesh.position.copy(this.pos).add(new THREE.Vector3(0, this.kind === "thornwisp" ? 0 : r * 0.6, 0));
      this.shieldMesh.rotation.y += dt * 1.5;
    } else if (this.shieldMesh) { g.scene.remove(this.shieldMesh); this.shieldMesh = null; }
    // Dizzy stars when stunned.
    if (this.stun > 0 && this.kind !== "thornwisp") {
      if (!this.dizzy) {
        this.dizzy = new THREE.Group();
        for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), dizzyMat); s.position.set(Math.cos(i * 2.1) * 0.7, 0, Math.sin(i * 2.1) * 0.7); this.dizzy.add(s); }
        g.scene.add(this.dizzy);
      }
      this.dizzy.position.copy(this.pos).add(new THREE.Vector3(0, this.height + 0.3, 0));
      this.dizzy.rotation.y += dt * 5;
    } else if (this.dizzy) { g.scene.remove(this.dizzy); this.dizzy = null; }
  }

  alertPack() {
    for (const e of this.game.enemies) if (e.alive && e !== this && e.state === "idle" && e.kind !== "boss" && e.pos.distanceTo(this.pos) < 14) e.state = "chase";
  }

  // --- pinelings: a pack that taunts from the front, flanks from behind, burrows and retreats ------
  packRank(target) {
    let rank = 0;
    const my = this.pos.distanceTo(target.pos);
    for (const e of this.game.enemies) {
      if (e === this || !e.alive || e.kind !== "pineling" || e.state !== "chase" || e.burrowed) continue;
      if (e.pos.distanceTo(target.pos) < my && e.pos.distanceTo(target.pos) < 16) rank++;
    }
    return rank;
  }

  packTactics(dt, target, dist) {
    const g = this.game, d = this.def;
    if (this.hp < this.maxHp * 0.35 && !this.retreated) {
      this.retreated = true;
      this.state = "retreat";
      this.pool = g.combat ? g.combat.poolFor(this.home) : null;
      if (this.pool) { g.fx.number(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), "Eek! Sap!", "#f2b84b"); return new THREE.Vector3(); }
    }
    const rank = this.packRank(target);
    const to = target.pos.clone().sub(this.pos).setY(0);
    // Burrow and pop up underneath the target.
    if (rank > 0 && this.burrowCd <= 0 && dist > 4.5 && dist < 13 && this.rooted <= 0) { this.startBurrow(target); return new THREE.Vector3(); }
    let goal;
    if (rank === 0) {
      goal = target.pos.clone().addScaledVector(target.forward ? target.forward() : new THREE.Vector3(), 1.6); // the taunter: in your face
    } else {
      const side = rank % 2 ? 1 : -1;
      const ang = target.facing + Math.PI + side * (0.7 + 0.45 * Math.floor((rank - 1) / 2));
      goal = target.pos.clone().add(new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)).multiplyScalar(2.6));
    }
    const toGoal = goal.sub(this.pos).setY(0);
    this.faceTowards(to, dt);
    const inPlace = toGoal.length() < 1.3;
    const facingMe = target.forward ? target.forward().dot(to.clone().negate().normalize()) > 0.4 : false;
    // Taunter swings when close; flankers strike when the target isn't looking (or after a while).
    this.patience = (this.patience || 0) + (inPlace ? dt : 0);
    if (dist < d.reach + target.radius + 0.6 && this.cool <= 0 && (rank === 0 || !facingMe || this.patience > 2.5)) {
      this.cool = 1.6 + Math.random() * 0.6;
      this.patience = 0;
      const aimPt = this.pos.clone().addScaledVector(to.clone().normalize(), Math.min(dist, 1.4));
      this.windupAttack({ shape: "circle", pos: aimPt, r: 1.3, delay: 0.6, dmg: d.dmg, knock: 6 }, () => {
        if (!this.alive) return;
        this.slam = 0;
        this.vel.addScaledVector(to.clone().normalize(), 5);
        g.sound.play("pine_hop", { vol: 0.5 });
      });
      return new THREE.Vector3();
    }
    return toGoal.length() > 0.4 ? toGoal.normalize() : new THREE.Vector3();
  }

  startBurrow(target) {
    const g = this.game;
    this.burrowCd = 9 + Math.random() * 5;
    this.burrowed = 1.3;
    this.burrowTarget = target;
    this.holder.visible = false;
    g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), "leaf", 16, { speed: 4, color: "#a07a4a" });
    g.sound.play("pine_hop", { rate: 0.6 });
  }

  burrowUpdate(dt, t) {
    const g = this.game, tgt = this.burrowTarget;
    this.burrowed -= dt;
    if (this.eruptTg) return; // waiting under the telegraph
    if (tgt && !tgt.fainted) {
      const to = tgt.pos.clone().sub(this.pos).setY(0);
      if (to.length() > 0.5) this.pos.addScaledVector(to.normalize(), Math.min(to.length(), 8 * dt));
      this.pos.y = g.world.groundAt(this.pos.x, this.pos.z);
      if (Math.random() < dt * 8) g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), "puff", 1, { color: "#c9b089", speed: 0.5, life: 0.6 });
    }
    if (this.burrowed <= 0 && g.combat) {
      const at = (tgt && !tgt.fainted ? tgt.pos : this.pos).clone();
      this.eruptTg = g.combat.telegraph({ shape: "circle", pos: at, r: 1.7, delay: 0.9, dmg: 14, knock: 4, lift: 9, owner: null, color: "#f0a860",
        onFire: () => {
          this.eruptTg = null;
          this.burrowed = 0;
          this.pos.set(at.x, g.world.groundAt(at.x, at.z, at.y + 0.5), at.z);
          this.holder.visible = true;
          this.holder.position.copy(this.pos);
          g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), "leaf", 22, { speed: 6, color: "#a07a4a" });
          g.combat.shake(0.2);
          this.stunFor(0.9); // a moment to punish it after it pops up
          this.cool = 1.2;
        } });
    }
  }

  retreatMove(dt) {
    const g = this.game, p = this.pool;
    if (!p) { this.state = "chase"; return new THREE.Vector3(); }
    const to = p.pos.clone().sub(this.pos).setY(0);
    if (to.length() > 1) { this.faceTowards(to, dt); return to.normalize(); }
    if (!p.denied) {
      this.hp = Math.min(this.maxHp, this.hp + 9 * dt);
      if (Math.random() < dt * 5) g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), "heal", 1, { color: "#f2b84b", speed: 1 });
    }
    this.retreatTime = (this.retreatTime || 0) + dt;
    if (this.hp >= this.maxHp * 0.9 || (p.denied && this.retreatTime > 2)) { this.state = "chase"; this.retreatTime = 0; }
    return new THREE.Vector3();
  }

  // --- thornwisps: kite, flee melee, line-shot thorns, and shield allies -------------------------
  wispTactics(dt, target, dist) {
    const g = this.game, d = this.def;
    const to = target.pos.clone().sub(this.pos).setY(0);
    let move = new THREE.Vector3();
    if (dist < 4.5) { this.fleeing = 1.2; move.copy(to).normalize().negate(); }
    else if (dist > 10) move.copy(to).normalize();
    else if (dist < 7.5) move.copy(to).normalize().negate();
    else move.set(-to.z, 0, to.x).normalize().multiplyScalar(0.6 * (Math.sin(g.t * 0.7 + this.home.x) > 0 ? 1 : -1)); // orbit
    this.faceTowards(to, dt);
    // Shield the nearest ally.
    if (this.shieldCd <= 0) {
      const ally = g.enemies.filter((e) => e.alive && e !== this && e.kind !== "boss" && e.kind !== "thornwisp" && e.thornShield <= 0 && e.pos.distanceTo(this.pos) < 14)
        .sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))[0];
      if (ally) {
        this.shieldCd = 9;
        ally.thornShield = 6; ally.shieldHits = 0;
        g.fx.burst(ally.pos.clone().add(UP), "sparkle", 16, { color: "#d7b5ff", speed: 3 });
        g.sound.play("portal", { vol: 0.25, rate: 1.4 });
      } else this.shieldCd = 3;
    }
    // Aim a thorn lance: the line shows first, then the thorn flies along it.
    if (this.cool <= 0 && dist < 18) {
      this.cool = 2.6;
      const dir = to.clone().normalize();
      const start = this.pos.clone().setY(g.world.groundAt(this.pos.x, this.pos.z));
      this.windupAttack({ shape: "line", pos: start, dir, length: 16, width: 0.9, delay: 0.65, dmg: 0, color: "#c58cf0" }, () => {
        if (!this.alive) return;
        g.sound.play("needles", { vol: 0.35 });
        g.fx.shoot({ pos: this.pos.clone(), vel: dir.clone().setY(-0.05).multiplyScalar(22), radius: 0.55, from: "enemy", owner: this,
          color: "#c58cf0", size: 0.65, life: 1.2, damage: d.dmg, trail: "sparkle" });
      });
    }
    return move;
  }

  // --- the Bramble Knight: a shield in front, slow to turn, and a charge you can bait into trees ----
  knightTactics(dt, target, dist) {
    const g = this.game, d = this.def;
    const to = target.pos.clone().sub(this.pos).setY(0);
    this.faceTowards(to, dt, 1.7); // slow to turn: get behind it
    if (dist < d.reach + target.radius + 0.8 && this.cool <= 0) {
      this.cool = 2.2;
      this.windupAttack({ shape: "cone", pos: this.pos.clone(), dir: this.forward(), r: 3, angle: 1.7, delay: 0.75, dmg: d.dmg, knock: 10 }, () => {
        if (!this.alive) return;
        this.slam = 0;
        g.sound.play("boss_slam", { vol: 0.35, rate: 1.5 });
      });
      return new THREE.Vector3();
    }
    if (dist > 5 && dist < 15 && this.chargeCd <= 0) {
      this.chargeCd = 7 + Math.random() * 3;
      const dir = to.clone().normalize();
      this.facing = Math.atan2(dir.x, dir.z);
      const len = Math.min(dist + 5, 18);
      g.ui.bubble(this, "HRRRMM!");
      this.windupAttack({ shape: "line", pos: this.pos.clone(), dir, length: len, width: 2.0, delay: 1.1, dmg: 0, color: "#ff9a6b" }, () => {
        if (!this.alive || this.stun > 0) return;
        this.charging = { dir, left: len, hit: new Set() };
        g.sound.play("roar", { vol: 0.4, rate: 0.6 });
      });
      return new THREE.Vector3();
    }
    return dist > d.reach ? to.normalize() : new THREE.Vector3();
  }

  chargeUpdate(dt, t) {
    const g = this.game, c = this.charging;
    const step = Math.min(c.left, 15 * dt);
    const before = this.pos.clone();
    this.pos.addScaledVector(c.dir, step);
    // It smashes straight through fences and little things; trees and walls still stop it (BONK).
    g.destruct?.hitPoint(this.pos, this.radius + 0.7, 26 * dt * 8, c.dir, "charge");
    g.world.collide(this.pos, this.radius);
    this.pos.y = g.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
    const blocked = before.distanceTo(this.pos) < step * 0.5;
    c.left -= step;
    for (const h of g.party.members) {
      if (!h.joined || h.fainted || c.hit.has(h)) continue;
      if (h.pos.distanceTo(this.pos) < this.radius + h.radius + 0.4) { c.hit.add(h); h.takeDamage(20, this.pos, { knock: 12, lift: 5, melee: this }); }
    }
    if (Math.random() < dt * 20) g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), "puff", 1, { color: "#d9c9a0", speed: 1 });
    if (blocked) {
      // Bonk! It ran into a tree or a wall: dazed, shield dropped, back wide open.
      this.charging = null;
      this.stunFor(3.5);
      this.shieldDown = 4;
      g.fx.number(this.pos.clone().add(new THREE.Vector3(0, 2.6, 0)), "BONK!", "#ffe27a");
      g.fx.burst(this.pos.clone().add(new THREE.Vector3(0, 2, 0)), "star", 20, { speed: 5 });
      g.combat?.shake(0.35);
      g.sound.play("boss_slam", { vol: 0.5, rate: 1.3 });
    } else if (c.left <= 0) this.charging = null;
    this.holder.position.copy(this.pos);
    this.holder.rotation.y = this.facing;
    this.puppet.apply({ t, speed: 6, running: true, hurt: 0, attack: -1 });
  }
}
