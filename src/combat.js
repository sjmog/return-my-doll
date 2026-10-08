// Combat systems shared by heroes, enemies and the boss: ground telegraphs, hit resolution
// (perfect dodge, parry, ward), hit-stop and slow motion, screen shake, stamina, charged attacks,
// reviving fallen friends, companion orders, sap pools, and the HUD bits for all of that.
import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const DANGER = new THREE.Color("#e4405a");
const STAMINA_MAX = 100;
export const COSTS = { mobility: 26, special: 30, charged: 22, guard: 12 };

function decalMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false,
  });
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.telegraphs = [];
    this.pools = [];
    this.hitstopT = 0;
    this.slowT = 0;
    this.slowScale = 1;
    this.shakeAmt = 0;
    this.order = "attack"; // companions: follow | attack | hold
    this.holdPos = null;
    this.focus = null; // the enemy the player last hit; companions focus it
    this.charge = { held: false, t: 0, hero: null };
    this.reviving = { target: null, t: 0 };
    this.calm = false; // activities may pause combat
    this.buildHud();
    this.bindInput();
  }

  // --- time & camera feel -----------------------------------------------------------------------
  hitstop(s = 0.06) { this.hitstopT = Math.max(this.hitstopT, s); }
  slowmo(s = 0.6, scale = 0.3) { this.slowT = Math.max(this.slowT, s); this.slowScale = scale; }
  shake(amount = 0.25) { this.shakeAmt = Math.min(1.2, this.shakeAmt + amount); }

  /** Scales the fixed simulation step for hit-stop and slow motion. */
  timeScale(dt) {
    if (this.hitstopT > 0) { this.hitstopT -= dt; return dt * 0.04; }
    if (this.slowT > 0) { this.slowT -= dt; return dt * this.slowScale; }
    return dt;
  }

  applyShake(camera, dt) {
    if (this.shakeAmt < 0.002) return;
    const a = this.shakeAmt;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a * 0.7;
    camera.position.z += (Math.random() - 0.5) * a;
    this.shakeAmt *= Math.exp(-dt * 9);
  }

  // --- telegraphs ---------------------------------------------------------------------------------
  /**
   * Show where an attack will land, then resolve it.
   * spec: { shape: circle|ring|line|cone, pos, dir, r, r2 (ring inner), length, width, angle,
   *         delay, dmg, knock, lift, from, hitAir (default false), onFire(tg), color, owner }
   */
  telegraph(spec) {
    const tg = { t: 0, delay: 0.8, dmg: 10, knock: 6, lift: 3, hitAir: false, ...spec };
    tg.pos = spec.pos.clone();
    tg.dir = spec.dir ? spec.dir.clone().setY(0).normalize() : new THREE.Vector3(0, 0, 1);
    const g = this.game;
    const y = (spec.y ?? g.world.groundAt(tg.pos.x, tg.pos.z, tg.pos.y + 0.5)) + 0.08;
    const color = new THREE.Color(spec.color || DANGER);
    const group = new THREE.Group();
    let outline, fill;
    if (tg.shape === "circle") {
      outline = new THREE.Mesh(new THREE.RingGeometry(tg.r - 0.18, tg.r, 48), decalMaterial(color, 1));
      fill = new THREE.Mesh(new THREE.CircleGeometry(tg.r, 48), decalMaterial(color, 0.45));
    } else if (tg.shape === "ring") {
      outline = new THREE.Mesh(new THREE.RingGeometry(tg.r2, tg.r, 64), decalMaterial(color, 0.22));
      fill = new THREE.Mesh(new THREE.RingGeometry(tg.r2, tg.r, 64), decalMaterial(color, 0.42));
    } else if (tg.shape === "cone") {
      const a = tg.angle;
      outline = new THREE.Mesh(new THREE.CircleGeometry(tg.r, 32, Math.PI / 2 - a / 2, a), decalMaterial(color, 0.3));
      fill = new THREE.Mesh(new THREE.CircleGeometry(tg.r, 32, Math.PI / 2 - a / 2, a), decalMaterial(color, 0.55));
    } else { // line
      const geo = new THREE.PlaneGeometry(tg.width, tg.length);
      geo.translate(0, tg.length / 2, 0);
      outline = new THREE.Mesh(geo, decalMaterial(color, 0.3));
      fill = new THREE.Mesh(geo.clone(), decalMaterial(color, 0.6));
    }
    for (const m of [outline, fill]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 5; group.add(m); }
    group.position.set(tg.pos.x, y, tg.pos.z);
    // Point the shape's +Y (before laying flat) along dir.
    group.rotation.y = Math.atan2(tg.dir.x, tg.dir.z) + Math.PI;
    if (tg.shape === "line" || tg.shape === "cone") group.rotation.y = Math.atan2(-tg.dir.x, -tg.dir.z);
    g.scene.add(group);
    tg.mesh = group;
    tg.fill = fill;
    tg.y = y;
    this.telegraphs.push(tg);
    return tg;
  }

  inside(tg, p, radius = 0) {
    const dx = p.x - tg.pos.x, dz = p.z - tg.pos.z;
    const d = Math.hypot(dx, dz);
    if (tg.shape === "circle") return d <= tg.r + radius;
    if (tg.shape === "ring") return d <= tg.r + radius && d >= tg.r2 - radius;
    if (tg.shape === "cone") {
      if (d > tg.r + radius) return false;
      if (d < 0.6) return true;
      return Math.acos(Math.max(-1, Math.min(1, (dx * tg.dir.x + dz * tg.dir.z) / d))) <= tg.angle / 2 + 0.1;
    }
    const along = dx * tg.dir.x + dz * tg.dir.z, perp = Math.abs(dx * tg.dir.z - dz * tg.dir.x);
    return along >= -radius && along <= tg.length + radius && perp <= tg.width / 2 + radius;
  }

  /** Is this spot inside a telegraph that's about to fire? (companions and bots avoid them) */
  danger(p, radius = 0.5, within = 2) {
    return this.telegraphs.find((tg) => !tg.fired && tg.delay - tg.t < within && this.inside(tg, p, radius));
  }

  resolve(tg) {
    tg.fired = true;
    const g = this.game;
    for (const h of g.party.members) {
      if (!h.joined || h.fainted) continue;
      if (!tg.hitAir && h.pos.y - g.world.groundAt(h.pos.x, h.pos.z, h.pos.y) > 0.45) continue;
      if (Math.abs(h.pos.y - tg.y) > 3.5) continue;
      if (!this.inside(tg, h.pos, h.radius * 0.6)) continue;
      const from = tg.from || tg.pos;
      if (tg.dmg > 0 && this.hitHero(h, tg.dmg, from, { telegraph: tg, knock: tg.knock, lift: tg.lift }) && tg.onHit) tg.onHit(h);
    }
    g.destruct?.hitTelegraph(tg);
    if (tg.onFire) tg.onFire(tg);
  }

  // --- hits on heroes -----------------------------------------------------------------------------
  /** Central damage path for heroes. Returns true if damage landed, "reflected" for a parried projectile. */
  hitHero(h, dmg, from, src = {}) {
    const g = this.game;
    if (h.fainted || g.cheats.god || this.calm) return false;
    // Perfect dodge: hit just after starting a dodge.
    if (h.lastDodge !== undefined && g.t - h.lastDodge < 0.32) {
      if (!h.perfected) this.perfectDodge(h);
      return false;
    }
    if (h.invuln > 0) return false;
    // The Boy's parry: reflect projectiles, stagger melee attackers.
    if (h.parry > 0) {
      g.fx.burst(h.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), "star", 14, { speed: 5, life: 0.4 });
      g.sound.play("hit", { rate: 1.6 });
      this.hitstop(0.09);
      this.shake(0.2);
      h.parry = 0;
      h.counter = Math.max(h.counter || 0, 1.5);
      this.stats().parries++;
      if (src.projectile) {
        const p = src.projectile;
        p.from = "player";
        const back = p.owner && p.owner.alive ? p.owner.pos.clone().add(new THREE.Vector3(0, 1, 0)).sub(p.pos).normalize() : p.vel.clone().negate().normalize();
        p.vel.copy(back.multiplyScalar(p.vel.length() * 1.4 + 4));
        p.damage = (p.damage || 8) * 2.2;
        p.color = "#fff3b0";
        p.sprite.material.color.set("#fff3b0");
        p.age = 0;
        p.tag = "reflect";
        g.fx.number(h.pos, "Parried!", "#fff3b0");
        return "reflected";
      }
      if (src.melee && src.melee.stunFor) { src.melee.stunFor(1.6); g.fx.number(h.pos, "Parried!", "#fff3b0"); }
      else g.fx.number(h.pos, "Blocked!", "#fff3b0");
      return false;
    }
    // The Girl's ward bubble eats one hit.
    if (h.ward > 0) {
      h.ward = 0;
      g.fx.burst(h.pos.clone().add(new THREE.Vector3(0, 1.1, 0)), "heal", 18, { color: "#cdb7ff", speed: 4 });
      g.fx.number(h.pos, "Warded!", "#cdb7ff");
      g.sound.play("blink");
      return false;
    }
    h.applyDamage(dmg, from, src);
    if (h === g.active) { this.shake(0.18 + dmg * 0.01); this.hitstop(0.05); }
    return true;
  }

  perfectDodge(h) {
    const g = this.game;
    h.perfected = true;
    h.counter = 2.2;
    h.stamina = Math.min(STAMINA_MAX, h.stamina + 20);
    this.slowmo(0.7, 0.3);
    g.fx.number(h.pos, "Perfect dodge!", "#bfe6ff");
    g.fx.burst(h.pos.clone().add(new THREE.Vector3(0, 1, 0)), "sparkle", 26, { color: "#bfe6ff", speed: 5 });
    g.sound.play("blink", { rate: 0.7 });
    this.stats().perfect++;
  }

  stats() { return (this.game.stats.combat ||= { perfect: 0, parries: 0, synergies: 0, revives: 0, charged: 0 }); }

  // --- stamina -----------------------------------------------------------------------------------
  spend(h, n) {
    if (h.stamina < n) {
      this.tiredFlash = 0.5;
      if (h === this.game.active && !this.tiredToast) { this.game.fx.number(h.pos, "Too tired!", "#ffd0a8"); this.tiredToast = 1; }
      return false;
    }
    h.stamina -= n;
    h.staminaWait = 0.8;
    return true;
  }

  // --- input -------------------------------------------------------------------------------------
  bindInput() {
    const g = this.game;
    const live = () => g.started && !g.paused && !g.dialogue.open;
    addEventListener("keydown", (e) => {
      if (e.repeat || !live()) return;
      if (e.code === "KeyF") this.guard();
      if (e.code === "KeyG") this.cycleOrder();
      if (e.code === "KeyJ") this.startCharge();
    });
    addEventListener("keyup", (e) => { if (e.code === "KeyJ") this.releaseCharge(); });
    g.canvas.addEventListener("mousedown", (e) => { if (e.button === 0 && live()) this.startCharge(); });
    addEventListener("mouseup", (e) => { if (e.button === 0) this.releaseCharge(); });
  }

  guard() {
    const h = this.game.active;
    if (!h || h.fainted || (h.cd.guard || 0) > 0) return;
    const fn = { boy: "parryUp", girl: "wardUp", dragon: "roarTaunt", doll: "playDead" }[h.id];
    if (fn && h[fn]) h[fn]();
  }

  cycleOrder() {
    const g = this.game;
    const next = { attack: "follow", follow: "hold", hold: "attack" }[this.order];
    this.order = next;
    if (next === "hold") this.holdPos = g.active.pos.clone();
    g.ui.toast({ attack: "Friends: attack my target! (G)", follow: "Friends: stay close and keep safe. (G)", hold: "Friends: hold this spot. (G)" }[next]);
    this.hudOrder();
    g.sound.play("talk", { vol: 0.5 });
  }

  startCharge() {
    const h = this.game.active;
    if (!h || (h.id !== "boy" && h.id !== "girl")) return;
    this.charge = { held: true, t: 0, hero: h };
  }

  releaseCharge() {
    const c = this.charge;
    if (!c.held) return;
    c.held = false;
    const h = c.hero;
    if (c.t >= 0.55 && h === this.game.active && !h.fainted && this.spend(h, COSTS.charged)) {
      const aim = this.game.cameraForward();
      const foe = this.game.nearestEnemy(h.pos, 14, aim);
      const dir = foe ? foe.pos.clone().sub(h.pos).setY(0).normalize() : aim;
      h.charged(dir);
      this.stats().charged++;
    }
  }

  // --- reviving & companions ----------------------------------------------------------------------
  downedNear(h) {
    return this.game.party.members.find((m) => m.joined && m.fainted && m !== h && m.pos.distanceTo(h.pos) < 2.8);
  }

  isReviving(h) { return this.reviving.target && this.game.active === h; }

  // --- sap pools: where hurt pinelings go to heal -------------------------------------------------
  poolFor(home) {
    let p = this.pools.find((x) => x.home.distanceTo(home) < 1);
    if (p) return p;
    const g = this.game;
    const a = Math.random() * Math.PI * 2;
    const pos = home.clone().add(new THREE.Vector3(Math.cos(a) * 7, 0, Math.sin(a) * 7));
    pos.y = g.world.groundAt(pos.x, pos.z);
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(1.8, 32), decalMaterial(new THREE.Color("#f2b84b"), 0.55));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos).add(new THREE.Vector3(0, 0.07, 0));
    g.scene.add(mesh);
    p = { home: home.clone(), pos, mesh, denied: false };
    this.pools.push(p);
    return p;
  }

  // --- per step ----------------------------------------------------------------------------------
  update(dt, t, talking) {
    const g = this.game;
    // Telegraphs fill up, then fire.
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const tg = this.telegraphs[i];
      if (talking && !tg.fired) continue;
      // Interrupted: the attacker was stunned or beaten mid wind-up, so the attack fizzles.
      const o = tg.owner;
      if (!tg.fired && (tg.cancelled || (o && o.kind && o.kind !== "boss" && (!o.alive || o.stun > 0)))) {
        if (o && o.alive && !tg.cancelled) g.fx.number(tg.pos, "Interrupted!", "#d6ffd0");
        g.scene.remove(tg.mesh);
        for (const m of tg.mesh.children) { m.geometry.dispose(); m.material.dispose(); }
        if (o && o.windupTg === tg) { o.windupTg = null; o.windup = 0; }
        this.telegraphs.splice(i, 1);
        continue;
      }
      tg.t += dt;
      if (!tg.fired) {
        const u = Math.min(1, tg.t / tg.delay);
        if (tg.shape === "circle" || tg.shape === "cone") tg.fill.scale.setScalar(Math.max(0.02, u));
        else if (tg.shape === "line") tg.fill.scale.set(1, Math.max(0.02, u), 1);
        else tg.fill.material.opacity = 0.15 + 0.4 * u;
        tg.fill.material.opacity = tg.shape === "ring" ? tg.fill.material.opacity : 0.35 + 0.4 * u;
        tg.mesh.children[0].material.opacity = (tg.shape === "circle" ? 0.75 : 0.25) + 0.25 * Math.sin(tg.t * 18) * (u > 0.7 ? 1 : 0);
        if (tg.t >= tg.delay) { this.resolve(tg); tg.flash = 0; }
      } else {
        tg.flash += dt;
        tg.fill.material.color.set("#fff4e6");
        for (const m of tg.mesh.children) m.material.opacity = Math.max(0, 0.6 * (1 - tg.flash / 0.25));
        if (tg.flash > 0.25) { g.scene.remove(tg.mesh); for (const m of tg.mesh.children) { m.geometry.dispose(); m.material.dispose(); } this.telegraphs.splice(i, 1); }
      }
    }
    // Stamina, guard timers and counter windows for every hero.
    for (const h of g.party.members) {
      if (!h.joined) continue;
      h.staminaWait = (h.staminaWait || 0) - dt;
      if (h.staminaWait <= 0) h.stamina = Math.min(STAMINA_MAX, h.stamina + 30 * dt);
      h.parry = Math.max(0, (h.parry || 0) - dt);
      h.counter = Math.max(0, (h.counter || 0) - dt);
      if (h.lastDodge !== undefined && g.t - h.lastDodge > 0.4) h.perfected = false;
      if (h.ward > 0) {
        h.ward -= dt;
        h.wardMesh && (h.wardMesh.visible = h.ward > 0);
      }
      if (h.playingDead > 0) h.playingDead -= dt;
    }
    // Charging a heavy attack.
    const c = this.charge;
    if (c.held) { c.t += dt; if (c.hero !== g.active) c.held = false; }
    // Reviving: hold E beside a fallen friend.
    const a = g.active;
    const down = !talking && a && !a.fainted ? this.downedNear(a) : null;
    if (down && g.keys.has("KeyE")) {
      if (this.reviving.target !== down) this.reviving = { target: down, t: 0 };
      this.reviving.t += dt;
      if (this.reviving.t >= 1.6) {
        down.revive(0.5);
        g.ui.toast(`${a.def.name} helped ${down.def.name} up!`);
        g.sound.play("heal", { vol: 0.6 });
        this.stats().revives++;
        this.reviving = { target: null, t: 0 };
      }
    } else this.reviving = { target: null, t: 0 };
    this.downNearby = down;
    // Sap pools are denied while a hero stands on them.
    for (const p of this.pools) {
      p.denied = g.party.members.some((h) => h.joined && !h.fainted && h.pos.distanceTo(p.pos) < 3);
      p.mesh.material.opacity = p.denied ? 0.18 : 0.45 + 0.12 * Math.sin(t * 3);
    }
    if (this.focus && !this.focus.alive) this.focus = null;
    if (this.tiredFlash > 0) this.tiredFlash -= dt;
    if (this.tiredToast > 0) this.tiredToast -= dt;
    this.updateHud();
  }

  clear() {
    for (const tg of this.telegraphs) this.game.scene.remove(tg.mesh);
    this.telegraphs = [];
  }

  // --- HUD -------------------------------------------------------------------------------------
  buildHud() {
    const css = document.createElement("style");
    css.textContent = `
      #stamina { position: fixed; z-index: 5; bottom: 74px; left: 50%; transform: translateX(-50%); width: 260px; height: 9px;
        background: rgba(255,252,245,.85); border: 1.5px solid #e7dccb; border-radius: 99px; overflow: hidden; }
      #stamina i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #a8d8b0, #d6efa8); transition: width .1s; }
      #stamina.tired i { background: #f6b3a8; }
      #hud.talking #stamina, #hud.talking #orders, #hud.talking #charge { display: none; }
      #orders { position: fixed; z-index: 5; bottom: 16px; left: calc(50% + 330px); font: 800 12px Nunito, sans-serif; color: #3b3049;
        background: rgba(255,252,245,.9); border: 1.5px solid #e7dccb; border-radius: 12px; padding: 6px 10px; }
      #charge { position: fixed; z-index: 6; left: 0; top: 0; width: 56px; height: 56px; pointer-events: none; }
      #charge circle { fill: none; stroke: #fff3b0; stroke-width: 5; stroke-dasharray: 150.8; filter: drop-shadow(0 0 4px rgba(255,220,120,.9)); }
      #revive { position: fixed; z-index: 6; bottom: 120px; left: 50%; transform: translateX(-50%); background: #3b3049; color: #fff;
        font: 800 14px Nunito, sans-serif; padding: 7px 14px; border-radius: 99px; }
      #revive b { display: inline-block; width: 80px; height: 6px; background: rgba(255,255,255,.25); border-radius: 99px; overflow: hidden; vertical-align: middle; margin-left: 8px; }
      #revive b i { display: block; height: 100%; background: #b6f5c4; }
      @media (max-width: 900px) { #orders { left: auto; right: 220px; } }
    `;
    document.head.appendChild(css);
    const hud = document.querySelector("#hud");
    hud.insertAdjacentHTML("beforeend", `<div id="stamina" title="Stamina: dodges, specials and charged attacks"><i></i></div>
      <div id="orders"></div>
      <svg id="charge" viewBox="0 0 56 56" hidden><circle cx="28" cy="28" r="24"/></svg>
      <div id="revive" hidden>Hold <kbd style="background:#fff;color:#3b3049;border-radius:5px;padding:0 5px">E</kbd> to help <span></span> up<b><i></i></b></div>`);
    this.el = { stamina: hud.querySelector("#stamina"), orders: hud.querySelector("#orders"), charge: hud.querySelector("#charge"), revive: hud.querySelector("#revive") };
    this.hudOrder();
  }

  hudOrder() {
    this.el.orders.textContent = { attack: "⚔️ Friends: attack", follow: "🫶 Friends: follow", hold: "🛡️ Friends: hold" }[this.order] + "  ·  G";
  }

  updateHud() {
    const g = this.game, h = g.active;
    if (!h || !this.el) return;
    this.el.stamina.querySelector("i").style.width = `${(h.stamina / STAMINA_MAX) * 100}%`;
    this.el.stamina.classList.toggle("tired", this.tiredFlash > 0 || h.stamina < 20);
    const c = this.charge;
    const show = c.held && c.t > 0.12 && c.hero === h;
    this.el.charge.hidden = !show;
    if (show) {
      const v = h.pos.clone().add(new THREE.Vector3(0, 1.1, 0)).project(g.camera);
      this.el.charge.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth - 28}px, ${(-v.y * 0.5 + 0.5) * innerHeight - 28}px)`;
      const u = Math.min(1, c.t / 0.55);
      const circ = this.el.charge.querySelector("circle");
      circ.style.strokeDashoffset = String(150.8 * (1 - u));
      circ.style.stroke = u >= 1 ? "#ffd36b" : "#fff3b0";
    }
    const d = this.downNearby;
    this.el.revive.hidden = !d;
    if (d) {
      this.el.revive.querySelector("span").textContent = d.def.name;
      this.el.revive.querySelector("b i").style.width = `${Math.min(1, this.reviving.t / 1.6) * 100}%`;
    }
  }
}
