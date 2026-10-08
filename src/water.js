// Water: a mirror reflection of the world, rippling surfaces with depth, glints, caustics and foam,
// and rings that spread wherever something moves through it.
import * as THREE from "three";

export const MAX_RIPPLES = 12;

/** Renders the scene mirrored in a horizontal plane, at half resolution, for the water to sample. */
export class Reflection {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.set(0); // layer 1 (water, grass, sparkles) stays out of the reflection
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.clear = new THREE.Color(0, 0, 0);
    this.matrix = new THREE.Matrix4(); // world -> reflection texture uv
    this.setSize();
  }

  setSize() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(Math.max(1, Math.round(s.x / 2)), Math.max(1, Math.round(s.y / 2)));
  }

  render(scene, camera, planeY) {
    const rc = this.camera, cp = camera.position;
    if (cp.y < planeY + 0.05) return false;
    // Mirror the camera's position, view direction and up vector in y = planeY.
    const look = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
    rc.position.set(cp.x, 2 * planeY - cp.y, cp.z);
    rc.up.set(up.x, -up.y, up.z);
    rc.lookAt(rc.position.x + look.x, rc.position.y - look.y, rc.position.z + look.z);
    // Only what's near enough to read in a ripply mirror; the sky comes from the shader (where alpha is 0).
    rc.far = 260;
    rc.updateMatrixWorld();
    rc.fov = camera.fov; rc.aspect = camera.aspect; rc.near = camera.near;
    rc.updateProjectionMatrix();
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // Oblique near plane at the water, so nothing below the surface shows up in the mirror.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY).applyMatrix4(rc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = rc.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
    const r = this.renderer, prev = r.getRenderTarget(), shadows = r.shadowMap.autoUpdate;
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.setClearColor(this.clear, 0);
    r.state.buffers.depth.setMask(true);
    r.clear();
    r.render(scene, rc);
    r.setRenderTarget(prev);
    r.setClearColor(prevClear, prevAlpha);
    r.shadowMap.autoUpdate = shadows;
    return true;
  }
}

export function waterUniforms() {
  return {
    time: { value: 0 }, night: { value: 0 },
    zenith: { value: new THREE.Color("#9fcdec") }, horizon: { value: new THREE.Color("#fbead2") },
    deep: { value: new THREE.Color("#2f6f86") }, shallow: { value: new THREE.Color("#8fc9c4") },
    sunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3) }, sunCol: { value: new THREE.Color(1, 0.95, 0.85) },
    reflTex: { value: null }, reflMat: { value: new THREE.Matrix4() }, reflOn: { value: 0 }, reflY: { value: 0 },
    ripples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)) },
  };
}

