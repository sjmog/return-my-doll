// HUD and dialogue, drawn in the DOM over the canvas.
import * as THREE from "three";
import { PLACES, WORLD_R } from "./world.js";

const PORTRAITS = { boy: "boy", girl: "girl", dragon: "dragon", doll: "girl", oak: "tree_oak", sun: "sun", pine: "tree_pine", narrator: "tree_magic" };
const $ = (s) => document.querySelector(s);

export class UI {
  constructor(game) {
    this.game = game;
    this.partyEl = $("#party");
    this.movesEl = $("#moves");
    this.questEl = $("#quest");
    this.toastEl = $("#toasts");
    this.bubbles = [];
    this.mini = $("#minimap");
    this.miniCtx = this.mini.getContext("2d");
    this.compass = $("#compass");
    this.bossEl = $("#bossbar");
  }

  portrait(id) {
    return `thumbs/${PORTRAITS[id] || id}.png`;
  }

  buildParty() {
    const g = this.game;
    this.partyEl.innerHTML = g.party.members.filter((h) => h.joined).map((h, i) => `
      <button class="member" data-id="${h.id}" title="${h.def.name} (${i + 1})">
        <img src="${this.portrait(h.id)}" alt="">
        <span class="key">${i + 1}</span>
        <span class="nm">${h.def.name}</span>
        <span class="hp"><i></i></span>
      </button>`).join("");
    this.partyEl.querySelectorAll(".member").forEach((b) => b.onclick = () => g.switchTo(b.dataset.id));
  }

  buildMoves() {
    const h = this.game.active;
    const keys = { primary: "Click / J (hold)", special: "Right-click / K", mobility: "Shift", guard: "F" };
    this.movesEl.innerHTML = h.def.moves.map((m) => `
      <div class="move" data-k="${m.key}">
        <div class="ic">${m.icon}<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"/></svg></div>
        <div class="mt"><b>${m.name}</b><span>${keys[m.key]}</span></div>
      </div>`).join("") + `<div class="move"><div class="ic">${h.def.flies ? "🪽" : "⤴️"}</div><div class="mt"><b>${h.def.flies ? "Fly" : h.def.jumps > 1 ? (h.def.jumps === 2 ? "Double jump" : "Triple jump") : "Jump"}</b><span>Space</span></div></div>`;
  }

  toast(text, kind = "") {
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.textContent = text;
    this.toastEl.appendChild(el);
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  bubble(actor, text) {
    const el = document.createElement("div");
    el.className = "bubble";
    el.textContent = text;
    document.querySelector("#overlay").appendChild(el);
    this.bubbles.push({ el, actor, age: 0 });
  }

  setQuest(title, lines, side = []) {
    const html = `<h3>${title}</h3>` + lines.map((l) => `<p class="${l.done ? "done" : ""}">${l.done ? "✓" : "•"} ${l.text}</p>`).join("")
      + (side.length ? `<h4>Side tales</h4>` + side.map((l) => `<p class="side ${l.done ? "done" : ""}">${l.done ? "✓" : "✦"} ${l.text}</p>`).join("") : "");
    if (html !== this.questHtml) { this.questHtml = html; this.questEl.innerHTML = html; }
  }

  /** Ask a question with up to four answers (keys 1-4 or click). Resolves to the index, or -1 on timeout. */
  choose(question, options, opts = {}) {
    return this.game.dialogue.choose({ text: question, options, who: opts.who || "narrator", name: opts.name || "", timer: opts.timer || 0 });
  }

  boss(enemy) {
    this.bossTarget = enemy;
    this.bossEl.hidden = !enemy;
    document.querySelector("#hud").classList.toggle("bossfight", !!enemy);
  }

  tick(dt) {
    for (const b of this.bubbles) b.age += dt;
  }

  update() {
    const g = this.game;
    if (!g.started) return;
    // Party bars.
    for (const h of g.party.members) {
      const el = this.partyEl.querySelector(`[data-id="${h.id}"]`);
      if (!el) continue;
      el.classList.toggle("active", g.active === h);
      el.classList.toggle("fainted", h.fainted);
      el.querySelector(".hp i").style.width = `${Math.max(0, (h.hp / h.maxHp) * 100)}%`;
    }
    // Move cooldowns.
    const h = g.active;
    this.movesEl.querySelectorAll(".move[data-k]").forEach((m) => {
      const key = m.dataset.k, def = h.def.moves.find((x) => x.key === key);
      const u = def.cd ? h.cd[key] / def.cd : 0;
      m.classList.toggle("cooling", u > 0);
      m.querySelector("circle").style.strokeDashoffset = String(100.5 * (1 - u));
    });
    $("#level").textContent = `Lv ${g.party.level}`;
    $("#xp i").style.width = `${(g.party.xp / g.party.nextXp()) * 100}%`;
    const sun = g.activities?.byId?.sun;
    const blessed = sun && sun.blessed > 0 ? `  ·  🌞 ${Math.floor(sun.blessed / 60)}:${String(Math.floor(sun.blessed % 60)).padStart(2, "0")}` : "";
    $("#acorns").textContent = `🌰 ${g.party.acorns}  ·  ⭐ ${g.party.stars}/${g.totalStars}${blessed}`;
    // Bubbles over heads.
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (b.age > 2.6) { b.el.remove(); this.bubbles.splice(i, 1); continue; }
      const v = b.actor.pos.clone().add(new THREE.Vector3(0, 2.6, 0)).project(g.camera);
      b.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
      b.el.style.opacity = String(Math.min(1, (2.6 - b.age) * 3));
    }
    if (this.bossTarget) {
      $("#bossbar i").style.width = `${Math.max(0, this.bossTarget.hp / this.bossTarget.maxHp) * 100}%`;
      if (!this.bossTarget.alive) this.boss(null);
    }
    // The minimap is a canvas redraw: ~12 Hz is plenty.
    const now = performance.now();
    if (now - (this.mapAt || 0) > 80) { this.mapAt = now; this.drawMinimap(); }
    this.drawCompass();
  }

