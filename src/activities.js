// Side tales: short activities that show who each character really is.
//   The Boy's Verse Duel with the Wizard Oak  (a pompous little poet)
//   The Girl and Sprig, the frightened pineling (gentle, patient, brave in a quiet way)
//   Biscuit's Zoomies hoop race                (pure enthusiasm, no attention span)
//   Dolly's Hide and Seek                      (sly, sarcastic, secretly delighted)
//   Making the Sun laugh                       (overworked, grumpy, desperate for a pun)
import * as THREE from "three";
import { spawn } from "./assets.js";
import { Puppet } from "./puppet.js";
import { PLACES, terrainHeight } from "./world.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function bangTexture(glyph = "!", bg = "#f7c948") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.beginPath(); g.arc(64, 60, 46, 0, 7); g.fill();
  g.beginPath(); g.moveTo(50, 100); g.lineTo(64, 124); g.lineTo(78, 100); g.fill();
  g.fillStyle = "#3b3049";
  g.font = "900 64px Nunito, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(glyph, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function eyes(holder, mood = "sad") {
  const white = new THREE.MeshLambertMaterial({ color: "#fffaf0", emissive: "#666" });
  const black = new THREE.MeshBasicMaterial({ color: "#2b2238" });
  const shine = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 12), white);
    e.position.set(side * 0.4, 0, 0);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), black);
    p.position.set(side * 0.4, -0.05, 0.22);
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), shine);
    s.position.set(side * 0.4 + 0.07, 0.04, 0.4);
    g.add(e, p, s);
    if (mood === "sad") {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.06), black);
      brow.position.set(side * 0.38, 0.36, 0.22);
      brow.rotation.z = side * 0.4; // worried, not angry
      g.add(brow);
    }
  }
  holder.add(g);
  return g;
}

/** Floating DOM label pinned to a 3D point (trust meters, giggles, race HUD bits). */
class Pin {
  constructor(game, cls) {
    this.game = game;
    this.el = document.createElement("div");
    this.el.className = cls;
    document.querySelector("#overlay").appendChild(this.el);
    this.el.hidden = true;
  }
  show(pos, html, lift = 0) {
    const v = pos.clone().add(V(0, lift, 0)).project(this.game.camera);
    if (v.z > 1) { this.el.hidden = true; return; }
    this.el.hidden = false;
    if (html !== undefined && this.el._html !== html) { this.el.innerHTML = html; this.el._html = html; }
    this.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
  }
  hide() { this.el.hidden = true; }
  remove() { this.el.remove(); }
}

class Activity {
  constructor(acts, id, title) {
    this.acts = acts;
    this.game = acts.game;
    this.id = id;
    this.title = title;
    this.done = false;
    this.result = null;
    this.bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: acts.bangTex, depthWrite: false, transparent: true }));
    this.bang.scale.setScalar(1.3);
    this.bang.visible = false;
    this.game.scene.add(this.bang);
  }
  say(lines) { return new Promise((r) => this.game.dialogue.say(lines, r)); }
  near(p, r) { return this.game.active.pos.distanceTo(p) < r; }
  available() { return false; }
  where() { return null; }
  hint() { return this.title; }
  interaction() { return null; }
  update() {}
  begin() { this.acts.running = this; this.acts.refresh(); }
  end() { if (this.acts.running === this) this.acts.running = null; this.acts.refresh(); }
  reward(xp, acorns = 0) {
    const g = this.game;
    if (xp) g.party.gainXp(xp);
    if (acorns) { g.party.acorns += acorns; g.ui.toast(`+${acorns} acorn${acorns > 1 ? "s" : ""}`); }
    g.sound.play("quest");
  }
  bangAt(pos, show, t) {
    this.bang.visible = !!show;
    if (show) this.bang.position.copy(pos).add(V(0, 0.4 * Math.sin(t * 3), 0));
  }
}

// --- 1. The Boy's Verse Duel -----------------------------------------------------------------------

const VERSE_ROUNDS = [
  {
    oak: "Your rhymes are as flimsy as dandelion fluff!", rhyme: "fluff", time: 9,
    options: [
      { text: "Then why are you trembling? Is my fluff… too TOUGH?", pts: 2, react: "Hrrm. Swaggering. But it scans." },
      { text: "Well, you're a big tree, and that's quite enough.", pts: 1, react: "Accurate. Dull, but accurate." },
      { text: "I am the greatest poet who has ever lived.", pts: 0, react: "That doesn't even rhyme, child." },
      { text: "Your leaves are all yellow, your bark is all orange.", pts: 0, react: "NOTHING rhymes with orange. Everyone knows that." },
    ],
  },
  {
    oak: "I've stood on this hill for four hundred long years!", rhyme: "years", time: 8,
    options: [
      { text: "And grown nothing but acorns and big hairy ears!", pts: 2, react: "My ears are LICHEN, thank you very much." },
      { text: "Then allow me, old-timer, to bring you to TEARS!", pts: 2, react: "Oh, the drama! The flourish! I am… moved. Slightly." },
      { text: "And in all that time, has anyone… cheered?", pts: 1, react: "‘Cheered’ is a near rhyme. I'll allow it. Grudgingly." },
      { text: "I have stood in this field for six. With my mum.", pts: 0, react: "…Is your mum here? Should someone fetch her?" },
    ],
  },
  {
    oak: "Then finish it, poet, if you have the knack!", rhyme: "knack", time: 6,
    options: [
      { text: "Your bark has no bite, and your bite has no SNACK!", pts: 2, react: "…I am hungry, now that you mention it." },
      { text: "I rhyme like a hero. You rhyme like a stack… of logs.", pts: 1, react: "A stack of logs is a perfectly respectable thing to be." },
      { text: "I'll finish you, Oak, and you'll never come back! …Grow back.", pts: 1, react: "You stumbled. But you stumbled with conviction." },
      { text: "Knack knack. Who's there?", pts: 0, react: "That is a door joke. This is a DUEL." },
    ],
  },
];

