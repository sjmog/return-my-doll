// The story: Return My Doll. Stages, NPC conversations, pickups, objectives and markers.
import * as THREE from "three";
import { PLACES, terrainHeight, WATER_Y } from "./world.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function glowOrb(color, size = 0.6) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.55, 20, 16),
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.9 }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 16),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
  g.add(core, halo);
  return g;
}
function beacon(color) {
  // A soft column of light visible from afar.
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 60, 16, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.position.y = 30;
  return m;
}

export class Quests {
  constructor(game) {
    this.game = game;
    this.stage = "intro";
    this.drops = [];
    this.stars = [];
    this.pickups = [];
    this.fetches = 0;
    this.stick = null;
    this.flags = {};
  }

  setup(save) {
    const g = this.game, s = g.scene, w = g.world;
    // Paint drops: rose (Pine Woods), sky (pond island), sage (Oak Ring).
    const spots = [
      ["rose", "#ff9fbf", PLACES.woods.clone().add(V(4, 0, -3)), "the Pine Woods"],
      ["sky", "#8fd0ff", PLACES.pond.clone().add(V(0, 0, -2.5)), "the Lily Pond island"],
      ["sage", "#a8e6a0", PLACES.hill.clone(), "the Oak Ring on the hill"],
    ];
    for (const [id, col, p, where] of spots) {
      const o = glowOrb(col, 0.7);
      const b = beacon(col);
      o.add(b);
      p.y = w.groundAt(p.x, p.z) + 1.4;
      o.position.copy(p);
      o.visible = false;
      s.add(o);
      this.drops.push({ id, col, pos: p, obj: o, where, got: false });
    }
    // Dolly, captive on the cap of the Great Mushroom Tree, glowing so you can see her from anywhere.
    const doll = g.party.byId.doll;
    const cap = w.capCentre;
    doll.setPos(cap.x + 1.5, cap.z - 1, w.capTop);
    doll.anim.sit = true;
    this.dollGlow = beacon("#ffd1e6");
    this.dollGlow.position.copy(doll.pos).setY(w.capTop + 30);
    s.add(this.dollGlow);
    this.dollSparkle = 0;
    // Biscuit naps at the foot of the Mushroom Tree.
    const biscuit = g.party.byId.dragon;
    biscuit.setPos(PLACES.mushroom.x + 19, PLACES.mushroom.z + 12);
    biscuit.facing = -2.2;
    biscuit.anim.sleep = true;
    // Fetch sticks lie nearby.
    // Stars: ten hidden golden stars for exploring.
    const starSpots = [
      [PLACES.village.x - 14, PLACES.village.z + 8, 7.2], [PLACES.hill.x, PLACES.hill.z + 18, 0], [PLACES.pond.x + 18, PLACES.pond.z + 12, 0],
      [PLACES.woods.x - 20, PLACES.woods.z + 22, 0], [150, 20, 0], [-150, -20, 0], [20, 180, 0], [-40, -170, 0], [cap.x - 3, cap.z + 2, 0.2], [200, -150, 0],
    ];
    for (const [x, z, extra] of starSpots) {
      const st = glowOrb("#ffe27a", 0.45);
      const y = (extra === 0.2 ? w.capTop : w.groundAt(x, z)) + 1.2 + (extra > 1 ? extra : 0);
      st.position.set(x, y, z);
      s.add(st);
      this.stars.push({ obj: st, pos: st.position.clone(), got: false });
    }
    g.totalStars = this.stars.length;
    g.activities?.setup(save?.activities);
    if (!save) this.stageIntro();
  }

