// Particles (sparkles, petals, leaves, puffs), projectiles and floating numbers.
import * as THREE from "three";

function dotTexture(soft = true) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(soft ? 0.35 : 0.8, "rgba(255,255,255,0.8)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function leafTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.beginPath(); g.ellipse(32, 32, 26, 12, 0.6, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(scene, camera, overlay) {
    this.scene = scene;
    this.camera = camera;
    this.overlay = overlay;
    this.glowTex = dotTexture(true);
    this.leafTex = leafTexture();
    this.pool = [];
    this.live = [];
    this.projectiles = [];
    this.texts = [];
  }

  sprite(additive, tex) {
    let s = this.pool.find((p) => !p.visible && p.userData.additive === additive && p.material.map === tex);
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      s.userData.additive = additive;
      this.pool.push(s);
      this.scene.add(s);
    }
    s.visible = true;
    return s;
  }

  /** Burst of n particles. kind: sparkle | heal | leaf | puff | petal | star */
  burst(pos, kind, n = 16, { color, speed = 3, life = 0.9, size = 0.35, up = 2, spread = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const additive = kind === "sparkle" || kind === "heal" || kind === "star";
      const tex = kind === "leaf" || kind === "petal" ? this.leafTex : this.glowTex;
      const s = this.sprite(additive, tex);
      const col = color || { sparkle: "#fff3b0", heal: "#b6f5c4", leaf: ["#e09a52", "#a8c46a", "#d4b25a"][i % 3], puff: "#ffffff", petal: "#ffbfd2", star: "#ffe9a8" }[kind];
      s.material.color.set(col);
      if (additive) s.material.color.multiplyScalar(1.6); // bright enough for the bloom pass
      s.material.opacity = kind === "puff" ? 0.6 : 1;
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.3) * spread, (Math.random() - 0.5) * spread));
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      v.y += up * Math.random();
      const sz = size * (0.6 + Math.random() * 0.8) * (kind === "puff" ? 3 : 1);
      s.scale.setScalar(sz);
      s.material.rotation = Math.random() * 6;
      this.live.push({ s, v, life: life * (0.7 + Math.random() * 0.6), age: 0, size: sz, kind, spin: (Math.random() - 0.5) * 6 });
    }
  }

  /** A projectile: {pos, vel, radius, damage, from ('player'|'enemy'), kind, life, onHit, homing} */
  shoot(p) {
    const s = this.sprite(true, this.glowTex);
    s.material.color.set(p.color || "#ffe9a8").multiplyScalar(1.6);
    s.material.opacity = 1;
    s.scale.setScalar(p.size || 0.7);
    s.position.copy(p.pos);
    p.sprite = s;
    p.age = 0;
    this.projectiles.push(p);
    return p;
  }

  number(pos, text, color = "#fff") {
    const el = document.createElement("div");
    el.className = "dmg";
    el.textContent = text;
    el.style.color = color;
    this.overlay.appendChild(el);
    this.texts.push({ el, pos: pos.clone(), age: 0 });
  }

  update(dt, hitTest) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) { p.s.visible = false; this.live.splice(i, 1); continue; }
      if (p.kind === "leaf" || p.kind === "petal") { p.v.y -= 2.5 * dt; p.v.multiplyScalar(0.98); }
      else if (p.kind === "puff") p.v.multiplyScalar(0.92);
      else { p.v.y -= 1.2 * dt; p.v.multiplyScalar(0.96); }
      p.s.position.addScaledVector(p.v, dt);
      p.s.material.rotation += p.spin * dt;
      p.s.material.opacity = (p.kind === "puff" ? 0.6 : 1) * (1 - u);
      if (p.kind === "puff") p.s.scale.setScalar(p.size * (1 + u));
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.homing && p.target && p.target.alive) {
        const want = p.target.pos.clone().add(new THREE.Vector3(0, 0.8, 0)).sub(p.pos).normalize().multiplyScalar(p.vel.length());
        p.vel.lerp(want, Math.min(1, dt * p.homing));
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.sprite.position.copy(p.pos);
      p.sprite.material.rotation += dt * 4;
      if (Math.random() < 0.6) this.burst(p.pos, p.trail || "sparkle", 1, { color: p.color, speed: 0.6, life: 0.4, size: (p.size || 0.7) * 0.5, up: 0 });
      const hit = hitTest(p);
      if (hit || p.age > (p.life || 2)) {
        if (hit && p.onHit) p.onHit(hit, p);
        this.burst(p.pos, "sparkle", 8, { color: p.color, speed: 2, life: 0.4 });
        p.sprite.visible = false;
        this.projectiles.splice(i, 1);
      }
    }
    const w = innerWidth, h = innerHeight;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const tx = this.texts[i];
      tx.age += dt;
      if (tx.age > 1.1) { tx.el.remove(); this.texts.splice(i, 1); continue; }
      const v = tx.pos.clone().add(new THREE.Vector3(0, 1.6 + tx.age * 1.4, 0)).project(this.camera);
      // Keep floating words fully on screen.
      const sx = Math.min(w - 90, Math.max(90, (v.x * 0.5 + 0.5) * w)), sy = Math.min(h - 60, Math.max(150, (-v.y * 0.5 + 0.5) * h));
      tx.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${1 + 0.3 * Math.max(0, 0.2 - tx.age) * 5})`;
      tx.el.style.opacity = String(Math.min(1, (1.1 - tx.age) * 3));
      tx.el.style.display = v.z > 1 ? "none" : "block";
    }
  }
}
