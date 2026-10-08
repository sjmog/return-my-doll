// Music (crossfaded by mood) and sound effects, all generated with ElevenLabs for this game.
const SFX = ["jump", "land", "splash", "wade", "swing", "hit", "verse", "bolt", "heal", "blink", "flap", "breath", "tailspin", "roar", "bark",
  "pine_hop", "pine_hurt", "pine_die", "pickup", "levelup", "hurt", "doll", "button", "boss_roar", "boss_slam", "needles",
  "talk", "quest", "fetch_throw", "portal"];
const MUSIC = ["title", "day", "night", "battle", "boss", "victory"];

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.music = {};
    this.current = null;
    this.musicVol = 0.45;
    this.sfxVol = 0.8;
    this.muted = new URLSearchParams(location.search).has("mute");
    this.last = {};
  }

  async init() {
    if (this.ctx) return;
    // Everything that needs a user gesture happens synchronously here, inside the click/keypress:
    // browsers only allow audio to start in direct response to the player.
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.ctx.resume?.();
    for (const n of MUSIC) {
      const a = new Audio(`assets/audio/music_${n}.mp3`);
      a.loop = n !== "victory";
      a.preload = "auto";
      a.volume = 0;
      this.music[n] = a;
      // Prime each track while we still have the gesture, then pause it again.
      a.play().then(() => { if (this.current !== n) a.pause(); }).catch(() => {});
    }
    // If anything was still blocked, the next key or click unlocks it.
    const unlock = () => {
      if (this.ctx.state === "suspended") this.ctx.resume();
      const cur = this.music[this.current];
      if (cur && cur.paused) cur.play().catch(() => {});
      this.report();
    };
    addEventListener("pointerdown", unlock, true);
    addEventListener("keydown", unlock, true);
    this.ctx.onstatechange = () => this.report();
    await Promise.all(SFX.map(async (n) => {
      try {
        const r = await fetch(`assets/audio/sfx_${n}.mp3`);
        this.buffers[n] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) { /* a missing sound shouldn't stop the game */ }
    }));
    this.report();
  }

  /** Audio state on <body data-audio> so it can be checked from outside the page. */
  report() {
    const cur = this.music[this.current];
    document.body.dataset.audio = `ctx:${this.ctx?.state} music:${this.current || "-"}:${cur ? (cur.paused ? "paused" : "playing") : "-"} vol:${cur ? cur.volume.toFixed(2) : "-"} muted:${this.muted} sfx:${Object.keys(this.buffers).length}`;
  }

  play(name, { vol = 1, rate = 1, gap = 0.06 } = {}) {
    if (!this.ctx || this.muted || !this.buffers[name]) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain();
    g.gain.value = vol * this.sfxVol;
    src.connect(g).connect(this.master);
    src.start();
  }

  setMusic(name) {
    if (!this.ctx || name === this.current) return;
    const prev = this.current ? this.music[this.current] : null;
    const next = this.music[name];
    this.current = name;
    if (next) {
      next.currentTime = 0;
      next.play().then(() => this.report()).catch(() => this.report());
      this.fade(next, this.muted ? 0 : this.musicVol, 2.5);
    }
    if (prev) this.fade(prev, 0, 2.5, () => prev.pause());
  }

  fade(a, to, secs, done) {
    const from = a.volume, t0 = performance.now();
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / (secs * 1000));
      a.volume = from + (to - from) * u;
      if (u < 1) requestAnimationFrame(step); else if (done) done();
    };
    step();
  }

  toggleMute() {
    this.muted = !this.muted;
    for (const a of Object.values(this.music)) a.volume = this.muted ? 0 : (a === this.music[this.current] ? this.musicVol : 0);
    return this.muted;
  }
}
