// The Great Pine: a three-phase fight on the Mushroom Tree's cap.
//   I   Sap & Needles: a sap shield fed by linked pinelings (kill the adds or chip the boss),
//       telegraphed needle lines (dodge sideways, or the Boy can parry them back) and root eruptions.
//   II  Hostage: he holds Dolly in front of him (careless shots hit her), sweeps a branch across the
//       cap (jump it), and the cap's edge starts to crumble.
//   III Fall: he flings Dolly off the cap (switch to Biscuit and catch her), then fights enraged with
//       marching roots and needle spirals; after each combo he staggers, exposing glowing roots.
//       During a stagger you can throw him a stick instead — Biscuit's lesson — and befriend him.
import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const AMBER = "#f2b84b";

export class BossBrain {
  constructor(boss) {
    this.boss = boss;
    this.game = boss.game;
    this.phase = 0;
    this.links = [];
    this.tethers = [];
    this.pattern = 2.5;
    this.combo = 0;
    this.stagger = 0;
    this.shieldWindow = 0;
    this.linkCd = 0;
    this.sweepCd = 5;
    this.courage = 100; // Dolly's patience with your aim while she's held
    this.dollState = "cap"; // cap | held | falling | caught | landed | free
    this.hintGiven = false;
    this.lastShieldMsg = 0;
    const g = this.game;
    const cap = g.world.platforms.find((p) => p.name === "cap");
    this.cap = cap;
    this.capR0 = cap.r;
    this.capTop = g.world.capTop;
    this.buildHud();
    this.keyHandler = (e) => { if (e.code === "KeyE" && this.stickPrompt && !g.dialogue.open) this.throwStick(); };
    addEventListener("keydown", this.keyHandler);
  }

  get doll() { return this.game.party.byId.doll; }
  get dragon() { return this.game.party.byId.dragon; }
  linksAlive() { return this.links.filter((e) => e.alive).length; }
  shielded() { return this.linksAlive() > 0; }

  // --- damage rules ---------------------------------------------------------------------------------
  modifyDamage(n, src = {}, from) {
    const g = this.game;
    if (this.cinematic || this.befriended) return 0;
    if (src.tag === "reflect") n *= 1.5; // his own needles, parried back: they ignore the sap shield
    else if (this.shielded()) {
      n *= 0.12;
      if (g.t - this.lastShieldMsg > 1.2) {
        this.lastShieldMsg = g.t;
        g.fx.number(this.boss.pos.clone().add(new THREE.Vector3(0, 5, 0)), "Sap shield! Cut his root-links", AMBER);
        g.fx.burst(this.boss.pos.clone().add(new THREE.Vector3(0, 3, 0)), "sparkle", 10, { color: AMBER, speed: 3 });
      }
    }
    if (this.stagger > 0) n *= 2;
    // Don't let one big hit skip a phase's mechanics.
    const b = this.boss;
    const floors = [0.65, 0.35];
    for (const f of floors) {
      const line = b.maxHp * f;
      if (b.hp > line && b.hp - n < line - 1 && this.phaseFor(b.hp) < this.phaseFor(line - 1)) n = b.hp - line + 0.5;
    }
    return n;
  }

  phaseFor(hp) { const m = this.boss.maxHp; return hp > m * 0.65 ? 1 : hp > m * 0.35 ? 2 : 3; }

  /** Player projectiles fired at the boss while he's holding Dolly can hit her instead. */
  projectileHook(p) {
    if (this.dollState !== "held" || p.from !== "player") return false;
    if (p.pos.distanceTo(this.doll.pos.clone().add(new THREE.Vector3(0, 0.4, 0))) > 1.4) return false;
    const g = this.game;
    this.courage -= p.damage * 1.5;
    g.fx.number(this.doll.pos.clone().add(UP), ["Ow!", "Watch it!", "MY BUTTONS!", "Aim, please!"][Math.floor(Math.random() * 4)], "#ffb3d1");
    g.sound.play("doll", { rate: 1.3 });
    if (this.courage <= 0) {
      this.courage = 100;
      const heal = this.boss.maxHp * 0.08;
      this.boss.hp = Math.min(this.boss.maxHp * (this.phase === 2 ? 0.65 : 1), this.boss.hp + heal);
      g.ui.bubble(this.boss, "Hah! Careless! Your doll's tears are delicious sap!");
      g.fx.burst(this.boss.pos.clone().add(new THREE.Vector3(0, 3, 0)), "heal", 30, { color: AMBER, speed: 5 });
    }
    return true;
  }