class VerseDuel extends Activity {
  constructor(acts) { super(acts, "verse", "Verse Duel with the Wizard Oak"); }
  oakPos() { return PLACES.oak.clone().setY(terrainHeight(PLACES.oak.x, PLACES.oak.z)); }
  available() {
    return ["drops", "biscuit", "fetch", "climb", "free"].includes(this.game.quests.stage) && this.game.party.byId.boy.joined;
  }
  where() { return this.oakPos(); }
  hint() { return this.done ? "Bard of the Meadow" : "Challenge the Wizard Oak to a Verse Duel"; }
  interaction() {
    if (this.done || !this.available() || this.acts.running || !this.near(this.oakPos(), 9)) return null;
    return { label: "Challenge the Wizard Oak to a Verse Duel", action: () => this.run() };
  }
  update(dt, t) {
    this.bangAt(this.oakPos().add(V(0, 12.5, 0)), this.available() && !this.done && !this.acts.running, t);
  }
  async run() {
    const g = this.game, boy = g.party.byId.boy;
    this.begin();
    if (boy.fainted) boy.revive(0.5);
    g.switchTo("boy");
    const oak = { who: "oak", name: "The Wizard Oak" }, b = { who: "boy", name: "The Boy" };
    await this.say([
      { ...b, text: "Wizard Oak! I, the Boy, Bard of the Bedroom, Scribe of the Shed, challenge you to a DUEL. Of VERSE." },
      { ...oak, text: "A duel? With a sapling? …Very well. I say a line. You answer with one that rhymes. Hesitate, and the meadow will know." },
      { ...b, text: "*cracks knuckles* *cracks neck* *cracks a twig by accident* I am ready." },
    ]);
    let score = 0;
    for (const [i, r] of VERSE_ROUNDS.entries()) {
      await this.say([{ ...oak, text: r.oak }]);
      const opts = shuffle(r.options);
      const k = await g.ui.choose(`Round ${i + 1}: answer with a rhyme for “${r.rhyme}” · verse points ${score}`, opts.map((o) => o.text),
        { who: "boy", name: "The Boy", timer: r.time });
      if (k < 0) {
        await this.say([{ ...b, text: "Um. Er. …Words!" }, { ...oak, text: "Silence. The deadliest rhyme of all. No points." }]);
        continue;
      }
      const o = opts[k];
      score += o.pts;
      g.sound.play(o.pts === 2 ? "verse" : o.pts === 1 ? "talk" : "hurt", { vol: 0.5 });
      if (o.pts === 2) g.fx.burst(boy.pos.clone().add(V(0, 1.8, 0)), "star", 16, { speed: 3 });
      await this.say([{ ...b, text: o.text + (o.pts === 2 ? "  *bows to an imaginary audience*" : "") }, { ...oak, text: o.react }]);
    }
    this.result = score;
    if (score >= 4) {
      this.done = true;
      await this.say([
        { ...oak, text: `${score} verse points. I… concede. Your rhymes have roots, little one.` },
        { ...b, text: "I would like to thank my mum, the meadow, and myself. Mostly myself." },
        { ...oak, text: "Take this, Bard of the Meadow: a verse need not be loud to land. …But yours will be, won't it." },
      ]);
      const sp = boy.def.moves.find((m) => m.key === "special");
      if (sp) sp.cd = +(sp.cd * 0.6).toFixed(1);
      boy.def.name = "The Bard";
      g.ui.buildParty();
      if (g.active === boy) g.ui.buildMoves();
      g.ui.toast("Verse Shout upgraded: it recharges much faster. The Boy is now ‘The Bard’!", "level");
      this.reward(120, 1);
    } else {
      await this.say([{ ...oak, text: `${score} verse points. Come back when your couplets have grown some rings.` },
        { ...b, text: "I let you win. Out of respect. For trees." }]);
    }
    this.end();
  }
  save() { return { done: this.done }; }
  load(s) {
    if (!s?.done) return;
    this.done = true;
    const boy = this.game.party.byId.boy, sp = boy.def.moves.find((m) => m.key === "special");
    if (sp) sp.cd = +(sp.cd * 0.6).toFixed(1);
    boy.def.name = "The Bard";
  }
}

// --- 2. The Girl and Sprig, the frightened pineling ------------------------------------------------

const SPRIG_HOME = V(22, 0, -46);

