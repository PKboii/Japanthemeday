/* HINOMORI — one spring morning. A small hand-placed village in real 3D:
   the boy's route is the spine; houses, cherry lane, paddies, river, bridge,
   square and viewpoint hill all physically connect along it. */

import * as THREE from "three";
import { clamp, lerp, smooth, hash2 } from "./state";

export interface Obstacle { x: number; z: number; r: number }

export function makeCanvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c = cv.getContext("2d")!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
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

function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  const u = smooth(xf), v = smooth(zf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x: number, z: number): number {
  return vnoise(x * 0.05, z * 0.05) * 0.65 + vnoise(x * 0.13 + 7, z * 0.13) * 0.35;
}

/* ---------- THE ROUTE (the story's spine) ---------- */
export const ROUTE: [number, number][] = [
  [-78.5, -50.5], [-60, -47], [-47, -39], [-40, -34], [-32, -31], [-20, -26],
  [-8, -19], [6, -12], [18, -7], [27, -1], [29, 6], [31, 13],
  [34, 18.5], [34, 25.5], [35, 31], [39, 40], [37, 45], [34, 49],
  [40, 55], [48, 62], [55, 69], [59, 73.8],
];

function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

function routeDist(x: number, z: number): number {
  let d = 1e9;
  for (let i = 0; i < ROUTE.length - 1; i++) {
    d = Math.min(d, distSeg(x, z, ROUTE[i][0], ROUTE[i][1], ROUTE[i + 1][0], ROUTE[i + 1][1]));
  }
  return d;
}

export function riverZ(x: number): number {
  return 21.5 + 2.6 * Math.sin(x * 0.035 + 0.4) + 1.1 * Math.sin(x * 0.09);
}
const RIVER_Y = -1.0;

/* flattening circles for house plots & square */
const FLATS: [number, number, number][] = [
  [-84, -58, 9], [-58, -55, 7], [-46, -30.5, 8], [-27, -41, 7], [-13, -31.5, 8],
  [4, -30, 6.5], [24, 38, 7], [46, 41, 9], [44, 55, 7], [22, 52, 6.5],
  [34, 44, 15], [59, 74, 7],
];

function terraceH(x: number, z: number): number {
  if (x < 6 || x > 50 || z < -44 || z > -16) return 0;
  const tier = clamp(Math.floor((-16 - z) / 7), 0, 3);
  const c = -16 - tier * 7 - 3.5;
  const inT = smooth(clamp(1 - Math.abs(z - c) / 3.9, 0, 1));
  const ex = smooth(clamp(1 - Math.max(6 - x, x - 50) / 3, 0, 1));
  /* keep a flat aze (field-path) corridor along the boy's route */
  const rd = routeDist(x, z);
  const pathFade = smooth(clamp((rd - 2.4) / 2.6, 0, 1));
  return (tier + 1) * 0.72 * inT * ex * pathFade;
}

function mound(x: number, z: number, cx: number, cz: number, r: number, h: number): number {
  const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
  return d > r ? 0 : h * smooth(1 - d / r);
}

function bigH(x: number, z: number): number {
  let h = 0;
  /* north hill row */
  for (let i = 0; i < 7; i++) {
    h += mound(x, z, -130 + i * 44, -104 - (i % 2) * 12, 34, 11 + (i % 3) * 4);
  }
  /* viewpoint hill */
  h += mound(x, z, 58, 74, 42, 8.4);
  /* west shoulder */
  h += mound(x, z, -150, -10, 60, 10);
  h += mound(x, z, -135, 50, 55, 8);
  /* east shoulder */
  h += mound(x, z, 150, 10, 60, 9);
  /* rice terraces */
  h += terraceH(x, z);
  /* river channel */
  const dr = Math.abs(z - riverZ(x));
  h -= (1 - smooth(clamp((dr - 3.2) / 9, 0, 1))) * 3.6;
  return h;
}

export function terrainH(x: number, z: number): number {
  const big = bigH(x, z);
  let noise = (fbm(x, z) - 0.5) * 2.3;
  /* quiet the noise along the route, the square and house plots */
  const dr = routeDist(x, z);
  let k = 1 - smooth(clamp((dr - 3.0) / 3.6, 0, 1)) * 0.92;
  for (const [fx, fz, fr] of FLATS) {
    const d = Math.sqrt((x - fx) ** 2 + (z - fz) ** 2);
    k *= 1 - smooth(clamp(1 - d / fr, 0, 1)) * 0.92;
  }
  let h = big + noise * k;
  /* bowl edge so the valley reads enclosed */
  const rr = Math.sqrt(x * x + (z - 8) * (z - 8));
  if (rr > 165) h += Math.pow((rr - 165) / 13, 1.7) * 5;
  return h;
}

const DECK_Y = 8.8;
export function heightAt(x: number, z: number): number {
  const h = terrainH(x, z);
  let out = h;
  /* bridge deck — flat across the planks (z 16.8–28.8), gentle ramps on the banks */
  if (x > 30.6 && x < 37.4 && z > 15.4 && z < 30.2) {
    const ex = smooth(clamp(1 - Math.max(31.5 - x, x - 36.5) / 0.9, 0, 1));
    const ezIn = smooth(clamp((z - 15.4) / 1.4, 0, 1));
    const ezOut = smooth(clamp((30.2 - z) / 1.4, 0, 1));
    out = Math.max(out, 0.62 * ex * Math.min(ezIn, ezOut));
  }
  if (x > 55.4 && x < 62.6 && z > 71.4 && z < 76.8) out = Math.max(out, DECK_Y);    // lookout deck
  return out;
}

export function surfaceAt(x: number, z: number): "grass" | "dirt" | "stone" | "wood" {
  if (x > 31.5 && x < 36.5 && z > 16.8 && z < 28.8) return "wood";
  if (x > 55.4 && x < 62.6 && z > 71.4 && z < 76.8) return "wood";
  if (routeDist(x, z) < 2.6) return x < -18 ? "dirt" : "stone";
  const dc = Math.sqrt((x - 34) ** 2 + (z - 44) ** 2);
  if (dc < 13) return "stone";
  return "grass";
}

/* ================================================================ */

