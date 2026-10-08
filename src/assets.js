// Loads the Blender puppets (glTF) and dresses them in the painted sheets.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const MODEL_NAMES = ["boy", "girl", "dragon", "tree_oak", "tree_pine", "tree_magic", "house", "hills", "sun"];

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const templates = {};
const materials = {};

/** Rim light colour shared by every puppet (the world tints it by time of day). */
export const rimLight = { value: new THREE.Color(0.32, 0.29, 0.26) };

function paintedMaterial(tex) {
  // Lambert keeps watercolour flat and soft; a little self-glow keeps pastels bright, like the films;
  // a soft rim light catches the puppets' edges so they lift off the painted background.
  const m = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.31, 0.3, 0.29) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimLight = rimLight;
    sh.fragmentShader = "uniform vec3 rimLight;\n" + sh.fragmentShader.replace("#include <opaque_fragment>", `
      float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
      outgoingLight += rimLight * rimF * (0.6 + 0.4 * diffuseColor.rgb);
      #include <opaque_fragment>`);
  };
  return m;
}

export async function loadAssets(onProgress) {
  let done = 0;
  const total = MODEL_NAMES.length * 2;
  const tick = () => onProgress && onProgress(++done / total);
  await Promise.all(MODEL_NAMES.map(async (name) => {
    const [gltf, tex] = await Promise.all([
      import(`../assets/${name}.glb.js`).then((mod) => loader.parseAsync(Uint8Array.from(atob(mod.default), (c) => c.charCodeAt(0)).buffer, "")).then((g) => { tick(); return g; }),
      texLoader.loadAsync(`tex/${name}.jpg?v=${Date.now()}`).then((t) => { tick(); return t; }),
    ]);
    tex.flipY = false; // glTF UV convention
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    materials[name] = paintedMaterial(tex);
    const root = gltf.scene.getObjectByName(name) || gltf.scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = materials[name];
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    optimiseTemplate(root);
    templates[name] = root;
  }));
}

// Parts the puppeteer moves. Everything else (eyes, hair, cuffs, shoes, spines…) is rigidly attached,
// so it's merged into the nearest moving part: ~5x fewer draw calls per puppet, same animation.
const JOINTS = new Set(["body", "head", "arm_L", "arm_R", "leg_L", "leg_R", "wing_L", "wing_R", "tail",
  "leg_FL", "leg_FR", "leg_BL", "leg_BR"]);

function optimiseTemplate(root) {
  root.updateMatrixWorld(true);
  const isJoint = (o) => o === root || JOINTS.has(o.userData?.part);
  const groups = new Map(); // joint -> meshes to merge into it
  root.traverse((o) => {
    if (!o.isMesh) return;
    let j = o;
    while (!isJoint(j)) j = j.parent;
    if (!groups.has(j)) groups.set(j, []);
    groups.get(j).push(o);
  });
  for (const [joint, meshes] of groups) {
    if (meshes.length === 1 && meshes[0] === joint) continue;
    const inv = new THREE.Matrix4().copy(joint.matrixWorld).invert();
    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      return g.index ? g.toNonIndexed() : g;
    });
    const merged = mergeGeometries(geos, false);
    let target = joint.isMesh ? joint : null;
    if (!target) {
      target = new THREE.Mesh(merged, meshes[0].material);
      target.castShadow = target.receiveShadow = true;
      joint.add(target);
    } else target.geometry = merged;
    for (const m of meshes) {
      if (m === target) continue;
      // Keep any moving parts that hung off a merged piece.
      for (const c of [...m.children]) if (c.isObject3D) joint.attach(c);
      m.parent.remove(m);
    }
  }
}

const merged = {};

/** All of a model's parts merged into one geometry in the model's own space (for instanced scenery). */
export function mergedGeometry(name) {
  if (merged[name]) return merged[name];
  const root = templates[name];
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  merged[name] = mergeGeometries(parts, false);
  merged[name].computeBoundingSphere();
  return merged[name];
}

/** A fresh copy of a model. `parts` maps part names (arm_L, head, wing_R…) to their nodes. */
export function spawn(name, scale = 1) {
  const obj = templates[name].clone(true);
  const holder = new THREE.Group();
  holder.add(obj);
  obj.position.set(0, 0, 0);
  holder.scale.setScalar(scale);
  const parts = {};
  obj.traverse((o) => {
    const part = o.userData?.part || (o.name.includes(".") ? o.name.split(".").slice(1).join(".") : null);
    if (part && !parts[part]) {
      parts[part] = o;
      o.userData.restQ = o.quaternion.clone();
      o.userData.restP = o.position.clone();
    }
  });
  holder.userData = { name, parts };
  return holder;
}

export function material(name) {
  return materials[name];
}

/** Bounding size of a template (for colliders and framing). */
export function sizeOf(name, scale = 1) {
  const box = new THREE.Box3().setFromObject(templates[name]);
  const s = new THREE.Vector3();
  box.getSize(s);
  return s.multiplyScalar(scale);
}