class Sprig extends Activity {
  constructor(acts) {
    super(acts, "sprig", "A frightened pineling");
    const g = this.game;
    this.holder = spawn("tree_pine", 0.3);
    this.puppet = new Puppet(this.holder, "pine");
    this.eyes = eyes(this.holder.children[0], "sad");
    this.eyes.position.set(0, 2.2, 1.18);
    // A little bandage on its trunk.
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.13, 8, 20), new THREE.MeshLambertMaterial({ color: "#fff7ee", emissive: "#555" }));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.8;
    this.holder.children[0].add(band);
    this.pos = SPRIG_HOME.clone().setY(terrainHeight(SPRIG_HOME.x, SPRIG_HOME.z));
    this.holder.position.copy(this.pos);
    g.scene.add(this.holder);
    this.trust = 0;
    this.tremble = 0;
    this.nextTremble = 3;
    this.scareCd = 0;
    this.fleeTo = null;
    this.meter = new Pin(g, "act-meter");
    this.noteCd = 0;
    this.warned = 0;
    this.findCd = 60;
    this.cheerCd = 0;
    this.facing = 0;
  }
  available() { return ["drops", "biscuit", "fetch", "climb", "free"].includes(this.game.quests.stage) && this.game.party.byId.girl.joined; }
  where() { return this.pos.clone(); }
  hint() { return this.done ? "Sprig the pineling is your friend" : "Something small is crying near the Pine Woods"; }
  speed() { const v = this.game.active.vel; return Math.hypot(v.x, v.z); }
  interaction() {
    if (this.done || !this.available() || this.acts.running && this.acts.running !== this) return null;
    const g = this.game, d = g.active.pos.distanceTo(this.pos);
    if (g.active.id !== "girl" || d > 7) return null;
    if (this.trust >= 100 && d < 3.8) return { label: "Heal Sprig's branch", action: () => this.heal() };
    return { label: "Hold E to hum a lullaby (stand still)", action: () => {} };
  }
  scare(why) {
    const g = this.game;
    if (this.scareCd > 0) return;
    this.scareCd = 1.6;
    this.trust = Math.max(0, this.trust - 30);
    const away = this.pos.clone().sub(g.active.pos).setY(0).normalize();
    const target = this.pos.clone().addScaledVector(away, 5);
    const off = target.clone().sub(SPRIG_HOME).setY(0);
    if (off.length() > 12) target.copy(SPRIG_HOME).addScaledVector(off.normalize(), 12);
    this.fleeTo = target;
    g.ui.bubble(this, pick(["eep!", "EEP!", "no no no", "*hides behind self*"]));
    g.sound.play("pine_hurt", { vol: 0.4 });
    if (why) g.ui.toast(why);
  }
  update(dt, t) {
    const g = this.game;
    this.scareCd -= dt;
    if (this.done) return this.follow(dt, t);
    const show = this.available();
    this.holder.visible = show;
    this.bangAt(this.pos.clone().add(V(0, 2.7, 0)), show && this.game.active.pos.distanceTo(this.pos) > 9, t);
    if (!show) { this.meter.hide(); return; }
    const a = g.active, d = a.pos.distanceTo(this.pos), s = this.speed();
    // Trembling: a little panic every few seconds. Moving while it trembles frightens it.
    this.nextTremble -= dt;
    if (this.nextTremble <= 0 && this.tremble <= 0) { this.tremble = 1.5; this.nextTremble = 3 + Math.random() * 2.5; }
    this.tremble -= dt;
    const shaking = this.tremble > 0;
    if (a.id === "girl") {
      if (d < 12 && s > 6.2) this.scare("Sprig bolts! Running is too loud. Hold Alt to walk softly.");
      else if (shaking && d < 9 && s > 0.6) this.scare("Sprig is trembling. Stand still until it calms down.");
      else if (d < 12) {
        const humming = g.keys.has("KeyE") && d < 7 && s < 0.6;
        const rate = humming ? 15 : s < 0.6 ? (d < 8 ? 2.5 : 0) : 3.5;
        this.trust = Math.min(100, this.trust + rate * dt);
        if (humming) {
          a.anim.talk = true;
          this.noteCd -= dt;
          if (this.noteCd <= 0) {
            this.noteCd = 0.55;
            g.ui.bubble(a, pick(["♪ hmm-hmm ♪", "♫ la la lu ♫", "♪ shh, little tree ♪"]));
            g.fx.burst(a.pos.clone().add(V(0, 1.8, 0)), "sparkle", 3, { color: "#d9c8ff", speed: 1, up: 1.5, life: 1.2 });
          }
        } else if (a.anim.talk && !g.dialogue.open) a.anim.talk = false;
      }
    } else if (d < 10) {
      this.warned -= dt;
      if (this.warned <= 0) { this.warned = 6; this.scare(`Sprig hides from ${a.def.name}. It might trust someone gentler… (press 2 for the Girl)`); }
    }
    // Movement: scurry away when frightened, otherwise peek at whoever is near.
    if (this.fleeTo) {
      const to = this.fleeTo.clone().sub(this.pos).setY(0);
      if (to.length() < 0.3) this.fleeTo = null;
      else { this.pos.addScaledVector(to.normalize(), Math.min(to.length(), dt * 7)); this.facing = Math.atan2(-to.x, -to.z); }
    } else if (d < 16) {
      const to = a.pos.clone().sub(this.pos);
      this.facing += (Math.atan2(to.x, to.z) - this.facing) * Math.min(1, dt * 3);
    }
    this.pos.y = terrainHeight(this.pos.x, this.pos.z);
    this.holder.position.copy(this.pos);
    if (shaking) { this.holder.position.x += Math.sin(t * 60) * 0.05; this.holder.position.z += Math.cos(t * 53) * 0.05; }
    this.holder.rotation.y = this.facing;
    this.puppet.apply({ t, speed: this.fleeTo ? 5 : 0, hurt: shaking ? 0.6 : 0 });
    // Trust meter when someone is near.
    if (d < 14 && a.id === "girl") {
      const hearts = Math.round(this.trust / 20);
      this.meter.show(this.pos, `<span>${"♥".repeat(hearts)}<i>${"♥".repeat(5 - hearts)}</i></span><b>${this.trust >= 100 ? "Sprig trusts you" : shaking ? "trembling… stay still" : "trust"}</b>`, 3.3);
    } else this.meter.hide();
  }
  async heal() {
    const g = this.game, girl = g.party.byId.girl;
    this.begin();
    this.meter.hide();
    girl.anim.cast = 0;
    g.sound.play("heal");
    g.fx.burst(this.pos.clone().add(V(0, 1, 0)), "petal", 30, { speed: 3, life: 1.8 });
    g.fx.burst(this.pos.clone().add(V(0, 1, 0)), "heal", 20, { speed: 2 });
    const sp = { who: "pine", name: "Sprig" }, gl = { who: "girl", name: "The Girl" };
    await this.say([
      { ...gl, text: "Shh… it's okay. I'm scared of loud things too. Mostly my brother. When he rhymes." },
      { ...sp, text: "…You're not going to chop me?" },
      { ...gl, text: "I'm going to fix your branch. There. Does that feel better?" },
      { ...sp, text: "The Great Pine says people are all axes and fire. You're more… humming." },
      { ...gl, text: "Would you like to come with us? We have acorns. And a dragon. He's mostly a dog." },
      { ...sp, text: "I can find acorns! I'm VERY good at finding acorns. It's the only thing I'm good at. Is that okay?" },
      { who: "narrator", name: "Storyteller", text: "Sprig decided, there and then, to follow the girl anywhere. Always at a distance of exactly one small hop." },
    ]);
    this.done = true;
    // Pinelings keep a little more distance from a party that has befriended one of their own.
    const p = g.enemies.find((e) => e.kind === "pineling" && e.def?.aggro);
    if (p && !p.def.softened) { p.def.aggro *= 0.7; p.def.softened = true; }
    g.ui.toast("Sprig joined you! Sprig finds acorns and pinelings are warier of your party.", "quest");
    this.reward(100, 2);
    this.end();
  }
  follow(dt, t) {
    const g = this.game, lead = g.active;
    this.bang.visible = false;
    this.meter.hide();
    this.holder.visible = true;
    const slot = V(-1.6, 0, -3).applyAxisAngle(UP, lead.facing).add(lead.pos);
    const to = slot.clone().sub(this.pos).setY(0);
    const dist = to.length();
    if (dist > 40) this.pos.copy(slot);
    else if (dist > 0.8) this.pos.addScaledVector(to.normalize(), Math.min(dist, dt * (dist > 6 ? 11 : 6)));
    this.pos.y = g.world.groundAt(this.pos.x, this.pos.z, lead.pos.y + 1);
    this.facing += (Math.atan2(to.x, to.z) - this.facing) * Math.min(1, dt * 5);
    this.holder.position.copy(this.pos);
    this.holder.rotation.y = this.facing;
    this.puppet.apply({ t, speed: dist > 0.8 ? 4 : 0, hurt: 0 });
    // Finds acorns; cheers when the party is fighting.
    this.findCd -= dt;
    if (this.findCd <= 0 && !g.dialogue.open) {
      this.findCd = 75;
      g.dropAcorn(this.pos.clone().add(V(1, 0, 0)));
      g.ui.bubble(this, pick(["Found one!", "ACORN! For you!", "This one's extra acorny."]));
    }
    this.cheerCd -= dt;
    if (this.cheerCd <= 0 && g.enemies.some((e) => e.alive && e.state === "chase" && e.pos.distanceTo(this.pos) < 15)) {
      this.cheerCd = 9;
      g.ui.bubble(this, pick(["Go go go!", "You can do it!", "Sorry, cousin!", "Not the face! …They don't have faces."]));
    }
  }
  save() { return { done: this.done }; }
  load(s) { if (s?.done) { this.done = true; this.trust = 100; } }
}

