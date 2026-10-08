// Post-processing: turns the render into a living watercolour page.
// Render -> selective bloom (only emissive magic is bright enough) -> watercolour pass (wobble, bleed,
// ink outlines from depth, pigment pooling at colour edges, height mist, time-of-day grading, soft
// highlight shoulder, paper granulation, vignette, hit flash) -> sRGB output -> FXAA.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

function paperTexture() {
  // R/G: low-frequency wobble field, B: fine paper tooth. Tiles seamlessly.
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  const rnd = (s) => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
  const val = (x, y, f, seed) => {
    // tileable value noise at frequency f
    const xi = Math.floor(x * f), yi = Math.floor(y * f), xf = x * f - xi, yf = y * f - yi;
    const h = (a, b) => rnd(((a % f) + f) % f * 57 + (((b % f) + f) % f) * 131 + seed * 17);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), cc = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const r = 0.6 * val(u, v, 4, 1) + 0.4 * val(u, v, 9, 2);
    const gg = 0.6 * val(u, v, 4, 3) + 0.4 * val(u, v, 9, 4);
    const b = 0.5 * val(u, v, 32, 5) + 0.3 * val(u, v, 64, 6) + 0.2 * rnd(x * 7 + y * 131);
    const i = (y * N + x) * 4;
    img.data[i] = r * 255; img.data[i + 1] = gg * 255; img.data[i + 2] = b * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

class WatercolourPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null }, tPaper: { value: paperTexture() },
      resolution: { value: new THREE.Vector2(1, 1) }, near: { value: 0.1 }, far: { value: 2000 }, time: { value: 0 },
      projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() },
      lift: { value: new THREE.Vector3(0.03, 0.028, 0.03) }, gain: { value: new THREE.Vector3(1, 1, 0.98) },
      sat: { value: 0.95 }, mist: { value: 0.3 }, mistHeight: { value: 2 }, mistColor: { value: new THREE.Color(1, 0.95, 0.9) },
      ink: { value: 0.55 }, inkColor: { value: new THREE.Color(0.32, 0.25, 0.36) }, pigment: { value: 0.16 },
      paperAmt: { value: 0.11 }, wobble: { value: 1.0 }, vignette: { value: 0.32 },
      flash: { value: 0 }, flashColor: { value: new THREE.Color(1, 1, 1) },
      sunUv: { value: new THREE.Vector2(0.5, 0.8) }, rays: { value: 0 }, rayColor: { value: new THREE.Color(1, 0.9, 0.7) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tDepth, tPaper;
        uniform vec2 resolution; uniform float near, far, time;
        uniform mat4 projInv, camWorld;
        uniform vec3 lift, gain, mistColor, inkColor, flashColor;
        uniform float sat, mist, mistHeight, ink, pigment, paperAmt, wobble, vignette, flash, rays;
        uniform vec2 sunUv; uniform vec3 rayColor;
        varying vec2 vUv;
        float linZ(float d){ float z = d * 2.0 - 1.0; return (2.0 * near * far) / (far + near - z * (far - near)); }
        vec3 viewPos(vec2 uv, float d){ vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
        vec3 shoulder(vec3 x){ // soft highlight roll-off instead of a hard clip
          vec3 k = max(x - 0.78, 0.0);
          return min(x, 0.78) + 0.22 * (1.0 - exp(-k / 0.22));
        }
        void main(){
          vec2 px = 1.0 / resolution;
          float aspect = resolution.x / resolution.y;
          vec3 pp = texture2D(tPaper, vUv * vec2(aspect, 1.0) * 1.6).rgb;
          // Hand-made wobble: the image sits a hair off on the paper.
          vec2 uv = vUv + (pp.rg - 0.5) * wobble * px * 3.5;
          vec3 c = texture2D(tDiffuse, uv).rgb;
          vec3 cr = texture2D(tDiffuse, uv + vec2(px.x * 2.0, 0.0)).rgb, cl = texture2D(tDiffuse, uv - vec2(px.x * 2.0, 0.0)).rgb;
          vec3 cu = texture2D(tDiffuse, uv + vec2(0.0, px.y * 2.0)).rgb, cd = texture2D(tDiffuse, uv - vec2(0.0, px.y * 2.0)).rgb;
          // Colour bleed: wet edges soften into their neighbours.
          c = mix(c, (cr + cl + cu + cd) * 0.25, 0.22);
          // Pigment pools at colour edges (darker rims, like a dried wash).
          float gx = dot(cr - cl, vec3(0.333)), gy = dot(cu - cd, vec3(0.333));
          float pig = smoothstep(0.04, 0.25, length(vec2(gx, gy)));
          c *= 1.0 - pig * pigment;
          // Ink outlines where depth folds (silhouettes), fading with distance.
          float d0 = texture2D(tDepth, vUv).r;
          float z0 = linZ(d0);
          float zl = linZ(texture2D(tDepth, vUv - vec2(px.x, 0.0)).r), zr = linZ(texture2D(tDepth, vUv + vec2(px.x, 0.0)).r);
          float zu = linZ(texture2D(tDepth, vUv + vec2(0.0, px.y)).r), zd = linZ(texture2D(tDepth, vUv - vec2(0.0, px.y)).r);
          float dz = (abs(zl + zr - 2.0 * z0) + abs(zu + zd - 2.0 * z0)) / max(z0, 0.4);
          float edge = smoothstep(0.006, 0.045, dz) * (1.0 - smoothstep(45.0, 240.0, z0));
          edge *= 0.65 + 0.35 * pp.b; // a slightly broken, hand-drawn line
          // Height mist and aerial haze, reconstructed from depth.
          if (d0 < 0.99999) {
            vec3 vp = viewPos(vUv, d0);
            vec3 wp = (camWorld * vec4(vp, 1.0)).xyz;
            float dist = length(vp);
            float n = texture2D(tPaper, wp.xz * 0.006 + vec2(time * 0.004, time * 0.002)).r;
            float m = mist * (1.0 - exp(-dist * 0.010)) * exp(-max(wp.y - mistHeight, 0.0) * 0.18);
            c = mix(c, mistColor, clamp(m * (0.55 + 0.9 * n), 0.0, 0.65));
          }
          // Distance melts into soft washes, as a painter leaves the background loose.
          float far = smoothstep(70.0, 260.0, z0) * step(d0, 0.99999);
          if (far > 0.01) {
            vec3 soft = vec3(0.0);
            for (int i = 0; i < 6; i++) {
              float a = float(i) * 1.0472 + pp.r * 3.0;
              soft += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * px * 3.5).rgb;
            }
            c = mix(c, soft / 6.0, far * 0.7);
          }
          c = mix(c, c * inkColor * 1.4, edge * ink);
          // Light shafts: march toward the sun; wherever the sky shows through, light streams in.
          if (rays > 0.001) {
            vec2 dir = sunUv - vUv;
            float acc = 0.0;
            for (int i = 0; i < 10; i++) {
              vec2 sp = vUv + dir * ((float(i) + pp.b) / 10.0);
              if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0) acc += step(0.99999, texture2D(tDepth, sp).r);
            }
            float fall = 1.0 - smoothstep(0.0, 1.1, length(dir * vec2(aspect, 1.0)));
            c += rayColor * (acc / 10.0) * fall * fall * rays;
          }
          // Grade: no true blacks in watercolour; per time-of-day lift/gain and saturation.
          c = shoulder(c);
          c = lift + c * (gain - lift);
          float g = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(g), c, sat);
          // Paper tooth: granulation sits more in the painted (darker) areas.
          c *= 1.0 - paperAmt * (pp.b - 0.5) * (0.5 + (1.0 - g));
          // Vignette like a page under a lamp.
          float v = length((vUv - 0.5) * vec2(aspect * 0.8, 1.0));
          c *= 1.0 - vignette * smoothstep(0.35, 0.95, v);
          c = mix(c, flashColor, flash);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setSize(w, h) { this.uniforms.resolution.value.set(w, h); }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.near.value = this.camera.near;
    u.far.value = this.camera.far;
    u.projInv.value.copy(this.camera.projectionMatrixInverse);
    u.camWorld.value.copy(this.camera.matrixWorld);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