  // --- stages ----------------------------------------------------------------------------------
  stageIntro() {
    const g = this.game;
    this.stage = "intro";
    this.setTracker();
    g.dialogue.say([
      { who: "narrator", name: "Storyteller", text: "Once upon a painted morning, a boy woke to find his doll, Dolly, gone." },
      { who: "boy", name: "The Boy", text: "Dolly? DOLLY! My grandpa gave me that doll!" },
      { who: "girl", name: "The Girl", text: "Look... up there, on the Great Mushroom Tree. Something is glowing pink.", look: "doll" },
      { who: "boy", name: "The Boy", text: "The Wizard Oak will know what to do. He knows everything. Mostly in verse." },
      { who: "narrator", name: "Storyteller", text: "WASD to walk, Shift to dodge, Space to jump. Click and right-click to use your moves. E to talk. 1-4 switches hero." },
    ], () => { this.stage = "oak"; this.setTracker(); });
  }

  setTracker() {
    const g = this.game, d = this.drops;
    const T = {
      intro: ["Prologue", []],
      oak: ["The Wizard Oak", [{ text: "Talk to the Wizard Oak, west of the Mushroom Tree" }]],
      drops: ["Three Drops of Paint", d.map((x) => ({ text: `${x.id[0].toUpperCase() + x.id.slice(1)} drop in ${x.where}`, done: x.got }))],
      biscuit: ["A Snoring Dragon", [{ text: "Wake whoever is snoring by the Mushroom Tree" }]],
      fetch: ["Fetch!", [{ text: `Throw the stick for Biscuit (${this.fetches}/3)`, done: this.fetches >= 3 }, { text: "Pick up the stick with E, throw it with E" }]],
      climb: ["The Great Pine", [{ text: "Climb the painted stairs (or fly with Biscuit) to the top of the Mushroom Tree" }]],
      boss: ["The Great Pine", [{ text: "Defeat the Great Pine and free Dolly!" }]],
      ending: ["The Great Pine", [{ text: "Defeat the Great Pine and free Dolly!", done: true }]],
      free: ["Happily Ever After", [{ text: `Find the hidden stars (${g.party.stars}/${g.totalStars || 10})`, done: g.party.stars >= (g.totalStars || 10) }, { text: "Explore with Dolly and friends" }]],
    }[this.stage] || ["Return My Doll", []];
    g.ui.setQuest(T[0], T[1], g.activities?.trackerLines() || []);
  }

  markers() {
    const g = this.game;
    switch (this.stage) {
      case "oak": return [PLACES.oak.clone().setY(terrainHeight(PLACES.oak.x, PLACES.oak.z) + 3)];
      case "drops": return this.drops.filter((d) => !d.got).map((d) => d.pos);
      case "biscuit": case "fetch": return [g.party.byId.dragon.pos.clone()];
      case "climb": case "boss": return [g.world.capCentre.clone().setY(g.world.capTop)];
      default: return [];
    }
  }

  /** What E would do right now, if anything: {label, action}. */
  interaction() {
    const g = this.game, p = g.active.pos;
    if (this.stage === "oak" && p.distanceTo(PLACES.oak.clone().setY(p.y)) < 8) return { label: "Talk to the Wizard Oak", action: () => this.talkOak() };
    const biscuit = g.party.byId.dragon;
    if (this.stage === "biscuit" && p.distanceTo(biscuit.pos) < 6) return { label: "Wake the dragon", action: () => this.wakeBiscuit() };
    if (this.stage === "fetch") {
      if (!this.holding && this.stick && !this.stick.flying && p.distanceTo(this.stick.obj.position) < 2.5) return { label: "Pick up the stick", action: () => this.pickStick() };
      if (this.holding) return { label: "Throw the stick!", action: () => this.throwStick() };
    }
    return g.activities?.interaction() || null;
  }