// --- 3. Biscuit's Zoomies --------------------------------------------------------------------------

class Zoomies extends Activity {
  constructor(acts) {
    super(acts, "zoomies", "Biscuit's Zoomies");
    const g = this.game, H = PLACES.hill;
    this.start = H.clone().add(V(0, 0, -24));
    this.start.y = terrainHeight(this.start.x, this.start.z);
    // A painted race flag.
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4, 8), new THREE.MeshLambertMaterial({ color: "#a2734a" }));
    pole.position.y = 2;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshLambertMaterial({ color: "#ffb3c9", emissive: "#5a2f3a", side: THREE.DoubleSide }));
    cloth.position.set(0.8, 3.4, 0);
    flag.add(pole, cloth);
    flag.position.copy(this.start);
    g.scene.add(flag);
    this.cloth = cloth;
    // The hoop course loops round the Oak Ring hill.
    this.hoops = [];
    const n = 10;
    const ringMat = (c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 });
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + 0.25;
      const r = 30 + 6 * Math.sin(i * 1.7);
      const x = H.x + Math.cos(a) * r, z = H.z + Math.sin(a) * r;
      const y = terrainHeight(x, z) + 7 + 4 * Math.sin(i * 1.3 + 0.5);
      const m = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.22, 10, 40), ringMat("#cdbbe3"));
      m.position.set(x, y, z);
      m.visible = false;
      g.scene.add(m);
      this.hoops.push(m);
    }
    for (let i = 0; i < n; i++) this.hoops[i].lookAt(this.hoops[(i + 1) % n].position);
    this.butterfly = this.makeButterfly();
    this.hud = document.querySelector("#activity");
    this.best = null;
  }
  makeButterfly() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: "#ffd36e", emissive: "#7a5a12", side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10), mat);
      w.position.x = side * 0.4;
      w.userData.side = side;
      g.add(w);
    }
    g.visible = false;
    this.game.scene.add(g);
    return g;
  }
  available() { return this.game.party.byId.dragon.joined && ["climb", "free"].includes(this.game.quests.stage); }
  where() { return this.start.clone(); }
  hint() { return this.result ? `Zoomies best: ${this.best.toFixed(1)} s (${this.result})` : "Biscuit wants to race at the Oak Ring"; }
  interaction() {
    if (!this.available() || this.acts.running || !this.near(this.start, 7)) return null;
    return { label: this.result ? "Race Biscuit's Zoomies again" : "Race Biscuit's Zoomies hoop course", action: () => this.begin_() };
  }
  async begin_() {
    const g = this.game, b = g.party.byId.dragon;
    this.begin();
    if (b.fainted) b.revive(0.6);
    g.switchTo("dragon");
    await this.say([
      { who: "dragon", name: "Biscuit", text: "RACE! RACE! There are HOOPS! I go through the hoops! In ORDER! Fast!" },
      { who: "dragon", name: "Biscuit", text: "Space to flap, steer with WASD, through the golden hoop each time. I will NOT get distracted. I am a PROFESSIONAL." },
    ]);
    b.setPos(this.start.x, this.start.z + 2);
    this.state = { next: 0, t: 0, penalty: 0, distracted: 0, spawnedFly: false, done: false };
    this.hoops.forEach((h, i) => { h.visible = true; h.scale.setScalar(1); this.tint(h, i === 0); });
    this.hud.hidden = false;
    g.sound.play("bark");
  }
  tint(h, next) {
    h.material.color.set(next ? "#ffd84a" : "#cdbbe3");
    h.material.emissive.set(next ? "#ffd84a" : "#cdbbe3");
    h.material.opacity = next ? 1 : 0.55;
  }
  update(dt, t) {
    const g = this.game;
    this.cloth.rotation.y = Math.sin(t * 3) * 0.25;
    this.bangAt(this.start.clone().add(V(0, 5, 0)), this.available() && !this.result && !this.acts.running, t);
    const s = this.state;
    if (!s || s.done) return;
    const b = g.party.byId.dragon;
    if (g.dialogue.open) return;
    s.t += dt;
    if (g.active !== b) g.switchTo("dragon");
    const hoop = this.hoops[s.next];
    hoop.rotation.z += dt * 1.5;
    if (b.pos.clone().add(V(0, 1.2, 0)).distanceTo(hoop.position) < 3.1) {
      g.sound.play("pickup", { vol: 0.6, rate: 1 + s.next * 0.05 });
      g.fx.burst(hoop.position, "star", 20, { speed: 5 });
      hoop.visible = false;
      s.next++;
      if (s.next === 4 && !s.spawnedFly) this.distract(b);
      if (s.next >= this.hoops.length) return this.finish();
      this.tint(this.hoops[s.next], true);
    }
    // The butterfly: Biscuit's attention is not his own.
    const bf = this.butterfly;
    if (s.distracted > 0) {
      s.distracted -= dt;
      bf.position.add(V(Math.sin(t * 2.3) * 3 * dt, Math.sin(t * 3.1) * 1.5 * dt, Math.cos(t * 1.7) * 3 * dt)).addScaledVector(s.flyDir, dt * 3.5);
      bf.children.forEach((w) => { w.rotation.y = w.userData.side * Math.abs(Math.sin(t * 18)) * 1.2; });
      bf.lookAt(bf.position.clone().add(s.flyDir));
      const pull = bf.position.clone().sub(b.pos);
      if (pull.length() < 2) {
        s.penalty += 3; s.distracted = 0;
        g.ui.bubble(b, "*boop* …achoo!");
        g.sound.play("bark");
        g.ui.toast("Biscuit booped the butterfly. +3 s penalty!");
      } else {
        b.vel.addScaledVector(pull.normalize(), dt * 16); // he can't help it
        if (Math.random() < dt * 1.2) g.ui.bubble(b, pick(["BUTTERFLY!!", "pretty… so pretty…", "must… focus… BUTTERFLY", "hoops? what hoops?"]));
      }
      if (s.distracted <= 0) { bf.visible = false; g.ui.toast("Phew. Back to the hoops!"); }
    }
    if (s.t > 150) {
      s.done = true;
      this.cleanup();
      this.say([{ who: "dragon", name: "Biscuit", text: "I got bored and chased my tail for a bit. Is that allowed? Can we go again?" }]).then(() => this.end());
    }
    this.hud.innerHTML = `<b>Biscuit's Zoomies</b><span>Hoop ${Math.min(s.next + 1, this.hoops.length)}/${this.hoops.length}</span><span>${(s.t + s.penalty).toFixed(1)} s</span>${s.distracted > 0 ? "<em>Biscuit is distracted, steer him back!</em>" : ""}`;
  }
  distract(b) {
    const s = this.state;
    s.spawnedFly = true;
    s.distracted = 6;
    const side = V(-Math.cos(b.facing), 0, Math.sin(b.facing));
    this.butterfly.position.copy(b.pos).add(V(0, 1.5, 0)).addScaledVector(b.forward(), 4).addScaledVector(side, 3);
    s.flyDir = side.clone().add(V(0, 0.15, 0)).normalize();
    this.butterfly.visible = true;
    this.game.ui.bubble(b, "…is that a BUTTERFLY?!");
  }
  cleanup() {
    this.hoops.forEach((h) => { h.visible = false; });
    this.butterfly.visible = false;
    this.hud.hidden = true;
  }
  async finish() {
    const g = this.game, s = this.state, b = g.party.byId.dragon;
    s.done = true;
    const time = s.t + s.penalty;
    this.cleanup();
    const medal = time <= 28 ? "gold" : time <= 40 ? "silver" : "bronze";
    const first = !this.result;
    if (!this.best || time < this.best) this.best = time;
    if (!this.result || ["bronze", "silver", "gold"].indexOf(medal) > ["bronze", "silver", "gold"].indexOf(this.result)) this.result = medal;
    b.spin = 1.2;
    g.sound.play("levelup");
    g.fx.burst(b.pos.clone().add(V(0, 2, 0)), "star", 50, { speed: 7 });
    await this.say([
      { who: "dragon", name: "Biscuit", text: `${time.toFixed(1)} seconds! Did I win?! Was anyone else racing? Doesn't matter. I WON.` },
      { who: "dragon", name: "Biscuit", text: medal === "gold" ? "GOLD! I'm going to lie on my back now. Rub my tummy. That's the prize. For me." :
        medal === "silver" ? "Silver! That's the shiny one that isn't gold! Again? AGAIN?" : "Bronze is just gold that's having a nice relaxing time. Again?" },
    ]);
    b.anim.sleep = true;
    setTimeout(() => { b.anim.sleep = false; }, 2500);
    if (first) this.reward(110, medal === "gold" ? 3 : medal === "silver" ? 2 : 1);
    if (medal === "gold" && !this.mastered) {
      this.mastered = true;
      const sw = b.def.moves.find((m) => m.key === "mobility");
      if (sw) sw.cd = +(sw.cd * 0.6).toFixed(2);
      if (g.active === b) g.ui.buildMoves();
      g.ui.toast("Zoomies mastered: Biscuit's Swoop recharges much faster!", "level");
    }
    g.ui.toast(`Zoomies: ${medal} medal (${time.toFixed(1)} s)`, "quest");
    this.end();
  }
  save() { return { result: this.result, best: this.best, mastered: this.mastered }; }
  load(s) {
    if (!s) return;
    Object.assign(this, { result: s.result, best: s.best, mastered: s.mastered });
    if (s.mastered) { const sw = this.game.party.byId.dragon.def.moves.find((m) => m.key === "mobility"); if (sw) sw.cd = +(sw.cd * 0.6).toFixed(2); }
  }
}