interface Bldg {
  w: number; d: number; h: number; roofH: number;
  wall: number; roof: number;
  sign?: string; noren?: string; norenColor?: number;
  chimney?: boolean; engawa?: boolean; windows?: number; door?: boolean;
}

export interface Collider { x: number; y: number; z: number; r: number }

export class World {
  scene: THREE.Scene;
  cherrySpots: [number, number, number, number][] = [];
  smokeSpots: [number, number, number][] = [];
  colliders: Collider[] = [];
  pathCurve: THREE.CatmullRomCurve3;

  private canopies: { m: THREE.Object3D; ph: number; amp: number }[] = [];
  private flags: { m: THREE.Object3D; ph: number }[] = [];
  private waterUniforms: Record<string, THREE.IUniform> = {};
  private stars?: THREE.Points;
  private clouds: THREE.Group[] = [];
  private grassMesh!: THREE.InstancedMesh;
  private flowerMesh!: THREE.InstancedMesh;
  private shojiTex: THREE.CanvasTexture;
  private heroBranch!: THREE.Object3D;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const pts = ROUTE.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 0.02, z));
    this.pathCurve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.35);
    this.shojiTex = makeCanvasTex(64, 64, (c) => {
      c.fillStyle = "#efe4c8"; c.fillRect(0, 0, 64, 64);
      c.strokeStyle = "#5a4a33"; c.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16, 64); c.stroke(); }
      for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(0, i * 16); c.lineTo(64, i * 16); c.stroke(); }
    });
    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildBridge();
    this.buildRouteDressing();
    this.buildHouses();
    this.buildSquare();
    this.buildTrees();
    this.buildLookout();
  }

  /* ---------------- SKY ---------------- */
  private buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(430, 24, 14),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          top: { value: new THREE.Color("#6ea9d6") },
          bottom: { value: new THREE.Color("#f4e8cd") },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bottom;
          void main(){ float h = normalize(vP).y*0.5+0.5; gl_FragColor = vec4(mix(bottom, top, pow(h, 0.66)), 1.0); }`,
      })
    );
    this.scene.add(sky);

    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const k = 3 + Math.floor(Math.random() * 3);
      for (let j = 0; j < k; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(9 + Math.random() * 8, 8, 6), cm);
        s.position.set(j * 12 - k * 6, Math.random() * 3.5, Math.random() * 9 - 4);
        s.scale.y = 0.4;
        g.add(s);
      }
      g.position.set((Math.random() - 0.5) * 420, 92 + Math.random() * 50, -140 + Math.random() * 220);
      this.clouds.push(g);
      this.scene.add(g);
    }
  }

  /* ---------------- TERRAIN ---------------- */
  private buildTerrain() {
    const SIZE = 460, SEG = 170;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const cGrass = new THREE.Color("#7fab52"), cGrass2 = new THREE.Color("#94bd60");
    const cDirt = new THREE.Color("#a5895f"), cStone = new THREE.Color("#a7a193");
    const cSand = new THREE.Color("#b9aa7c"), cRock = new THREE.Color("#8d907f");
    const cPath = new THREE.Color("#c2b391");
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = terrainH(x, z);
      p.setY(i, h);
      const n = fbm(x * 2.3 + 40, z * 2.3);
      tmp.copy(cGrass).lerp(cGrass2, n);
      const dr = Math.abs(z - riverZ(x));
      if (dr < 13) tmp.lerp(cSand, (1 - dr / 13) * 0.85);
      if (h > 13) tmp.lerp(cRock, clamp((h - 13) / 12, 0, 1) * 0.75);
      const rd = routeDist(x, z);
      if (rd < 4) tmp.lerp(x < -18 ? cDirt : cPath, 1 - smooth(clamp((rd - 1.6) / 2.2, 0, 1)));
      const dc = Math.sqrt((x - 34) ** 2 + (z - 44) ** 2);
      if (dc < 14) tmp.lerp(cStone, 1 - smooth(clamp((dc - 8) / 6, 0, 1)));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }));
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    /* layered mountain ranges — near detailed, far hazy */
    const nearM = new THREE.MeshLambertMaterial({ color: 0x6d8a58 });
    const midM = new THREE.MeshLambertMaterial({ color: 0x5d7390 });
    const farM = new THREE.MeshLambertMaterial({ color: 0xa7bccb });
    const row = (mat: THREE.Material, zBase: number, hMin: number, hMax: number, spread: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const x = -spread / 2 + (spread / (n - 1)) * i + (hash2(i, zBase) - 0.5) * 26;
        const h = hMin + hash2(i, zBase + 3) * (hMax - hMin);
        const pk = new THREE.Mesh(new THREE.ConeGeometry(34 + hash2(i, 7) * 30, h, 5), mat);
        pk.position.set(x, h / 2 - 7, zBase + (hash2(i, 11) - 0.5) * 24);
        pk.rotation.y = hash2(i, 9) * 3;
        this.scene.add(pk);
      }
    };
    row(nearM, -118, 18, 28, 420, 8);
    row(midM, -168, 30, 44, 520, 9);
    row(farM, -228, 42, 58, 620, 10);
    /* soft south-east rim */
    for (let i = 0; i < 5; i++) {
      const pk = new THREE.Mesh(new THREE.ConeGeometry(40, 20 + hash2(i, 2) * 12, 5), midM);
      pk.position.set(120 + i * 40, 4, 160 + (i % 2) * 30);
      this.scene.add(pk);
    }
  }

  /* ---------------- WATER ---------------- */
  private buildWater() {
    const seg = 90, hw = 5.2;
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const uv = new Float32Array((seg + 1) * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const x = -190 + (380 * i) / seg;
      const cz = riverZ(x);
      pos[i * 6] = x; pos[i * 6 + 1] = RIVER_Y; pos[i * 6 + 2] = cz - hw;
      pos[i * 6 + 3] = x; pos[i * 6 + 4] = RIVER_Y; pos[i * 6 + 5] = cz + hw;
      uv[i * 4] = x * 0.05; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = x * 0.05; uv[i * 4 + 3] = 1;
      if (i < seg) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.waterUniforms = {
      uT: { value: 0 },
      uDeep: { value: new THREE.Color("#3f7d84") },
      uLight: { value: new THREE.Color("#d8ecdf") },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true, uniforms: this.waterUniforms,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float uT; uniform vec3 uDeep; uniform vec3 uLight;
        void main(){
          float flow = sin(vUv.x*20.0 + uT*2.4 + sin(vUv.y*8.0 + uT*0.8)*1.3);
          float flow2 = sin(vUv.x*37.0 + uT*3.8 + vUv.y*12.0);
          float glint = smoothstep(0.6, 0.97, flow*0.6 + flow2*0.4);
          float edge = smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
          vec3 col = mix(uDeep, uLight, glint*0.5 + (1.0-edge)*0.42);
          /* faint sakura tint in the shallows */
          col = mix(col, vec3(0.92, 0.80, 0.80), (1.0-edge)*0.18);
          gl_FragColor = vec4(col, 0.88);
        }`,
    });
    this.scene.add(new THREE.Mesh(g, mat));

    /* rocks + reeds */
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8f88, roughness: 1 });
    for (let i = 0; i < 34; i++) {
      const x = -150 + Math.random() * 300;
      const side = Math.random() < 0.5 ? -1 : 1;
      const r = new THREE.Mesh(rockGeo, rockMat);
      const sc = 0.3 + Math.random() * 0.9;
      r.scale.set(sc, sc * 0.65, sc);
      r.position.set(x, RIVER_Y + sc * 0.35, riverZ(x) + side * (3.6 + Math.random() * 3));
      r.rotation.set(Math.random(), Math.random() * 3, Math.random());
      r.castShadow = true;
      this.scene.add(r);
    }
    const reedGeo = new THREE.ConeGeometry(0.05, 1.5, 4);
    const reedMat = new THREE.MeshLambertMaterial({ color: 0x7a9455 });
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, 180);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 180; i++) {
      const x = -140 + Math.random() * 290;
      const side = Math.random() < 0.5 ? -1 : 1;
      const z = riverZ(x) + side * (5.6 + Math.random() * 2.6);
      m4.makeRotationY(Math.random() * 3);
      m4.setPosition(x, terrainH(x, z) + 0.7, z);
      reeds.setMatrixAt(i, m4);
    }
    this.scene.add(reeds);
  }

  /* ---------------- BRIDGE ---------------- */
  private buildBridge() {
    const deckY = 0.62;
    const x0 = 31.5, x1 = 36.5, z0 = 16.8, z1 = 28.8;
    const woodM = new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.9 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x6b553c, roughness: 0.95 });
    /* deck planks running across the walk */
    const plankGeo = new THREE.BoxGeometry(x1 - x0, 0.12, 0.5);
    for (let z = z0 + 0.3; z < z1; z += 0.62) {
      const p = new THREE.Mesh(plankGeo, Math.floor(z / 0.62) % 2 ? woodM : darkM);
      p.position.set((x0 + x1) / 2, deckY - 0.06, z);
      p.receiveShadow = true;
      this.scene.add(p);
    }
    /* side stringers */
    for (const sx of [x0 + 0.15, x1 - 0.15]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, z1 - z0), darkM);
      beam.position.set(sx, deckY - 0.2, (z0 + z1) / 2);
      beam.castShadow = true;
      this.scene.add(beam);
    }
    /* railings on both sides — set just inside the deck edge so the walker stays clear */
    for (const sx of [x0 + 0.25, x1 - 0.25]) {
      for (let z = z0; z <= z1 + 0.01; z += 2.4) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.85, 0.14), darkM);
        post.position.set(sx, deckY + 0.42, z);
        post.castShadow = true;
        this.scene.add(post);
      }
      for (const rh of [0.5, 0.82]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, z1 - z0), woodM);
        rail.position.set(sx, deckY + rh, (z0 + z1) / 2);
        this.scene.add(rail);
      }
    }
    /* slightly taller entrance posts */
    for (const sx of [x0 + 0.25, x1 - 0.25]) {
      for (const ez of [z0, z1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), darkM);
        post.position.set(sx, deckY + 0.55, ez);
        post.castShadow = true;
        this.scene.add(post);
      }
    }
  }

  /* ---------------- ROUTE DRESSING ---------------- */
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

  private buildRouteDressing() {
    /* stone edging along the cherry lane */
    const stoneGeo = new THREE.DodecahedronGeometry(0.2, 0);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1 });
    const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, 130);
    const m4 = new THREE.Matrix4();
    let si = 0;
    for (let i = 0; i < 26 && si < 126; i++) {
      const t = 0.24 + (i / 25) * 0.28;
      const p = this.pathCurve.getPointAt(clamp(t, 0, 1));
      const tan = this.pathCurve.getTangentAt(clamp(t, 0, 1));
      const nx = -tan.z, nz = tan.x;
      for (const side of [-1, 1]) {
        const x = p.x + nx * side * 2.4 + (hash2(i, side) - 0.5) * 0.5;
        const z = p.z + nz * side * 2.4 + (hash2(i + 40, side) - 0.5) * 0.5;
        m4.makeRotationY(hash2(i, side + 9) * 3);
        m4.setPosition(x, heightAt(x, z) + 0.08, z);
        stones.setMatrixAt(si++, m4);
      }
    }
    stones.count = si;
    this.scene.add(stones);

    /* utility poles + sagging wires along the residential road */
    const poleTs = [0.0, 0.06, 0.12, 0.18];
    const polePos: THREE.Vector3[] = [];
    for (const t of poleTs) {
      const p = this.pathCurve.getPointAt(t);
      const tan = this.pathCurve.getTangentAt(t);
      const x = p.x - tan.z * 4.4, z = p.z + tan.x * 4.4;
      polePos.push(new THREE.Vector3(x, heightAt(x, z), z));
    }
    for (let i = 0; i < polePos.length; i++) {
      const pp = polePos[i];
      this.box(0.22, 7.2, 0.22, 0x4e463a, pp.x, pp.y + 3.6, pp.z);
      this.box(2.6, 0.14, 0.14, 0x4e463a, pp.x, pp.y + 6.9, pp.z);
      if (i > 0) {
        const q = polePos[i - 1];
        const mid = new THREE.Vector3().addVectors(pp, q).multiplyScalar(0.5);
        mid.y += 6.72;
        const len = pp.distanceTo(q);
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 3),
          new THREE.MeshBasicMaterial({ color: 0x2c2c30 }));
        wire.position.copy(mid);
        wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
          new THREE.Vector3().subVectors(pp, q).normalize());
        this.scene.add(wire);
      }
    }

    /* mailboxes */
    for (const [mx, mz] of [[-75, -49.5], [-55.5, -52.8], [26.5, 36.5]] as [number, number][]) {
      this.box(0.1, 1.0, 0.1, 0x5a4a33, mx, heightAt(mx, mz) + 0.5, mz);
      this.box(0.42, 0.34, 0.3, 0xc2472f, mx, heightAt(mx, mz) + 1.1, mz);
    }

    /* small drainage stones along the residential road */
    const drain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.1, 0.4), stoneMat, 40);
    for (let i = 0; i < 40; i++) {
      const t = i / 39 * 0.2;
      const p = this.pathCurve.getPointAt(t);
      const tan = this.pathCurve.getTangentAt(t);
      const x = p.x + tan.z * 2.9, z = p.z - tan.x * 2.9;
      m4.makeRotationY(Math.atan2(tan.x, tan.z));
      m4.setPosition(x, heightAt(x, z) + 0.05, z);
      drain.setMatrixAt(i, m4);
    }
    this.scene.add(drain);

    /* low bamboo fences between plots */
    const fenceRuns: [number, number, number, number][] = [
      [-70, -52.5, -50, -49], [-38, -34.5, -24, -31], [18, 35, 30, 33],
    ];
    for (const [x0, z0, x1, z1] of fenceRuns) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(len / 0.9);
      for (let i = 0; i <= n; i++) {
        const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n);
        this.box(0.07, 0.75, 0.07, 0x8a7a54, x, heightAt(x, z) + 0.37, z);
      }
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const rail = this.box(len, 0.06, 0.05, 0x9a8a64, cx, heightAt(cx, cz) + 0.6, cz);
      rail.rotation.y = Math.atan2(z1 - z0, x1 - x0);
      const rail2 = this.box(len, 0.06, 0.05, 0x9a8a64, cx, heightAt(cx, cz) + 0.3, cz);
      rail2.rotation.y = rail.rotation.y;
    }

    /* rice terraces — flooded spring water + young seedling rows */
    for (let tier = 0; tier < 4; tier++) {
      const zc = -16 - tier * 7 - 3.5;
      const y = (tier + 1) * 0.72 + 0.12;
      const tex = makeCanvasTex(128, 128, (c) => {
        c.fillStyle = "#8fa6ad"; c.fillRect(0, 0, 128, 128);
        for (let r = 0; r < 128; r += 10) {
          c.fillStyle = "rgba(214,230,235,0.55)";
          c.fillRect(0, r, 128, 6);
          c.fillStyle = "#6fae6a";
          for (let x = 0; x < 128; x += 6) c.fillRect(x + (r % 20 ? 2 : 0), r + 2, 2.4, 2.4);
        }
      });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(42, 6.6),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.08 }));
      pl.rotation.x = -Math.PI / 2;
      pl.position.set(28, y, zc);
      pl.receiveShadow = true;
      this.scene.add(pl);
      /* bund (earthen edge) */
      this.box(42, 0.28, 0.5, 0x7d7357, 28, y - 0.12, zc + 3.4, { rough: 1 });
    }
    /* irrigation channel beside the paddy path */
    const chan = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 30),
      new THREE.MeshStandardMaterial({ color: 0x6f9aa0, roughness: 0.25, metalness: 0.2 }));
    chan.rotation.x = -Math.PI / 2;
    chan.position.set(36.8, 0.06, 2);
    this.scene.add(chan);

    /* scarecrow at the terrace edge */
    this.scarecrow(9, -14);

    /* grass + flowers */
    this.buildFlora();
  }

  private scarecrow(x: number, z: number) {
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

  private buildFlora() {
    const blade = new THREE.PlaneGeometry(0.15, 0.6);
    blade.translate(0, 0.3, 0);
    const N = 2100;
    this.grassMesh = new THREE.InstancedMesh(blade,
      new THREE.MeshLambertMaterial({ color: 0xbfe3a8, side: THREE.DoubleSide }), N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
    const col = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < N && guard++ < N * 9) {
      const x = (Math.random() - 0.5) * 330, z = (Math.random() - 0.5) * 330;
      const h = terrainH(x, z);
      if (h < -0.5 || h > 15) continue;
      if (routeDist(x, z) < 3.4) continue;
      if (Math.abs(z - riverZ(x)) < 7) continue;
      if (x > 4 && x < 52 && z > -46 && z < -14) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      const s = 0.7 + Math.random() * 1.1;
      sc.set(s, s, s);
      pv.set(x, h - 0.02, z);
      m4.compose(pv, q, sc);
      this.grassMesh.setMatrixAt(placed, m4);
      col.setHSL(0.25 + Math.random() * 0.06, 0.52, 0.42 + Math.random() * 0.16);
      this.grassMesh.setColorAt(placed, col);
      placed++;
    }
    this.grassMesh.count = placed;
    this.scene.add(this.grassMesh);

    /* flower clusters near homes & the square */
    const heads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 0),
      new THREE.MeshLambertMaterial({ color: 0xffffff }), 300);
    const clusters: [number, number, number][] = [
      [-38.5, -27.5, 14], [-80, -52, 10], [22, 36, 10], [40, 47, 14], [30, 50, 10],
      [50, 44, 8], [6, -27, 8], [-24, -38, 8], [44, 20, 10], [52, 66, 12],
    ];
    let fi = 0;
    for (const [cx, cz, n] of clusters) {
      for (let i = 0; i < n && fi < 300; i++) {
        const x = cx + (Math.random() - 0.5) * 4.5, z = cz + (Math.random() - 0.5) * 3.5;
        m4.makeTranslation(x, heightAt(x, z) + 0.24 + Math.random() * 0.12, z);
        heads.setMatrixAt(fi, m4);
        const pink = Math.random() < 0.65;
        col.set(pink ? 0xf2b8c6 : 0xf6f0e0).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
        heads.setColorAt(fi, col);
        fi++;
      }
    }
    heads.count = fi;
    this.flowerMesh = heads;
    this.scene.add(heads);
  }

  /* ---------------- HOUSES (ten unique) ---------------- */
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
    const base = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.5, 0.5, o.d + 0.5),
      new THREE.MeshStandardMaterial({ color: 0x8d8577, roughness: 1 }));
    base.position.y = 0.25; base.receiveShadow = true; base.castShadow = true;
    g.add(base);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d),
      new THREE.MeshStandardMaterial({ color: o.wall, roughness: 0.9 }));
    wall.position.y = 0.5 + o.h / 2; wall.castShadow = true; wall.receiveShadow = true;
    g.add(wall);
    const roof = new THREE.Mesh(prismGeo(o.w + 2.1, o.roofH, o.d + 2.3),
      new THREE.MeshStandardMaterial({ color: o.roof, roughness: 0.62, side: THREE.DoubleSide }));
    roof.position.y = 0.5 + o.h; roof.castShadow = true;
    g.add(roof);
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, o.d + 2.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x31343c, roughness: 0.7 }));
    ridge.rotation.x = Math.PI / 2; ridge.position.y = 0.5 + o.h + o.roofH;
    g.add(ridge);
    const wm = new THREE.MeshStandardMaterial({
      map: this.shojiTex, emissiveMap: this.shojiTex, emissive: 0xffd9a0,
      emissiveIntensity: 0.06, color: 0xffffff, roughness: 0.8,
    });
    const wn = o.windows ?? 2;
    for (let i = 0; i < wn; i++) {
      const wx = -o.w / 2 + (o.w / (wn + 1)) * (i + 1);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.25), wm);
      win.position.set(wx, 0.5 + o.h * 0.52, o.d / 2 + 0.02);
      g.add(win);
    }
    if (o.door !== false) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.9),
        new THREE.MeshStandardMaterial({ color: 0x3d3125, roughness: 0.9 }));
      door.position.set(0, 1.45, o.d / 2 + 0.03);
      g.add(door);
    }
    if (o.engawa) {
      const eng = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.4, 0.16, 1.1),
        new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.85 }));
      eng.position.set(0, 0.55, o.d / 2 + 0.6); eng.castShadow = true;
      g.add(eng);
    }
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
      noren.position.set(0, 2.15, o.d / 2 + 0.14);
      g.add(noren);
      this.flags.push({ m: noren, ph: Math.random() * 6 });
    }
    if (o.sign) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.86),
        new THREE.MeshStandardMaterial({ map: this.signTex(o.sign, "#f0e8d4", "#2c2620"), roughness: 0.8 }));
      sign.position.set(0, 0.5 + o.h + o.roofH * 0.45, o.d / 2 + 0.35);
      g.add(sign);
    }
    if (o.chimney) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x6b6259, roughness: 1 }));
      ch.position.set(o.w * 0.28, 0.5 + o.h + o.roofH * 0.5, -o.d * 0.2);
      g.add(ch);
      const wp = new THREE.Vector3(o.w * 0.28, 0.5 + o.h + o.roofH * 0.5 + 0.9, -o.d * 0.2)
        .applyMatrix4(new THREE.Matrix4().makeRotationY(ry));
      this.smokeSpots.push([x + wp.x, g.position.y + wp.y, z + wp.z]);
    }
    /* camera collider — walls are solid */
    this.colliders.push({ x, y: heightAt(x, z) + o.h * 0.5, z, r: Math.max(o.w, o.d) * 0.62 });
    this.scene.add(g);
    return g;
  }

  private bike(x: number, z: number, ry: number) {
    const g = new THREE.Group();
    const frameM = new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.5, metalness: 0.3 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.9 });
    for (const wx of [-0.62, 0.62]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 14), darkM);
      w.position.set(wx, 0.34, 0);
      g.add(w);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5), frameM);
    bar.rotation.z = Math.PI / 2 - 0.2; bar.position.set(0, 0.55, 0);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.14), darkM);
    seat.position.set(-0.35, 0.86, 0);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), frameM);
    handle.rotation.x = Math.PI / 2; handle.position.set(0.62, 0.95, 0);
    g.add(bar, seat, handle);
    g.position.set(x, heightAt(x, z), z);
    g.rotation.y = ry; g.rotation.z = 0.12;
    this.scene.add(g);
    return g;
  }

  private buildHouses() {
    /* 1 — the boy's house: engawa, chimney, veggie plot */
    this.building(-84, -58, 0.35, { w: 7, d: 6, h: 3, roofH: 2.2, wall: 0xd8c9a8, roof: 0x4c4238, engawa: true, chimney: true, windows: 2 });
    for (let r = 0; r < 3; r++) {
      this.box(3.4, 0.26, 1.1, 0x4e3b28, -89.5, heightAt(-89.5, -55 + r * 1.6) + 0.13, -55 + r * 1.6, { rough: 1 });
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0),
          new THREE.MeshLambertMaterial({ color: 0x6fae6a }));
        c.position.set(-90.8 + i * 0.7, heightAt(-89.5, -55 + r * 1.6) + 0.4, -55 + r * 1.6);
        this.scene.add(c);
      }
    }
    /* wind chime on the engawa */
    this.windChime(-82.2, heightAt(-84, -58) + 2.6, -54.6);

    /* 2 — dark tiled roof + bicycle */
    this.building(-58, -55, 0.2, { w: 6, d: 5.4, h: 2.8, roofH: 2, wall: 0xbfae90, roof: 0x3f4a56, windows: 2 });
    this.bike(-54.6, -52.4, 0.9);

    /* 3 — Haru's: flower garden + stone wall + watering can */
    this.building(-46, -30.5, -2.6, { w: 6.2, d: 5.6, h: 2.8, roofH: 2, wall: 0xd6c6a5, roof: 0x4c4238, engawa: true, windows: 2 });
    for (let i = 0; i < 5; i++) this.box(1, 0.55, 0.5, 0x948c7c, -40.8 + i * 0.92, heightAt(-40.8 + i * 0.92, -28.3 + i * 0.34) + 0.27, -28.3 + i * 0.34, { ry: 1.22 });
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.34, 8),
      new THREE.MeshStandardMaterial({ color: 0x708090, roughness: 0.5 }));
    can.position.set(-38.6, heightAt(-38.6, -28.7) + 0.17, -28.7);
    this.scene.add(can);

    /* 4 — hydrangea house */
    this.building(-27, -41, 0.5, { w: 5.8, d: 5.2, h: 2.7, roofH: 1.9, wall: 0xcdbfa2, roof: 0x57483a, windows: 2 });
    for (const [hx, hz] of [[-30.5, -38], [-24, -37.5], [-29, -44]] as [number, number][]) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1),
        new THREE.MeshStandardMaterial({ color: 0x5f9038, roughness: 0.95, flatShading: true }));
      bush.position.set(hx, heightAt(hx, hz) + 0.6, hz);
      this.scene.add(bush);
      for (let i = 0; i < 5; i++) {
        const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0),
          new THREE.MeshLambertMaterial({ color: i % 2 ? 0xb8c8e8 : 0xe8c8d8 }));
        fl.position.set(hx + (Math.random() - 0.5) * 1.1, heightAt(hx, hz) + 0.9 + Math.random() * 0.5, hz + (Math.random() - 0.5) * 1.1);
        this.scene.add(fl);
      }
    }

    /* 5 — the bicycle shop: open front facing the road, workbench, spare wheels */
    this.building(-13, -31.5, 0.23, { w: 7.4, d: 5.6, h: 3, roofH: 1.7, wall: 0xb8a98c, roof: 0x424c58, sign: "自転車", noren: "輪", norenColor: 0x39506b, door: false, windows: 1 });
    this.bike(-10.2, -28.4, 0.23 + Math.PI / 2);
    this.bike(-8.8, -29.6, 0.23 + Math.PI / 2 + 0.15);
    for (const [wx, wz] of [[-15.6, -28.6], [-15.2, -29.6]] as [number, number][]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0x2c2c2c }));
      wheel.position.set(wx, heightAt(wx, wz) + 0.5, wz);
      wheel.rotation.y = 0.5;
      this.scene.add(wheel);
    }
    this.box(1.6, 0.8, 0.7, 0x6b553c, -11.5, heightAt(-11.5, -28.8) + 0.4, -28.8, { ry: 0.6 });

    /* 6 — little house north of the junction */
    this.building(4, -30, 2.9, { w: 5.4, d: 5, h: 2.6, roofH: 1.8, wall: 0xcbb894, roof: 0x57483a, windows: 1 });
    for (let i = 0; i < 3; i++) {
      const pot = this.box(0.44, 0.4, 0.44, 0x8a5a40, 6.4, heightAt(6.4, -27.5 + i * 0.9) + 0.2, -27.5 + i * 0.9);
      pot.rotation.y = Math.random();
    }

    /* 7 — blue noren house after the bridge */
    this.building(24, 38, 2.4, { w: 6, d: 5.4, h: 2.8, roofH: 2, wall: 0xd0c0a0, roof: 0x424c58, noren: "手", norenColor: 0x39506b, windows: 2 });
    this.bike(27.2, 35.6, 2.2);

    /* 8 — the village shop 雑貨 */
    const shop = this.building(46, 41, -1.9, { w: 7.6, d: 6.2, h: 3.2, roofH: 2.2, wall: 0xdcc9a3, roof: 0x54483a, sign: "雑貨", noren: "雑", norenColor: 0xb23a24, windows: 3 });
    /* awning */
    const awn = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.1, 1.7),
      new THREE.MeshStandardMaterial({ color: 0xb23a24, roughness: 0.8 }));
    awn.position.set(0, 2.6, 4.2);
    awn.rotation.x = 0.22;
    shop.add(awn);
    /* crates + produce + flower buckets by the door (clear of Miyo) */
    for (const [cx, cz, cc] of [[43.5, 38.2, 0xd97e2f], [43.2, 39.9, 0x8fb75c], [44.1, 41.7, 0xc2472f]] as [number, number, number][]) {
      this.box(0.8, 0.5, 0.8, 0x8a6f4d, cx, heightAt(cx, cz) + 0.25, cz, { ry: Math.random() });
      for (let i = 0; i < 4; i++) {
        const pr = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5),
          new THREE.MeshStandardMaterial({ color: cc, roughness: 0.7 }));
        pr.position.set(cx + (Math.random() - 0.5) * 0.4, heightAt(cx, cz) + 0.58, cz + (Math.random() - 0.5) * 0.4);
        this.scene.add(pr);
      }
    }
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x708090, roughness: 0.5 }));
    bucket.position.set(43.2, heightAt(43.2, 43.6) + 0.25, 43.6);
    this.scene.add(bucket);
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.7, 4),
        new THREE.MeshLambertMaterial({ color: i % 2 ? 0xf2b8c6 : 0xe8c8c0 }));
      st.position.set(43.2 + (Math.random() - 0.5) * 0.3, heightAt(43.2, 43.6) + 0.85, 43.6 + (Math.random() - 0.5) * 0.3);
      st.rotation.z = (Math.random() - 0.5) * 0.5;
      this.scene.add(st);
    }

    /* 9 — veranda + wind chime (set east of the square, clear of the hill path) */
    this.building(52, 50, -2.2, { w: 6, d: 5.4, h: 2.8, roofH: 2, wall: 0xc3b092, roof: 0x4c4238, engawa: true, windows: 2, chimney: true });
    this.windChime(54.2, heightAt(52, 50) + 2.6, 52.4);
    this.laundry(56, 53);

    /* 10 — kura storehouse */
    this.building(22, 52, 0.4, { w: 4.6, d: 4.2, h: 3.1, roofH: 1.5, wall: 0xe8e2d2, roof: 0x31343c, windows: 0 });
  }

  private windChime(x: number, y: number, z: number) {
    const g = new THREE.Group();
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x9db8d2, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide }));
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xf2ead6, side: THREE.DoubleSide, roughness: 1 }));
    strip.position.y = -0.4;
    g.add(bell, strip);
    g.position.set(x, y, z);
    this.scene.add(g);
    this.flags.push({ m: g, ph: Math.random() * 6 });
  }

  private laundry(x: number, z: number) {
    const y = heightAt(x, z);
    this.box(0.1, 2, 0.1, 0x8a6f4d, x - 1.5, y + 1, z);
    this.box(0.1, 2, 0.1, 0x8a6f4d, x + 1.5, y + 1, z);
    const colors = [0xf4eee0, 0x9db8d2, 0xe8c8c0];
    for (let i = 0; i < 3; i++) {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.05),
        new THREE.MeshStandardMaterial({ color: colors[i], side: THREE.DoubleSide, roughness: 1 }));
      cloth.position.set(x - 0.9 + i * 0.9, y + 1.35, z);
      this.scene.add(cloth);
      this.flags.push({ m: cloth, ph: i * 1.7 });
    }
  }

  /* ---------------- SQUARE ---------------- */
  private buildSquare() {
    /* well */
    const well = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 1, 10),
      new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1 }));
    well.position.set(30, heightAt(30, 45) + 0.5, 45);
    well.castShadow = true;
    this.scene.add(well);
    const wr = new THREE.Mesh(prismGeo(2.8, 1, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x4c4238, roughness: 0.7, side: THREE.DoubleSide }));
    wr.position.set(30, heightAt(30, 45) + 2.3, 45);
    this.scene.add(wr);
    for (const sx of [-1, 1]) this.box(0.16, 1.4, 0.16, 0x5a4a33, 30 + sx * 1.1, heightAt(30, 45) + 1.7, 45);
    this.colliders.push({ x: 30, y: heightAt(30, 45) + 1.5, z: 45, r: 1.5 });

    /* notice board */
    this.box(0.14, 1.9, 0.14, 0x5a4a33, 38.5, heightAt(38.5, 47.5) + 0.95, 47.5);
    const board = this.box(2.2, 1.3, 0.14, 0x7b6647, 38.5, heightAt(38.5, 47.5) + 1.75, 47.5);
    board.rotation.y = -0.7;
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.95),
      new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 1 }));
    paper.position.set(38.44, heightAt(38.5, 47.5) + 1.75, 47.42);
    paper.rotation.y = -0.7 + Math.PI;
    this.scene.add(paper);

    /* benches — the elders' bench west of the well, one more by the shop road */
    this.bench(27.5, 41.5, 0.5);
    this.bench(40.5, 36, -1.2);

    /* planter Nana tends (west of the path so the boy never clips it) */
    this.box(2.6, 0.5, 0.9, 0x8a6f4d, 29.5, heightAt(29.5, 50.5) + 0.25, 50.5, { ry: 0.35 });
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0),
        new THREE.MeshLambertMaterial({ color: i % 2 ? 0xf2b8c6 : 0xf6e08a }));
      f.position.set(28.4 + i * 0.36, heightAt(29.5, 50.5) + 0.62, 50.4 + Math.sin(i) * 0.12);
      this.scene.add(f);
    }

    /* stone lantern at square edge */
    this.stoneLantern(25.5, 46.5);
    /* two street lamps (morning — unlit, just furniture) */
    for (const [lx, lz] of [[28.5, 38.5], [40.5, 46.5]] as [number, number][]) {
      this.box(0.13, 3.2, 0.13, 0x3a3a3e, lx, heightAt(lx, lz) + 1.6, lz);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.55, 0.46),
        new THREE.MeshStandardMaterial({ color: 0xf6e7c4, roughness: 0.4 }));
      head.position.set(lx, heightAt(lx, lz) + 3.35, lz);
      this.scene.add(head);
    }
  }

  private bench(x: number, z: number, ry: number) {
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
  }

  private stoneLantern(x: number, z: number) {
    const y = heightAt(x, z);
    const m = new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 1 });
    const parts: [number, number][] = [[0.5, 0.5], [0.34, 0.5], [0.62, 0.55], [0.45, 0.3]];
    let yy = y;
    for (const [w, h] of parts) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.6, w, h, 6), m);
      b.position.set(x, yy + h / 2, z);
      b.castShadow = true;
      this.scene.add(b);
      yy += h;
    }
    const boxPart = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), m);
    boxPart.position.set(x, yy + 0.22, z);
    this.scene.add(boxPart);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.4, 4), m);
    top.position.set(x, yy + 0.62, z);
    this.scene.add(top);
  }

  /* ---------------- TREES ---------------- */
  private matCherry = new THREE.MeshStandardMaterial({ color: 0xf2b3c4, roughness: 0.9, flatShading: true });
  private matCherryDeep = new THREE.MeshStandardMaterial({ color: 0xe89cb2, roughness: 0.9, flatShading: true });
  private matLeaf = new THREE.MeshStandardMaterial({ color: 0x6f9c46, roughness: 0.95, flatShading: true });
  private matLeafB = new THREE.MeshStandardMaterial({ color: 0x58863e, roughness: 0.95, flatShading: true });
  private matPine = new THREE.MeshStandardMaterial({ color: 0x4e7d52, roughness: 0.95, flatShading: true });

  private tree(x: number, z: number, kind: "cherry" | "leaf" | "pine", s = 1, register = true) {
    const y = heightAt(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.36 * s, 2.4 * s, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b5138, roughness: 1 }));
    trunk.position.y = 1.2 * s; trunk.castShadow = true;
    g.add(trunk);
    const mat = kind === "cherry"
      ? (Math.random() < 0.5 ? this.matCherry : this.matCherryDeep)
      : kind === "pine" ? this.matPine : (Math.random() < 0.5 ? this.matLeaf : this.matLeafB);
    const blobs = kind === "pine" ? 3 : 3 + Math.floor(Math.random() * 2);
    let maxR = 0;
    for (let i = 0; i < blobs; i++) {
      const r = (kind === "pine" ? 1.5 - i * 0.38 : 1.3 + Math.random() * 0.6) * s;
      maxR = Math.max(maxR, r);
      const blob = new THREE.Mesh(
        kind === "pine" ? new THREE.ConeGeometry(r, 1.7 * s, 7) : new THREE.IcosahedronGeometry(r, 1),
        mat
      );
      const bx = (Math.random() - 0.5) * 1.2 * s;
      const by = (kind === "pine" ? 2.7 + i * 1.15 : 2.8 + Math.random() * 1.1) * s;
      const bz = (Math.random() - 0.5) * 1.2 * s;
      blob.position.set(bx, by, bz);
      blob.castShadow = true;
      g.add(blob);
      this.canopies.push({ m: blob, ph: x * 0.7 + i * 1.3, amp: kind === "pine" ? 0.012 : 0.03 });
      /* camera colliders — the view must never travel through foliage */
      this.colliders.push({ x: x + bx, y: y + by, z: z + bz, r: r * 0.94 });
    }
    this.colliders.push({ x, y: y + 1.2 * s, z, r: 0.5 * s });
    this.scene.add(g);
    if (register && kind === "cherry") {
      this.cherrySpots.push([x, y + 3.3 * s, z, maxR * 1.25]);
    }
    return g;
  }

  private buildTrees() {
    /* HERO cherry — its low branch wipes the camera at the first descent */
    const hero = this.tree(-66, -2, "cherry", 1.8);
    const branch = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 1), this.matCherry);
    branch.position.set(-70.5, 3.6, -7.5);
    branch.castShadow = true;
    this.scene.add(branch);
    this.heroBranch = branch;
    this.canopies.push({ m: branch, ph: 2, amp: 0.04 });
    this.cherrySpots.push([-70.5, 3.6, -7.5, 2.6]);
    this.colliders.push({ x: -70.5, y: 3.6, z: -7.5, r: 2.4 });
    hero.rotation.y = 0.7;

    /* cherry lane — alternating sides, kept clear of the road centreline
       and of the camera corridor that tracks the boy from the south */
    const lane: [number, number, number][] = [
      [-14, -24.5, 1.25], [-6, -20.5, 1.0], [6.5, -15.5, 1.35], [19, -11, 1.3], [25.5, -5, 1.2],
      [-1, -11, 1.15], [11, -6.5, 0.9], [23.5, 1.5, 1.1], [35, 9, 0.95],
    ];
    for (const [x, z, s] of lane) this.tree(x, z, "cherry", s);

    /* cherries near homes & square */
    this.tree(-76, -45, "cherry", 1.0);
    this.tree(26, 33.5, "cherry", 1.15);
    this.tree(44.5, 47.5, "cherry", 1.05);
    this.tree(45, 14, "cherry", 1.3);
    this.tree(50, 60, "cherry", 1.1);

    /* leaf trees scattered */
    for (const [x, z] of [[-60, -38], [-20, -44], [10, -30], [-34, 34], [18, 42], [30, 55], [42, 34], [-66, -30], [8, 8], [52, 44]] as [number, number][]) {
      this.tree(x + (hash2(x, z) - 0.5) * 3, z + (hash2(z, x) - 0.5) * 3, "leaf", 0.85 + hash2(x, z + 1) * 0.45);
    }
    /* pines on the north hills & viewpoint slope */
    for (let i = 0; i < 16; i++) {
      const x = -110 + i * 15 + (hash2(i, 3) - 0.5) * 8;
      const z = -92 - hash2(i, 5) * 16;
      this.tree(x, z, "pine", 0.9 + hash2(i, 7) * 0.6, false);
    }
    for (let i = 0; i < 7; i++) {
      const a = hash2(i, 11) * Math.PI * 2;
      const r = 24 + hash2(i, 13) * 12;
      const x = 58 + Math.cos(a) * r, z = 74 + Math.sin(a) * r * 0.8;
      if (z < 60 || z > 92) continue;
      this.tree(x, z, "pine", 0.8 + hash2(i, 17) * 0.5, false);
    }
  }

  /* ---------------- LOOKOUT ---------------- */
  private buildLookout() {
    const y = DECK_Y;
    const deck = this.box(7.4, 0.3, 5.6, 0x8a6f4d, 59, y - 0.15, 74.1, { rough: 0.9 });
    deck.receiveShadow = true;
    for (const [cx, cz] of [[55.8, 71.8], [62.2, 71.8], [55.8, 76.4], [62.2, 76.4]] as [number, number][]) {
      this.box(0.28, 2.6, 0.28, 0x6b553c, cx, y - 1.3, cz);
    }
    for (const cz of [71.6, 76.6]) this.box(7, 0.13, 0.13, 0x6b553c, 59, y + 0.9, cz);
    for (const cx of [55.6, 62.4]) this.box(0.13, 0.13, 5.2, 0x6b553c, cx, y + 0.9, 74.1);
    this.bench(57.4, 75.6, Math.PI + 0.15);
    this.stoneLantern(62, 72.6);
    /* little red bench-umbrella */
    const pole = this.box(0.08, 2.4, 0.08, 0x5a4a33, 61.2, y + 1.2, 75.4);
    pole.rotation.z = 0.06;
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.7, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xc2472f, roughness: 0.7, side: THREE.DoubleSide }));
    umb.position.set(61.2, y + 2.5, 75.4);
    this.scene.add(umb);
  }

  /* ---------------- PER-FRAME ---------------- */
  update(dt: number, clock: number, gust: number) {
    this.waterUniforms.uT.value = clock;
    const w = 0.55 + gust * 2.4;
    for (const c of this.canopies) {
      c.m.rotation.z = Math.sin(clock * 1.25 + c.ph) * c.amp * w;
      c.m.rotation.x = Math.cos(clock * 1.05 + c.ph) * c.amp * 0.7 * w;
    }
    if (this.heroBranch) {
      this.heroBranch.rotation.z = Math.sin(clock * 1.1) * 0.035 * w;
    }
    for (const f of this.flags) {
      f.m.rotation.x = Math.sin(clock * 2.3 + f.ph) * 0.09 * (0.5 + w * 0.5);
      f.m.rotation.y += Math.sin(clock * 1.7 + f.ph) * 0.0012;
    }
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += dt * (1.1 + i * 0.18) * (0.6 + gust);
      if (c.position.x > 320) c.position.x = -320;
    }
  }
}
