/* Living inhabitants of Hinomori: the boy, villagers with daily routines,
   animals, the little train, and world-space particle systems. */

import * as THREE from "three";
import { S, clamp, lerp, dist2 } from "./state";
import { World, heightAt, makeCanvasTex, riverX, surfaceAt } from "./world";
import { audio } from "./audio";

export type AnimMode = "idle" | "walk" | "run" | "sit" | "work" | "wave" | "fish" | "carry";

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Mesh[];
  phase: number;
  mode: AnimMode;
  speed: number;        // 0..1 animation blend
  blinkT: number;
  props: THREE.Group;   // right-hand prop mount
}

interface RigOpts {
  skin?: number; hair?: number; shirt?: number; pants?: number;
  hat?: "straw" | "cap" | "none"; bun?: boolean; scarf?: boolean;
  scale?: number; skirt?: boolean; elder?: boolean;
}

function rig(scene: THREE.Scene, o: RigOpts): Rig {
  const s = o.scale ?? 1;
  const skin = new THREE.MeshStandardMaterial({ color: o.skin ?? 0xf0c8a0, roughness: 0.8 });
  const hairM = new THREE.MeshStandardMaterial({ color: o.hair ?? 0x2e2620, roughness: 0.9 });
  const shirt = new THREE.MeshStandardMaterial({ color: o.shirt ?? 0x3d5a80, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: o.pants ?? 0x4a4238, roughness: 0.9 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52 * s, 0.62 * s, 0.3 * s), shirt);
  torso.position.y = 1.02 * s; torso.castShadow = true;
  body.add(torso);
  if (o.skirt) {
    const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.34 * s, 0.42 * s, 8), pants);
    sk.position.y = 0.72 * s;
    body.add(sk);
  }
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.46 * s, 0.2 * s, 0.27 * s), pants);
  hips.position.y = 0.66 * s;
  body.add(hips);

  const head = new THREE.Group();
  head.position.y = 1.56 * s;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.24 * s, 10, 8), skin);
  skull.castShadow = true;
  head.add(skull);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.25 * s, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
  hairCap.position.y = 0.02 * s;
  head.add(hairCap);
  if (o.bun) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 6, 5), hairM);
    bun.position.set(0, 0.16 * s, -0.16 * s);
    head.add(bun);
  }
  const eyes: THREE.Mesh[] = [];
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x1c1814 });
  for (const ex of [-0.085, 0.085]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.028 * s, 5, 4), eyeM);
    e.position.set(ex * s, 0.01 * s, 0.215 * s);
    head.add(e); eyes.push(e);
  }
  if (o.elder) {
    const hairGray = new THREE.Mesh(new THREE.SphereGeometry(0.25 * s, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1 }));
    hairGray.position.y = 0.02 * s;
    head.add(hairGray);
  }
  if (o.hat === "straw") {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.4 * s, 0.22 * s, 10),
      new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 1 }));
    hat.position.y = 0.24 * s;
    head.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.4 * s, 0.4 * s, 0.02 * s, 10),
      new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 1 }));
    brim.position.y = 0.15 * s;
    head.add(brim);
  }
  if (o.hat === "cap") {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26 * s, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: 0xc2472f, roughness: 0.8 }));
    cap.position.y = 0.05 * s;
    head.add(cap);
  }
  if (o.scarf) {
    const sc = new THREE.Mesh(new THREE.TorusGeometry(0.17 * s, 0.06 * s, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0xb23a24, roughness: 0.9 }));
    sc.rotation.x = Math.PI / 2;
    sc.position.y = -0.17 * s;
    head.add(sc);
  }
  body.add(head);

  const mkLimb = (w: number, len: number, mat: THREE.Material, side: number, isArm: boolean): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (isArm ? 0.33 : 0.14) * s, (isArm ? 1.28 : 0.6) * s, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * s, len * s, w * s), mat);
    mesh.position.y = -len * 0.5 * s;
    mesh.castShadow = true;
    pivot.add(mesh);
    if (!isArm) {
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(w * 1.15 * s, 0.09 * s, w * 1.7 * s),
        new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.9 }));
      shoe.position.set(0, -len * s + 0.02 * s, 0.05 * s);
      pivot.add(shoe);
    }
    body.add(pivot);
    return pivot;
  };
  const armL = mkLimb(0.13, 0.5, shirt, -1, true);
  const armR = mkLimb(0.13, 0.5, shirt, 1, true);
  const legL = mkLimb(0.16, 0.58, pants, -1, false);
  const legR = mkLimb(0.16, 0.58, pants, 1, false);

  const props = new THREE.Group();
  props.position.y = -0.5 * s;
  armR.add(props);

  root.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; } });
  scene.add(root);
  return { root, body, armL, armR, legL, legR, head, eyes, phase: Math.random() * 6, mode: "idle", speed: 0, blinkT: Math.random() * 4, props };
}

function animateRig(r: Rig, dt: number, t: number) {
  const target = r.mode === "walk" ? clamp(r.speed, 0.25, 1) : r.mode === "run" ? 1 : 0;
  const moving = r.mode === "walk" || r.mode === "run";
  const freq = r.mode === "run" ? 11 : 7.5;
  if (moving) r.phase += dt * freq * (0.5 + r.speed * 0.6);
  const amp = moving ? 0.4 + r.speed * 0.6 : 0;
  const sin = Math.sin(r.phase);

  let lRot = sin * 0.75 * amp, aRot = -sin * 0.55 * amp;
  let bodyTilt = 0, armBase = 0;
  if (r.mode === "sit") { lRot = -1.45; aRot = 0.15; }
  if (r.mode === "work") { bodyTilt = 0.5 + Math.sin(t * 3.2) * 0.14; lRot = 0; aRot = -0.9 + Math.sin(t * 3.2) * 0.25; }
  if (r.mode === "fish") { bodyTilt = 0.08; aRot = -1.15; }
  if (r.mode === "carry") { aRot = -1.05; }
  if (r.mode === "wave") {
    r.armR.rotation.z = -2.5 + Math.sin(t * 7) * 0.25;
    r.armR.rotation.x = 0;
  } else {
    r.armR.rotation.z = lerp(r.armR.rotation.z, 0, dt * 8);
    r.armR.rotation.x = aRot + armBase;
  }
  r.armL.rotation.x = -aRot;
  r.legL.rotation.x = lRot;
  r.legR.rotation.x = -lRot;
  r.body.rotation.x = lerp(r.body.rotation.x, bodyTilt + (r.mode === "run" ? 0.12 : 0), dt * 6);
  const bob = moving ? Math.abs(Math.cos(r.phase)) * 0.055 * amp : Math.sin(t * 1.8) * 0.012;
  r.body.position.y = bob + (r.mode === "sit" ? -0.42 : 0);
  /* blink */
  r.blinkT -= dt;
  const blink = r.blinkT < 0.12 && r.blinkT > 0;
  for (const e of r.eyes) e.scale.y = blink ? 0.1 : 1;
  if (r.blinkT < 0) r.blinkT = 2.5 + Math.random() * 3.5;
}