// --- 4. Dolly's Hide and Seek ------------------------------------------------------------------------

const TAUNTS = {
  warmer: ["Warmer. Like a slightly heated sock.", "Ooh, warmer. Don't let it go to your head.", "Getting warmer. Shocking, honestly."],
  colder: ["Colder. You're basically a penguin now.", "Arctic. Bring a scarf.", "Colder. Were you even trying?", "Freezing. I can hear your teeth from here."],
  same: ["Are you just… standing there?", "Take your time. I'm a doll. I have literally nothing else on.", "Lovely weather for losing at hide and seek."],
};

class HideSeek extends Activity {
  constructor(acts) {
    super(acts, "hide", "Hide and Seek with Dolly");
    this.giggle = new Pin(this.game, "act-giggle");
    this.hud = document.querySelector("#activity");
  }
  spots() {
    const v = PLACES.village, gh = (x, z) => terrainHeight(x, z);
    return [
      { name: "behind the cottage", p: V(v.x - 2.5, gh(v.x - 2.5, v.z + 4.2), v.z + 4.2) },
      { name: "under the little toadstool", p: V(v.x - 18, gh(v.x - 18, v.z - 6), v.z - 6) },
      { name: "in the long grass", p: V(v.x + 21, gh(v.x + 21, v.z - 7), v.z - 7) },
      { name: "behind the round house", p: V(v.x + 15, gh(v.x + 15, v.z + 15), v.z + 15) },
      { name: "on the cottage ROOF", p: V(v.x, gh(v.x, v.z) + 6.1, v.z), sneaky: true },
      { name: "up in the oak's branches", p: V(v.x + 18, gh(v.x + 18, v.z - 4) + 5.2, v.z - 4), sneaky: true },
      { name: "behind the far house", p: V(v.x - 6, gh(v.x - 6, v.z + 23), v.z + 23) },
    ];
  }
  available() { return this.game.party.byId.doll.joined && this.game.quests.stage === "free"; }
  where() { return this.state ? null : this.game.party.byId.doll.pos.clone(); }
  hint() { return this.result != null ? `Hide and seek: found Dolly ${this.result}/3` : "Dolly is bored. Ask her to play, in the village"; }
  interaction() {
    const g = this.game, doll = g.party.byId.doll;
    if (this.state && !this.state.over) {
      const sp = this.state.spot;
      const dh = Math.hypot(g.active.pos.x - sp.p.x, g.active.pos.z - sp.p.z);
      if (dh < 4.5 && Math.abs(g.active.pos.y - sp.p.y) < 7.5) return { label: "Found you!", action: () => this.found() };
      return null;
    }
    if (!this.available() || this.acts.running || g.active === doll || !this.near(doll.pos, 4)) return null;
    if (g.active.pos.distanceTo(PLACES.village) > 40) return null; // only a village game
    return { label: this.result != null ? "Play hide and seek again" : "Play hide and seek with Dolly", action: () => this.go() };
  }
  async go() {
    const g = this.game, doll = g.party.byId.doll;
    this.begin();
    await this.say([
      { who: "doll", name: "Dolly", text: "Hide and seek. Three rounds. You count, I hide. I'll know if you peek. I'm a doll. We see everything." },
      { who: "boy", name: "The Boy", text: "Dolly, you've been my doll for six years. I know ALL your hiding places." },
      { who: "doll", name: "Dolly", text: "You found me in the toybox once. ONCE. And I was waiting to be found. Close your eyes." },
    ]);
    this.state = { round: 0, found: 0, used: new Set(), over: false };
    if (g.active === doll) g.switchTo("boy");
    this.nextRound();
  }
  nextRound() {
    const g = this.game, s = this.state, doll = g.party.byId.doll;
    const spots = this.spots().filter((x) => !s.used.has(x.name) && (s.round < 2 ? !x.sneaky : x.sneaky));
    s.spot = pick(spots);
    s.used.add(s.spot.name);
    s.round++;
    s.t = 0;
    s.limit = 70;
    s.giggleCd = 2;
    s.tauntCd = 8;
    s.lastD = g.active.pos.distanceTo(s.spot.p);
    document.querySelector("#fade").classList.add("on");
    setTimeout(() => {
      doll.setPos(s.spot.p.x, s.spot.p.z, s.spot.p.y);
      doll.vel.set(0, 0, 0);
      doll.anim.sit = true;
      doll.holder.position.copy(doll.pos);
      document.querySelector("#fade").classList.remove("on");
      g.ui.toast(`Round ${s.round}: find Dolly! (follow the giggles)`, "quest");
    }, 900);
  }
  update(dt, t) {
    const g = this.game, s = this.state, doll = g.party.byId.doll;
    this.bangAt(doll.pos.clone().add(V(0, 1.6, 0)), this.available() && this.result == null && !this.acts.running && !s && doll.pos.distanceTo(PLACES.village) < 40, t);
    if (!s) return;
    // She stays in the party (so saves stay safe) but is pinned to her hiding spot.
    doll.pos.copy(s.spot.p); doll.vel.set(0, 0, 0); doll.holder.position.copy(doll.pos);
    if (g.active === doll) { g.switchTo(g.party.byId.boy.fainted ? "girl" : "boy"); g.ui.toast("Dolly: “No peeking. Playing AS me is cheating.”"); }
    if (s.over || g.dialogue.open) return;
    s.t += dt;
    // She stays put (no gravity: she's on a roof or a branch), only visible when you're close.
    doll.pos.copy(s.spot.p);
    doll.holder.position.copy(doll.pos);
    const d = g.active.pos.distanceTo(s.spot.p);
    doll.holder.visible = d < 7;
    doll.holder.rotation.y = Math.atan2(g.active.pos.x - doll.pos.x, g.active.pos.z - doll.pos.z);
    doll.puppet.apply({ t, speed: 0, sit: true, talk: d < 7 });
    s.giggleCd -= dt;
    if (s.giggleCd <= 0) {
      s.giggleCd = 6 + Math.random() * 3;
      s.giggleT = 1.6;
      s.giggleText = pick(["hee hee!", "hee!", "*snrk*", "tee hee"]);
      g.sound.play("doll", { vol: Math.max(0.15, 1 - d / 60) });
    }
    if (s.giggleT > 0) { s.giggleT -= dt; this.giggle.show(s.spot.p, s.giggleText, 1.4); }
    else this.giggle.hide();
    s.tauntCd -= dt;
    if (s.tauntCd <= 0) {
      s.tauntCd = 9;
      const kind = d < s.lastD - 3 ? "warmer" : d > s.lastD + 3 ? "colder" : "same";
      s.lastD = d;
      g.ui.toast(`Dolly: “${pick(TAUNTS[kind])}”`);
    }
    this.hud.hidden = false;
    this.hud.innerHTML = `<b>Hide and Seek</b><span>Round ${s.round}/3</span><span>${Math.max(0, s.limit - s.t).toFixed(0)} s</span>`;
    if (s.t > s.limit) this.timeout();
  }
  async found() {
    const g = this.game, s = this.state;
    s.found++;
    g.sound.play("pickup");
    g.fx.burst(s.spot.p.clone().add(V(0, 1, 0)), "petal", 26, { speed: 4 });
    const lines = [
      ["Fine. FINE. That was round one. I was going easy on you.", "You found me. Do you want a medal? Too bad, I'm a doll, not a medal."],
      ["Lucky. You were walking in a random direction and I happened to be there.", "Hmph. Who taught you to look behind things? …Me. I did. Ugh."],
      [`${s.spot.name.includes("ROOF") ? "How did you even— never mind." : "Up here was SUPPOSED to be impossible."} …You're good at finding things. Like dolls. Which is your job.`],
    ][s.round - 1];
    s.over = true;
    this.giggle.hide();
    await this.say([{ who: "doll", name: "Dolly", text: pick(lines) }]);
    this.after();
  }
  async timeout() {
    const s = this.state;
    s.over = true;
    this.giggle.hide();
    this.game.party.byId.doll.holder.visible = true;
    await this.say([{ who: "doll", name: "Dolly", text: `I was ${s.spot.name} the WHOLE time. Embarrassing. For you, specifically.` }]);
    this.after();
  }
  async after() {
    const g = this.game, s = this.state, doll = g.party.byId.doll;
    if (s.round < 3) { s.over = false; this.nextRound(); return; }
    this.hud.hidden = true;
    doll.anim.sit = false;
    doll.holder.visible = true;
    this.state = null;
    doll.setPos(g.active.pos.x + 1.5, g.active.pos.z + 1.5);
    const first = this.result == null;
    this.result = Math.max(this.result ?? 0, s.found);
    await this.say(s.found >= 2 ? [
      { who: "doll", name: "Dolly", text: `${s.found} out of 3. Adequate. Since you're adequate, here's something: I know where every star in this world is hidden. I've been watching. From shelves.` },
      { who: "girl", name: "The Girl", text: "You KNEW and you didn't tell us?!" },
      { who: "doll", name: "Dolly", text: "Nobody asked the doll. Nobody ever asks the doll. …I had fun. Don't make it weird." },
    ] : [
      { who: "doll", name: "Dolly", text: `${s.found} out of 3. I'll pretend I didn't see that. Again sometime? I'm not saying I liked it. I'm saying again sometime.` },
    ]);
    if (s.found >= 2 && !this.starMap) {
      this.starMap = true;
      g.ui.toast("Dolly marked every hidden star on your map!", "level");
    }
    if (first) this.reward(100, 2);
    this.end();
  }
  save() { return { result: this.result, starMap: this.starMap }; }
  load(s) { if (s) { this.result = s.result ?? null; this.starMap = !!s.starMap; } }
}