const lerp = (a, b, t) => a + (b - a) * t;

export class Post {
  constructor(game) {
    this.game = game;
    const r = game.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(game.scene, game.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.4, 0.5, 1.3);
    this.composer.addPass(this.bloom);
    this.water = new WatercolourPass(game.camera);
    this.composer.addPass(this.water);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new FXAAPass());
    this.flashLeft = 0;
    this.flashDur = 1;
    this.setSize(innerWidth, innerHeight);
    document.body.classList.add("post");
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.game.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const s = this.game.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.water.setSize(s.x, s.y);
  }

  flash(color = "#ffffff", seconds = 0.25) {
    this.water.uniforms.flashColor.value.set(color);
    this.flashLeft = this.flashDur = seconds;
  }

  /** Grade follows the time of day: golden warmth at dusk, cool moonlight at night, misty dawns. */
  grade(dt) {
    const w = this.game.world;
    if (!w) return;
    const t = w.time, night = w.night || 0;
    const golden = Math.max(0, 1 - Math.abs(t - 0.74) / 0.07);
    const dawn = Math.max(0, 1 - Math.abs(t - 0.27) / 0.06);
    const u = this.water.uniforms;
    u.lift.value.set(lerp(0.022, 0.02, night) + golden * 0.02, lerp(0.018, 0.03, night) + golden * 0.005, lerp(0.024, 0.06, night));
    u.gain.value.set(lerp(1.0, 0.82, night) + golden * 0.05, lerp(0.99, 0.9, night) - golden * 0.02, lerp(0.97, 1.12, night) - golden * 0.1);
    u.sat.value = lerp(1.04, 0.82, night) + golden * 0.08;
    u.mist.value = 0.1 + 0.3 * night + 0.45 * dawn - 0.05 * golden;
    u.mistColor.value.copy(this.game.scene.fog ? this.game.scene.fog.color : new THREE.Color(1, 1, 1)).lerp(new THREE.Color(1, 1, 1), 0.25);
    u.ink.value = lerp(0.55, 0.4, night);
    u.time.value = this.game.t || performance.now() / 1000;
    // Sun shafts: strongest in the low morning and golden evening sun, when it's in front of us.
    const sun = w.sunPuppet;
    let rays = 0;
    if (sun && sun.visible) {
      const p = sun.position.clone().project(this.game.camera);
      if (p.z < 1 && Math.abs(p.x) < 1.6 && p.y > -0.4 && p.y < 2.2) {
        u.sunUv.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
        const low = Math.max(0, 1 - Math.abs(t - 0.32) / 0.1) + Math.max(0, 1 - Math.abs(t - 0.72) / 0.09);
        rays = (0.08 + 0.2 * Math.min(1, low)) * (1 - night) * (1 - Math.max(0, Math.abs(p.x) - 1) * 1.6);
      }
    }
    u.rays.value = Math.max(0, rays);
    if (w.sunLight) u.rayColor.value.copy(w.sunLight.color).lerp(new THREE.Color(1, 1, 1), 0.2);
    this.bloom.strength = lerp(0.35, 0.8, night);
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    u.flash.value = 0.55 * (this.flashLeft / this.flashDur);
  }

  render(dt) {
    this.grade(dt);
    this.composer.render(dt); // (renderer.info is reset once per frame by the game loop)
  }
}