  // --- phases ---------------------------------------------------------------------------------------
  update(dt, t) {
    const b = this.boss, g = this.game;
    b.hurt = Math.max(0, b.hurt - dt * 3);
    if (b.flash > 0) b.flash -= dt;
    for (const { m, e } of b.mats) m.emissive.copy(b.flash > 0 ? new THREE.Color(1, 1, 1) : this.stagger > 0 ? e.clone().lerp(new THREE.Color("#ffe27a"), 0.5) : e);
    this.updateDoll(dt, t);
    this.updateTethers();
    this.updateArena(dt, t);
    this.updateHud(t);
    b.holder.position.copy(b.pos);
    b.holder.rotation.y = b.facing;
    const talking = g.dialogue.open;
    if (!b.started || talking || this.befriended) {
      b.puppet.apply({ t, speed: 0, hurt: b.hurt, talk: talking && g.dialogue.line?.who === "pine" });
      return;
    }
    if (this.phase === 0) this.enterPhase(1);
    const want = this.phaseFor(b.hp);
    if (want > this.phase && !this.cinematic) this.enterPhase(want);
    for (const h of g.party.members) h.camp = h.joined && !h.fainted && h.pos.distanceTo(b.pos) < 5.6 ? (h.camp || 0) + dt : 0;
    this.stagger -= dt;
    this.linkCd -= dt;
    this.sweepCd -= dt;
    this.shieldWindow -= dt;
    this.updateSweep(dt);
    this.stickPrompt = this.phase === 3 && this.stagger > 0 && this.dragon.joined && !this.cinematic &&
      g.active.pos.distanceTo(b.pos) < 11 && !this.sweep;
    this.el.stick.hidden = !this.stickPrompt;
    if (this.stagger > 0 || this.cinematic) {
      b.puppet.apply({ t, speed: 0, hurt: 0.8, attack: -1 });
      if (Math.random() < dt * 10) g.fx.burst(b.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.4, (Math.random() - 0.5) * 3)), "sparkle", 1, { color: "#ffe27a", speed: 2, size: 0.7 });
      return;
    }
    // Face the nearest hero (slowly: flank him and Dolly isn't in your way).
    const target = b.pickTarget();
    if (target) b.faceTowards(target.pos.clone().sub(b.pos).setY(0), dt, this.phase === 3 ? 1.6 : 0.9);
    // Keep the sap shield fed in phases I and III.
    if ((this.phase === 1 || this.phase === 3) && !this.shielded() && this.shieldWindow <= 0 && this.linkCd <= 0) this.summonLinks(this.phase === 1 ? 3 : 2);
    this.pattern -= dt;
    if (this.pattern <= 0 && target) this.nextAttack(target);
    b.slam = b.slam >= 0 ? b.slam + dt / 0.9 : -1;
    if (b.slam > 1) b.slam = -1;
    b.puppet.apply({ t, speed: 0, hurt: b.hurt, attack: b.slam, attackKind: "slam" });
  }

  enterPhase(n) {
    const g = this.game, b = this.boss;
    this.phase = n;
    this.pattern = 2.2;
    this.combo = 0;
    if (n === 1) {
      g.ui.toast("The Great Pine is shielded by sap. Cut the glowing root-links first!", "quest");
      this.summonLinks(3);
    } else if (n === 2) {
      // Grab Dolly and hold her up as a shield.
      g.sound.play("boss_roar");
      g.combat.shake(0.5);
      g.ui.bubble(b, "Come any closer and the doll gets it! ...Gets HUGGED. Very tightly.");
      this.dollState = "held";
      this.doll.carried = true;
      this.doll.anim.sit = true;
      g.ui.toast("He's holding Dolly! Careful aiming: hit her and he drinks the sap. Strike from the sides.", "quest");
      for (const e of this.links) if (e.alive) e.die();
      this.sweepCd = 3;
    } else if (n === 3) {
      if (this.dollState === "held" && this.dragon.joined) this.fling();
      else this.dollState = this.dollState === "held" ? "free" : this.dollState;
    }
  }

  // --- attacks --------------------------------------------------------------------------------------
  nextAttack(target) {
    const g = this.game, b = this.boss, ph = this.phase;
    const r = Math.random();
    this.combo++;
    if (this.campers().length) { this.pattern = 2.2; this.needleBurst(); b.slam = 0; return; }
    if (ph === 1) {
      this.pattern = 2.7;
      if (r < 0.5) this.needleLines(ph); else this.rootEruptions(ph);
    } else if (ph === 2) {
      this.pattern = 2.4;
      if (this.sweepCd <= 0 && r < 0.45) this.startSweep(1);
      else if (r < 0.75) this.needleLines(ph);
      else this.rootEruptions(ph);
    } else {
      this.pattern = 2.0;
      if (this.sweepCd <= 0 && r < 0.3) this.startSweep(2);
      else if (r < 0.55) this.rootLine(target);
      else if (r < 0.8) this.needleSpiral();
      else this.rootEruptions(ph);
      if (this.combo % 3 === 0) {
        // He tires after a flurry: the roots glow and you can hurt him badly (or throw him a stick).
        this.pattern += 3.2;
        setTimeout(() => this.staggerFor(3.2), 900);
      }
    }
    b.slam = 0;
  }

  /** Heroes who've been hugging his trunk for a while. */
  campers() {
    return this.game.party.members.filter((h) => h.joined && !h.fainted && (h.camp || 0) > 5);
  }

  needleBurst() {
    const g = this.game, b = this.boss;
    g.ui.bubble(b, "Too close, sapling!");
    for (const h of g.party.members) h.camp = 0;
    g.combat.telegraph({ shape: "circle", pos: b.pos.clone(), r: 6.4, delay: 1.0, dmg: 24, knock: 13, lift: 6, y: this.capTop + 0.08, color: "#9fd18a", owner: b,
      onFire: () => {
        g.sound.play("needles");
        g.combat.shake(0.35);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          g.fx.burst(b.pos.clone().add(new THREE.Vector3(Math.sin(a) * 2.5, 1.2, Math.cos(a) * 2.5)), "leaf", 1, { speed: 12, up: 0.5, color: "#7fbf7a" });
        }
      } });
  }

  needleLines(ph) {
    const g = this.game, b = this.boss;
    const heroes = g.party.members.filter((h) => h.joined && !h.fainted && !h.carried && h.pos.y > this.capTop - 3);
    const lines = heroes.slice(0, ph === 1 ? 2 : 3);
    g.sound.play("needles", { vol: 0.6 });
    for (const h of lines) {
      const dir = h.pos.clone().sub(b.pos).setY(0).normalize();
      const start = b.pos.clone().addScaledVector(dir, 2);
      g.combat.telegraph({ shape: "line", pos: start, dir, length: this.capR0 * 2.4, width: 1.2, delay: ph === 1 ? 1.0 : 0.85, dmg: 0, y: this.capTop + 0.08, color: "#9fd18a", owner: b,
        onFire: () => {
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              if (!b.alive || this.befriended) return;
              g.fx.shoot({ pos: start.clone().setY(this.capTop + 1.0), vel: dir.clone().multiplyScalar(24), radius: 0.55, from: "enemy", owner: b,
                color: "#7fbf7a", size: 0.7, life: 1.4, damage: 14, trail: "leaf" });
            }, i * 110);
          }
        } });
    }
  }

  rootEruptions(ph) {
    const g = this.game;
    for (const h of g.party.members) {
      if (!h.joined || h.fainted || h.carried || h.pos.y < this.capTop - 3) continue;
      this.rootAt(h.pos.clone(), ph === 1 ? 1.25 : 1.05, 22);
    }
  }

  rootAt(p, delay, dmg) {
    const g = this.game;
    g.combat.telegraph({ shape: "circle", pos: p, r: 1.9, delay, dmg, lift: 9, knock: 3, y: this.capTop + 0.08, color: "#f0a860", owner: this.boss,
      onFire: () => {
        g.fx.burst(p.clone().setY(this.capTop + 0.5), "leaf", 16, { speed: 7, up: 4, color: "#8a6a3a" });
        this.spike(p);
      } });
  }

  spike(p) {
    const g = this.game;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 7), new THREE.MeshLambertMaterial({ color: "#8a6a3a", emissive: "#2a1a08" }));
    m.position.set(p.x, this.capTop - 1.2, p.z);
    g.scene.add(m);
    let k = 0;
    const rise = () => {
      k += 0.08;
      m.position.y = this.capTop - 1.2 + Math.sin(Math.min(1, k) * Math.PI) * 2.2;
      if (k < 1) requestAnimationFrame(rise); else { g.scene.remove(m); m.geometry.dispose(); }
    };
    rise();
  }

  rootLine(target) {
    // Roots march from the Pine towards a hero: keep moving sideways.
    const g = this.game, b = this.boss;
    const dir = target.pos.clone().sub(b.pos).setY(0).normalize();
    for (let i = 0; i < 6; i++) {
      const p = b.pos.clone().addScaledVector(dir, 2.6 + i * 2.2);
      this.rootAt(p, 0.75 + i * 0.22, 16);
    }
    g.sound.play("boss_slam", { vol: 0.5 });
  }

  needleSpiral() {
    const g = this.game, b = this.boss;
    const base = Math.random() * Math.PI * 2;
    g.sound.play("needles");
    for (let i = 0; i < 6; i++) {
      const a = base + (i / 6) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const start = b.pos.clone().addScaledVector(dir, 2);
      g.combat.telegraph({ shape: "line", pos: start, dir, length: this.capR0 * 2, width: 1.0, delay: 0.9 + i * 0.12, dmg: 0, y: this.capTop + 0.08, color: "#9fd18a", owner: b,
        onFire: () => {
          if (!b.alive || this.befriended) return;
          g.fx.shoot({ pos: start.clone().setY(this.capTop + 1.0), vel: dir.clone().multiplyScalar(22), radius: 0.55, from: "enemy", owner: b,
            color: "#7fbf7a", size: 0.7, life: 1.2, damage: 13, trail: "leaf" });
        } });
    }
  }

  // The sweeping branch: a warning ring, then a branch swings round the whole cap at ankle height.
  startSweep(times) {
    const g = this.game, b = this.boss;
    this.sweepCd = 9;
    this.pattern = 4.2 + (times - 1) * 1.8;
    g.ui.bubble(b, times > 1 ? "Skip, little ones! SKIP! Twice!" : "Mind your ankles!");
    g.combat.telegraph({ shape: "ring", pos: b.pos.clone(), r: this.cap.r + 0.5, r2: 2.6, delay: 1.3, dmg: 0, y: this.capTop + 0.06, color: "#9fd18a", owner: b,
      onFire: () => {
        if (!b.alive || this.befriended) return;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, this.capR0 + 2), new THREE.MeshLambertMaterial({ color: "#6f8f4a", emissive: "#1f2f10" }));
        mesh.geometry.translate(0, 0, (this.capR0 + 2) / 2 + 1.5);
        const needles = new THREE.Mesh(new THREE.ConeGeometry(0.5, this.capR0 + 2, 6), new THREE.MeshLambertMaterial({ color: "#8fbf7a", emissive: "#20301a" }));
        needles.rotation.x = Math.PI / 2;
        needles.position.z = (this.capR0 + 2) / 2 + 1.5;
        mesh.add(needles);
        mesh.position.copy(b.pos).setY(this.capTop + 0.55);
        g.scene.add(mesh);
        this.sweep = { mesh, angle: b.facing, left: Math.PI * 2 * times, dir: Math.random() < 0.5 ? 1 : -1, hit: new Set(), times };
        g.sound.play("tailspin", { rate: 0.6 });
      } });
  }

  updateSweep(dt) {
    const s = this.sweep;
    if (!s) return;
    const g = this.game, b = this.boss;
    const speed = Math.PI * 2 / 1.7;
    const step = Math.min(s.left, speed * dt);
    s.angle += step * s.dir;
    s.left -= step;
    s.mesh.rotation.y = s.angle;
    if (s.left <= Math.PI * 2 * (s.times - 1) && s.times > 1 && !s.reset) { s.reset = true; s.hit = new Set(); }
    for (const h of g.party.members) {
      if (!h.joined || h.fainted || s.hit.has(h) || h.carried) continue;
      const to = h.pos.clone().sub(b.pos).setY(0);
      const d = to.length();
      if (d < 2 || d > this.capR0 + 3.5) continue;
      const ha = Math.atan2(to.x, to.z);
      let diff = Math.atan2(Math.sin(ha - s.angle), Math.cos(ha - s.angle));
      if (Math.abs(diff) > 0.2) continue;
      const air = h.pos.y - g.world.groundAt(h.pos.x, h.pos.z, h.pos.y);
      if (air > 0.7) { if (h === g.active && !s.cleared) { s.cleared = true; g.fx.number(h.pos, "Hop!", "#d6ffd0"); } continue; }
      s.hit.add(h);
      const tangent = new THREE.Vector3(Math.cos(s.angle), 0, -Math.sin(s.angle)).multiplyScalar(s.dir);
      h.takeDamage(26, h.pos.clone().sub(tangent), { knock: 9, lift: 4 });
    }
    if (s.left <= 0) {
      g.scene.remove(s.mesh);
      this.sweep = null;
      this.staggerFor(2.4);
    }
  }

  staggerFor(s) {
    const g = this.game, b = this.boss;
    if (!b.alive || this.befriended) return;
    this.stagger = Math.max(this.stagger, s);
    g.fx.number(b.pos.clone().add(new THREE.Vector3(0, 6, 0)), "Staggered! Strike his glowing roots!", "#ffe27a");
    g.sound.play("boss_roar", { vol: 0.4, rate: 1.4 });
    if (this.phase === 3 && this.dragon.joined && !this.hintGiven) {
      this.hintGiven = true;
      g.ui.bubble(this.dragon, "Psst! He's never had a single stick thrown for him. Ever. Just saying.");
    }
  }

  // --- the root-links that feed his sap shield ---------------------------------------------------------
  summonLinks(n) {
    const g = this.game, b = this.boss;
    this.linkCd = 6;
    g.sound.play("boss_roar", { vol: 0.6 });
    g.ui.bubble(b, "Rise, my little roots! Feed me sap!");
    for (let i = 0; i < n; i++) {
      const a = b.facing + Math.PI + (i - (n - 1) / 2) * 1.3;
      const r = this.cap.r * 0.68;
      const c = this.game.world.capCentre;
      const e = g.spawnEnemy("pineling", c.x + Math.sin(a) * r, c.z + Math.cos(a) * r, c);
      e.pos.y = this.capTop;
      e.linked = b;
      e.state = "chase";
      e.maxHp = e.hp = 70;
      e.retreated = true; // no sap pools up here
      e.burrowCd = 99;
      e.anchored = true; // root-links stay planted at the edge, channelling sap: you have to go to them
      this.links.push(e);
      g.fx.burst(e.pos.clone().add(UP), "leaf", 14, { speed: 4 });
    }
  }

  updateTethers() {
    const g = this.game, b = this.boss;
    const alive = this.links.filter((e) => e.alive);
    while (this.tethers.length < alive.length) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.85 }));
      g.scene.add(line);
      this.tethers.push(line);
    }
    while (this.tethers.length > alive.length) { const l = this.tethers.pop(); g.scene.remove(l); l.geometry.dispose(); }
    alive.forEach((e, i) => {
      const pos = this.tethers[i].geometry.attributes.position;
      pos.setXYZ(0, b.pos.x, b.pos.y + 2.5, b.pos.z);
      pos.setXYZ(1, e.pos.x, e.pos.y + 0.8, e.pos.z);
      pos.needsUpdate = true;
    });
    // Shield shimmer, and a stagger when the last link falls.
    if (this.hadShield && !this.shielded() && this.phase > 0) {
      this.shieldWindow = 13;
      this.linkCd = 13;
      this.staggerFor(3);
      g.ui.toast("Sap shield broken! Hit him now!", "level");
    }
    this.hadShield = this.shielded();
    if (!this.aura) {
      this.aura = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 16), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.16, depthWrite: false }));
      g.scene.add(this.aura);
    }
    this.aura.visible = this.shielded() && b.alive && !this.befriended;
    this.aura.position.copy(b.pos).add(new THREE.Vector3(0, 3.2, 0));
    this.aura.scale.setScalar(1 + 0.04 * Math.sin(g.t * 4));
  }

  // --- Dolly: held, flung, caught (or bounced) ------------------------------------------------------
  updateDoll(dt, t) {
    const g = this.game, b = this.boss, d = this.doll;
    if (this.dollState === "held") {
      d.pos.copy(b.pos).addScaledVector(b.forward(), 2.3).add(new THREE.Vector3(0, 2.9 + Math.sin(t * 3) * 0.1, 0));
      d.facing = b.facing;
      d.anim.talk = true;
      if (Math.random() < dt * 0.15) g.ui.bubble(d, ["Put me DOWN, you overgrown air freshener!", "I can see your sap from here. Gross.", "Boys! Aim AROUND me!"][Math.floor(Math.random() * 3)]);
    } else if (this.dollState === "falling") {
      this.fallV.y -= 3.2 * dt; // her skirt works like a little parachute
      d.pos.addScaledVector(this.fallV, dt);
      d.facing += dt * 3;
      const dr = this.dragon;
      if (dr.pos.distanceTo(d.pos) < 3.2 && g.active === dr) this.caught();
      else if (d.pos.y <= g.world.groundAt(d.pos.x, d.pos.z)) this.landed();
      this.el.catch.hidden = false;
    } else if (this.dollState === "caught") {
      d.pos.copy(this.dragon.pos).add(new THREE.Vector3(0, 2.0, 0)).addScaledVector(this.dragon.forward(), -0.3);
      d.facing = this.dragon.facing;
      d.anim.cheer = true;
    }
    if (this.dollState !== "falling") this.el.catch.hidden = true;
  }

  fling() {
    const g = this.game, b = this.boss, d = this.doll;
    this.cinematic = true;
    this.dollState = "flinging";
    g.sound.play("boss_roar");
    g.ui.bubble(b, "If I can't have her, NOBODY CAN!");
    g.combat.slowmo(1.2, 0.35);
    g.combat.shake(0.6);
    const away = d.pos.clone().sub(g.world.capCentre).setY(0).normalize();
    if (away.lengthSq() < 0.1) away.set(1, 0, 0);
    this.fallV = away.multiplyScalar(6.5).add(new THREE.Vector3(0, 7, 0));
    setTimeout(() => {
      this.dollState = "falling";
      this.cinematic = false;
      d.anim.sit = false;
      g.ui.toast("Dolly's falling! Switch to Biscuit (3) and catch her!", "quest");
      g.sound.play("doll", { rate: 0.8 });
    }, 700);
  }

  caught() {
    const g = this.game;
    this.dollState = "caught";
    g.combat.slowmo(0.6, 0.4);
    g.fx.burst(this.doll.pos.clone(), "heal", 40, { color: "#ffc6dc", speed: 6 });
    g.ui.bubble(this.dragon, "GOT HER! Good boy! I'm a good boy!");
    g.ui.toast("Caught her! The Great Pine is stunned with rage.", "level");
    g.sound.play("bark");
    g.party.gainXp(80);
    this.dollCaught = true;
    this.staggerFor(4);
    for (const e of this.links) if (e.alive) e.die();
    this.shieldWindow = 20;
  }

  landed() {
    const g = this.game, d = this.doll, b = this.boss;
    this.dollState = "landed";
    d.pos.y = g.world.groundAt(d.pos.x, d.pos.z);
    d.anim.sit = true;
    g.fx.burst(d.pos.clone().add(UP), "puff", 10, { speed: 2 });
    g.ui.toast("Dolly bounced. She's fine, but furious, and the Great Pine drinks the sap of her tears.", "");
    b.hp = Math.min(b.maxHp * 0.42, b.hp + b.maxHp * 0.1);
  }

  // --- the arena crumbles -------------------------------------------------------------------------
  updateArena(dt, t) {
    const g = this.game;
    if (!this.boss.started || this.befriended || !this.boss.alive) return;
    const goal = this.phase >= 3 ? this.capR0 * 0.66 : this.phase === 2 ? this.capR0 * 0.82 : this.capR0;
    if (this.cap.r > goal) {
      this.cap.r = Math.max(goal, this.cap.r - dt * 0.12);
      if (Math.random() < dt * 6) {
        const a = Math.random() * Math.PI * 2;
        const c = this.game.world.capCentre;
        g.fx.burst(new THREE.Vector3(c.x + Math.sin(a) * this.cap.r, this.capTop, c.z + Math.cos(a) * this.cap.r), "leaf", 4, { color: "#e48a5a", speed: 2, up: 0 });
      }
    }
    if (!this.edge) {
      this.edge = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 72), new THREE.MeshBasicMaterial({ color: "#ff8f7d", transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
      this.edge.rotation.x = -Math.PI / 2;
      g.scene.add(this.edge);
    }
    this.edge.visible = this.cap.r < this.capR0 - 0.05;
    this.edge.scale.setScalar(this.cap.r);
    this.edge.position.set(this.cap.x, this.capTop + 0.05, this.cap.z);
    // Fell off? Biscuit hauls you back up (it stings).
    for (const h of g.party.members) {
      if (!h.joined || h.carried) continue;
      if (h.pos.y < this.capTop - 5 && !(h.def.flies && h.anim.flying)) {
        const c = this.game.world.capCentre;
        h.setPos(c.x + (Math.random() - 0.5) * 2, c.z + (Math.random() - 0.5) * 2, this.capTop + 0.5);
        h.vel.set(0, 0, 0);
        if (!h.fainted) h.applyDamage(12, null);
        g.ui.toast(this.dragon.joined && h !== this.dragon ? `Biscuit hauled ${h.def.name} back up!` : `${h.def.name} clambered back up.`);
      }
    }
  }

  // --- the kind ending ----------------------------------------------------------------------------
  throwStick() {
    const g = this.game, b = this.boss;
    if (!this.stickPrompt) return;
    this.stickPrompt = false;
    this.el.stick.hidden = true;
    this.befriended = true;
    g.combat.clear();
    if (this.sweep) { g.scene.remove(this.sweep.mesh); this.sweep = null; }
    for (const e of this.links) if (e.alive) e.die();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 6), new THREE.MeshLambertMaterial({ color: "#a2734a" }));
    stick.position.copy(g.active.pos).add(new THREE.Vector3(0, 1.4, 0));
    g.scene.add(stick);
    g.sound.play("fetch_throw");
    const from = stick.position.clone(), to = b.pos.clone().add(new THREE.Vector3(0, 3, 0));
    let k = 0;
    const fly = () => {
      k += 0.025;
      stick.position.lerpVectors(from, to, k);
      stick.position.y += Math.sin(k * Math.PI) * 4;
      stick.rotation.x += 0.3;
      if (k < 1) requestAnimationFrame(fly);
      else { g.scene.remove(stick); this.befriend(); }
    };
    fly();
  }

  befriend() {
    const g = this.game, b = this.boss;
    // Soften his face: no more angry brows.
    b.eyes.traverse((o) => { if (o.userData.brows) o.visible = false; });
    g.sound.play("bark");
    g.dialogue.say([
      { who: "pine", name: "The Great Pine", text: "...What is this? A stick? For ME?" },
      { who: "dragon", name: "Biscuit", text: "You're meant to fetch it! Or keep it. Honestly, keeping it is also very good." },
      { who: "pine", name: "The Great Pine", text: "Three hundred years and nobody ever threw me anything but insults and pine-cone jokes." },
      { who: "pine", name: "The Great Pine", text: "I... I'm sorry about your doll. I only wanted something that someone loved." },
      { who: "boy", name: "The Boy", text: "You can have a stick every Tuesday. If you give Dolly back." },
      { who: "pine", name: "The Great Pine", text: "Every Tuesday. A deal. And... and maybe a Thursday?" },
    ], () => {
      this.release();
      b.alive = false;
      g.ui.boss(null);
      g.stats.befriended = true;
      g.quests.bossDefeated({ friend: true });
    });
  }

  release() {
    const g = this.game, d = this.doll;
    d.carried = false;
    d.anim.cheer = false;
    d.anim.talk = false;
    const c = g.world.capCentre, a = g.active.pos;
    const onCap = a.y > this.capTop - 3;
    d.setPos(onCap ? a.x + 1.2 : c.x + 1.5, onCap ? a.z + 1 : c.z - 1, (onCap ? a.y : this.capTop) + 0.3);
    this.dollState = "free";
    this.cap.r = this.capR0;
    if (this.edge) this.edge.visible = false;
  }

  onDeath() {
    this.release();
    this.cleanup();
  }

  cleanup() {
    const g = this.game;
    g.combat.clear();
    if (this.sweep) { g.scene.remove(this.sweep.mesh); this.sweep = null; }
    for (const e of this.links) if (e.alive) { e.alive = false; g.scene.remove(e.holder); }
    for (const l of this.tethers) g.scene.remove(l);
    this.tethers = [];
    if (this.aura) this.aura.visible = false;
    if (this.edge) this.edge.visible = false;
    this.el.stick.hidden = true;
    this.el.catch.hidden = true;
    this.el.status.textContent = "";
    removeEventListener("keydown", this.keyHandler);
  }

  /** The party wiped: put everything back for another try. */
  dispose() {
    const d = this.doll;
    this.cleanup();
    this.cap.r = this.capR0;
    d.carried = false;
    d.anim.cheer = false;
    d.anim.talk = false;
    const c = this.game.world.capCentre;
    d.setPos(c.x + 1.5, c.z - 1, this.capTop);
    d.anim.sit = true;
    this.dollState = "cap";
  }

  /** QA helper: finish the fight as if the party won. */
  forceDefeat() {
    this.boss.hp = 0;
    this.boss.die();
  }

  // --- HUD ----------------------------------------------------------------------------------------
  buildHud() {
    const bar = document.querySelector("#bossbar");
    let status = bar.querySelector(".bstatus");
    if (!status) {
      status = document.createElement("div");
      status.className = "bstatus";
      status.style.cssText = "font:800 13px Nunito,sans-serif;margin-top:4px;color:#fff;text-shadow:0 1px 3px rgba(30,20,40,.8)";
      bar.appendChild(status);
    }
    const hud = document.querySelector("#hud");
    let stick = hud.querySelector("#stickprompt");
    if (!stick) {
      hud.insertAdjacentHTML("beforeend", `<div id="stickprompt" hidden style="position:fixed;z-index:6;bottom:140px;left:50%;transform:translateX(-50%);background:#fff6dc;border:2px solid #f0d68a;color:#3b3049;font:800 15px Nunito,sans-serif;padding:9px 16px;border-radius:99px;box-shadow:0 8px 20px -10px rgba(59,48,73,.6)"><kbd style="background:#3b3049;color:#fff;border-radius:5px;padding:0 6px">E</kbd> Throw the Great Pine a stick?</div>
        <div id="catchprompt" hidden style="position:fixed;z-index:6;top:120px;left:50%;transform:translateX(-50%);background:#3b3049;color:#fff;font:900 18px Nunito,sans-serif;padding:10px 18px;border-radius:16px">Dolly's falling! Press <kbd style="background:#fff;color:#3b3049;border-radius:5px;padding:0 6px">3</kbd> for Biscuit and fly to catch her!</div>`);
    }
    this.el = { status, stick: hud.querySelector("#stickprompt"), catch: hud.querySelector("#catchprompt") };
  }

  updateHud(t) {
    if (!this.boss.started || this.befriended) return;
    const n = this.linksAlive();
    const parts = [];
    if (n) parts.push(`🟠 Sap shield: ${n} root-link${n > 1 ? "s" : ""}`);
    if (this.dollState === "held") parts.push(`🎀 Holding Dolly · her patience ${Math.max(0, Math.round(this.courage))}%`);
    if (this.stagger > 0) parts.push("✨ STAGGERED: strike now!");
    if (this.phase === 3 && !this.stagger) parts.push("🔥 Enraged");
    this.el.status.textContent = parts.join("   ·   ");
  }
}