// --- 5. Making the Sun laugh ----------------------------------------------------------------------

const JOKES = [
  {
    q: "The Sun is listening. Tell it a joke:",
    options: [
      { text: "Why did the Sun go to school? To get BRIGHTER!", mood: 2, react: "…Brighter. Because I'm… bright. Heh. HEH. Okay, that one got me." },
      { text: "Why did the Sun go to school? It didn't. Suns don't go to school.", mood: 0, react: "That's not a joke, that's just… correct. Rude, but correct." },
      { text: "You're so dim they should call you the Moon.", mood: -1, react: "…Wow. Okay. I'll just… *goes a little cloudy*" },
      { text: "Knock knock!", mood: 0, react: "I'm a ball of fire in the sky. I don't have a DOOR." },
    ],
  },
  {
    q: "The Sun is warming up. Another one:",
    options: [
      { text: "What's a Sun's favourite day of the week? SUNday!", mood: 2, react: "I've heard that one nine trillion times. …It still works. Every time. Hehehe." },
      { text: "Monday. Because everybody hates you a bit less.", mood: -1, react: "Monday is NOT my fault. I'm just turning up. Like always. *sniff*" },
      { text: "Whichever day we're all together, sunshine.", mood: 1, react: "Oh. Oh, that's… that's very sweet. I'm not crying. It's solar flares." },
      { text: "Pineday.", mood: 0, react: "…I don't get it. Is that a pine thing? Is HE here?" },
    ],
  },
  {
    q: "Big finish. Make it count:",
    options: [
      { text: "What did the Great Pine say when he lost? ‘I'm STUMPED!’", mood: 2, react: "STUMPED! Because he's a TREE! HAHAHA, oh no, I'm going to set early again—" },
      { text: "He'll be back… in the SPRUCE-quel.", mood: 2, react: "The spruce-quel! HAHA! Pine puns! I LIVE for pine puns!" },
      { text: "Trees can't talk. Except all of them, apparently.", mood: 0, react: "That's less a joke and more an observation about this valley." },
      { text: "Your shine is a bit boring, honestly.", mood: -1, react: "…I have been shining for four billion years. You try it." },
    ],
  },
];