const COMMON = /* glsl */ `
  uniform float time, night, reflOn, reflY;
  uniform vec3 zenith, horizon, deep, shallow, sunDir, sunCol;
  uniform sampler2D reflTex;
  uniform mat4 reflMat;
  uniform vec4 ripples[${MAX_RIPPLES}];
  varying vec3 vW; varying vec2 vUv; varying float vDepth; varying vec2 vFlow;
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hsh(i), hsh(i+vec2(1,0)), f.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), f.x), f.y); }
  // Wind-blown surface: a long swell, crossing chop and fine ruffles, all drifting.
  float waveH(vec2 p, vec2 drift){
    return vn(p * 0.32 + drift * 0.6) * 0.55
         + vn(p * 0.85 - vec2(drift.y, -drift.x) * 0.9) * 0.28
         + vn(p * 2.2 + drift * 1.7) * 0.12
         + vn(p * 5.0 - drift * 2.4) * 0.05;
  }
  vec2 waveGrad(vec2 p, vec2 drift){
    const float e = 0.07;
    float h = waveH(p, drift);
    return vec2(waveH(p + vec2(e, 0.0), drift) - h, waveH(p + vec2(0.0, e), drift) - h) / e;
  }
  // Rings spreading from splashes and footsteps.
  vec2 rippleGrad(vec2 p){
    vec2 g = vec2(0.0);
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = ripples[i];
      float age = time - r.z;
      if (age < 0.0 || age > 3.5) continue;
      vec2 d = p - r.xy;
      float dist = length(d) + 1e-3;
      float x = dist - age * 1.9;
      float env = r.w * exp(-age * 1.3) * exp(-x * x * 1.2) / (1.0 + dist * 0.5);
      g += (d / dist) * cos(x * 7.0) * env * 1.6;
    }
    return g;
  }
  vec4 shadeWater(vec2 grad, float depth, float flowFoam){
    vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
    vec3 V = normalize(cameraPosition - vW);
    float ndv = max(dot(V, N), 0.0);
    float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.6, R.y));
    vec3 refl = sky;
    if (reflOn > 0.5) {
      vec4 rp = reflMat * vec4(vW.x, reflY, vW.z, 1.0);
      vec2 ruv = rp.xy / rp.w + N.xz * 0.05;
      vec4 mirror = texture2D(reflTex, clamp(ruv, 0.002, 0.998));
      // Empty mirror (alpha 0) is open sky. The mirror is a plane at the pond's level, so water much
      // higher than that (the upland stream) sees only sky.
      refl = mix(sky, mirror.rgb, clamp(mirror.a, 0.0, 1.0) * (1.0 - smoothstep(0.2, 0.8, abs(vW.y - reflY))));
    }
    float dT = smoothstep(0.0, 2.4, depth);
    vec3 body = mix(shallow, deep, dT) * mix(1.0, 0.35, night);
    // Dappled light on the bed of the shallows.
    vec2 cp = vW.xz * 0.9 + grad * 0.6;
    float caust = pow(1.0 - abs(vn(cp + time * 0.35) - vn(cp * 1.31 - time * 0.28)) * 2.0, 7.0);
    body += caust * (1.0 - smoothstep(0.1, 1.6, depth)) * 0.22 * (1.0 - night) * sunCol;
    float mixR = clamp(0.06 + fres, 0.0, 1.0);
    vec3 c = mix(body, refl, mixR);
    // Sun glints (bright enough for the bloom to catch), a broad sheen around them.
    float sd = max(dot(R, normalize(sunDir)), 0.0);
    float sunUp = smoothstep(-0.05, 0.1, sunDir.y) * (1.0 - night);
    c += sunCol * (pow(sd, 700.0) * 7.0 + pow(sd, 60.0) * 0.18) * sunUp;
    // The shallows show the bed; deeper or at a glance the surface turns to mirror.
    float a = mix(0.35, 0.93, smoothstep(0.0, 1.6, depth));
    a = max(a, mixR);
    // Foam lapping the shore, and streaks where the stream runs fast.
    float lap = 0.18 + 0.07 * sin(time * 1.4 + vn(vW.xz * 0.4) * 6.28);
    float foam = smoothstep(lap, 0.02, depth) * smoothstep(0.35, 0.75, vn(vW.xz * 2.2 + time * 0.25));
    foam = max(foam, flowFoam);
    c = mix(c, vec3(1.0) * mix(1.0, 0.45, night), foam * 0.6);
    a = max(a, foam * 0.8);
    a *= smoothstep(0.0, 0.07, depth);
    return vec4(c, a);
  }`;

const VERT = /* glsl */ `
  attribute float depth;
  attribute vec2 flow;
  varying vec3 vW; varying vec2 vUv; varying float vDepth; varying vec2 vFlow;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv; vDepth = depth; vFlow = flow;
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

/** Still water (the pond): wind ripples drifting one way, plus rings. */
export function pondMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: { ...THREE.UniformsLib.fog, ...uniforms },
    vertexShader: VERT,
    fragmentShader: COMMON + /* glsl */ `
      #include <fog_pars_fragment>
      void main(){
        vec2 grad = waveGrad(vW.xz, vec2(time * 0.09, time * 0.05)) * 0.35 + rippleGrad(vW.xz);
        gl_FragColor = shadeWater(grad, vDepth, 0.0);
        #include <fog_fragment>
      }`,
  });
}

/** Running water (the stream): the surface pattern travels downstream, faster in the middle. */
export function streamMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: { ...THREE.UniformsLib.fog, ...uniforms },
    vertexShader: VERT,
    fragmentShader: COMMON + /* glsl */ `
      #include <fog_pars_fragment>
      void main(){
        float across = abs(vUv.x - 0.5) * 2.0;
        float speed = 1.6 * (1.0 - across * across * 0.7);
        // Flow space: x across the stream, y downstream (metres).
        vec2 fp = vec2(vUv.x * 7.0, vUv.y - time * speed);
        vec2 g = waveGrad(fp * vec2(1.0, 0.7), vec2(0.0)) * 0.45;
        vec2 side = vec2(vFlow.y, -vFlow.x);
        vec2 grad = side * g.x + vFlow * g.y + rippleGrad(vW.xz);
        float streak = smoothstep(0.7, 0.95, vn(vec2(vUv.x * 11.0, vUv.y * 0.5 - time * speed * 0.5))) * 0.35 * (1.0 - across);
        gl_FragColor = shadeWater(grad, vDepth, streak);
        #include <fog_fragment>
      }`,
  });
}