/* ---------------- NPCs ---------------- */

export interface NPCDef {
  name: string; role: string; opts: RigOpts;
  home: [number, number];
  sched: [number, number, number, AnimMode][];
  lines: { min: number; max: number; text: string }[];
}

const NPC_DEFS: NPCDef[] = [
  {
    name: "Hana", role: "Bakery owner", opts: { shirt: 0xb23a24, pants: 0x4a4238, bun: true },
    home: [-60, 20],
    sched: [[6, -13, -10.4, "work"], [12.2, -7, -8, "idle"], [13, -13, -10.4, "work"], [16.5, -8, 8, "idle"], [19, -60, 20, "idle"]],
    lines: [
      { min: 5.5, max: 10, text: "Ohayō! First batch of anpan is still warm." },
      { min: 10, max: 15, text: "The melon bread goes fast on sunny days." },
      { min: 15, max: 22, text: "Tomorrow I'll bake with yuzu from the south farms." },
    ],
  },
  {
    name: "Kenji", role: "Rice farmer", opts: { shirt: 0x41604a, pants: 0x3d3a30, hat: "straw" },
    home: [-46, 34],
    sched: [[6.6, -20, 30, "walk"], [7.2, 16, 78, "work"], [11.5, 8, 74, "sit"], [13, 26, 96, "work"], [17, 34, -36, "idle"], [19.4, -46, 34, "idle"]],
    lines: [
      { min: 5, max: 11, text: "Water's cold this morning. Good for the roots." },
      { min: 11, max: 14, text: "A farmer's lunch tastes best facing his own fields." },
      { min: 14, max: 22, text: "Walk the terraces at dusk — the rows turn to gold." },
    ],
  },
  {
    name: "Yuki", role: "School teacher", opts: { shirt: 0x39506b, pants: 0x4a4a52, bun: true },
    home: [114, 8],
    sched: [[7.4, 120, 10, "walk"], [8, 132, -4, "work"], [12, 130, 6, "idle"], [13.2, 132, -4, "work"], [15.6, 120, 20, "walk"], [16.6, 114, 8, "idle"]],
    lines: [
      { min: 7, max: 9, text: "Morning! We're studying river maps today." },
      { min: 9, max: 15.5, text: "Shh — the class is mid-haiku. Even the cicadas pause." },
      { min: 15.5, max: 22, text: "Mei and Taro raced home again. Fast as dragonflies." },
    ],
  },
  {
    name: "Satoshi", role: "Bicycle repairman", opts: { shirt: 0x708090, pants: 0x3d3a30, hat: "cap" },
    home: [121, 29],
    sched: [[8, 140, 45, "work"], [12.4, 147, 52.6, "sit"], [13.4, 140, 45, "work"], [17.5, 117, 23, "idle"], [19.2, 121, 29, "idle"]],
    lines: [
      { min: 6, max: 12, text: "Squeaky wheel, happy repairman. It's all rhythm." },
      { min: 12, max: 17, text: "This town runs on two wheels and one small train." },
      { min: 17, max: 23, text: "Evening air is good for a slow ride home." },
    ],
  },
  {
    name: "Emi", role: "Florist", opts: { shirt: 0x9db8d2, pants: 0x5a5248, bun: true },
    home: [-60, -4],
    sched: [[8.2, -9, 18, "work"], [12, -15.5, 5.6, "idle"], [13, -9, 18, "work"], [17, 6, 8, "sit"], [19, -60, -4, "idle"]],
    lines: [
      { min: 6, max: 12, text: "I planted hydrangeas by the well. Blue this year!" },
      { min: 12, max: 17, text: "Flowers keep the square honest. Nobody litters near them." },
      { min: 17, max: 23, text: "The evening primrose opens in about an hour. Wait for it." },
    ],
  },
  {
    name: "Aiko", role: "Neighborhood elder", opts: { shirt: 0x8a6f8a, pants: 0x54484a, elder: true },
    home: [-45, 16],
    sched: [[8, -41.3, 16.8, "sit"], [15, -43.5, 18.4, "idle"], [16, -41.3, 16.8, "sit"], [19.4, -45, 16, "idle"]],
    lines: [
      { min: 6, max: 14, text: "Sit a moment. The day will still be there." },
      { min: 14, max: 21, text: "Mochi pretends not to like me. We both pretend." },
    ],
  },
  {
    name: "Daichi", role: "Fisherman", opts: { shirt: 0x3d5a80, pants: 0x37413c, hat: "straw" },
    home: [-61, 38],
    sched: [[5.7, 87, 50, "fish"], [10, 67, 95, "idle"], [11.5, 87, 50, "fish"], [16.5, 4, 6, "idle"], [19, -61, 38, "idle"]],
    lines: [
      { min: 5, max: 11, text: "The sweetfish run early when the mist is low." },
      { min: 11, max: 16, text: "I mostly fish for quiet. The fish are a bonus." },
      { min: 16, max: 22, text: "River sounds different after dark. Friendlier." },
    ],
  },
  {
    name: "Mei", role: "Student", opts: { shirt: 0xe8c8c0, pants: 0x39506b, scale: 0.78, hat: "cap" },
    home: [117, 18],
    sched: [[7.5, 119, 13, "walk"], [8, 126, 6, "idle"], [12, 133, 8, "idle"], [15.2, 128, 8, "idle"], [17, 118, 21, "idle"], [18.4, 117, 18, "idle"]],
    lines: [
      { min: 7, max: 8.5, text: "If I run, I'm not late! Probably!" },
      { min: 8.5, max: 15, text: "We're learning why the terraces hold water. Magic. Or mud." },
      { min: 15, max: 20, text: "Wanna race to the bridge? Loser carries the winner's bag!" },
    ],
  },
  {
    name: "Taro", role: "Student", opts: { shirt: 0x86a868, pants: 0x4a4a52, scale: 0.8 },
    home: [121, 29],
    sched: [[7.5, 124, 18, "walk"], [8, 134, 8, "idle"], [12, 127, 4, "idle"], [15.2, 130, 9, "idle"], [18.4, 121, 29, "idle"]],
    lines: [
      { min: 7, max: 9, text: "I counted seven swallows over the paddies today." },
      { min: 9, max: 15, text: "Grandpa says the old bridge remembers everyone." },
      { min: 15, max: 20, text: "After school the square belongs to us. Rules of the village." },
    ],
  },
  {
    name: "Sato", role: "Stationmaster", opts: { shirt: 0x2c3c55, pants: 0x2c2c34, hat: "cap", elder: true },
    home: [117, 18],
    sched: [[6.6, 152, 52, "work"], [12, 147, 52.8, "sit"], [13, 152, 52, "work"], [18.4, 152, 50, "idle"], [19.6, 117, 18, "idle"]],
    lines: [
      { min: 6, max: 12, text: "On time, as always. The mountains keep our clocks honest." },
      { min: 12, max: 18, text: "Forty-one years of waves at this platform. My arm knows by heart." },
      { min: 18, max: 23, text: "Last train's through. The rails hum themselves to sleep." },
    ],
  },
  {
    name: "Nao", role: "Grocer", opts: { shirt: 0x41604a, pants: 0x54484a, bun: true, scarf: false },
    home: [-60, 38],
    sched: [[7, -12.2, 19.8, "work"], [12.5, -6, 12, "idle"], [13.4, -12.2, 19.8, "work"], [17.5, -14, 8, "idle"], [19, -60, 38, "idle"]],
    lines: [
      { min: 6, max: 12, text: "Daikon came in from the south farms. Crisp as the air." },
      { min: 12, max: 17, text: "Persimmons next week. The trees are already blushing." },
      { min: 17, max: 22, text: "Closing soon — but for you, one last mandarin." },
    ],
  },
  {
    name: "Ren", role: "Tea house keeper", opts: { shirt: 0x54484a, pants: 0x3d3a30, elder: true },
    home: [-61, 20],
    sched: [[9, -15.2, 4.8, "work"], [16, -8, 10, "idle"], [18.6, -61, 20, "idle"]],
    lines: [
      { min: 8, max: 16, text: "Sencha or roasted? The kettle already knows your answer." },
      { min: 16, max: 23, text: "Evening tea is for slow thoughts. Come, sit." },
    ],
  },
];