  talkOak() {
    const g = this.game;
    g.dialogue.say([
      { who: "oak", name: "The Wizard Oak", text: "Ahem. Hello, small ones, with your worried frowns. Your doll was snatched and carried up, above the town." },
      { who: "boy", name: "The Boy", text: "Up the Mushroom Tree? But nobody can climb it. It's too smooth!" },
      { who: "oak", name: "The Wizard Oak", text: "Its stairs were painted long ago, in rose and sky and sage. The colours ran away, my boy: find them, and turn the page." },
      { who: "oak", name: "The Wizard Oak", text: "One drop sleeps among the pines, where pinelings hop and bite. One floats upon the lily isle. One crowns the hill of light." },
      { who: "girl", name: "The Girl", text: "Three drops of paint. Got it. Thank you, Mr Oak!" },
      { who: "oak", name: "The Wizard Oak", text: "And mind the Great Pine, children. He hates a happy ending. ...That one didn't rhyme. I'm tired." },
    ], () => {
      this.stage = "drops";
      for (const d of this.drops) d.obj.visible = true;
      g.sound.play("quest");
      g.ui.toast("New quest: Three Drops of Paint", "quest");
      this.setTracker();
    });
  }

  collectDrop(d) {
    const g = this.game;
    d.got = true;
    d.obj.visible = false;
    g.sound.play("pickup");
    g.fx.burst(d.pos, "sparkle", 40, { color: d.col, speed: 6 });
    const n = this.drops.filter((x) => x.got).length;
    g.world.revealStairs(n / 3);
    g.sound.play("portal", { vol: 0.6 });
    g.party.gainXp(60);
    g.ui.toast(`${d.id[0].toUpperCase() + d.id.slice(1)} paint drop! (${n}/3) The Mushroom stairs grow…`, "quest");
    this.setTracker();
    if (n === 3) {
      g.dialogue.say([
        { who: "narrator", name: "Storyteller", text: "Rose, sky and sage ran back into the stairs, and the Mushroom Tree's spiral bloomed bright as a sweet shop." },
        { who: "girl", name: "The Girl", text: "Listen... is that snoring? Something big is sleeping by the Mushroom Tree." },
      ], () => { this.stage = "biscuit"; this.setTracker(); });
    }
  }

  wakeBiscuit() {
    const g = this.game, b = g.party.byId.dragon;
    b.anim.sleep = false;
    g.sound.play("bark");
    g.dialogue.say([
      { who: "dragon", name: "The Dragon", text: "WOOF! Oh! Visitors! Are you here to throw things? Please say you're here to throw things." },
      { who: "boy", name: "The Boy", text: "Did you take my doll?!" },
      { who: "dragon", name: "The Dragon", text: "Doll? I don't know anything about any doll. ...Throw a stick and I'll tell you everything. Three sticks. Please." },
    ], () => {
      this.stage = "fetch";
      this.fetches = 0;
      this.spawnStick(g.active.pos.clone().add(new THREE.Vector3(2, 0, 2)));
      this.setTracker();
    });
  }