class SunJokes extends Activity {
  constructor(acts) {
    super(acts, "sun", "Make the Sun laugh");
    const g = this.game, H = PLACES.hill;
    this.post = H.clone().setY(terrainHeight(H.x, H.z));
    // A painted signpost with a little sun on top.
    const sign = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3, 8), new THREE.MeshLambertMaterial({ color: "#a2734a" }));
    pole.position.y = 1.5;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshLambertMaterial({ color: "#ffd98a", emissive: "#a8741a", side: THREE.DoubleSide }));
    disc.position.y = 3.2;
    const rays = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 12, 1), new THREE.MeshLambertMaterial({ color: "#ffb870", emissive: "#80501a", side: THREE.DoubleSide }));
    rays.position.y = 3.2;
    sign.add(pole, disc, rays);
    sign.position.copy(this.post);
    g.scene.add(sign);
    this.sign = sign;
    this.blessed = 0;
  }
  window() { const t = this.game.world.time; return (t > 0.22 && t < 0.36) || (t > 0.66 && t < 0.82); }
  available() { return ["drops", "biscuit", "fetch", "climb", "free"].includes(this.game.quests.stage); }
  where() { return this.post.clone(); }
  hint() { return this.done ? "The Sun is in a wonderful mood (longer days)" : "Tell the Sun a joke on the Oak Ring hill, at dawn or dusk"; }
  interaction() {
    if (!this.available() || this.acts.running || !this.near(this.post, 6) || this.done) return null;
    if (!this.window()) return { label: "The Sun is busy shining. Come back at dawn or dusk.", action: () => this.game.ui.toast("Come back when the Sun is low: dawn or dusk.") };
    return { label: "Tell the Sun a joke", action: () => this.run() };
  }
  update(dt, t) {
    const g = this.game;
    this.sign.rotation.y += dt * 0.4;
    this.bangAt(this.post.clone().add(V(0, 4.6, 0)), this.available() && !this.done && this.window() && !this.acts.running, t);
    // Sun-blessed: daylight slowly heals the party.
    if (this.blessed > 0) {
      this.blessed -= dt;
      if (!g.world.isNight && !g.dialogue.open) for (const h of g.party.members) if (h.joined && !h.fainted && h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + 3 * dt);
    }
    if (this.laugh > 0) {
      this.laugh -= dt;
      const sun = g.world.sunPuppet;
      sun.scale.setScalar(9 * (1 + 0.18 * Math.abs(Math.sin(t * 14)) * Math.min(1, this.laugh)));
      sun.rotation.z = Math.sin(t * 20) * 0.15 * Math.min(1, this.laugh);
    }
  }
  async run() {
    const g = this.game, sun = g.world.sunPuppet;
    this.begin();
    const look = () => sun.position.clone();
    const S = (text) => ({ who: "sun", name: "The Sun", text, look: look() });
    const me = { who: g.active.id === "dragon" ? "dragon" : g.active.id, name: g.active.def.name };
    await this.say([
      S("Oh. Visitors. Do you know how many hours I've worked today? All of them. Every single hour is my hour."),
      S("Nobody ever tells ME a joke. They just squint at me. Go on then. Make me laugh. I dare you."),
    ]);
    let mood = 0;
    for (const r of JOKES) {
      const opts = shuffle(r.options);
      const k = await g.ui.choose(`${r.q}   (the Sun's mood: ${"☀️".repeat(Math.max(0, mood))}${"☁️".repeat(Math.max(0, 4 - Math.max(0, mood)))})`, opts.map((o) => o.text), { ...me });
      const o = opts[Math.max(0, k)];
      mood += o.mood;
      if (o.mood < 0) { g.post?.flash?.("#6b6f8a", 0.6); }
      if (o.mood === 2) g.fx.burst(g.active.pos.clone().add(V(0, 2, 0)), "star", 14, { speed: 3 });
      await this.say([{ ...me, text: o.text }, S(o.react)]);
    }
    if (mood >= 3) {
      this.done = true;
      this.laugh = 4;
      g.post?.flash?.("#fff1c4", 1.2);
      g.sound.play("levelup");
      await this.say([
        S("HAHAHAHA! Oh, oh dear. Oh, I needed that. Four billion years and finally, a decent pun."),
        S("For that, I'll stay up a little longer every day. And while I'm up, I'll keep you warm. Sun's honour."),
      ]);
      g.world.dayLength = 720;
      this.blessed = 300;
      g.ui.toast("The Sun is delighted: days last longer, and sunlight slowly heals your party for a while!", "level");
      this.reward(110, 1);
    } else {
      await this.say([S("Hmph. Come back when you're funnier. I'll still be here. I'm ALWAYS here.")]);
    }
    this.end();
  }
  save() { return { done: this.done }; }
  load(s) { if (s?.done) { this.done = true; this.game.world.dayLength = 720; } }
}