  drawMinimap() {
    const g = this.game, c = this.miniCtx, W = this.mini.width, H = this.mini.height;
    const big = g.mapOpen;
    const range = big ? WORLD_R * 1.05 : 70;
    const centre = big ? new THREE.Vector3() : g.active.pos;
    const sx = (x) => W / 2 + ((x - centre.x) / range) * (W / 2);
    const sz = (z) => H / 2 + ((z - centre.z) / range) * (H / 2);
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 2, 0, 7); c.clip();
    c.fillStyle = "#e9efd2"; c.fillRect(0, 0, W, H);
    const dot = (p, r, col, label) => {
      const x = sx(p.x), y = sz(p.z);
      c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      if (label && big) { c.fillStyle = "#4a3d58"; c.font = "bold 12px Nunito, sans-serif"; c.textAlign = "center"; c.fillText(label, x, y - r - 4); }
    };
    // Pond and landmarks.
    c.fillStyle = "#b9dcec"; c.beginPath(); c.arc(sx(PLACES.pond.x), sz(PLACES.pond.z), (26 / range) * (W / 2), 0, 7); c.fill();
    c.fillStyle = "#c8dcb0"; c.beginPath(); c.arc(sx(PLACES.woods.x), sz(PLACES.woods.z), (42 / range) * (W / 2), 0, 7); c.fill();
    dot(PLACES.mushroom, big ? 7 : 6, "#ef9fbd", "Mushroom Tree");
    dot(PLACES.village, 5, "#f2c98a", "Village");
    dot(PLACES.oak, 4, "#8fb37a", "Wizard Oak");
    if (big) { dot(PLACES.woods, 3, "#6f9a6a", "Pine Woods"); dot(PLACES.pond, 3, "#7fb5d0", "Lily Pond"); dot(PLACES.hill, 3, "#a5c48f", "Oak Ring"); }
    for (const e of g.enemies) if (e.alive) dot(e.pos, big ? 2 : 2.5, e.kind === "boss" ? "#5e8a4f" : "#c76b7b");
    for (const o of g.quests.markers()) dot(o, 5, "#f7d154");
    for (const o of g.activities?.markers() || []) dot(o, 4.5, "#b48be6");
    for (const o of g.activities?.starHints() || []) { c.fillStyle = "#e0a91a"; c.font = `${big ? 16 : 12}px sans-serif`; c.textAlign = "center"; c.fillText("★", sx(o.x), sz(o.z) + 4); }
    for (const h of g.party.members) if (h.joined && h !== g.active) dot(h.pos, 3, "#7f68b0");
    // Player arrow.
    const p = g.active;
    c.save(); c.translate(sx(p.pos.x), sz(p.pos.z)); c.rotate(-p.facing + Math.PI);
    c.fillStyle = "#3b3049"; c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 5); c.lineTo(-5, 5); c.closePath(); c.fill();
    c.restore();
    c.restore();
    c.strokeStyle = "rgba(59,48,73,.35)"; c.lineWidth = 3; c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 2, 0, 7); c.stroke();
  }

  drawCompass() {
    // Arrow at the screen edge pointing to the current objective.
    const g = this.game, m = g.quests.markers()[0];
    if (!m || g.dialogue.open) { this.compass.hidden = true; return; }
    const v = m.clone().add(new THREE.Vector3(0, 2, 0)).project(g.camera);
    const onScreen = v.z < 1 && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.85;
    const d = Math.round(m.distanceTo(g.active.pos));
    this.compass.hidden = false;
    let x = v.x, y = v.y;
    if (v.z > 1) { x = -x; y = -y; }
    if (!onScreen) {
      const k = 0.85 / Math.max(Math.abs(x), Math.abs(y));
      x *= k; y *= k;
    }
    this.compass.style.transform = `translate(${(x * 0.5 + 0.5) * innerWidth}px, ${(-y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -50%)`;
    this.compass.querySelector("b").textContent = `${d} m`;
    this.compass.querySelector("span").style.transform = onScreen ? "rotate(180deg)" : `rotate(${Math.atan2(x, y) * 180 / Math.PI}deg)`;
  }
}

