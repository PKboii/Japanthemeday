/* HINOMORI — one persistent 3D village.
   Terrain with real elevation, a living river, rice terraces, nine districts,
   hand-placed buildings, vegetation, sky, weather & seasonal systems. */

import * as THREE from "three";
import { S, Season, clamp, lerp, smooth, hash2 } from "./state";

export interface Obstacle { x: number; z: number; r: number }
export interface Spot { id: string; x: number; z: number; label: string; kind: string }

const RIVER_Y = -0.95;

export function riverX(z: number): number {
  return 78 + 16 * Math.sin(z * 0.016 + 1.2) + 7 * Math.sin(z * 0.037 + 0.5);
}

export function makeCanvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c = cv.getContext("2d")!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function prismGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([
    -hw, 0, -hd, hw, 0, -hd, 0, h, -hd,
    -hw, 0, hd, hw, 0, hd, 0, h, hd,
  ], 3));
  g.setIndex([0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0]);
  g.computeVertexNormals();
  return g;
}

/* value noise */
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  const u = smooth(xf), v = smooth(zf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x: number, z: number): number {
  return vnoise(x * 0.045, z * 0.045) * 0.7 + vnoise(x * 0.11 + 7, z * 0.11) * 0.3;
}

/* ---------- road network (polylines with widths) ---------- */
const ROADS: { pts: [number, number][]; w: number; stone?: boolean }[] = [
  { pts: [[0, -80], [0, -42], [0, 0], [2, 40], [4, 70], [4, 122]], w: 3.4 },               // main N-S
  { pts: [[0, 14], [40, 24], [78, 32], [110, 40], [150, 48], [150, 50]], w: 3.0 },          // east to station
  { pts: [[0, 2], [-25, 8], [-52, 12], [-52, 46], [-60, 70], [-74, 90]], w: 2.4 },           // west residential→farms
  { pts: [[0, -42], [-12, -56], [-22, -70], [-27, -84]], w: 2.0, stone: true },              // shrine approach
  { pts: [[-25, 8], [-52, -4], [-78, -18], [-102, -28]], w: 1.8 },                           // viewpoint trail
  { pts: [[4, 70], [20, 66], [30, 80], [34, 100], [32, 116]], w: 1.8 },                     // terrace path
  { pts: [[4, 92], [30, 94], [72, 95], [100, 97], [118, 60], [118, 12]], w: 2.0 },           // old bridge loop to school
  { pts: [[110, 40], [122, 14], [130, -4]], w: 2.2 },                                        // school road
  { pts: [[-52, 12], [-52, -20], [-40, -34]], w: 1.6 },                                      // back alley
];

function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

function roadMask(x: number, z: number): { m: number; stone: boolean } {
  let m = 0, stone = false;
  for (const r of ROADS) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const d = distSeg(x, z, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]);
      const k = 1 - smooth(clamp((d - r.w * 0.55) / (r.w * 0.6), 0, 1));
      if (k > m) { m = k; stone = !!r.stone; }
    }
  }
  return { m, stone };
}

/* ---------- analytic terrain height ---------- */
function terraceH(x: number, z: number): number {
  if (x < -18 || x > 52 || z < 56 || z > 118) return 0;
  const step = clamp(Math.floor((x + 18) / 14), 0, 4);
  const inT = smooth(clamp(1 - Math.abs(x - (-18 + step * 14 + 7)) / 7.4, 0, 1));
  return step * 0.85 * inT;
}

function mound(x: number, z: number, cx: number, cz: number, r: number, h: number): number {
  const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
  return d > r ? 0 : h * smooth(1 - d / r);
}

export function terrainH(x: number, z: number): number {
  const n = (fbm(x, z) - 0.5) * 2;
  const road = roadMask(x, z).m;
  let h = n * 1.5 * (1 - road * 0.9);
  /* flatten village core */
  const dc = Math.sqrt(x * x + z * z);
  h *= smooth(clamp((dc - 16) / 26, 0, 1)) * 0.8 + 0.2;
  /* terrace flats */
  const dEdge = Math.min(x + 18, 52 - x, z - 56, 118 - z);
  if (dEdge > -8) h *= 1 - smooth(clamp(dEdge / 8, 0, 1)) * 0.9;
  /* schoolyard */
  const dPlay = Math.sqrt((x - 130) ** 2 + (z - 6) ** 2);
  if (dPlay < 16) h = lerp(h, 0.2, 1 - smooth(clamp((dPlay - 9) / 7, 0, 1)));
  /* shrine stair corridor */
  const dSt = Math.abs(x + 27.5);
  if (z < -80 && z > -112 && dSt < 7) h *= 0.25 + 0.75 * smooth(clamp((dSt - 3.5) / 3.5, 0, 1));
  /* lookout deck */
  const dLook = Math.sqrt((x + 103.5) ** 2 + (z + 30) ** 2);
  if (dLook < 9) h *= 0.3 + 0.7 * smooth(clamp((dLook - 5) / 4, 0, 1));
  /* river channel */
  const dr = Math.abs(x - riverX(z));
  const chan = 1 - smooth(clamp((dr - 3.5) / 11, 0, 1));
  h -= chan * 3.4;
  /* flatten the railway corridor */
  if (x > 46) {
    const dt58 = Math.abs(z - 58);
    const k = 1 - smooth(clamp((dt58 - 2.5) / 7, 0, 1));
    h *= 1 - k * 0.9;
  }
  h += Math.max(0, terraceH(x, z));
  h += mound(x, z, -28, -104, 46, 8.5);    // shrine hill
  h += mound(x, z, -122, -50, 60, 23);     // viewpoint hill
  h += mound(x, z, 60, -120, 70, 9);       // NE forest ridge
  /* encircling mountains */
  const rr = Math.sqrt(x * x + z * z);
  if (rr > 150) h += Math.pow((rr - 150) / 14, 1.7) * 6 + n * 4;
  return h;
}

/* structure walk-surfaces */
const deckY = { main: 0, old: 0, look: 0 };
export function heightAt(x: number, z: number): number {
  const h = terrainH(x, z);
  let out = h;
  if (x > 84 && x < 114 && z > 30 && z < 40) {         // main arched bridge
    const t = (x - 84) / 30;
    out = Math.max(out, 0.25 + Math.sin(t * Math.PI) * 1.7);
  }
  if (x > 70 && x < 88 && z > 92.5 && z < 97.5) out = Math.max(out, 0.45);  // old bridge
  if (x > 127 && x < 177 && z > 48.5 && z < 55.5) out = Math.max(out, 0.9); // platform
  if (x > -31 && x < -24 && z > -106 && z < -84) {                          // shrine stairs
    const t = clamp((-84 - z) / 22, 0, 1);
    out = Math.max(out, 0.15 + t * 7.6);
  }
  if (x > -108 && x < -99 && z > -34 && z < -26) out = Math.max(out, deckY.look);
  return out;
}

export function surfaceAt(x: number, z: number): "grass" | "dirt" | "stone" | "wood" {
  if (x > 84 && x < 114 && z > 30 && z < 40) return "wood";
  if (x > 70 && x < 88 && z > 92.5 && z < 97.5) return "wood";
  if (x > 127 && x < 177 && z > 48.5 && z < 55.5) return "stone";
  if (x > -108 && x < -99 && z > -34 && z < -26) return "wood";
  if (x > -31 && x < -24 && z > -106 && z < -84) return "stone";
  const r = roadMask(x, z);
  if (r.m > 0.5) return r.stone ? "stone" : "dirt";
  if (x * x + z * z < 15 * 15) return "stone";
  return "grass";
}

/* ============================================================= */

interface Bldg {
  w: number; d: number; h: number; roofH: number;
  wall: number; roof: number; trim?: number;
  sign?: string; signColor?: string; noren?: string; norenColor?: number;
  chimney?: boolean; engawa?: boolean; windows?: number; door?: boolean;
}

export class World {
  scene: THREE.Scene;
  obstacles: Obstacle[] = [];
  photoSpots: Spot[] = [];
  interactables: Spot[] = [];
  chimneySpots: [number, number, number][] = [];