interface NPC {
  def: NPCDef;
  rig: Rig;
  tx: number; tz: number;
  visible: boolean;
}

/* ================= particle pool ================= */

const softTex = makeCanvasTex(32, 32, (c) => {
  const g = c.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
});
const petalTex = makeCanvasTex(32, 32, (c) => {
  c.clearRect(0, 0, 32, 32);
  c.fillStyle = "#f6c3d0";
  c.beginPath();
  c.ellipse(16, 16, 12, 8, 0.5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#eeaec0";
  c.beginPath();
  c.ellipse(14, 15, 7, 4, 0.5, 0, Math.PI * 2);
  c.fill();
});

class Pool {
  pts: THREE.Points;
  n: number;
  pos: Float32Array; vel: Float32Array; life: Float32Array;
  gravity: number; drag: number; wind: number;
  head = 0;
  constructor(scene: THREE.Scene, n: number, opts: { tex: THREE.Texture; color: number; size: number; additive?: boolean; opacity?: number; gravity?: number; drag?: number; wind?: number }) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 0;
    this.wind = opts.wind ?? 1;
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    const m = new THREE.PointsMaterial({
      map: opts.tex, color: opts.color, size: opts.size, transparent: true,
      opacity: opts.opacity ?? 1, depthWrite: false, sizeAttenuation: true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, m);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const i = this.head; this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
  }
  burst(x: number, y: number, z: number, count: number, speed: number, life: number) {
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.emit(x, y, z,
        Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.9, Math.sin(ph) * Math.sin(th) * sp,
        life * (0.7 + Math.random() * 0.5));
    }
  }
  update(dt: number, t: number, windX: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.vel[i * 3 + 1] += this.gravity * dt;
      this.vel[i * 3] *= 1 - this.drag * dt;
      this.vel[i * 3 + 1] *= 1 - this.drag * dt;
      this.vel[i * 3 + 2] *= 1 - this.drag * dt;
      this.pos[i * 3] += (this.vel[i * 3] + windX * this.wind) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.gravity < 0 && this.pos[i * 3 + 1] < 9 &&
          this.pos[i * 3 + 1] < heightAt(this.pos[i * 3], this.pos[i * 3 + 2]) - 0.1) {
        this.life[i] = Math.min(this.life[i], 0.25);
      }
    }
    (this.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* rain as line segments */
class Rain {
  lines: THREE.LineSegments;
  n = 650;
  vel = new Float32Array(this.n);
  center = new THREE.Vector3();
  constructor(scene: THREE.Scene) {
    const pos = new Float32Array(this.n * 6);
    for (let i = 0; i < this.n; i++) {
      this.vel[i] = 26 + Math.random() * 10;
      this.reset(pos, i, true);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9fb8cc, transparent: true, opacity: 0.42 }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
  }
  reset(pos: Float32Array, i: number, anyY: boolean) {
    const x = this.center.x + (Math.random() - 0.5) * 90;
    const z = this.center.z + (Math.random() - 0.5) * 90;
    const y = anyY ? heightAt(x, z) + Math.random() * 34 : heightAt(x, z) + 30 + Math.random() * 6;
    pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x + 0.25; pos[i * 6 + 4] = y - 1.15; pos[i * 6 + 5] = z;
  }
  update(dt: number, center: THREE.Vector3) {
    this.center.copy(center);
    const p = this.lines.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      p[i * 6 + 1] -= this.vel[i] * dt;
      p[i * 6 + 4] -= this.vel[i] * dt;
      p[i * 6] += 2.2 * dt; p[i * 6 + 3] += 2.2 * dt;
      if (p[i * 6 + 4] < heightAt(p[i * 6], p[i * 6 + 2])) this.reset(p, i, false);
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ================= main entity manager ================= */

const CHERRIES: [number, number][] = [[8, -15], [-6, -26], [-14, -62], [-33, -78], [118, 4], [62, 24], [-70, 44], [30, -52]];

export class Entities {
  scene: THREE.Scene;
  world: World;
  player!: Rig;
  npcs: NPC[] = [];
  walkerRigs: Rig[] = [];
  cat!: THREE.Group;
  catState: "sleep" | "stroll" | "groom" | "flee" = "sleep";
  catT = 0; catTX = 0; catTZ = 0;
  tail!: THREE.Mesh;
  chickens: THREE.Group[] = [];
  ducks: THREE.Group[] = [];
  birds: { g: THREE.Group; ph: number }[] = [];
  flies: { g: THREE.Group; ph: number }[] = [];
  train!: THREE.Group;
  trainState: "idle" | "arrive" | "dwell" | "depart" = "idle";
  trainT = 0; trainX = 340;
  pools!: { petal: Pool; snow: Pool; smoke: Pool; fly: Pool; fire: Pool; leaf: Pool };
  rain: Rain;
  flash!: THREE.PointLight;
  fireworkT = 0;
  petalT = 0; smokeT = 0; snowT = 0; leafT = 0;
  playerVel = new THREE.Vector3();
  playerYaw = 0;
  stepT = 0;
  lookHeadT = 0;

  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    this.world = world;

    /* the boy — Haru */
    this.player = rig(scene, { skin: 0xf2cda4, hair: 0x3a2e24, shirt: 0xd84f35, pants: 0x39506b, hat: "straw" });
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.9 }));
    pack.position.set(0, 1.05, -0.24);
    this.player.body.add(pack);
    /* hand props */
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.7 }));
    bun.name = "bun"; bun.visible = false;
    this.player.props.add(bun);
    const umbG = new THREE.Group(); umbG.name = "umb";
    const uc = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.4, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xc2472f, side: THREE.DoubleSide, roughness: 0.6 }));
    uc.position.y = 0.9;
    const uh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 5),
      new THREE.MeshStandardMaterial({ color: 0x5a4a33 }));
    uh.position.y = 0.4;
    umbG.add(uc, uh); umbG.visible = false;
    this.player.props.add(umbG);

    /* NPCs */
    for (const def of NPC_DEFS) {
      const r = rig(scene, def.opts);
      const winter = S.season === "winter";
      this.npcs.push({ def, rig: r, tx: def.home[0], tz: def.home[1], visible: false });
      r.root.visible = false;
      if (winter && def.opts.hat !== "straw") { /* scarf for winter charm */ }
      void winter;
    }
    /* ambient walkers */
    for (let i = 0; i < 3; i++) {
      const r = rig(scene, { shirt: [0x708090, 0x9db8d2, 0x86a868][i], pants: 0x4a4238, hat: i === 1 ? "cap" : "none", scale: 0.95 });
      r.root.visible = false;
      this.walkerRigs.push(r);
    }

    this.buildCat();
    this.buildChickens();
    this.buildDucks();
    this.buildBirds();
    this.buildFlies();
    this.buildTrain();

    this.pools = {
      petal: new Pool(scene, 420, { tex: petalTex, color: 0xffffff, size: 0.32, gravity: -0.55, drag: 1.1, wind: 2.2, opacity: 0.95 }),
      snow: new Pool(scene, 900, { tex: softTex, color: 0xffffff, size: 0.16, gravity: -0.4, drag: 1.6, wind: 1.1, opacity: 0.92 }),
      smoke: new Pool(scene, 120, { tex: softTex, color: 0xb8b4ac, size: 0.9, gravity: 0.5, drag: 0.9, wind: 1.4, opacity: 0.4 }),
      fly: new Pool(scene, 60, { tex: softTex, color: 0xd8f090, size: 0.22, additive: true, gravity: 0, drag: 2, wind: 0, opacity: 0.9 }),
      fire: new Pool(scene, 500, { tex: softTex, color: 0xffffff, size: 0.5, additive: true, gravity: -2.6, drag: 0.55, wind: 0, opacity: 1 }),
      leaf: new Pool(scene, 160, { tex: petalTex, color: 0xd98e4a, size: 0.3, gravity: -0.7, drag: 1.2, wind: 2, opacity: 0.9 }),
    };
    this.rain = new Rain(scene);
    this.flash = new THREE.PointLight(0xffd8a0, 0, 90);
    this.flash.position.set(34, 30, -37);
    scene.add(this.flash);
  }

  /* ---------- animals ---------- */
  private buildCat() {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 1 });
    const bodyM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.3), fur);
    bodyM.position.y = 0.3; bodyM.castShadow = true;
    const headM = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.24), fur);
    headM.position.set(0.32, 0.44, 0);
    const earG = new THREE.ConeGeometry(0.06, 0.1, 4);
    for (const ez of [-0.07, 0.07]) {
      const ear = new THREE.Mesh(earG, fur);
      ear.position.set(0.32, 0.6, ez);
      g.add(ear);
    }
    this.tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.45, 5), fur);
    this.tail.position.set(-0.3, 0.42, 0);
    this.tail.rotation.z = 0.9;
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.29, 0.31),
      new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 1 }));
    patch.position.set(-0.1, 0.3, 0);
    g.add(bodyM, headM, this.tail, patch);
    g.position.set(-43.2, heightAt(-43.2, 17.4), 17.4);
    this.cat = g;
    this.scene.add(g);
  }

  private buildChickens() {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const bodyM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5),
        new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 1 }));
      bodyM.position.y = 0.28; bodyM.scale.z = 1.25;
      const headM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 1 }));
      headM.position.set(0, 0.5, 0.16);
      const comb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xc2472f }));
      comb.position.set(0, 0.62, 0.16);
      g.add(bodyM, headM, comb);
      g.position.set(-57 + i * 1.2, 0, 86.5 + i * 0.5);
      g.userData.head = headM;
      this.chickens.push(g);
      this.scene.add(g);
    }
  }

  private buildDucks() {
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const bodyM = new THREE.Mesh(new THREE.SphereGeometry(0.24, 7, 5),
        new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 0.9 }));
      bodyM.scale.set(1, 0.75, 1.3);
      const headM = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5),
        new THREE.MeshStandardMaterial({ color: 0x4a6a52, roughness: 0.9 }));
      headM.position.set(0, 0.22, 0.22);
      const bill = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.14),
        new THREE.MeshStandardMaterial({ color: 0xd9a441 }));
      bill.position.set(0, 0.2, 0.36);
      g.add(bodyM, headM, bill);
      g.position.set(riverX(74) - 3 + i * 2.4, -0.78, 74 + i * 3);
      this.ducks.push(g);
      this.scene.add(g);
    }
  }

  private buildBirds() {
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const m = new THREE.MeshLambertMaterial({ color: 0x3a3a44 });
      const bodyM = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 4), m);
      bodyM.rotation.x = Math.PI / 2;
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), m);
      w1.position.x = 0.35;
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), m);
      w2.position.x = -0.35;
      g.add(bodyM, w1, w2);
      g.userData = { w1, w2 };
      this.birds.push({ g, ph: i * 1.7 });
      this.scene.add(g);
    }
  }

  private buildFlies() {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({ color: 0x5aa0b8, transparent: true, opacity: 0.85 });
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), m);
      w1.position.x = 0.15;
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), m);
      w2.position.x = -0.15;
      const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4),
        new THREE.MeshBasicMaterial({ color: 0x3a6a78 }));
      bodyM.rotation.x = Math.PI / 2;
      g.add(w1, w2, bodyM);
      g.userData = { w1, w2 };
      this.flies.push({ g, ph: i * 2.1 });
      this.scene.add(g);
    }
  }

  private buildTrain() {
    this.train = new THREE.Group();
    const winTex = makeCanvasTex(256, 64, (c) => {
      c.fillStyle = "#e8e2d2"; c.fillRect(0, 0, 256, 64);
      c.fillStyle = "#c2472f"; c.fillRect(0, 40, 256, 10);
      c.fillStyle = "#2c3c55";
      for (let i = 0; i < 6; i++) c.fillRect(10 + i * 42, 12, 30, 20);
    });
    for (let c = 0; c < 3; c++) {
      const car = new THREE.Group();
      const bodyM = new THREE.Mesh(new THREE.BoxGeometry(9, 2.5, 2.4),
        new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.5 }));
      bodyM.position.y = 1.55;
      const roofM = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.35, 2.6),
        new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.4, metalness: 0.4 }));
      roofM.position.y = 2.95;
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.8 }));
      skirt.position.y = 0.45;
      car.add(bodyM, roofM, skirt);
      if (c === 0) {
        const light = new THREE.Mesh(new THREE.CircleGeometry(0.22, 8),
          new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
        light.position.set(-4.52, 1.2, 0);
        light.rotation.y = -Math.PI / 2;
        car.add(light);
      }
      car.position.x = c * 9.6;
      this.train.add(car);
    }
    this.train.position.set(340, 0, 58);
    this.train.visible = false;
    this.scene.add(this.train);
  }

  /* ---------- per-frame ---------- */

  /* returns player horizontal speed (for footsteps / camera) */
  update(dt: number, t: number, input: { x: number; z: number; run: boolean; sit: boolean }, night: number): number {
    this.updatePlayer(dt, input, night);
    this.updateNPCs(dt, t, night);
    this.updateWalkers(dt, t, night);
    this.updateAnimals(dt, t);
    this.updateTrain(dt, t);
    this.updateParticles(dt, t, night);
    return this.playerVel.length();
  }

  private blocked(x: number, z: number, r: number, self: THREE.Object3D): boolean {
    for (const o of this.world.obstacles) {
      const d = dist2(x, z, o.x, o.z);
      if (d < o.r + r) return true;
    }
    for (const n of this.npcs) {
      if (!n.rig.root.visible) continue;
      if (n.rig.root === self) continue;
      if (dist2(x, z, n.rig.root.position.x, n.rig.root.position.z) < 0.75 + r) return true;
    }
    return false;
  }

  private pushOut(pos: THREE.Vector3, r: number, self: THREE.Object3D) {
    for (const o of this.world.obstacles) {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const min = o.r + r;
      if (d < min && d > 0.001) {
        pos.x = o.x + (dx / d) * min;
        pos.z = o.z + (dz / d) * min;
      }
    }
    for (const n of this.npcs) {
      if (!n.rig.root.visible || n.rig.root === self) continue;
      const np = n.rig.root.position;
      const dx = pos.x - np.x, dz = pos.z - np.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.8 && d > 0.001) {
        pos.x = np.x + (dx / d) * 0.8;
        pos.z = np.z + (dz / d) * 0.8;
      }
    }
  }

  private updatePlayer(dt: number, input: { x: number; z: number; run: boolean; sit: boolean }, _night: number) {
    const p = this.player;
    const pos = p.root.position;
    if (input.sit) {
      p.mode = "sit";
      p.speed = 0;
      animateRig(p, dt, performance.now() / 1000);
      this.playerVel.set(0, 0, 0);
      return;
    }
    const max = input.run ? 6.0 : 3.6;
    const accel = 16;
    const tx = input.x * max, tz = input.z * max;
    this.playerVel.x += clamp(tx - this.playerVel.x, -accel * dt, accel * dt);
    this.playerVel.z += clamp(tz - this.playerVel.z, -accel * dt, accel * dt);
    const sp = this.playerVel.length();
    if (sp > 0.05) {
      const targetYaw = Math.atan2(this.playerVel.x, this.playerVel.z);
      let dy = targetYaw - this.playerYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.playerYaw += dy * clamp(dt * 10, 0, 1);
      p.root.rotation.y = this.playerYaw;
    }
    const nx = pos.x + this.playerVel.x * dt;
    const nz = pos.z + this.playerVel.z * dt;
    const nh = heightAt(nx, nz);
    const bound = 205;
    const okBounds = Math.abs(nx) < bound && Math.abs(nz) < bound;
    const okWater = nh > -0.55;
    const okSlope = nh < 30;
    if (okBounds && okWater && okSlope) {
      pos.x = nx; pos.z = nz;
    } else {
      this.playerVel.multiplyScalar(0.2);
    }
    this.pushOut(pos, 0.42, p.root);
    const groundY = heightAt(pos.x, pos.z);
    pos.y += (groundY - pos.y) * clamp(dt * 12, 0, 1);

    p.mode = sp > 0.4 ? (input.run ? "run" : "walk") : "idle";
    p.speed = clamp(sp / max, 0, 1);
    animateRig(p, dt, performance.now() / 1000);

    /* footsteps */
    if (sp > 1) {
      this.stepT -= dt * sp;
      if (this.stepT < 0) {
        this.stepT = 1.1;
        audio.step(surfaceAt(pos.x, pos.z));
      }
    }
  }

  private npcSlot(n: NPC, h: number): { x: number; z: number; mode: AnimMode } | null {
    const s = n.def.sched;
    if (h < s[0][0]) return null;
    let cur = s[0];
    for (const slot of s) if (h >= slot[0]) cur = slot;
    return { x: cur[1], z: cur[2], mode: cur[3] };
  }

  private updateNPCs(dt: number, t: number, night: number) {
    const h = S.time;
    const pp = this.player.root.position;
    for (const n of this.npcs) {
      const slot = this.npcSlot(n, h);
      const r = n.rig;
      const pos = r.root.position;
      if (!slot) { r.root.visible = false; continue; }
      const lastSlot = n.def.sched[n.def.sched.length - 1];
      const isHome = slot.x === n.def.home[0] && slot.z === n.def.home[1];
      if (isHome && h > lastSlot[0] + 0.4) { r.root.visible = false; continue; }
      r.root.visible = true;
      if (pos.x === 0 && pos.z === 0 && !n.visible) { pos.set(n.def.home[0], 0, n.def.home[1]); n.visible = true; }
      n.tx = slot.x; n.tz = slot.z;
      const dx = n.tx - pos.x, dz = n.tz - pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const far = dist2(pp.x, pp.z, pos.x, pos.z) > 130;
      if (d > 0.9 && !far) {
        const sp = 2.1;
        let vx = (dx / d) * sp, vz = (dz / d) * sp;
        /* obstacle steering */
        for (const o of this.world.obstacles) {
          const ox = pos.x + vx * 0.7 - o.x, oz = pos.z + vz * 0.7 - o.z;
          const od = Math.sqrt(ox * ox + oz * oz);
          if (od < o.r + 0.6) {
            vx += (ox / od) * sp * 0.9;
            vz += (oz / od) * sp * 0.9;
          }
        }
        const vl = Math.sqrt(vx * vx + vz * vz) || 1;
        pos.x += (vx / vl) * sp * dt;
        pos.z += (vz / vl) * sp * dt;
        const nh = heightAt(pos.x, pos.z);
        if (nh < -0.5) { pos.x -= (vx / vl) * sp * dt * 2; pos.z -= (vz / vl) * sp * dt * 2; }
        else pos.y += (nh - pos.y) * clamp(dt * 8, 0, 1);
        r.mode = "walk"; r.speed = 0.75;
        const yaw = Math.atan2(vx, vz);
        let dyw = yaw - r.root.rotation.y;
        while (dyw > Math.PI) dyw -= Math.PI * 2;
        while (dyw < -Math.PI) dyw += Math.PI * 2;
        r.root.rotation.y += dyw * clamp(dt * 5, 0, 1);
      } else {
        pos.y += (heightAt(pos.x, pos.z) - pos.y) * clamp(dt * 8, 0, 1);
        r.mode = slot.mode === "idle" ? "idle" : slot.mode;
        r.speed = 0;
        /* face the player when close and idle */
        const pd = dist2(pp.x, pp.z, pos.x, pos.z);
        if (pd < 7 && slot.mode !== "sit" && slot.mode !== "work") {
          const yaw = Math.atan2(pp.x - pos.x, pp.z - pos.z);
          let dyw = yaw - r.root.rotation.y;
          while (dyw > Math.PI) dyw -= Math.PI * 2;
          while (dyw < -Math.PI) dyw += Math.PI * 2;
          r.root.rotation.y += dyw * clamp(dt * 3, 0, 1);
        }
        if (slot.mode === "sit") {
          r.mode = "sit";
        }
      }
      /* greeting wave when player comes close (once per approach) */
      const pd = dist2(pp.x, pp.z, pos.x, pos.z);
      if (pd < 4.5 && (n as any).waveCd === undefined) (n as any).waveCd = 0;
      if (pd < 4.5 && t - ((n as any).waveCd ?? 99) > 20 && r.mode !== "sit") {
        (n as any).waveCd = t;
        (n as any).waveT = t;
      }
      if ((n as any).waveT && t - (n as any).waveT < 1.6 && r.mode !== "walk") {
        r.mode = "wave";
      }
      animateRig(r, dt, t);
      void night;
    }
  }

  private walkerPaths: [number, number][][] = [
    [[0, -18], [8, -4], [4, 10], [-6, 12], [-8, -4]],
    [[-20, 2], [-8, -14], [10, -18], [14, 2], [-2, 16]],
    [[-14, 22], [-2, 8], [12, 6], [8, 20]],
  ];
  private walkerIdx = [0, 0, 0];

  private updateWalkers(dt: number, t: number, night: number) {
    const h = S.time;
    for (let i = 0; i < this.walkerRigs.length; i++) {
      const r = this.walkerRigs[i];
      if (h < 8.5 || h > 18 || night > 0.5) { r.root.visible = false; continue; }
      r.root.visible = true;
      if (r.root.position.lengthSq() === 0) r.root.position.set(this.walkerPaths[i][0][0], 0, this.walkerPaths[i][0][1]);
      const path = this.walkerPaths[i];
      const wp = path[this.walkerIdx[i]];
      const dx = wp[0] - r.root.position.x, dz = wp[1] - r.root.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.7) this.walkerIdx[i] = (this.walkerIdx[i] + 1) % path.length;
      const sp = 1.6;
      r.root.position.x += (dx / (d || 1)) * sp * dt;
      r.root.position.z += (dz / (d || 1)) * sp * dt;
      r.root.position.y += (heightAt(r.root.position.x, r.root.position.z) - r.root.position.y) * clamp(dt * 8, 0, 1);
      r.mode = "walk"; r.speed = 0.6;
      const yaw = Math.atan2(dx, dz);
      let dyw = yaw - r.root.rotation.y;
      while (dyw > Math.PI) dyw -= Math.PI * 2;
      while (dyw < -Math.PI) dyw += Math.PI * 2;
      r.root.rotation.y += dyw * clamp(dt * 4, 0, 1);
      animateRig(r, dt, t);
    }
  }

  private updateAnimals(dt: number, t: number) {
    const pp = this.player.root.position;
    const h = S.time;
    /* cat */
    const catPos = this.cat.position;
    this.catT -= dt;
    const pd = dist2(pp.x, pp.z, catPos.x, catPos.z);
    if (pd < 2.1 && S.rep < 3 && this.catState !== "flee") {
      this.catState = "flee"; this.catT = 1.2;
      const away = Math.atan2(catPos.x - pp.x, catPos.z - pp.z);
      this.catTX = catPos.x + Math.sin(away) * 4;
      this.catTZ = catPos.z + Math.cos(away) * 4;
    }
    if (this.catT < 0) {
      const roll = Math.random();
      if (roll < 0.4) { this.catState = "sleep"; this.catT = 6 + Math.random() * 6; }
      else if (roll < 0.75) {
        this.catState = "stroll";
        this.catT = 3 + Math.random() * 3;
        this.catTX = -45 + (Math.random() - 0.5) * 12;
        this.catTZ = 16 + (Math.random() - 0.5) * 10;
      } else { this.catState = "groom"; this.catT = 2.5 + Math.random() * 2; }
    }
    if (this.catState === "stroll" || this.catState === "flee") {
      const dx = this.catTX - catPos.x, dz = this.catTZ - catPos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const sp = this.catState === "flee" ? 4.2 : 0.9;
      if (d > 0.3) {
        catPos.x += (dx / d) * sp * dt;
        catPos.z += (dz / d) * sp * dt;
        this.cat.rotation.y = Math.atan2(dx, dz);
      } else if (this.catState === "flee") this.catState = "stroll";
    }
    catPos.y += (heightAt(catPos.x, catPos.z) - catPos.y) * clamp(dt * 8, 0, 1);
    this.cat.scale.y = this.catState === "sleep" ? 0.72 + Math.sin(t * 1.4) * 0.02 : 1;
    this.tail.rotation.x = Math.sin(t * (this.catState === "sleep" ? 0.8 : 3)) * 0.5;

    /* chickens */
    for (let i = 0; i < this.chickens.length; i++) {
      const c = this.chickens[i];
      c.userData.t = (c.userData.t ?? Math.random() * 3) - dt;
      const headM = c.userData.head as THREE.Mesh;
      if (pd < 30) {
        if (c.userData.t < 0) {
          c.userData.t = 1.5 + Math.random() * 3;
          c.userData.tx = -57 + (Math.random() - 0.5) * 5;
          c.userData.tz = 86 + (Math.random() - 0.5) * 3;
        }
        const dx = (c.userData.tx ?? c.position.x) - c.position.x;
        const dz = (c.userData.tz ?? c.position.z) - c.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.4) {
          c.position.x += (dx / d) * 0.7 * dt;
          c.position.z += (dz / d) * 0.7 * dt;
          c.rotation.y = Math.atan2(dx, dz);
          headM.position.y = 0.5 + Math.abs(Math.sin(t * 12 + i)) * 0.05;
        } else {
          headM.position.y = 0.5 - Math.abs(Math.sin(t * 6 + i * 2)) * 0.16; /* pecking */
        }
        c.position.y = heightAt(c.position.x, c.position.z);
      }
    }
    /* ducks */
    for (let i = 0; i < this.ducks.length; i++) {
      const d = this.ducks[i];
      d.position.z += dt * 0.5 * (i === 0 ? 1 : -1);
      if (d.position.z > 86) d.position.z = 68;
      if (d.position.z < 68) d.position.z = 86;
      d.position.x = riverX(d.position.z) - 2.5 + Math.sin(t * 0.6 + i * 2) * 1.4;
      d.position.y = -0.78 + Math.sin(t * 2 + i) * 0.03;
      d.rotation.y = i === 0 ? 0 : Math.PI;
    }
    /* birds */
    for (const b of this.birds) {
      const a = t * 0.22 + b.ph;
      const r = 34 + Math.sin(b.ph) * 10;
      b.g.position.set(18 + Math.cos(a) * r, 26 + Math.sin(a * 2 + b.ph) * 4, -28 + Math.sin(a) * r);
      b.g.rotation.y = -a;
      const flap = Math.sin(t * 9 + b.ph) * 0.6;
      (b.g.userData.w1 as THREE.Mesh).rotation.z = flap;
      (b.g.userData.w2 as THREE.Mesh).rotation.z = -flap;
    }
    /* dragonflies / butterflies */
    const flyVis = S.season === "summer" && h > 8 && h < 17;
    for (let i = 0; i < this.flies.length; i++) {
      const f = this.flies[i];
      f.g.visible = flyVis;
      if (!flyVis) continue;
      const bx = riverX(60 + i * 12) - 6 + Math.sin(t * 0.7 + f.ph) * 4;
      const bz = 60 + i * 12 + Math.cos(t * 0.55 + f.ph) * 3;
      f.g.position.set(bx, heightAt(bx, bz) + 1.4 + Math.sin(t * 2.2 + f.ph) * 0.4, bz);
      const flap = Math.sin(t * 22 + f.ph) * 0.7;
      (f.g.userData.w1 as THREE.Mesh).rotation.z = flap;
      (f.g.userData.w2 as THREE.Mesh).rotation.z = -flap;
    }
  }

  private updateTrain(dt: number, t: number) {
    this.trainT += dt;
    const CYCLE = 78, ARR = 13, DWELL = 13, DEP = 16;
    const ct = this.trainT % CYCLE;
    const pp = this.player.root.position;
    if (ct < ARR) {
      if (this.trainState !== "arrive") {
        this.trainState = "arrive";
        audio.trainHorn();
      }
      const k = ct / ARR;
      this.trainX = lerp(340, 152, smoothstep(k));
      this.train.visible = true;
      if (Math.random() < dt * 7) audio.clack(clamp(1 - Math.abs(this.trainX - pp.x) / 120, 0, 1));
    } else if (ct < ARR + DWELL) {
      if (this.trainState !== "dwell") { this.trainState = "dwell"; }
      this.trainX = 152;
      this.train.visible = true;
    } else if (ct < ARR + DWELL + DEP) {
      if (this.trainState !== "depart") { this.trainState = "depart"; audio.trainHorn(); }
      const k = (ct - ARR - DWELL) / DEP;
      this.trainX = lerp(152, -340, smoothstep(k));
      this.train.visible = true;
      if (Math.random() < dt * 7) audio.clack(clamp(1 - Math.abs(this.trainX - pp.x) / 120, 0, 1));
    } else {
      this.trainState = "idle";
      this.train.visible = false;
    }
    this.train.position.x = this.trainX;
    this.train.position.y = heightAt(this.trainX, 58) + 0.32;
    void t;
  }

  private updateParticles(dt: number, t: number, night: number) {
    const pp = this.player.root.position;
    const windX = Math.sin(t * 0.3) * 0.6 + S.wind * 1.4;

    /* petals — spring */
    if (S.season === "spring") {
      this.petalT -= dt;
      if (this.petalT < 0) {
        this.petalT = 0.06;
        for (const [cx, cz] of CHERRIES) {
          if (dist2(pp.x, pp.z, cx, cz) < 60 && Math.random() < 0.5) {
            this.pools.petal.emit(
              cx + (Math.random() - 0.5) * 5, heightAt(cx, cz) + 3 + Math.random() * 2.5, cz + (Math.random() - 0.5) * 5,
              (Math.random() - 0.5) * 0.7, -0.3, (Math.random() - 0.5) * 0.7,
              6 + Math.random() * 4);
          }
        }
      }
    }
    /* leaves — autumn */
    if (S.season === "autumn") {
      this.leafT -= dt;
      if (this.leafT < 0) {
        this.leafT = 0.22;
        const cx = pp.x + (Math.random() - 0.5) * 40, cz = pp.z + (Math.random() - 0.5) * 40;
        this.pools.leaf.emit(cx, heightAt(cx, cz) + 5 + Math.random() * 4, cz, 0, -0.4, 0, 7);
      }
    }
    /* snow — winter or snow weather */
    const snowing = S.weather === "snow" || (S.season === "winter" && S.weather === "clear");
    if (snowing) {
      this.snowT -= dt;
      if (this.snowT < 0) {
        this.snowT = 0.03;
        for (let i = 0; i < 3; i++) {
          this.pools.snow.emit(
            pp.x + (Math.random() - 0.5) * 60, pp.y + 18 + Math.random() * 12, pp.z + (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 0.5, -1.3 - Math.random() * 0.7, (Math.random() - 0.5) * 0.5,
            20);
        }
      }
    }
    /* chimney smoke */
    const h = S.time;
    const smokeOn = (h > 5.8 && h < 10.5) || (S.season === "winter" && night > 0.3);
    if (smokeOn) {
      this.smokeT -= dt;
      if (this.smokeT < 0) {
        this.smokeT = 0.28;
        for (const [sx, sy, sz] of this.world.chimneySpots) {
          this.pools.smoke.emit(sx, sy, sz, (Math.random() - 0.5) * 0.15, 0.7, (Math.random() - 0.5) * 0.15, 5);
        }
      }
    }
    /* fireflies — summer nights near river */
    if (S.season === "summer" && night > 0.45) {
      if (Math.random() < dt * 6) {
        const fx = riverX(pp.z) - 12 + (Math.random() - 0.5) * 16;
        const fz = pp.z + (Math.random() - 0.5) * 24;
        this.pools.fly.emit(fx, heightAt(fx, fz) + 0.6 + Math.random() * 1.4, fz,
          (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3,
          5 + Math.random() * 5);
      }
      (this.pools.fly.pts.material as THREE.PointsMaterial).opacity = 0.5 + Math.sin(t * 3) * 0.4;
    }
    /* festival fireworks */
    if (S.festivalOn && h > 19.6 && h < 21.5) {
      this.fireworkT -= dt;
      if (this.fireworkT < 0) {
        this.fireworkT = 3.2 + Math.random() * 2.5;
        const bx = 34 + (Math.random() - 0.5) * 18, bz = -37 + (Math.random() - 0.5) * 12;
        const cols = [0xffd8a0, 0xff8a6a, 0xa0e8c0, 0xf6c3d0, 0xf0ece2];
        (this.pools.fire.pts.material as THREE.PointsMaterial).color.set(cols[Math.floor(Math.random() * cols.length)]);
        this.pools.fire.burst(bx, 34 + Math.random() * 10, bz, 130, 9, 1.7);
        this.flash.position.set(bx, 34, bz);
        this.flash.intensity = 3.2;
        audio.pop();
      }
    }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 4.5);

    this.rain.lines.visible = S.weather === "rain";
    if (S.weather === "rain") this.rain.update(dt, pp);
    for (const k of Object.keys(this.pools) as (keyof typeof this.pools)[]) {
      this.pools[k].update(dt, t, windX);
    }
  }
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
