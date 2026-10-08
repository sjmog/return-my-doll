// Procedural puppeteering: rotate parts about their joint pivots, layered from a pose description.
// Angles are given the Blender way (x = forward/back swing, y = sideways, z = twist about vertical)
// and converted for three.js (Blender Z-up -> Y-up: x->x, y->-z, z->y).
import * as THREE from "three";

const D2R = Math.PI / 180;
const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();

export class Puppet {
  constructor(holder, kind) {
    this.holder = holder;
    this.kind = kind; // "kid", "dragon", "doll", "pine", "sun"
    this.parts = holder.userData.parts;
    this.deltas = {};
    this.lift = 0; // extra height offset (bobs, hops)
    this.tilt = new THREE.Vector3(); // whole-body lean, degrees (Blender axes)
    this.phase = Math.random() * 10;
  }

  rot(part, x = 0, y = 0, z = 0) {
    if (!this.parts[part]) return;
    const d = this.deltas[part] || (this.deltas[part] = [0, 0, 0]);
    d[0] += x; d[1] += y; d[2] += z;
  }

  /**
   * s: { t, speed (m/s), running, air (bool), vy, attack (0..1 or -1), attackKind, cast (0..1 or -1),
   *      flap, flying, talk, hurt (0..1), sit, sleep, wave, dance, cheer, carry }
   */
  apply(s) {
    this.deltas = {};
    this.lift = 0;
    this.tilt.set(0, 0, 0);
    const t = s.t + this.phase;
    const tt = t * Math.PI * 2;
    const k = this.kind;

    // Idle breathing.
    this.lift += 0.012 * Math.sin(tt * 0.5);
    this.rot("tail", 0, 0, 8 * Math.sin(tt * 0.4));
    this.rot("arm_L", 0, -4, 0);
    this.rot("arm_R", 0, 4, 0);

    const stride = Math.min(1, s.speed / (s.running ? 6 : 3));
    if (stride > 0.05 && !s.air && !s.flying) {
      const f = s.running ? 2.6 : 1.8;
      const amp = (s.running ? 40 : 28) * stride;
      const w = Math.sin(t * f * Math.PI * 2);
      if (k === "kid" || k === "doll") {
        this.rot("leg_L", amp * w); this.rot("leg_R", -amp * w);
        this.rot("arm_L", -amp * 0.9 * w); this.rot("arm_R", amp * 0.9 * w);
        this.lift += Math.abs(w) * (s.running ? 0.07 : 0.04);
        this.tilt.x += s.running ? 8 : 3;
      } else if (k === "dragon") {
        for (const [leg, ph] of [["leg_FL", 0], ["leg_BR", 0], ["leg_FR", Math.PI], ["leg_BL", Math.PI]]) {
          this.rot(leg, amp * 0.8 * Math.sin(t * f * Math.PI * 2 + ph));
        }
        this.lift += Math.abs(w) * 0.06;
        this.rot("head", 3 * Math.sin(tt * f));
      } else if (k === "pine") {
        // Pinelings hop rather than walk.
        this.lift += Math.abs(Math.sin(t * 3 * Math.PI)) * 0.35 * stride;
        this.tilt.x += 6 * stride;
      }
    }

    if (s.air && !s.flying) {
      if (k === "kid" || k === "doll") {
        this.rot("leg_L", -30); this.rot("leg_R", -10);
        this.rot("arm_L", 0, -70); this.rot("arm_R", 0, 70);
      }
    }

    if (k === "dragon") {
      if (s.flying) {
        const amp = s.flap ? 42 : 10, f = s.flap ? 2.2 : 0.5;
        const fl = amp * Math.sin(tt * f);
        this.rot("wing_L", 0, -fl); this.rot("wing_R", 0, fl);
        for (const leg of ["leg_FL", "leg_FR", "leg_BL", "leg_BR"]) this.rot(leg, 35);
        this.rot("tail", -6 * Math.sin(tt * f));
        this.tilt.x += THREE.MathUtils.clamp(-s.vy * 3, -18, 18);
      } else {
        const b = 4 * Math.sin(tt * 0.35);
        this.rot("wing_L", 0, -b); this.rot("wing_R", 0, b);
      }
    }

    // Attacks.
    if (s.attack >= 0) {
      const u = s.attack;
      const ak = s.attackKind;
      if (ak === "swipe") { // boy's stick: wind up, then sweep across
        const a = u < 0.3 ? -u / 0.3 : (u - 0.3) / 0.7;
        this.rot("arm_R", -60 - 40 * Math.max(0, a), 50 * (1 - Math.abs(a)), -70 * a);
        this.rot("body", 0, 0, -25 * a);
      } else if (ak === "bolt" || ak === "button") { // throw/cast forward
        const a = Math.sin(Math.min(1, u * 1.4) * Math.PI);
        this.rot("arm_R", -100 * a, 10 * a);
        this.rot("body", 0, 0, -10 * a);
      } else if (ak === "breath") {
        this.rot("head", -14);
        this.rot("wing_L", 0, -20); this.rot("wing_R", 0, 20);
      } else if (ak === "tailspin") {
        this.tilt.z += 0; // the controller spins the whole body
      } else if (ak === "slam") { // pine boss / pinelings
        const a = Math.sin(u * Math.PI);
        this.tilt.x += 30 * a;
      }
    }
    if (s.cast >= 0) {
      const a = Math.sin(Math.min(1, s.cast) * Math.PI);
      this.rot("arm_L", 0, -150 * a); this.rot("arm_R", 0, 150 * a);
      this.rot("head", -10 * a);
      this.lift += 0.1 * a;
    }
    if (s.talk) {
      this.rot("head", 5 * Math.sin(tt * 3.3) + 3 * Math.sin(tt * 5.1), 0, 4 * Math.sin(tt * 1.4));
      if (k === "kid" || k === "doll") this.rot("arm_R", -35 - 12 * Math.sin(tt * 2.3), 12);
    }
    if (s.wave) {
      this.rot("arm_R", 0, 125 + 20 * Math.sin(tt * 2.2));
    }
    if (s.cheer || s.dance) {
      const alt = Math.sin(tt * 1.6);
      this.rot("arm_L", 0, -(140 + 25 * alt)); this.rot("arm_R", 0, 140 - 25 * alt);
      this.lift += Math.abs(alt) * 0.1;
      if (s.dance) this.rot("body", 0, 10 * alt);
    }
    if (s.sit) {
      if (k === "dragon") { this.lift -= 0.3; for (const leg of ["leg_FL", "leg_FR"]) this.rot(leg, -50); for (const leg of ["leg_BL", "leg_BR"]) this.rot(leg, 50); }
      else { this.rot("leg_L", -85, -6); this.rot("leg_R", -85, 6); this.lift -= 0.36; }
    }
    if (s.sleep) {
      if (k === "dragon") { this.lift -= 0.3; this.rot("head", 22); this.rot("wing_L", 0, 40); this.rot("wing_R", 0, -40); }
      else { this.tilt.y += 88; this.lift += 0.17; this.rot("leg_L", -35); this.rot("leg_R", -45); }
    }
    if (s.hurt > 0) {
      this.tilt.x -= 18 * s.hurt;
      this.rot("head", -15 * s.hurt);
    }
    if (k === "sun") {
      this.tilt.y += 4 * Math.sin(tt * 0.25);
    }

    // Write rotations.
    for (const [name, node] of Object.entries(this.parts)) {
      const d = this.deltas[name];
      node.quaternion.copy(node.userData.restQ);
      if (d) {
        tmpE.set(d[0] * D2R, d[2] * D2R, -d[1] * D2R, "XYZ");
        tmpQ.setFromEuler(tmpE);
        node.quaternion.multiply(tmpQ);
      }
    }
    const inner = this.holder.children[0];
    inner.position.y = this.lift;
    inner.rotation.set(this.tilt.x * D2R, this.tilt.z * D2R, -this.tilt.y * D2R);
  }
}