  private canopies: { m: THREE.Object3D; ph: number; amp: number }[] = [];
  private flags: { m: THREE.Object3D; ph: number }[] = [];
  private windowMats: { m: THREE.MeshStandardMaterial; th: number }[] = [];
  private lampMats: THREE.MeshStandardMaterial[] = [];
  private lampGlows: THREE.Sprite[] = [];
  private roofCaps: THREE.Object3D[] = [];
  private riceTexs: THREE.CanvasTexture[] = [];
  private riceMats: THREE.MeshStandardMaterial[] = [];
  private sunflowers!: THREE.InstancedMesh;
  private flowerHeads!: THREE.InstancedMesh;
  private flowerN = 340;
  private terrainUniforms: Record<string, THREE.IUniform> = {};
  private waterUniforms: Record<string, THREE.IUniform> = {};
  private skyUniforms: Record<string, THREE.IUniform> = {};
  private stars!: THREE.Points;
  private sun!: THREE.Sprite; private moon!: THREE.Sprite;
  private clouds: THREE.Group[] = [];
  private lanternsGroup!: THREE.Group;
  private festivalGroup!: THREE.Group;
  private matCherry!: THREE.MeshStandardMaterial;
  private matLeafA!: THREE.MeshStandardMaterial;
  private matLeafB!: THREE.MeshStandardMaterial;
  private matMaple!: THREE.MeshStandardMaterial;
  private grassMesh!: THREE.InstancedMesh;
  private grassMat!: THREE.MeshLambertMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    deckY.look = terrainH(-103.5, -30) + 0.55;
    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildDistricts();
    this.buildVegetation();
    this.buildFestival();
    this.setSeason(S.season);
  }

  /* ---------------- SKY ---------------- */
  private buildSky() {
    this.skyUniforms = {
      top: { value: new THREE.Color("#7db4dd") },
      bottom: { value: new THREE.Color("#e8e0c8") },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 24, 14),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: this.skyUniforms,
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bottom;
          void main(){ float h = normalize(vP).y*0.5+0.5; vec3 c = mix(bottom, top, pow(h, 0.72)); gl_FragColor = vec4(c,1.0); }`,
      })
    );
    this.scene.add(sky);

    /* stars */
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.48 + 0.06;
      const r = 400;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    this.scene.add(this.stars);

    const glowTex = makeCanvasTex(64, 64, (c) => {
      const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,0.6)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    });
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2c8, fog: false, transparent: true, opacity: 1 }));
    this.sun.scale.setScalar(46);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xdfe8f8, fog: false, transparent: true, opacity: 0 }));
    this.moon.scale.setScalar(22);
    this.scene.add(this.sun, this.moon);

    /* clouds */
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const k = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < k; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(10 + Math.random() * 9, 8, 6), cm);
        s.position.set(j * 13 - k * 6, Math.random() * 4, Math.random() * 10 - 5);
        s.scale.y = 0.42;
        g.add(s);
      }
      g.position.set((Math.random() - 0.5) * 500, 95 + Math.random() * 55, (Math.random() - 0.5) * 500);
      this.clouds.push(g); this.scene.add(g);
    }
  }

  /* ---------------- TERRAIN ---------------- */
  private buildTerrain() {
    const SIZE = 440, SEG = 168;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const cGrass = new THREE.Color("#79a24e"), cGrass2 = new THREE.Color("#8fb75c");
    const cDirt = new THREE.Color("#a5895f"), cStone = new THREE.Color("#a7a193");
    const cSand = new THREE.Color("#b7a878"), cRock = new THREE.Color("#8d907f");
    const cPave = new THREE.Color("#b3ab97");
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = terrainH(x, z);
      p.setY(i, h);
      const rm = roadMask(x, z);
      const n = fbm(x * 2.2 + 40, z * 2.2);
      tmp.copy(cGrass).lerp(cGrass2, n);
      const dr = Math.abs(x - riverX(z));
      if (dr < 15) tmp.lerp(cSand, (1 - dr / 15) * 0.85);
      if (h > 14) tmp.lerp(cRock, clamp((h - 14) / 14, 0, 1) * 0.8);
      if (x * x + z * z < 15.5 * 15.5) tmp.lerp(cPave, 0.9);
      tmp.lerp(rm.stone ? cStone : cDirt, rm.m);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.terrainUniforms = { uSnow: { value: 0 }, uWet: { value: 0 } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.terrainUniforms);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObjN = normal;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjN;\nuniform float uSnow;\nuniform float uWet;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          float smask = smoothstep(0.45, 0.82, vObjN.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93,0.95,0.99), uSnow * smask);
          diffuseColor.rgb *= 1.0 - uWet * 0.22 * smask;`);
    };
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    /* distant peak silhouettes */
    const peakMat = new THREE.MeshLambertMaterial({ color: 0x5f7292, fog: true });
    const capMat = new THREE.MeshLambertMaterial({ color: 0xe8edf5 });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + 0.35;
      const r = 265 + hash2(i, 3) * 60;
      const h = 55 + hash2(i, 7) * 50;
      const pk = new THREE.Mesh(new THREE.ConeGeometry(60 + hash2(i, 5) * 40, h, 5), peakMat);
      pk.position.set(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r);
      pk.rotation.y = hash2(i, 9) * 3;
      this.scene.add(pk);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(22, h * 0.3, 5), capMat);
      cap.position.copy(pk.position); cap.position.y += h * 0.36;
      cap.visible = S.season === "winter";
      this.roofCaps.push(cap);
      this.scene.add(cap);
    }
  }

  /* ---------------- WATER ---------------- */
  private buildWater() {
    const seg = 150, hw = 8.6;
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const uv = new Float32Array((seg + 1) * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const z = -200 + (400 * i) / seg;
      const cx = riverX(z);
      pos[i * 6] = cx - hw; pos[i * 6 + 1] = RIVER_Y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = cx + hw; pos[i * 6 + 4] = RIVER_Y; pos[i * 6 + 5] = z;
      uv[i * 4] = 0; uv[i * 4 + 1] = z * 0.06; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = z * 0.06;
      if (i < seg) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.waterUniforms = {
      uT: { value: 0 },
      uDeep: { value: new THREE.Color("#2a6470") },
      uLight: { value: new THREE.Color("#bcd9d2") },
      uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true, uniforms: this.waterUniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uT; uniform vec3 uDeep; uniform vec3 uLight; uniform float uNight;
        void main(){
          float flow = sin(vUv.y*22.0 - uT*2.6 + sin(vUv.x*9.0 + uT*0.9)*1.4);
          float flow2 = sin(vUv.y*41.0 - uT*4.1 + vUv.x*14.0);
          float glint = smoothstep(0.62, 0.96, flow*0.6 + flow2*0.4);
          float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
          vec3 col = mix(uDeep, uLight, glint*0.55 + (1.0-edge)*0.4);
          col = mix(col, col*0.35 + vec3(0.02,0.03,0.07), uNight*0.72);
          gl_FragColor = vec4(col, 0.86);
        }`,
    });
    const water = new THREE.Mesh(g, mat);
    this.scene.add(water);

    /* river rocks + reeds */
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8f88, roughness: 1 });
    for (let i = 0; i < 46; i++) {
      const z = -170 + Math.random() * 340;
      const side = Math.random() < 0.5 ? -1 : 1;
      const r = new THREE.Mesh(rockGeo, rockMat);
      const sc = 0.35 + Math.random() * 1.1;
      r.scale.set(sc, sc * 0.7, sc);
      r.position.set(riverX(z) + side * (6 + Math.random() * 4), RIVER_Y + sc * 0.4, z);
      r.rotation.set(Math.random(), Math.random() * 3, Math.random());
      r.castShadow = true;
      this.scene.add(r);
      if (sc > 0.8) this.obstacles.push({ x: r.position.x, z, r: sc });
    }
    const reedGeo = new THREE.ConeGeometry(0.05, 1.5, 4);
    const reedMat = new THREE.MeshLambertMaterial({ color: 0x7a9455 });
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, 260);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 260; i++) {
      const z = -160 + Math.random() * 320;
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = riverX(z) + side * (9 + Math.random() * 3);
      m4.makeRotationY(Math.random() * 3);
      m4.setPosition(x, terrainH(x, z) + 0.7, z);
      reeds.setMatrixAt(i, m4);
    }
    this.scene.add(reeds);
  }

  /* ---------------- BUILDING KIT ---------------- */
  private box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, opts: { ry?: number; shadow?: boolean; rough?: number } = {}): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85 })
    );
    m.position.set(x, y, z);
    if (opts.ry) m.rotation.y = opts.ry;
    m.castShadow = opts.shadow !== false;
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  private shojiTex = makeCanvasTex(64, 64, (c) => {
    c.fillStyle = "#efe4c8"; c.fillRect(0, 0, 64, 64);
    c.strokeStyle = "#5a4a33"; c.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16, 64); c.stroke(); }
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(0, i * 16); c.lineTo(64, i * 16); c.stroke(); }
  });

  private signTex(text: string, bg: string, fg: string): THREE.CanvasTexture {
    return makeCanvasTex(256, 96, (c) => {
      c.fillStyle = bg; c.fillRect(0, 0, 256, 96);
      c.strokeStyle = fg; c.lineWidth = 6; c.strokeRect(8, 8, 240, 80);
      c.fillStyle = fg;
      c.font = "700 46px 'Shippori Mincho', serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(text, 128, 52);
    });
  }

  private building(x: number, z: number, ry: number, o: Bldg): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z) - 0.1, z);
    g.rotation.y = ry;
    /* foundation */
    const base = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.5, 0.5, o.d + 0.5),
      new THREE.MeshStandardMaterial({ color: 0x8d8577, roughness: 1 }));
    base.position.y = 0.25; base.receiveShadow = true; base.castShadow = true;
    g.add(base);
    /* walls */
    const wall = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d),
      new THREE.MeshStandardMaterial({ color: o.wall, roughness: 0.9 }));
    wall.position.y = 0.5 + o.h / 2; wall.castShadow = true; wall.receiveShadow = true;
    g.add(wall);
    /* beams / trim */
    const trimC = o.trim ?? 0x4a3b2c;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, o.h, 0.22),
        new THREE.MeshStandardMaterial({ color: trimC, roughness: 0.9 }));
      post.position.set(sx * (o.w / 2 - 0.05), 0.5 + o.h / 2, o.d / 2 - 0.05);
      g.add(post);
    }
    /* roof */
    const roof = new THREE.Mesh(prismGeo(o.w + 2.1, o.roofH, o.d + 2.3),
      new THREE.MeshStandardMaterial({ color: o.roof, roughness: 0.62, side: THREE.DoubleSide }));
    roof.position.y = 0.5 + o.h; roof.castShadow = true;
    g.add(roof);
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, o.d + 2.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x31343c, roughness: 0.7 }));
    ridge.rotation.x = Math.PI / 2; ridge.position.y = 0.5 + o.h + o.roofH;
    g.add(ridge);
    /* snow cap */
    const cap = new THREE.Mesh(prismGeo(o.w + 1.7, o.roofH * 0.82, o.d + 1.9),
      new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.95 }));
    cap.position.y = 0.5 + o.h + 0.12; cap.visible = false;
    g.add(cap);
    this.roofCaps.push(cap);
    /* shoji windows */
    const wm = new THREE.MeshStandardMaterial({
      map: this.shojiTex, emissiveMap: this.shojiTex, emissive: 0xffd9a0,
      emissiveIntensity: 0, color: 0xffffff, roughness: 0.8,
    });
    this.windowMats.push({ m: wm, th: 0.25 + Math.random() * 0.45 });
    const wn = o.windows ?? 2;
    for (let i = 0; i < wn; i++) {
      const wx = -o.w / 2 + (o.w / (wn + 1)) * (i + 1);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.25), wm);
      win.position.set(wx, 0.5 + o.h * 0.52, o.d / 2 + 0.02);
      g.add(win);
    }
    /* door */
    if (o.door !== false) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.9),
        new THREE.MeshStandardMaterial({ color: 0x3d3125, roughness: 0.9 }));
      door.position.set(0, 1.45, o.d / 2 + 0.03);
      g.add(door);
    }
    /* engawa veranda */
    if (o.engawa) {
      const eng = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.4, 0.16, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.85 }));
      eng.position.set(0, 0.55, o.d / 2 + 0.6); eng.castShadow = true;
      g.add(eng);
    }
    /* noren curtain */
    if (o.noren) {
      const nt = makeCanvasTex(128, 96, (c) => {
        c.fillStyle = "#" + (o.norenColor ?? 0x39506b).toString(16).padStart(6, "0");
        c.fillRect(0, 0, 128, 96);
        c.fillStyle = "#f2ead6";
        c.font = "700 44px 'Shippori Mincho', serif";
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(o.noren!, 64, 52);
        c.fillStyle = "rgba(0,0,0,0.25)";
        for (let i = 1; i < 4; i++) c.fillRect(i * 32 - 1, 0, 2, 96);
      });
      const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.05),
        new THREE.MeshStandardMaterial({ map: nt, side: THREE.DoubleSide, roughness: 1 }));
      noren.position.set(0, 2.1, o.d / 2 + 0.14);
      g.add(noren);
      this.flags.push({ m: noren, ph: Math.random() * 6 });
    }
    /* sign */
    if (o.sign) {
      const st = this.signTex(o.sign, "#" + (o.signColor ?? 0xf0e8d4).toString(16).padStart(6, "0"), "#2c2620");
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.86),
        new THREE.MeshStandardMaterial({ map: st, roughness: 0.8 }));
      sign.position.set(0, 0.5 + o.h + o.roofH * 0.45, o.d / 2 + 0.35);
      g.add(sign);
    }
    /* chimney */
    if (o.chimney) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x6b6259, roughness: 1 }));
      ch.position.set(o.w * 0.28, 0.5 + o.h + o.roofH * 0.5, -o.d * 0.2);
      g.add(ch);
      const wp = new THREE.Vector3(o.w * 0.28, 0.5 + o.h + o.roofH * 0.5 + 0.8, -o.d * 0.2).applyMatrix4(
        new THREE.Matrix4().makeRotationY(ry)
      );
      this.chimneySpots.push([x + wp.x, g.position.y + wp.y, z + wp.z]);
    }
    this.scene.add(g);
    this.obstacles.push({ x, z, r: Math.max(o.w, o.d) * 0.62 });
    return g;
  }

  /* ---------------- DISTRICTS ---------------- */
  private buildDistricts() {
    /* === A — village center === */
    this.building(-16, -12, Math.PI / 2, { w: 7, d: 6, h: 3.1, roofH: 2.2, wall: 0xdcc9a3, roof: 0x4c4238, sign: "パン屋", noren: "焼", norenColor: 0xb23a24, chimney: true, windows: 2 });
    this.building(-18, 4, Math.PI / 2, { w: 6.4, d: 5.6, h: 2.9, roofH: 2.0, wall: 0xcfc2a6, roof: 0x3f4a56, sign: "茶", noren: "茶", norenColor: 0x41604a, windows: 2 });
    this.building(-15, 19, Math.PI / 2, { w: 6.8, d: 6, h: 3.2, roofH: 2.1, wall: 0xd8cdb4, roof: 0x54483a, sign: "八百屋", noren: "八百", norenColor: 0x39506b, windows: 3 });
    /* market shed (east side) */
    this.building(13, -8, -Math.PI / 2, { w: 7.5, d: 5.5, h: 2.7, roofH: 1.6, wall: 0xb8a98c, roof: 0x5d5244, door: false, windows: 1 });
    /* well */
    const well = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 1, 10),
      new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1 }));
    well.position.set(3, heightAt(3, -1) + 0.5, -1);
    well.castShadow = true;
    this.scene.add(well);
    const wellRoof = new THREE.Mesh(prismGeo(2.8, 1, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x4c4238, roughness: 0.7, side: THREE.DoubleSide }));
    wellRoof.position.set(3, heightAt(3, -1) + 2.3, -1);
    this.scene.add(wellRoof);
    for (const sx of [-1, 1]) this.box(0.16, 1.4, 0.16, 0x5a4a33, 3 + sx * 1.1, heightAt(3, -1) + 1.7, -1);
    this.obstacles.push({ x: 3, z: -1, r: 1.5 });
    this.interactables.push({ id: "well", x: 3, z: -1, label: "The old well", kind: "well" });

    /* notice board */
    this.box(0.14, 1.9, 0.14, 0x5a4a33, 11.5, heightAt(11.5, -14) + 0.95, -14);
    const board = this.box(2.3, 1.35, 0.16, 0x7b6647, 11.5, heightAt(11.5, -14) + 1.75, -14);
    board.rotation.y = -0.4;
    this.interactables.push({ id: "board", x: 11.5, z: -14, label: "Village notice board", kind: "board" });
    this.obstacles.push({ x: 11.5, z: -14, r: 0.9 });

    /* vending machine */
    const vm = this.box(1.05, 1.8, 0.8, 0xc2472f, 9.6, heightAt(9.6, 3) + 0.9, 3);
    const vmGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xfff3d8, emissive: 0xffe9b8, emissiveIntensity: 0.5 }));
    vmGlow.position.set(9.05, heightAt(9.6, 3) + 1.05, 3);
    vmGlow.rotation.y = -Math.PI / 2;
    this.scene.add(vmGlow);
    vm.rotation.y = Math.PI / 2;
    this.obstacles.push({ x: 9.6, z: 3, r: 0.85 });
    this.interactables.push({ id: "vending", x: 9.6, z: 3, label: "Drink machine", kind: "vending" });

    /* benches + bikes */
    this.bench(6.5, 8, 0.3);
    this.bench(-5, -20, 1.2);
    this.bike(-8.5, 21, 0.4); this.bike(14.5, 14, -1.1); this.bike(140, 44.5, 0.2);
    this.bike(124, -10, 2.2); this.bike(-55.5, 14.5, 0.1);

    /* street lamps around square */
    for (const [lx, lz] of [[-7, -7], [8, -6], [-6, 12], [9, 11], [0, 34], [2, -30]] as [number, number][]) {
      this.streetLamp(lx, lz);
    }

    /* utility poles + wires along main road */
    const polePos: [number, number][] = [];
    for (let z = -70; z <= 115; z += 22) polePos.push([7.2, z]);
    for (let i = 0; i < polePos.length; i++) {
      const [px, pz] = polePos[i];
      const y = heightAt(px, pz);
      this.box(0.22, 7.5, 0.22, 0x4e463a, px, y + 3.75, pz);
      this.box(2.6, 0.14, 0.14, 0x4e463a, px, y + 7.2, pz);
      this.obstacles.push({ x: px, z: pz, r: 0.3 });
      if (i > 0) {
        const [qx, qz] = polePos[i - 1];
        const qy = heightAt(qx, qz);
        const mid = new THREE.Vector3((px + qx) / 2, (y + qy) / 2 + 7.05, (pz + qz) / 2);
        const len = new THREE.Vector3(px - qx, y - qy, pz - qz).length();
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 3),
          new THREE.MeshBasicMaterial({ color: 0x2c2c30 }));
        wire.position.copy(mid);
        wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(px - qx, y - qy, pz - qz).normalize());
        this.scene.add(wire);
      }
    }

    /* === B — residential street (west) === */
    const houses: [number, number, number, Bldg][] = [
      [-44, -6, -Math.PI / 2 + 0.15, { w: 6, d: 5.4, h: 2.8, roofH: 1.9, wall: 0xcdbfa2, roof: 0x424c58, engawa: true, windows: 2 }],
      [-60, -4, Math.PI / 2 - 0.1, { w: 5.6, d: 5, h: 2.7, roofH: 1.8, wall: 0xb9a488, roof: 0x57483a, windows: 2 }],
      [-45, 16, -Math.PI / 2, { w: 6.2, d: 5.6, h: 2.8, roofH: 2.0, wall: 0xd6c6a5, roof: 0x4c4238, engawa: true, windows: 2 }],   // Aiko's
      [-61, 20, Math.PI / 2 + 0.12, { w: 5.8, d: 5.2, h: 2.7, roofH: 1.8, wall: 0xc3b092, roof: 0x3f4a56, windows: 2 }],
      [-46, 34, -Math.PI / 2 - 0.1, { w: 6, d: 5.4, h: 2.8, roofH: 1.9, wall: 0xbfae90, roof: 0x54483a, windows: 2 }],
      [-60, 38, Math.PI / 2, { w: 5.6, d: 5, h: 2.7, roofH: 1.8, wall: 0xd0c0a0, roof: 0x424c58, engawa: true, windows: 1 }],
      [-40, -34, -0.3, { w: 5.4, d: 5, h: 2.6, roofH: 1.8, wall: 0xc8b694, roof: 0x57483a, windows: 1 }],
    ];
    for (const [hx, hz, ry, b] of houses) this.building(hx, hz, ry, b);
    /* east-bank houses (across the river, toward the school) */
    const eastHouses: [number, number, number, Bldg][] = [
      [114, 8, Math.PI / 2, { w: 5.6, d: 5, h: 2.7, roofH: 1.8, wall: 0xcfc0a2, roof: 0x3f4a56, engawa: true, windows: 2 }],
      [117, 18, 0, { w: 6, d: 5.4, h: 2.8, roofH: 1.9, wall: 0xd6c6a5, roof: 0x4c4238, windows: 2 }],
      [121, 29, 0, { w: 5.8, d: 5.2, h: 2.7, roofH: 1.8, wall: 0xbfae90, roof: 0x54483a, engawa: true, windows: 2 }],
    ];
    for (const [hx, hz, ry, b] of eastHouses) this.building(hx, hz, ry, b);
    this.laundry(113, 24);
    /* Aiko's bench + stone wall + pots */
    this.bench(-41.5, 16, Math.PI / 2);
    for (let i = 0; i < 6; i++) this.box(1, 0.6, 0.5, 0x948c7c, -48.5, heightAt(-48.5, 10 + i * 2.4) + 0.3, 10 + i * 2.4);
    for (const [fx, fz] of [[-42.5, 13], [-42.5, 19], [-57, 17]] as [number, number][]) {
      const pot = this.box(0.5, 0.45, 0.5, 0x8a5a40, fx, heightAt(fx, fz) + 0.22, fz);
      pot.rotation.y = Math.random();
    }
    /* laundry line behind a house */
    this.laundry(-50, 26);

    /* === C — rice terraces (built with terrain) === */
    for (let s = 0; s < 5; s++) {
      const x0 = -18 + s * 14;
      const tex = this.riceTexture();
      this.riceTexs.push(tex);
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
      this.riceMats.push(m);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 60), m);
      pl.rotation.x = -Math.PI / 2;
      pl.position.set(x0 + 7, s * 0.85 + 0.16, 86);
      pl.receiveShadow = true;
      this.scene.add(pl);
    }
    /* scarecrows + tools */
    this.scarecrow(10, 78); this.scarecrow(32, 100);
    this.obstacles.push({ x: 10, z: 78, r: 0.5 }, { x: 32, z: 100, r: 0.5 });
    /* little tractor */
    const trac = new THREE.Group();
    const tb = this.box(1.7, 0.8, 1.1, 0x9a4a34, 0, 0.8, 0); tb.removeFromParent(); trac.add(tb);
    const tc = this.box(0.9, 0.8, 0.95, 0x9a4a34, -1.1, 1.15, 0); tc.removeFromParent(); trac.add(tc);
    const wheelG = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
    const wheelM = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 1 });
    for (const [wx, wz, ws] of [[0.7, 0.6, 1], [0.7, -0.6, 1], [-1.15, 0.55, 0.7], [-1.15, -0.55, 0.7]] as [number, number, number][]) {
      const w = new THREE.Mesh(wheelG, wheelM);
      w.rotation.x = Math.PI / 2; w.scale.setScalar(ws);
      w.position.set(wx, 0.42 * ws, wz);
      trac.add(w);
    }
    trac.position.set(-12, heightAt(-12, 62) + 0.0, 62);
    trac.rotation.y = 0.7;
    this.scene.add(trac);
    this.obstacles.push({ x: -12, z: 62, r: 1.4 });

    /* === D — river bridges === */
    this.archBridge(84, 114, 35);
    this.flatBridge(70, 88, 95);
    /* stepping stones */
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.25, 7),
        new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1 }));
      st.position.set(riverX(66) - 6 + i * 3, RIVER_Y + 0.28, 66 + Math.sin(i) * 0.6);
      st.castShadow = true;
      this.scene.add(st);
    }
    /* fishing spot */
    this.interactables.push({ id: "fish", x: riverX(50) - 10, z: 50, label: "A quiet fishing bend", kind: "view" });

    /* === E — shrine + forest === */
    this.torii(-27, -82, 1.15);
    this.torii(-27, -96, 1.0);
    const honden = new THREE.Group();
    const hb = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3, 4.4),
      new THREE.MeshStandardMaterial({ color: 0xa8896a, roughness: 0.85 }));
    hb.position.y = 1.9; hb.castShadow = true;
    honden.add(hb);
    const hr = new THREE.Mesh(prismGeo(7.6, 2.3, 6.2),
      new THREE.MeshStandardMaterial({ color: 0x37413c, roughness: 0.6, side: THREE.DoubleSide }));
    hr.position.y = 3.4; hr.castShadow = true;
    honden.add(hr);
    const hcap = new THREE.Mesh(prismGeo(7.0, 2.0, 5.6),
      new THREE.MeshStandardMaterial({ color: 0xf2f5fa, roughness: 0.95 }));
    hcap.position.y = 3.52; hcap.visible = false;
    honden.add(hcap); this.roofCaps.push(hcap);
    const chigi1 = this.box(0.18, 2.2, 0.18, 0x37413c, 0, 0, 0); chigi1.removeFromParent();
    chigi1.position.set(1.2, 5.4, 0); chigi1.rotation.z = 0.5; honden.add(chigi1);
    const chigi2 = chigi1.clone(); chigi2.position.x = -1.2; chigi2.rotation.z = -0.5; honden.add(chigi2);
    honden.position.set(-27, 7.9, -111);
    this.scene.add(honden);
    this.obstacles.push({ x: -27, z: -111, r: 3.4 });
    /* offering box + bell */
    const saisen = this.box(1.5, 0.7, 0.9, 0x5a4a33, -27, 8.25, -106.8);
    saisen.rotation.x = 0;
    this.interactables.push({ id: "bell", x: -27, z: -106.4, label: "Ring the shrine bell", kind: "bell" });
    this.obstacles.push({ x: -27, z: -106.8, r: 1.1 });
    /* stone lanterns along stairs */
    for (const [slx, slz] of [[-32.5, -88], [-21.5, -93], [-32.5, -100], [-21.5, -105], [-33, -111], [-21, -111]] as [number, number][]) {
      this.stoneLantern(slx, slz);
    }
    /* ema plaques */
    for (let i = 0; i < 5; i++) {
      const ema = this.box(0.5, 0.4, 0.05, 0xc9a86a, -31 + i * 0.62, 8.9, -108.4);
      ema.rotation.y = 0.1 * i;
    }
    this.photoSpots.push({ id: "shrine", x: -27, z: -104, label: "Shrine in the Cedars", kind: "photo" });

    /* === F — station === */
    const platform = this.box(48, 0.9, 6.4, 0x9d958a, 152, 0.45, 52, { rough: 1 });
    platform.receiveShadow = true;
    this.obstacles.push({ x: 152, z: 52, r: 4 });
    this.building(152, 45, Math.PI, { w: 8.5, d: 5, h: 3, roofH: 1.9, wall: 0xd9c9a6, roof: 0x3f4a56, sign: "日ノ森駅", noren: "駅", norenColor: 0x39506b, windows: 3 });
    /* roof over platform */
    const prow = new THREE.Mesh(prismGeo(14, 1.6, 5.4),
      new THREE.MeshStandardMaterial({ color: 0x424c58, roughness: 0.6, side: THREE.DoubleSide }));
    prow.position.set(152, 3.6, 52);
    this.scene.add(prow);
    for (const px of [146, 158]) this.box(0.2, 2.7, 0.2, 0x5a4a33, px, 2.25, 52);
    this.streetLamp(135, 52); this.streetLamp(168, 52);
    this.bench(147, 53, Math.PI); this.bench(159, 53, Math.PI);
    /* timetable */
    const tt = this.box(0.9, 1.2, 0.1, 0xe9e2cf, 144.4, 2.2, 49.4);
    tt.rotation.x = -0.08;
    this.interactables.push({ id: "timetable", x: 144.4, z: 49.9, label: "Train timetable", kind: "board" });
    /* tracks */
    this.tracks();
    this.photoSpots.push({ id: "train", x: 152, z: 53, label: "The Little Train", kind: "photo" });

    /* === G — school === */
    this.building(132, -10, 0, { w: 16, d: 7, h: 4.2, roofH: 2.4, wall: 0xe2d7ba, roof: 0x424c58, sign: "日ノ森小学校", windows: 5 });
    /* clock */
    const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0xf4eee0, roughness: 0.5 }));
    clock.rotation.x = Math.PI / 2;
    clock.position.set(132, heightAt(132, -10) + 6.4, -6.4);
    this.scene.add(clock);
    /* playground */
    const pg = new THREE.Mesh(new THREE.CircleGeometry(11, 24),
      new THREE.MeshStandardMaterial({ color: 0xb9a276, roughness: 1 }));
    pg.rotation.x = -Math.PI / 2;
    pg.position.set(130, heightAt(130, 6) + 0.06, 6);
    pg.receiveShadow = true;
    this.scene.add(pg);
    /* basketball hoop */
    this.box(0.18, 3.4, 0.18, 0x6b6259, 137, heightAt(137, 10) + 1.7, 10);
    const bb = this.box(1.3, 1, 0.08, 0xf4eee0, 137, heightAt(137, 10) + 3.2, 9.4);
    bb.rotation.x = -0.06;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0xc2472f, roughness: 0.6 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(137, heightAt(137, 10) + 2.9, 8.9);
    this.scene.add(rim);
    this.obstacles.push({ x: 137, z: 10, r: 0.4 });
    /* low fence */
    for (let i = 0; i < 9; i++) this.box(0.12, 0.9, 0.12, 0x8a8f88, 120 + i * 2.6, heightAt(120 + i * 2.6, 15.5) + 0.45, 15.5);

    /* === H — farms (southwest) === */
    this.building(-78, 84, 0.5, { w: 8, d: 6.4, h: 3.2, roofH: 2.4, wall: 0x8a5f45, roof: 0x57483a, door: true, windows: 1 });   // barn
    this.building(-62, 98, -0.7, { w: 6, d: 5, h: 2.7, roofH: 1.8, wall: 0xcbb894, roof: 0x4c4238, windows: 2 });                // farmhouse
    /* greenhouse */
    const gh = new THREE.Mesh(prismGeo(6, 2.2, 9),
      new THREE.MeshStandardMaterial({ color: 0xe8f0ea, roughness: 0.25, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    gh.position.set(-90, heightAt(-90, 98) + 0.1, 98);
    gh.rotation.y = 0.5;
    this.scene.add(gh);
    this.obstacles.push({ x: -90, z: 98, r: 4 });
    /* veggie patches */
    for (let r = 0; r < 4; r++) {
      const patch = this.box(5.5, 0.3, 1.4, 0x4e3b28, -70 + r * 0, heightAt(-70, 88 + r * 2) + 0.15, 88 + r * 2);
      patch.rotation.y = 0.5;
      for (let i = 0; i < 6; i++) {
        const crop = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0),
          new THREE.MeshLambertMaterial({ color: r % 2 ? 0x6f9c46 : 0x8fb75c }));
        crop.position.set(-71.5 + i * 0.75, heightAt(-70, 88 + r * 2) + 0.45, 88 + r * 2 + Math.sin(i + r) * 0.2);
        this.scene.add(crop);
      }
    }
    /* pumpkins (autumn) */
    for (let i = 0; i < 6; i++) {
      const pk = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xd97e2f, roughness: 0.8 }));
      pk.scale.y = 0.75;
      pk.position.set(-66 + (i % 3) * 0.9, heightAt(-66, 92) + 0.28, 92.5 + Math.floor(i / 3) * 0.8);
      this.scene.add(pk);
    }
    /* chicken coop */
    this.box(2.2, 1.5, 1.8, 0x9a7a54, -56, heightAt(-56, 84) + 0.75, 84);
    for (let i = 0; i < 6; i++) this.box(0.1, 0.7, 0.1, 0x8a6f4d, -59 + i * 1.2, heightAt(-59 + i * 1.2, 87) + 0.35, 87);
    this.obstacles.push({ x: -56, z: 84, r: 1.6 });
    /* kei truck */
    const truck = new THREE.Group();
    const tbed = this.box(2, 0.7, 1.5, 0x708090, 0, 0.55, 0.4); tbed.removeFromParent(); truck.add(tbed);
    const tcab = this.box(1.4, 1.1, 1.45, 0x708090, 0, 1.05, -1.05); tcab.removeFromParent(); truck.add(tcab);
    for (const [wx, wz] of [[0.8, -1], [-0.8, -1], [0.8, 0.9], [-0.8, 0.9]] as [number, number][]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 8), wheelM);
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.32, wz);
      truck.add(w);
    }
    truck.position.set(-58, heightAt(-58, 72), 72);
    truck.rotation.y = 2.4;
    this.scene.add(truck);
    this.obstacles.push({ x: -58, z: 72, r: 1.7 });

    /* === I — viewpoint === */
    const dy = deckY.look;
    const deck = this.box(8, 0.3, 6, 0x8a6f4d, -103.5, dy - 0.15, -30, { rough: 0.9 });
    deck.receiveShadow = true;
    for (const [cx, cz] of [[-107, -32.5], [-100, -32.5], [-107, -27.5], [-100, -27.5]] as [number, number][]) {
      this.box(0.28, 2.4, 0.28, 0x6b553c, cx, dy - 1.2, cz);
    }
    for (const cz of [-32.7, -27.3]) this.box(7.6, 0.14, 0.14, 0x6b553c, -103.5, dy + 0.95, cz);
    for (const cx of [-107.2, -99.8]) this.box(0.14, 0.14, 5.6, 0x6b553c, cx, dy + 0.95, -30);
    this.bench(-103.5, -31.5, Math.PI);
    this.photoSpots.push({ id: "valley", x: -103.5, z: -30, label: "The Valley Wakes", kind: "photo" });
    this.interactables.push({ id: "lookout", x: -103.5, z: -28, label: "Look over the valley", kind: "view" });

    /* === J — festival grounds === */
    this.festivalGroup = new THREE.Group();
    this.scene.add(this.festivalGroup);
    for (const [px, pz] of [[28, -42], [40, -42], [28, -32], [40, -32]] as [number, number][]) {
      this.box(0.18, 4.4, 0.18, 0x6b553c, px, heightAt(px, pz) + 2.2, pz);
    }
    this.building(45, -37, -Math.PI / 2, { w: 4, d: 3.4, h: 2.3, roofH: 1.3, wall: 0xb8a98c, roof: 0x57483a, door: true, windows: 0 });
    this.obstacles.push({ x: 45, z: -37, r: 2.4 });
    this.photoSpots.push({ id: "festival", x: 34, z: -37, label: "Lantern Night", kind: "photo" });

    /* photo + interactable extras */
    this.photoSpots.push(
      { id: "bridge", x: 99, z: 35, label: "The Old Bridge", kind: "photo" },
    );
    this.interactables.push(
      { id: "umbrella", x: riverX(80) + 10.5, z: 80, label: "Something red by the reeds…", kind: "umbrella" },
    );
    /* umbrella object (quest) */
    const umb = new THREE.Group();
    const uc = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.5, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xc2472f, roughness: 0.6, side: THREE.DoubleSide }));
    uc.position.y = 0.55; uc.rotation.z = 1.2;
    const uh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 5),
      new THREE.MeshStandardMaterial({ color: 0x5a4a33 }));
    uh.rotation.z = 1.2;
    umb.add(uc, uh);
    umb.position.set(riverX(80) + 10.5, heightAt(riverX(80) + 10.5, 80), 80);
    umb.name = "questUmbrella";
    this.scene.add(umb);
    (this as any).umbrellaObj = umb;
  }

  get umbrellaObj(): THREE.Group { return (this as any)._umb; }
  set umbrellaObj(v: THREE.Group) { (this as any)._umb = v; }

  /* ---------- small kit pieces ---------- */
  bench(x: number, z: number, ry: number) {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.9 }));
    seat.position.y = 0.48; seat.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.9 }));
    back.position.set(0, 0.78, -0.24);
    g.add(seat, back);
    for (const sx of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.48, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x4e463a }));
      leg.position.set(sx, 0.24, 0);
      g.add(leg);
    }
    g.position.set(x, heightAt(x, z), z);
    g.rotation.y = ry;
    this.scene.add(g);
    this.obstacles.push({ x, z, r: 0.7 });
    this.interactables.push({ id: "bench" + x + z, x, z, label: "Rest on the bench", kind: "bench" });
  }

  bike(x: number, z: number, ry: number) {
    const g = new THREE.Group();
    const frameM = new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.5, metalness: 0.3 });
    const wheelM = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.9 });
    for (const wx of [-0.62, 0.62]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 14), wheelM);
      w.position.set(wx, 0.34, 0);
      g.add(w);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5), frameM);
    bar.rotation.z = Math.PI / 2 - 0.2; bar.position.set(0, 0.55, 0);
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.65, 5), frameM);
    fork.position.set(0.55, 0.62, 0); fork.rotation.z = -0.25;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.14), wheelM);
    seat.position.set(-0.35, 0.86, 0);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), frameM);
    handle.rotation.x = Math.PI / 2; handle.position.set(0.62, 0.95, 0);
    g.add(bar, fork, seat, handle);
    g.position.set(x, heightAt(x, z), z);
    g.rotation.y = ry; g.rotation.z = 0.12;
    this.scene.add(g);
    this.obstacles.push({ x, z, r: 0.55 });
    this.interactables.push({ id: "bike" + x + z, x, z, label: "A village bicycle", kind: "bike" });
  }

  streetLamp(x: number, z: number) {
    const y = heightAt(x, z);
    this.box(0.14, 3.3, 0.14, 0x3a3a3e, x, y + 1.65, z);
    const m = new THREE.MeshStandardMaterial({
      color: 0xf6e7c4, emissive: 0xffd9a0, emissiveIntensity: 0.05, roughness: 0.4,
    });
    this.lampMats.push(m);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.5), m);
    head.position.set(x, y + 3.45, z);
    this.scene.add(head);
    const capM = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.25, 4),
      new THREE.MeshStandardMaterial({ color: 0x31343c }));
    capM.position.set(x, y + 3.9, z);
    this.scene.add(capM);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: (this as any).glowTexCached ?? ((this as any).glowTexCached = makeCanvasTex(64, 64, (c) => {
        const gg = c.createRadialGradient(32, 32, 2, 32, 32, 30);
        gg.addColorStop(0, "rgba(255,220,160,0.9)");
        gg.addColorStop(1, "rgba(255,220,160,0)");
        c.fillStyle = gg; c.fillRect(0, 0, 64, 64);
      })),
      transparent: true, opacity: 0, depthWrite: false,
    }));
    glow.position.set(x, y + 3.45, z);
    glow.scale.setScalar(3.2);
    this.lampGlows.push(glow);
    this.scene.add(glow);
    this.obstacles.push({ x, z, r: 0.25 });
  }

  stoneLantern(x: number, z: number) {
    const y = heightAt(x, z);
    const m = new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1 });
    const parts: [number, number, number][] = [[0.5, 0.5, 0], [0.34, 0.5, 0.6], [0.62, 0.55, 1.2], [0.45, 0.3, 1.7]];
    let yy = y;
    for (const [w, h] of parts) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.6, w, h, 6), m);
      b.position.set(x, yy + h / 2, z);
      b.castShadow = true;
      this.scene.add(b);
      yy += h;
    }
    const glowM = new THREE.MeshStandardMaterial({ color: 0xf6e7c4, emissive: 0xffc98a, emissiveIntensity: 0.05 });
    this.lampMats.push(glowM);
    const boxPart = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), glowM);
    boxPart.position.set(x, yy + 0.22, z);
    this.scene.add(boxPart);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.4, 4), m);
    top.position.set(x, yy + 0.62, z);
    this.scene.add(top);
  }

  torii(x: number, z: number, s: number) {
    const m = new THREE.MeshStandardMaterial({ color: 0xc2472f, roughness: 0.55 });
    const y = heightAt(x, z);
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 4.6 * s, 10), m);
      p.position.set(x + sx * 2.1 * s, y + 2.3 * s, z);
      p.castShadow = true;
      this.scene.add(p);
      this.obstacles.push({ x: x + sx * 2.1 * s, z, r: 0.35 });
    }
    const nuki = new THREE.Mesh(new THREE.BoxGeometry(4.8 * s, 0.32 * s, 0.26 * s), m);
    nuki.position.set(x, y + 3.6 * s, z);
    this.scene.add(nuki);
    const kasagi = new THREE.Mesh(new THREE.BoxGeometry(5.6 * s, 0.4 * s, 0.5 * s),
      new THREE.MeshStandardMaterial({ color: 0x31343c, roughness: 0.6 }));
    kasagi.position.set(x, y + 4.5 * s, z);
    kasagi.rotation.z = 0;
    this.scene.add(kasagi);
  }

  scarecrow(x: number, z: number) {
    const y = heightAt(x, z);
    this.box(0.12, 2.1, 0.12, 0x8a6f4d, x, y + 1.05, z);
    this.box(1.6, 0.1, 0.1, 0x8a6f4d, x, y + 1.6, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 1 }));
    head.position.set(x, y + 2.25, z);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 1 }));
    hat.position.set(x, y + 2.45, z);
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x39506b, roughness: 1 }));
    shirt.position.set(x, y + 1.55, z);
    this.scene.add(head, hat, shirt);
    this.flags.push({ m: shirt, ph: Math.random() * 6 });
  }

  laundry(x: number, z: number) {
    const y = heightAt(x, z);
    this.box(0.1, 2, 0.1, 0x8a6f4d, x - 1.6, y + 1, z);
    this.box(0.1, 2, 0.1, 0x8a6f4d, x + 1.6, y + 1, z);
    const colors = [0xf4eee0, 0x9db8d2, 0xe8c8c0];
    for (let i = 0; i < 3; i++) {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1),
        new THREE.MeshStandardMaterial({ color: colors[i], side: THREE.DoubleSide, roughness: 1 }));
      cloth.position.set(x - 1 + i, y + 1.35, z);
      this.scene.add(cloth);
      this.flags.push({ m: cloth, ph: i * 1.7 });
    }
  }

  archBridge(x0: number, x1: number, z: number) {
    const n = 14, mat = new THREE.MeshStandardMaterial({ color: 0x8a5a40, roughness: 0.85 });
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const xa = x0 + (x1 - x0) * t0, xb = x0 + (x1 - x0) * t1;
      const ya = 0.25 + Math.sin(t0 * Math.PI) * 1.7, yb = 0.25 + Math.sin(t1 * Math.PI) * 1.7;
      const seg = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) / n + 0.15, 0.22, 4.4), mat);
      seg.position.set((xa + xb) / 2, (ya + yb) / 2, z);
      seg.rotation.z = Math.atan2(yb - ya, xb - xa);
      seg.castShadow = true; seg.receiveShadow = true;
      this.scene.add(seg);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = x0 + (x1 - x0) * t;
        const y = 0.25 + Math.sin(t * Math.PI) * 1.7;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.16),
          new THREE.MeshStandardMaterial({ color: 0x5a3f2c, roughness: 0.9 }));
        post.position.set(x, y + 0.55, z + side * 2.1);
        post.castShadow = true;
        this.scene.add(post);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.12, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x5a3f2c, roughness: 0.9 }));
      rail.position.set((x0 + x1) / 2, 2.2, z + side * 2.1);
      this.scene.add(rail);
    }
  }

  flatBridge(x0: number, x1: number, z: number) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x77603f, roughness: 0.9 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.2, 3.4), mat);
    deck.position.set((x0 + x1) / 2, 0.4, z);
    deck.castShadow = true; deck.receiveShadow = true;
    this.scene.add(deck);
    for (let i = 0; i < 6; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 3.4),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x6b5535 : 0x83694a, roughness: 1 }));
      plank.position.set(x0 + 1.5 + i * 3, 0.52, z);
      this.scene.add(plank);
    }
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.1, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x5a4630 }));
      rail.position.set((x0 + x1) / 2, 1.15, z + side * 1.6);
      this.scene.add(rail);
      for (let i = 0; i <= 4; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, 0.14),
          new THREE.MeshStandardMaterial({ color: 0x5a4630 }));
        post.position.set(x0 + (x1 - x0) * (i / 4), 0.8, z + side * 1.6);
        this.scene.add(post);
      }
    }
  }

  tracks() {
    const railM = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.35, metalness: 0.7 });
    for (const off of [-0.75, 0.75]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(440, 0.14, 0.14), railM);
      rail.position.set(0, heightAt(0, 58 + off) + 0.32, 58 + off);
      this.scene.add(rail);
    }
    const tieGeo = new THREE.BoxGeometry(0.35, 0.12, 2.4);
    const tieM = new THREE.MeshStandardMaterial({ color: 0x4e4234, roughness: 1 });
    const ties = new THREE.InstancedMesh(tieGeo, tieM, 220);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 220; i++) {
      const x = -218 + i * 2;
      m4.makeTranslation(x, heightAt(x, 58) + 0.12, 58);
      ties.setMatrixAt(i, m4);
    }
    this.scene.add(ties);
    /* rail bridge over river */
    const rx = riverX(58);
    const girder = new THREE.Mesh(new THREE.BoxGeometry(26, 1, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x8a4a3c, roughness: 0.7 }));
    girder.position.set(rx, 0.2, 58);
    this.scene.add(girder);
  }

  /* ---------------- VEGETATION ---------------- */
  private tree(x: number, z: number, kind: "cherry" | "leaf" | "maple" | "pine" | "bamboo", s = 1) {
    const y = heightAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x6b5138, roughness: 1 });
    if (kind === "bamboo") {
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 5.5 * s, 5),
          new THREE.MeshStandardMaterial({ color: 0x7fa868, roughness: 0.8 }));
        b.position.set((Math.random() - 0.5) * 1.4, 2.7 * s, (Math.random() - 0.5) * 1.4);
        b.rotation.z = (Math.random() - 0.5) * 0.14;
        g.add(b);
        this.canopies.push({ m: b, ph: Math.random() * 6, amp: 0.03 });
      }
      this.scene.add(g);
      return;
    }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.38 * s, 2.4 * s, 6), trunkM);
    trunk.position.y = 1.2 * s; trunk.castShadow = true;
    g.add(trunk);
    let mat: THREE.MeshStandardMaterial;
    if (kind === "cherry") mat = this.matCherry;
    else if (kind === "maple") mat = this.matMaple;
    else if (kind === "pine") mat = this.matLeafB;
    else mat = Math.random() < 0.5 ? this.matLeafA : this.matLeafB;
    const blobs = kind === "pine" ? 3 : 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < blobs; i++) {
      const r = (kind === "pine" ? 1.5 - i * 0.38 : 1.35 + Math.random() * 0.6) * s;
      const blob = new THREE.Mesh(
        kind === "pine" ? new THREE.ConeGeometry(r, 1.6 * s, 7) : new THREE.IcosahedronGeometry(r, 1),
        mat
      );
      blob.position.set(
        (Math.random() - 0.5) * 1.3 * s,
        (kind === "pine" ? 2.6 + i * 1.15 : 2.7 + Math.random() * 1.2) * s,
        (Math.random() - 0.5) * 1.3 * s
      );
      blob.castShadow = true;
      g.add(blob);
      this.canopies.push({ m: blob, ph: x * 0.7 + i, amp: kind === "pine" ? 0.012 : 0.028 });
    }
    this.scene.add(g);
    if (kind !== "pine" || s > 1.2) this.obstacles.push({ x, z, r: 0.55 * s });
  }

  private buildVegetation() {
    this.matCherry = new THREE.MeshStandardMaterial({ color: 0xf2b8c6, roughness: 0.9, flatShading: true });
    this.matLeafA = new THREE.MeshStandardMaterial({ color: 0x6f9c46, roughness: 0.95, flatShading: true });
    this.matLeafB = new THREE.MeshStandardMaterial({ color: 0x58863e, roughness: 0.95, flatShading: true });
    this.matMaple = new THREE.MeshStandardMaterial({ color: 0xcf5b3a, roughness: 0.9, flatShading: true });

    /* cherries — square, shrine path, school, river */
    this.tree(8, -15, "cherry", 1.5);
    this.tree(-6, -26, "cherry", 1.1);
    this.tree(-14, -62, "cherry", 1.05);
    this.tree(-33, -78, "cherry", 0.95);
    this.tree(118, 4, "cherry", 1.1);
    this.tree(62, 24, "cherry", 1.0);
    this.tree(-70, 44, "cherry", 1.0);
    this.tree(30, -52, "cherry", 1.15);
    /* maples — shrine & viewpoint */
    this.tree(-20, -100, "maple", 1.1);
    this.tree(-35, -108, "maple", 0.95);
    this.tree(-96, -34, "maple", 1.1);
    this.tree(-112, -26, "maple", 0.9);
    /* leaf trees around village */
    for (const [x, z] of [[-28, -16], [18, 24], [-8, 42], [22, -18], [-34, 28], [16, 44], [-20, -48], [44, 8], [108, 24], [-72, 8], [26, 62], [-38, 58], [122, -18], [140, 20], [-84, 30], [8, -56]] as [number, number][]) {
      this.tree(x + (hash2(x, z) - 0.5) * 4, z + (hash2(z, x) - 0.5) * 4, "leaf", 0.85 + hash2(x, z + 1) * 0.5);
    }
    /* pines on hills + north forest */
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 120 + Math.random() * 60;
      const x = Math.cos(a) * r * 0.9, z = Math.sin(a) * r;
      if (z > 44 && x > 60) continue;
      this.tree(x, z, "pine", 1 + Math.random() * 0.8);
    }
    for (let i = 0; i < 16; i++) {
      this.tree(-20 + (Math.random() - 0.5) * 56, -120 - Math.random() * 34, "pine", 0.9 + Math.random() * 0.7);
    }
    /* bamboo grove */
    for (let i = 0; i < 12; i++) {
      this.tree(-50 + (Math.random() - 0.5) * 16, -74 + (Math.random() - 0.5) * 14, "bamboo", 0.9 + Math.random() * 0.4);
    }

    /* grass */
    const blade = new THREE.PlaneGeometry(0.16, 0.62);
    blade.translate(0, 0.31, 0);
    this.grassMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const N = 2600;
    this.grassMesh = new THREE.InstancedMesh(blade, this.grassMat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), posV = new THREE.Vector3();
    const col = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < N && guard++ < N * 8) {
      const x = (Math.random() - 0.5) * 360, z = (Math.random() - 0.5) * 360;
      const h = terrainH(x, z);
      if (h < -0.4 || h > 16) continue;
      if (roadMask(x, z).m > 0.4) continue;
      if (x * x + z * z < 17 * 17) continue;
      if (x > -18 && x < 52 && z > 56 && z < 118) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      const s = 0.7 + Math.random() * 1.1;
      sc.set(s, s, s);
      posV.set(x, h - 0.02, z);
      m4.compose(posV, q, sc);
      this.grassMesh.setMatrixAt(placed, m4);
      col.setHSL(0.26 + Math.random() * 0.05, 0.5, 0.32 + Math.random() * 0.14);
      this.grassMesh.setColorAt(placed, col);
      placed++;
    }
    this.grassMesh.count = placed;
    this.scene.add(this.grassMesh);

    /* flowers */
    const headGeo = new THREE.IcosahedronGeometry(0.09, 0);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.flowerHeads = new THREE.InstancedMesh(headGeo, headMat, this.flowerN);
    let fp = 0; guard = 0;
    while (fp < this.flowerN && guard++ < this.flowerN * 8) {
      const x = (Math.random() - 0.5) * 320, z = (Math.random() - 0.5) * 320;
      const h = terrainH(x, z);
      if (h < -0.3 || h > 12) continue;
      if (roadMask(x, z).m > 0.35) continue;
      m4.makeTranslation(x, h + 0.28 + Math.random() * 0.1, z);
      this.flowerHeads.setMatrixAt(fp, m4);
      fp++;
    }
    this.flowerHeads.count = fp;
    this.scene.add(this.flowerHeads);

    /* sunflowers near farms (summer) */
    const sfGeo = new THREE.CylinderGeometry(0.3, 0.34, 0.16, 10);
    const sfMat = new THREE.MeshLambertMaterial({ color: 0xe8c33a });
    this.sunflowers = new THREE.InstancedMesh(sfGeo, sfMat, 42);
    for (let i = 0; i < 42; i++) {
      const x = -84 + (i % 7) * 1.1, z = 90 + Math.floor(i / 7) * 1.1;
      m4.makeTranslation(x, heightAt(x, z) + 1.35, z);
      this.sunflowers.setMatrixAt(i, m4);
    }
    this.sunflowers.visible = false;
    this.scene.add(this.sunflowers);
  }

  /* festival lanterns + stalls (exist always, glow at festival) */
  private buildFestival() {
    this.lanternsGroup = new THREE.Group();
    const lanternM = new THREE.MeshStandardMaterial({ color: 0xf6d8a8, emissive: 0xffb066, emissiveIntensity: 0.08, roughness: 0.6 });
    (this as any).lanternMat = lanternM;
    const zones: [number, number, number, number][] = [[28, 40, -42, -32], [-7, 8, -8, 12], [-16, -14, -4, 24]];
    for (const [x0, x1, z0, z1] of zones) {
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = lerp(x0, x1, t), z = lerp(z0, z1, t);
        const y = heightAt(x, z) + 3.1 - Math.sin(t * Math.PI) * 0.7;
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), lanternM);
        l.scale.y = 1.25;
        l.position.set(x, y, z);
        this.lanternsGroup.add(l);
      }
    }
    /* stalls */
    const stallM = new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.9 });
    const roofColors = [0xb23a24, 0x39506b, 0x41604a];
    for (let i = 0; i < 3; i++) {
      const sx = 30 + i * 4.6, sz = -43.5;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 2.2), stallM);
      body.position.y = 1.1; body.castShadow = true;
      const roof = new THREE.Mesh(prismGeo(4.4, 1.1, 3),
        new THREE.MeshStandardMaterial({ color: roofColors[i], roughness: 0.7, side: THREE.DoubleSide }));
      roof.position.y = 2.2;
      g.add(body, roof);
      g.position.set(sx, heightAt(sx, sz), sz);
      this.festivalGroup.add(g);
    }
    this.festivalGroup.visible = false;
    this.lanternsGroup.visible = true;
    this.scene.add(this.lanternsGroup);
  }

  /* ---------------- SEASONS ---------------- */
  private riceTexture(): THREE.CanvasTexture {
    return makeCanvasTex(128, 128, () => { });
  }

  private paintRice(t: THREE.CanvasTexture, season: Season) {
    const c = (t.image as HTMLCanvasElement).getContext("2d")!;
    const cfg = {
      spring: { bg: "#7d93a0", row: "#6fae6a", watery: true },
      summer: { bg: "#4e7d33", row: "#5f9c41", watery: false },
      autumn: { bg: "#c9973f", row: "#dcae55", watery: false },
      winter: { bg: "#b9b4a6", row: "#c9c4b6", watery: false },
    }[season];
    c.fillStyle = cfg.bg; c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 11) {
      c.fillStyle = cfg.row;
      c.fillRect(0, y, 128, 5);
      if (cfg.watery) {
        c.fillStyle = "rgba(210,228,235,0.5)";
        c.fillRect(0, y + 5, 128, 6);
      }
      c.fillStyle = "rgba(0,0,0,0.12)";
      c.fillRect(0, y + 4, 128, 1);
    }
    t.needsUpdate = true;
  }

  setSeason(s: Season) {
    /* canopies */
    const cherryCols: Record<Season, number> = { spring: 0xf2b8c6, summer: 0x6f9c46, autumn: 0xd9915a, winter: 0x8a7a6a };
    const mapleCols: Record<Season, number> = { spring: 0x8fb75c, summer: 0x58863e, autumn: 0xcf5b3a, winter: 0x8a7a6a };
    const leafCols: Record<Season, [number, number]> = {
      spring: [0x7fae52, 0x6a9c46], summer: [0x5f9038, 0x4e7d30],
      autumn: [0xc98a3f, 0xb5763a], winter: [0x7c7268, 0x6e665c],
    };
    this.matCherry.color.set(cherryCols[s]);
    this.matMaple.color.set(mapleCols[s]);
    this.matLeafA.color.set(leafCols[s][0]);
    this.matLeafB.color.set(leafCols[s][1]);
    const bare = s === "winter";
    this.matCherry.transparent = bare; this.matCherry.opacity = bare ? 0.55 : 1;
    this.matMaple.transparent = bare; this.matMaple.opacity = bare ? 0.55 : 1;
    /* grass + flowers */
    const grassCols: Record<Season, number> = { spring: 0xbfe3a8, summer: 0xa8d48e, autumn: 0xd8c48e, winter: 0xaeb8c8 };
    this.grassMat.color.set(grassCols[s]);
    const flowerCols: Record<Season, number> = { spring: 0xf2c8d8, summer: 0x7a9ad6, autumn: 0xd98e4a, winter: 0xc8d0dc };
    (this.flowerHeads.material as THREE.MeshLambertMaterial).color.set(flowerCols[s]);
    this.flowerHeads.visible = s !== "winter";
    this.sunflowers.visible = s === "summer";
    this.riceTexs.forEach((t) => this.paintRice(t, s));
    this.roofCaps.forEach((c) => (c.visible = s === "winter"));
    S.snow = s === "winter" ? 1 : 0;
  }

  setFestival(on: boolean) {
    S.festivalOn = on;
    this.festivalGroup.visible = on;
  }

  /* ---------------- PER-FRAME ---------------- */
  update(dt: number, t: number, night: number, dusk: number) {
    this.waterUniforms.uT.value = t * (S.weather === "rain" ? 1.6 : 1);
    this.waterUniforms.uNight.value = night;
    this.terrainUniforms.uSnow.value = lerp(this.terrainUniforms.uSnow.value as number, S.snow, dt * 1.4);
    this.terrainUniforms.uWet.value = lerp(this.terrainUniforms.uWet.value as number, S.wet, dt * 1.2);

    /* wind sway */
    const w = S.wind * (S.weather === "rain" ? 1.3 : 1);
    for (const c of this.canopies) {
      c.m.rotation.z = Math.sin(t * 1.3 + c.ph) * c.amp * (0.6 + w);
      c.m.rotation.x = Math.cos(t * 1.1 + c.ph) * c.amp * 0.7 * (0.6 + w);
    }
    for (const f of this.flags) {
      f.m.rotation.x = Math.sin(t * 2.4 + f.ph) * 0.08 * (0.5 + w);
      f.m.rotation.y += Math.sin(t * 1.7 + f.ph) * 0.0015;
    }
    /* clouds */
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += dt * (1.2 + i * 0.2) * (0.5 + w);
      if (c.position.x > 320) c.position.x = -320;
    }
    /* night lights */
    for (const wm of this.windowMats) {
      const target = night > wm.th ? 0.85 + Math.sin(t * 0.5 + wm.th * 20) * 0.06 : 0;
      wm.m.emissiveIntensity = lerp(wm.m.emissiveIntensity, target, dt * 2.2);
    }
    for (const lm of this.lampMats) {
      lm.emissiveIntensity = lerp(lm.emissiveIntensity, night * 1.4 + dusk * 0.3, dt * 2);
    }
    for (const g of this.lampGlows) {
      (g.material as THREE.SpriteMaterial).opacity = lerp((g.material as THREE.SpriteMaterial).opacity, night * 0.75, dt * 2);
    }
    (this as any).lanternMat.emissiveIntensity = S.festivalOn ? 1.1 + Math.sin(t * 3) * 0.12 : lerp((this as any).lanternMat.emissiveIntensity, night * 0.5, dt);
    (this.stars.material as THREE.PointsMaterial).opacity = night * 0.9;
  }
}