  spawnStick(at) {
    const g = this.game;
    if (this.stick) g.scene.remove(this.stick.obj);
    const obj = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 6), new THREE.MeshLambertMaterial({ color: "#a2734a" }));
    obj.rotation.z = Math.PI / 2;
    obj.castShadow = true;
    obj.position.set(at.x, g.world.groundAt(at.x, at.z) + 0.1, at.z);
    g.scene.add(obj);
    this.stick = { obj, vel: new THREE.Vector3(), flying: false };
  }

  pickStick() {
    this.holding = true;
    this.stick.obj.visible = false;
    this.game.sound.play("pickup", { vol: 0.4 });
  }

  throwStick() {
    const g = this.game, h = g.active;
    this.holding = false;
    const f = g.cameraForward();
    this.stick.obj.visible = true;
    this.stick.obj.position.copy(h.pos).add(new THREE.Vector3(0, 1.4, 0));
    this.stick.vel.copy(f).multiplyScalar(14).setY(7);
    this.stick.flying = true;
    g.sound.play("fetch_throw");
    g.party.byId.dragon.anim.sit = false;
  }

  update(dt, t) {
    this.game.activities?.update(dt, t);
    const g = this.game;
    // Spin and bob pickups.
    for (const d of this.drops) if (d.obj.visible) { d.obj.position.y = d.pos.y + Math.sin(t * 2) * 0.25; d.obj.rotation.y += dt; }
    for (const s of this.stars) if (!s.got) { s.obj.position.y = s.pos.y + Math.sin(t * 2.4 + s.pos.x) * 0.2; }
    if (this.dollGlow) {
      this.dollGlow.material.opacity = 0.14 + 0.07 * Math.sin(t * 2);
      // Pink sparkles drift around Dolly's perch so the cap twinkles from across the world.
      this.dollSparkle -= dt;
      if (this.dollSparkle <= 0) {
        this.dollSparkle = 0.12;
        const d = g.party.byId.doll.pos, a = t * 1.3;
        g.fx.burst(new THREE.Vector3(d.x + Math.cos(a) * 2.5, d.y + 1 + Math.sin(t * 2) * 0.6, d.z + Math.sin(a) * 2.5), "sparkle", 2,
          { color: "#ffc6dc", speed: 0.6, life: 1.6, size: 0.9, up: 0.6 });
      }
    }
    // Picking things up by walking into them.
    for (const h of g.party.members) {
      if (!h.joined || h.fainted) continue;
      if (this.stage === "drops") for (const d of this.drops) if (!d.got && h.pos.distanceTo(d.pos) < 2.2) this.collectDrop(d);
      for (const s of this.stars) {
        if (!s.got && h.pos.distanceTo(s.pos) < 1.8) {
          s.got = true; s.obj.visible = false; g.party.stars++;
          g.sound.play("pickup"); g.fx.burst(s.pos, "star", 30, { speed: 5 });
          g.ui.toast(`Found a star! (${g.party.stars}/${g.totalStars})`);
          g.party.gainXp(25);
          if (this.stage === "free") this.setTracker();
        }
      }
    }
    // Biscuit's fetch game.
    const b = g.party.byId.dragon;
    if (this.stage === "fetch" && this.stick) {
      const st = this.stick;
      if (st.flying) {
        st.vel.y -= 20 * dt;
        st.obj.position.addScaledVector(st.vel, dt);
        st.obj.rotation.x += dt * 12;
        const gy = g.world.groundAt(st.obj.position.x, st.obj.position.z);
        if (st.obj.position.y <= gy + 0.1) { st.obj.position.y = gy + 0.1; st.flying = false; st.landed = true; g.sound.play("bark"); }
      }
      if (st.landed) {
        // Biscuit bounds over, grabs it and brings it back.
        const to = st.obj.position.clone().sub(b.pos).setY(0);
        if (!st.fetched) {
          if (to.length() > 2) { b.vel.x = to.x / to.length() * 11; b.vel.z = to.z / to.length() * 11; b.faceTowards(to.x, to.z, dt); }
          else { st.fetched = true; st.obj.visible = false; g.sound.play("bark"); }
        } else {
          const back = g.active.pos.clone().sub(b.pos).setY(0);
          if (back.length() > 3) { b.vel.x = back.x / back.length() * 11; b.vel.z = back.z / back.length() * 11; b.faceTowards(back.x, back.z, dt); }
          else {
            b.vel.set(0, b.vel.y, 0);
            this.fetches++;
            g.fx.burst(b.pos.clone().add(new THREE.Vector3(0, 2, 0)), "heal", 16, { color: "#ffc4d6" });
            g.ui.bubble(b, ["Again! AGAIN!", "Best. Day. Ever.", "One more! One more!"][Math.min(2, this.fetches - 1)]);
            this.setTracker();
            if (this.fetches >= 3) { g.scene.remove(st.obj); this.stick = null; this.biscuitJoins(); }
            else this.spawnStick(b.pos.clone().add(b.forward().multiplyScalar(1.5)));
          }
        }
      }
      if (!st || (!st.landed && !st.flying)) { b.vel.x *= 0.8; b.vel.z *= 0.8; }
    }
    if (!b.joined) b.update(dt, t, null);
    const doll = g.party.byId.doll;
    if (!doll.joined) { doll.anim.sit = true; doll.update(dt, t, null); }
    // Reaching the cap starts the boss fight.
    if (this.stage === "climb" && g.active.pos.y > g.world.capTop - 0.8 && g.active.pos.distanceTo(g.world.capCentre.clone().setY(g.world.capTop)) < 9) this.startBoss();
  }

  biscuitJoins() {
    const g = this.game, b = g.party.byId.dragon;
    g.dialogue.say([
      { who: "dragon", name: "Biscuit", text: "Okay, okay. Full truth. I didn't take your doll. My old master did. The Great Pine." },
      { who: "dragon", name: "Biscuit", text: "He never threw ONE stick in three hundred years. He wants your doll because you love her. He can't stand that." },
      { who: "girl", name: "The Girl", text: "Then we go up there together. All of us." },
      { who: "dragon", name: "Biscuit", text: "I can fly, you know! Hold Space to flap. I'm Biscuit, by the way. I'm a good boy." },
    ], () => {
      b.joined = true;
      g.ui.buildParty();
      g.sound.play("quest");
      g.ui.toast("Biscuit joined your party! Press 3 to play as him.", "quest");
      this.stage = "climb";
      this.setTracker();
    });
  }

  startBoss() {
    const g = this.game;
    this.stage = "boss";
    this.setTracker();
    const cap = g.world.capCentre;
    // The Great Pine looms at the far side of the cap from where you arrived.
    const away = cap.clone().sub(g.active.pos).setY(0).normalize().multiplyScalar(4);
    const boss = g.spawnEnemy("boss", cap.x + away.x, cap.z + away.z, cap);
    boss.pos.y = g.world.capTop;
    g.boss = boss;
    g.ui.boss(boss);
    g.speakers.pine = boss;
    g.sound.setMusic("boss");
    g.sound.play("boss_roar");
    g.dialogue.say([
      { who: "pine", name: "The Great Pine", text: "Who dares climb MY mushroom? Ah. The boy. And my runaway dog.", look: "boss" },
      { who: "pine", name: "The Great Pine", text: "This doll is MINE now. Everyone loves her. Nobody ever loved a pine. Not even at Christmas. ESPECIALLY at Christmas." },
      { who: "boy", name: "The Boy", text: "Return my doll, or slay me where I stand!" },
      { who: "pine", name: "The Great Pine", text: "...Fine. I'll do the second one." },
    ], () => { boss.started = true; });
  }

  bossDefeated(opts = {}) {
    const g = this.game, doll = g.party.byId.doll;
    g.sound.setMusic("victory");
    g.ui.boss(null);
    this.stage = "ending";
    g.dialogue.say([
      ...(opts.friend ? [
        { who: "doll", name: "Dolly", text: "Well. That's the first sensible thing anyone's done all day." },
      ] : [
        { who: "pine", name: "The Great Pine", text: "Oof. Needles... everywhere. Fine. Take her. She kept looking at me like I was sad." },
        { who: "doll", name: "Dolly", text: "You ARE sad. But you could try being kind. Biscuit says you've never thrown a stick." },
      ]),
      { who: "boy", name: "The Boy", text: "DOLLY! You can TALK?" },
      { who: "doll", name: "Dolly", text: "Always could. You never stopped talking long enough to notice." },
      { who: "narrator", name: "Storyteller", text: "And high above, the Sun, who had watched the whole thing, laughed so hard that it set three hours early." },
    ], () => {
      doll.joined = true;
      doll.anim.sit = false;
      doll.revive(1);
      if (this.dollGlow) { g.scene.remove(this.dollGlow); this.dollGlow = null; }
      g.ui.buildParty();
      g.world.time = 0.74; // sunset
      g.sound.setMusic("day");
      g.ui.toast("Dolly joined your party! Press 4 to play as her.", "quest");
      g.party.gainXp(200);
      this.stage = "free";
      this.setTracker();
      g.showEnding();
    });
  }
}