// --- the collection ----------------------------------------------------------------------------------

export class Activities {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.running = null;
    this.refreshCd = 0;
  }

  setup(save) {
    this.bangTex = bangTexture();
    this.list = [new VerseDuel(this), new Sprig(this), new Zoomies(this), new HideSeek(this), new SunJokes(this)];
    this.byId = Object.fromEntries(this.list.map((a) => [a.id, a]));
    if (save) for (const a of this.list) a.load(save[a.id]);
  }

  interaction() {
    if (this.running && this.running.interaction) {
      const it = this.running.interaction();
      if (it) return it;
      if (this.running.id !== "sprig") return null;
    }
    for (const a of this.list) { const it = a.interaction(); if (it) return it; }
    return null;
  }

  markers() {
    return this.list.filter((a) => a.available() && !a.done && !(a.result && a.id !== "hide") && a.where()).map((a) => a.where());
  }

  trackerLines() {
    return this.list.filter((a) => a.available() || a.done || a.result).map((a) => ({ text: a.hint(), done: a.done || a.result != null }));
  }

  /** Unfound stars, if Dolly has shared her secret map. */
  starHints() {
    return this.byId?.hide?.starMap ? this.game.quests.stars.filter((s) => !s.got).map((s) => s.pos) : [];
  }

  refresh() { this.game.quests.setTracker(); }

  update(dt, t) {
    if (!this.list.length) return;
    // While an activity runs, nearby enemies hold back (it's a game, not an ambush).
    if (this.running && this.running.id !== "sprig") {
      if (this.game.combat) { this.game.combat.calm = true; this.calmed = true; }
      for (const e of this.game.enemies) if (e.alive && e.kind !== "boss" && e.pos.distanceTo(this.game.active.pos) < 80) { e.rooted = Math.max(e.rooted || 0, 0.3); e.cool = Math.max(e.cool || 0, 0.3); e.state = "idle"; }
    } else if (this.calmed && this.game.combat) { this.game.combat.calm = false; this.calmed = false; }
    for (const a of this.list) a.update(dt, t);
    this.refreshCd -= dt;
    if (this.refreshCd <= 0) { this.refreshCd = 2; this.refresh(); }
  }

  saveData() {
    return Object.fromEntries(this.list.map((a) => [a.id, a.save()]));
  }
}