/** Dialogue box with portraits and a typewriter. Lines: {who, name, text}. */
export class Dialogue {
  constructor(game) {
    this.game = game;
    this.el = $("#dialogue");
    this.open = false;
    this.queue = [];
    this.choosing = null;
    this.el.onclick = () => this.advance();
    this.choicesEl = this.el.querySelector(".choices");
    this.timerEl = this.el.querySelector(".ctimer");
    // While choosing, number keys / arrows / Enter belong to the choice (not hero switching or jumping).
    addEventListener("keydown", (e) => {
      const c = this.choosing;
      if (!c) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[e.code];
      if (n !== undefined && n < c.n) return this.pick(n);
      if (e.code === "ArrowDown" || e.code === "KeyS") this.highlight((c.sel + 1) % c.n);
      if (e.code === "ArrowUp" || e.code === "KeyW") this.highlight((c.sel + c.n - 1) % c.n);
      if (e.code === "Enter" || e.code === "Space" || e.code === "KeyE") this.pick(c.sel);
    }, true);
  }

  choose({ text, options, who, name, timer }) {
    return new Promise((resolve) => {
      this.queue = [];
      this.done = null;
      this.open = true;
      this.el.hidden = false;
      document.querySelector("#hud").classList.add("talking");
      if (document.pointerLockElement) document.exitPointerLock();
      this.line = { who, name, text };
      this.shown = text.length;
      this.el.querySelector("img").src = this.game.ui.portrait(who);
      this.el.querySelector(".who").textContent = name;
      this.el.querySelector(".text").textContent = text;
      this.el.classList.add("choosing");
      this.el.classList.toggle("narrator", who === "narrator");
      this.choicesEl.innerHTML = options.map((o, i) => `<button type="button" data-i="${i}"><kbd>${i + 1}</kbd><span></span></button>`).join("");
      this.choicesEl.querySelectorAll("button").forEach((b, i) => {
        b.querySelector("span").textContent = options[i];
        b.onclick = (e) => { e.stopPropagation(); this.pick(i); };
        b.onmouseenter = () => this.highlight(i);
      });
      this.choicesEl.hidden = false;
      this.timerEl.hidden = !timer;
      this.choosing = { resolve, n: options.length, sel: 0, timer, left: timer };
      this.highlight(0);
      this.game.sound.play("talk", { vol: 0.5 });
    });
  }

  highlight(i) {
    if (!this.choosing) return;
    this.choosing.sel = i;
    this.choicesEl.querySelectorAll("button").forEach((b, k) => b.classList.toggle("sel", k === i));
  }

  pick(i) {
    const c = this.choosing;
    if (!c) return;
    this.choosing = null;
    this.choicesEl.hidden = true;
    this.timerEl.hidden = true;
    this.el.classList.remove("choosing");
    this.game.sound.play("pickup", { vol: 0.3 });
    this.close();
    c.resolve(i);
  }

  say(lines, done) {
    this.queue = lines.slice();
    this.done = done;
    this.open = true;
    this.el.hidden = false;
    document.querySelector("#hud").classList.add("talking");
    this.next();
  }

  next() {
    const line = this.queue.shift();
    if (!line) return this.close();
    this.line = line;
    this.shown = 0;
    this.el.querySelector("img").src = this.game.ui.portrait(line.who);
    this.el.querySelector(".who").textContent = line.name;
    this.el.querySelector(".text").textContent = "";
    this.el.classList.toggle("narrator", line.who === "narrator");
    const g = this.game;
    if (line.look && line.look.isVector3) g.camFocus = line.look.clone();
    if (line.look === "doll") g.camFocus = g.party.byId.doll.pos.clone().add(new THREE.Vector3(0, 1, 0));
    else if (line.look === "boss" && g.boss) g.camFocus = g.boss.pos.clone().add(new THREE.Vector3(0, 3, 0));
    else if (line.look === undefined && g.camFocus && !line.keepLook) g.camFocus = null;
    const speaker = this.game.speakers[line.who];
    for (const a of Object.values(this.game.speakers)) if (a?.anim) a.anim.talk = false;
    if (speaker?.anim) speaker.anim.talk = true;
    this.game.sound.play("talk", { vol: 0.5 });
  }

  advance() {
    if (!this.open || this.choosing) return;
    if (this.shown < this.line.text.length) { this.shown = this.line.text.length; return; }
    this.next();
  }

  close() {
    this.open = false;
    this.el.hidden = true;
    document.querySelector("#hud").classList.remove("talking");
    this.game.camFocus = null;
    for (const a of Object.values(this.game.speakers)) if (a?.anim) a.anim.talk = false;
    const d = this.done;
    this.done = null;
    if (d) d();
  }

  update(dt) {
    const c = this.choosing;
    if (c && c.timer) {
      c.left -= dt;
      this.timerEl.querySelector("i").style.width = `${Math.max(0, c.left / c.timer) * 100}%`;
      if (c.left <= 0) this.pick(-1);
    }
    if (!this.open || !this.line || c) return;
    if (this.shown < this.line.text.length) {
      this.shown = Math.min(this.line.text.length, this.shown + dt * 55);
      this.el.querySelector(".text").textContent = this.line.text.slice(0, Math.floor(this.shown));
    }
  }
}
