/* Characters, micro-stories, animals and particles — all choreographed by the
   scroll timeline S.t (scrubbable both ways) plus ambient clock loops. */

import * as THREE from "three";
import { S, clamp, lerp, bell, hash2 } from "./state";
import { World, heightAt, riverZ, makeCanvasTex } from "./world";
import { audio } from "./audio";

/* ---------------- character rig ---------------- */
export interface Rig {
  root: THREE.Group; hip: THREE.Object3D; torso: THREE.Object3D; head: THREE.Object3D;
  armL: THREE.Object3D; armR: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D;
  foreL: THREE.Object3D; foreR: THREE.Object3D; shinL: THREE.Object3D; shinR: THREE.Object3D;
  hat?: THREE.Object3D;
}

function std(color: number, rough = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough });
}

export interface RigOpts {
  shirt: number; pants: number; skin?: number; scale?: number;
  hat?: "straw" | "cap" | "none"; hair?: number; female?: boolean; elder?: boolean; shorts?: boolean;
}

export function makeRig(o: RigOpts): Rig {
  const s = o.scale ?? 1;
  const skin = o.skin ?? 0xf0c8a0;
  const hairCol = o.elder ? 0xcfcabf : (o.hair ?? 0x2c2620);
  const root = new THREE.Group();
  const hip = new THREE.Group(); hip.position.y = 0.95 * s; root.add(hip);

  /* pivot group with a rounded capsule limb hanging below it */
  const limb = (parent: THREE.Object3D, r: number, len: number, mat: THREE.Material,
    px: number, py: number, pz: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(px * s, py * s, pz * s);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r * s, len * s, 5, 10), mat);
    m.position.y = -(len / 2 + r * 0.35) * s;
    m.castShadow = true;
    g.add(m);
    parent.add(g);
    return g;
  };

  /* pelvis */
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.145 * s, 0.1 * s, 5, 10), std(o.pants));
  pelvis.position.y = 0.02 * s; pelvis.castShadow = true;
  hip.add(pelvis);
  /* torso */
  const torso = new THREE.Group(); torso.position.y = 0.05 * s; hip.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.155 * s, 0.3 * s, 6, 12), std(o.shirt));
  chest.position.y = 0.33 * s; chest.castShadow = true;
  torso.add(chest);
  if (o.female) {
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s, 0.27 * s, 0.36 * s, 10), std(o.shirt));
    skirt.position.y = -0.12 * s; skirt.castShadow = true; hip.add(skirt);
  }
  torso.userData.stoop = o.elder ? 0.1 : 0; /* gentle stoop, preserved by animations */
  torso.rotation.x = torso.userData.stoop as number;

  /* neck + head */
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * s, 0.05 * s, 0.1 * s, 8), std(skin, 0.7));
  neck.position.y = 0.6 * s;
  torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.62 * s; torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.145 * s, 16, 12), std(skin, 0.65));
  skull.scale.set(0.95, 1.08, 0.98);
  skull.position.y = 0.12 * s; skull.castShadow = true;
  head.add(skull);
  /* hair — a cap over the crown, face stays open */
  const hairM = std(hairCol, 0.95);
  const capHair = new THREE.Mesh(new THREE.SphereGeometry(0.152 * s, 14, 10), hairM);
  capHair.scale.set(1.0, 0.92, 1.02);
  capHair.position.set(0, 0.165 * s, -0.028 * s);
  head.add(capHair);
  if (o.female) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.062 * s, 10, 8), hairM);
    bun.position.set(0, 0.24 * s, -0.1 * s);
    head.add(bun);
    for (const sx of [-1, 1]) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 8, 6), hairM);
      tuft.scale.set(0.7, 1.3, 0.9);
      tuft.position.set(sx * 0.125 * s, 0.07 * s, 0.015 * s);
      head.add(tuft);
    }
  } else if (!o.hat || o.hat === "none") {
    for (const [tx, tz] of [[0, 0.02], [-0.06, -0.01], [0.06, -0.01]] as [number, number][]) {
      const spike = new THREE.Mesh(new THREE.SphereGeometry(0.048 * s, 8, 6), hairM);
      spike.position.set(tx * s, 0.27 * s, tz * s);
      head.add(spike);
    }
  }
  /* face */
  const eyeM = std(0x241d18, 0.4);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016 * s, 6, 5), eyeM);
    eye.position.set(sx * 0.05 * s, 0.125 * s, 0.128 * s);
    head.add(eye);
  }
  if (o.hat === "straw") {
    const brim = new THREE.Mesh(new THREE.ConeGeometry(0.32 * s, 0.13 * s, 12), std(0xd9c07a, 1));
    brim.position.y = 0.26 * s;
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.17 * s, 0.12 * s, 12), std(0xcbb26e, 1));
    top.position.y = 0.33 * s;
    head.add(brim, top);
  }
  if (o.hat === "cap") {
    const capG = new THREE.Mesh(new THREE.SphereGeometry(0.155 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x39506b));
    capG.position.y = 0.17 * s;
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.16 * s, 0.02 * s, 10, 1, false, -0.9, 1.8), std(0x39506b));
    visor.position.set(0, 0.175 * s, 0.06 * s);
    head.add(capG, visor);
  }

  /* arms: shoulder → elbow → hand */
  const armL = limb(torso, 0.05, 0.2, std(o.shirt), -0.225, 0.52, 0);
  const armR = limb(torso, 0.05, 0.2, std(o.shirt), 0.225, 0.52, 0);
  const foreL = limb(armL, 0.043, 0.17, std(skin, 0.7), 0, -0.3, 0);
  const foreR = limb(armR, 0.043, 0.17, std(skin, 0.7), 0, -0.3, 0);
  for (const f of [foreL, foreR]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 8, 6), std(skin, 0.7));
    hand.position.y = -0.26 * s;
    f.add(hand);
  }

  /* legs: hip → knee → rounded foot */
  const shinMat = std(o.shorts ? skin : o.pants);
  const legL = limb(hip, 0.075, 0.26, std(o.pants), -0.095, -0.02, 0);
  const legR = limb(hip, 0.075, 0.26, std(o.pants), 0.095, -0.02, 0);
  const shinL = limb(legL, 0.058, 0.26, shinMat, 0, -0.42, 0);
  const shinR = limb(legR, 0.058, 0.26, shinMat, 0, -0.42, 0);
  const shoeM = std(0x3a352c, 0.8);
  for (const sh of [shinL, shinR]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.062 * s, 8, 6), shoeM);
    foot.scale.set(0.85, 0.55, 1.5);
    foot.position.set(0, -0.42 * s, 0.04 * s);
    foot.castShadow = true;
    sh.add(foot);
  }

  root.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; } });
  return { root, hip, torso, head, armL, armR, legL, legR, foreL, foreR, shinL, shinR };
}

function sitPose(r: Rig) {
  r.legL.rotation.x = -1.45; r.legR.rotation.x = -1.45;
  r.shinL.rotation.x = 1.35; r.shinR.rotation.x = 1.35;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}

/* petal texture */
const petalTex = makeCanvasTex(64, 64, (c) => {
  c.clearRect(0, 0, 64, 64);
  c.save();
  c.translate(32, 32);
  c.rotate(0.5);
  const g = c.createRadialGradient(0, 0, 2, 0, 0, 26);
  g.addColorStop(0, "#ffe4ec");
  g.addColorStop(1, "#f2a8be");
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(0, 0, 22, 14, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
});
const smokeTex = makeCanvasTex(64, 64, (c) => {
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(220,220,225,0.5)");
  g.addColorStop(1, "rgba(220,220,225,0)");
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
});

/* ---------------- particle pool ---------------- */
class Pool {
  geo: THREE.BufferGeometry; pts: THREE.Points;
  pos: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array;
  size: Float32Array; spin: Float32Array;
  n: number; cursor = 0;
  gravity = 0; wind = 0; turb = 0; baseSize = 0.2;

  constructor(scene: THREE.Scene, n: number, tex: THREE.Texture, opts: { gravity?: number; wind?: number; turb?: number; size?: number; opacity?: number; color?: number; additive?: boolean } = {}) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.size = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.gravity = opts.gravity ?? 0;
    this.wind = opts.wind ?? 0;
    this.turb = opts.turb ?? 0;
    this.baseSize = opts.size ?? 0.2;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute("aSpin", new THREE.BufferAttribute(this.spin, 1));
    this.geo.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTex: { value: tex },
        uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
        uOp: { value: opts.opacity ?? 1 },
      },
      vertexShader: `attribute float aSize; attribute float aSpin; attribute float aLife;
        varying float vLife; varying float vSpin;
        void main(){ vLife = aLife; vSpin = aSpin;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uColor; uniform float uOp;
        varying float vLife; varying float vSpin;
        void main(){
          vec2 uv = gl_PointCoord - 0.5;
          float cs = cos(vSpin), sn = sin(vSpin);
          uv = mat2(cs, -sn, sn, cs) * uv + 0.5;
          vec4 t = texture2D(uTex, uv);
          float fade = smoothstep(0.0, 0.12, vLife) * smoothstep(1.0, 0.75, vLife);
          gl_FragColor = vec4(uColor, t.a * vOp * fade);
          if (gl_FragColor.a < 0.01) discard; }`,
    });
    this.pts = new THREE.Points(this.geo, mat);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life;
    this.size[i] = this.baseSize * size;
    this.spin[i] = Math.random() * 6.28;
  }

  update(dt: number, t: number, windX: number, sink = false) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.vel[i * 3 + 1] += this.gravity * dt;
      if (this.turb > 0) {
        this.vel[i * 3] += Math.sin(t * 2.1 + i * 0.7) * this.turb * dt;
        this.vel[i * 3 + 2] += Math.cos(t * 1.7 + i * 1.1) * this.turb * dt;
      }
      this.pos[i * 3] += (this.vel[i * 3] + windX * this.wind) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.spin[i] += dt * (1.5 + (i % 5) * 0.4);
      if (sink && this.pos[i * 3 + 1] < heightAt(this.pos[i * 3], this.pos[i * 3 + 2]) - 0.05 && this.gravity < 0) {
        this.life[i] = Math.min(this.life[i], 0.3);
      }
      this.size[i] = this.baseSize * (this.life[i] / this.max[i] > 0.9 ? (1 - this.life[i] / this.max[i]) * 10 : 1);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSpin as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ---------------- the boy ---------------- */
export class Boy {
  rig: Rig;
  private prevT = 0;
  speed = 0;
  private phase = 0;
  private yaw = 0;
  onStep: (wood: boolean) => void = () => { };
  private lastStepSide = 1;
  private world: World;

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;
    this.rig = makeRig({ shirt: 0x4e6e9e, pants: 0x8a7a5a, scale: 0.82, hat: "none", hair: 0x241f1a, shorts: true });
    /* little backpack */
    const pack = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.16, 4, 8), std(0xb23a24));
    pack.position.set(0, 0.34, -0.19);
    this.rig.torso.add(pack);
    scene.add(this.rig.root);
  }

  update(dt: number, clock: number, t: number, boyT: number) {
    const curve = this.world.pathCurve;
    const bt = clamp(boyT, 0.0001, 0.9999);
    const p = curve.getPointAt(bt);
    const tan = curve.getTangentAt(bt);
    this.rig.root.position.copy(p);
    this.rig.root.position.y = heightAt(p.x, p.z);

    const pathLen = 205;
    const rawSpeed = ((boyT - this.prevT) / Math.max(dt, 1e-4)) * pathLen;
    this.prevT = boyT;
    this.speed = lerp(this.speed, clamp(Math.abs(rawSpeed), 0, 4.5), clamp(dt * 8, 0, 1));

    /* face travel direction when moving */
    if (this.speed > 0.15) {
      const target = Math.atan2(tan.x, tan.z);
      this.yaw = lerpAngle(this.yaw, target, clamp(dt * 7, 0, 1));
    }
    /* during the square, glance toward the village (pointer gives life) */
    const squareW = bell(S.t, 0.79, 0.05);
    const finalW = bell(S.t, 0.965, 0.05);
    this.rig.root.rotation.y = this.yaw + S.mx * 0.35 * (squareW + finalW);

    const r = this.rig;
    const sp = this.speed;
    this.phase += sp * dt * 3.4;
    const swing = Math.sin(this.phase) * clamp(sp / 2.6, 0, 1) * 0.62;
    const breathe = Math.sin(clock * 1.9) * 0.02;

    /* cues, scrubbable */
    const waveW = bell(S.t, 0.305, 0.018);
    const nodW = Math.max(bell(S.t, 0.403, 0.011), bell(S.t, 0.668, 0.012));
    const bowW = bell(S.t, 0.785, 0.015);
    const lookUpW = bell(S.t, 0.515, 0.022);

    r.legL.rotation.x = swing;
    r.legR.rotation.x = -swing;
    r.shinL.rotation.x = Math.max(0, -Math.sin(this.phase + 0.9)) * clamp(sp / 2.6, 0, 1) * 0.7;
    r.shinR.rotation.x = Math.max(0, Math.sin(this.phase + 0.9)) * clamp(sp / 2.6, 0, 1) * 0.7;
    r.armL.rotation.x = -swing * 0.85;
    r.armR.rotation.x = swing * 0.85 * (1 - waveW) + waveW * (-2.5 + Math.sin(clock * 9) * 0.35 * waveW);
    r.armR.rotation.z = waveW * -0.4;
    r.foreR.rotation.x = waveW * -0.4;
    r.hip.position.y = 0.95 * 0.82 + Math.abs(Math.cos(this.phase)) * clamp(sp / 2.6, 0, 1) * 0.05 + breathe * 0.2;
    r.torso.rotation.x = breathe + clamp(sp / 3.4, 0, 1) * 0.08 + bowW * 0.55;
    r.head.rotation.x = breathe * 0.6 - lookUpW * 0.85 - bowW * 0.2 + nodW * Math.sin(S.t * 400) * 0.06;
    r.head.rotation.y = lookUpW * 0.15 + waveW * 0.3;

    /* footsteps */
    const side = Math.sin(this.phase) > 0 ? 1 : -1;
    if (side !== this.lastStepSide && sp > 0.4) {
      this.lastStepSide = side;
      const surf = this.world.constructor === World ? surfAt(p.x, p.z) : "grass";
      this.onStep(surf === "wood");
    }
  }
}

import { surfaceAt as surfAt } from "./world";

/* ---------------- choreographed NPCs ---------------- */
interface Cue { wave?: number; nod?: number; bow?: number; look?: number }

export class Villager {
  rig: Rig;
  x: number; z: number; baseYaw: number;
  kind: string;
  phase: number;
  prop?: THREE.Object3D;

  constructor(scene: THREE.Scene, x: number, z: number, yaw: number, kind: string,
    opts: RigOpts) {
    this.x = x; this.z = z; this.baseYaw = yaw; this.kind = kind;
    this.phase = Math.random() * 9;
    this.rig = makeRig(opts);
    this.rig.root.position.set(x, heightAt(x, z), z);
    this.rig.root.rotation.y = yaw;
    scene.add(this.rig.root);
  }

  update(dt: number, clock: number, cue: Cue, boyPos: THREE.Vector3) {
    const r = this.rig;
    const p = this.phase + clock;
    const stoop = (r.torso.userData.stoop as number) ?? 0;
    const breathe = Math.sin(p * 1.7) * 0.02;
    r.torso.rotation.x = stoop + breathe;
    r.head.rotation.x = breathe * 0.5;
    r.armL.rotation.x = 0; r.armR.rotation.x = 0;
    r.armL.rotation.z = 0.04; r.armR.rotation.z = -0.04;

    const dx = boyPos.x - this.x, dz = boyPos.z - this.z;
    const yawToBoy = Math.atan2(dx, dz);
    const lookW = cue.look ?? 0;

    switch (this.kind) {
      case "water": {
        /* Haru: waters flowers; stops, turns, waves, returns */
        const act = 1 - lookW - (cue.wave ?? 0);
        r.torso.rotation.x += 0.28 * act;
        r.armR.rotation.x = (-0.9 + Math.sin(p * 2.6) * 0.22) * act;
        r.armR.rotation.z = -0.3 * act;
        r.head.rotation.x += 0.25 * act;
        r.root.rotation.y = lerpAngle(r.root.rotation.y, lookW > 0.02 ? yawToBoy : this.baseYaw, dt * 3.5);
        r.head.rotation.y = 0;
        r.armR.rotation.x += (cue.wave ?? 0) * (-2.4 + Math.sin(clock * 8.5) * 0.4);
        r.armR.rotation.z += (cue.wave ?? 0) * -0.35;
        break;
      }
      case "repair": {
        /* Gen: bent over a bicycle; looks up, nods, returns */
        const act = 1 - lookW;
        r.torso.rotation.x += 0.5 * act;
        r.armL.rotation.x = (-0.7 + Math.sin(p * 5.2) * 0.12) * act;
        r.armR.rotation.x = (-0.6 + Math.cos(p * 5.2) * 0.12) * act;
        r.head.rotation.x += 0.3 * act + (cue.nod ?? 0) * Math.sin(clock * 7) * 0.22;
        r.root.rotation.y = lerpAngle(r.root.rotation.y, lookW > 0.02 ? yawToBoy : this.baseYaw, dt * 3.5);
        break;
      }
      case "basket": {
        /* Kōsaku: carries a basket; raises it slightly in greeting */
        const lift = cue.nod ?? 0;
        r.armL.rotation.x = -0.75; r.armR.rotation.x = -0.75;
        r.foreL.rotation.x = -0.5 - lift * 0.5; r.foreR.rotation.x = -0.5 - lift * 0.5;
        r.root.rotation.y = lerpAngle(r.root.rotation.y, lift > 0.02 ? yawToBoy : this.baseYaw, dt * 3);
        r.head.rotation.x = -lift * 0.1 + Math.sin(p * 1.3) * 0.04;
        /* slow step in place */
        const st = Math.sin(p * 1.4) * 0.06;
        r.legL.rotation.x = st; r.legR.rotation.x = -st;
        break;
      }
      case "shopkeep": {
        /* Miyo: arranges flowers; bows in greeting */
        const bow = cue.bow ?? 0;
        const act = 1 - bow;
        r.armL.rotation.x = (-0.5 + Math.sin(p * 2.1) * 0.2) * act;
        r.armR.rotation.x = (-0.6 + Math.cos(p * 2.1) * 0.2) * act;
        r.torso.rotation.x += bow * 0.5 + 0.1 * act;
        r.root.rotation.y = lerpAngle(r.root.rotation.y, bow > 0.02 ? yawToBoy : this.baseYaw, dt * 3.5);
        break;
      }
      case "tend": {
        /* Nana: tends the planter */
        r.torso.rotation.x += 0.22;
        r.armR.rotation.x = -0.7 + Math.sin(p * 2.4) * 0.18;
        r.head.rotation.x += 0.2;
        r.root.rotation.y = lerpAngle(r.root.rotation.y, lookW > 0.02 ? yawToBoy : this.baseYaw, dt * 3);
        break;
      }
      default: {
        /* idle villager: weight shift + glance */
        r.hip.rotation.z = Math.sin(p * 0.9) * 0.03;
        r.armL.rotation.x = Math.sin(p * 1.1) * 0.06;
        r.armR.rotation.x = -Math.sin(p * 1.1) * 0.06;
        r.root.rotation.y = lerpAngle(r.root.rotation.y, lookW > 0.02 ? yawToBoy : this.baseYaw, dt * 3);
      }
    }
  }
}

/* ---------------- micro-story walkers ---------------- */
class Walker {
  rig: Rig;
  constructor(scene: THREE.Scene, o: RigOpts, private carry?: "grocery") {
    this.rig = makeRig(o);
    if (carry === "grocery") {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.18), std(0xe8e2d2));
      bag.position.y = -0.52;
      this.rig.foreL.add(bag);
      const bag2 = bag.clone();
      this.rig.foreR.add(bag2);
      this.rig.armL.rotation.x = -0.35;
      this.rig.armR.rotation.x = -0.35;
    }
    scene.add(this.rig.root);
  }
  walk(dt: number, clock: number, ax: number, az: number, bx: number, bz: number, period: number, offset: number) {
    /* there-and-back with natural pauses at each end */
    const u = (Math.sin((clock / period) * Math.PI * 2 + offset) + 1) / 2;
    const e = u * u * (3 - 2 * u);
    const x = lerp(ax, bx, e), z = lerp(az, bz, e);
    const moving = Math.abs(Math.cos((clock / period) * Math.PI * 2 + offset)) > 0.22;
    this.rig.root.position.set(x, heightAt(x, z), z);
    const yaw = Math.atan2(bx - ax, bz - az) + (u > 0.5 ? Math.PI : 0);
    this.rig.root.rotation.y = lerpAngle(this.rig.root.rotation.y, yaw, dt * 4);
    const ph = clock * 6 + offset;
    const sw = moving ? Math.sin(ph) * 0.55 : 0;
    this.rig.legL.rotation.x = sw;
    this.rig.legR.rotation.x = -sw;
    if (!this.carry) {
      this.rig.armL.rotation.x = -sw * 0.8;
      this.rig.armR.rotation.x = sw * 0.8;
    }
    this.rig.hip.position.y = 0.95 * (this.rig.root.scale.y || 1) + Math.abs(Math.cos(ph)) * (moving ? 0.04 : 0);
  }
}

class SeatedPair {
  a: Rig; b: Rig;
  constructor(scene: THREE.Scene, x: number, z: number, yaw: number) {
    this.a = makeRig({ shirt: 0x86a868, pants: 0x4a4a52, elder: true, hat: "straw" });
    this.b = makeRig({ shirt: 0xb8685a, pants: 0x37413c, female: true, elder: true });
    for (const [rig, off] of [[this.a, -0.45], [this.b, 0.45]] as [Rig, number][]) {
      rig.root.position.set(x + Math.cos(yaw) * off, heightAt(x, z) + 0.02, z - Math.sin(yaw) * off);
      rig.root.rotation.y = yaw + Math.PI;
      rig.hip.position.y = 0.58; /* seated on the bench */
      sitPose(rig);
      scene.add(rig.root);
    }
  }
  update(clock: number) {
    /* asynchronous conversation: nods and gestures */
    this.a.head.rotation.x = Math.max(0, Math.sin(clock * 1.3)) * 0.18;
    this.b.head.rotation.x = Math.max(0, Math.sin(clock * 1.7 + 2)) * 0.15;
    this.b.armR.rotation.x = -0.5 + Math.sin(clock * 0.9) * 0.3 * (Math.sin(clock * 0.23) > 0 ? 1 : 0.1);
    this.b.armR.rotation.z = -0.25;
    this.a.armL.rotation.x = -0.25;
  }
}

class ChildChase {
  rig: Rig;
  constructor(scene: THREE.Scene) {
    this.rig = makeRig({ shirt: 0xe8c33a, pants: 0x39506b, scale: 0.62, hat: "cap" });
    scene.add(this.rig.root);
  }
  update(dt: number, clock: number, cx: number, cz: number) {
    /* dash, stop, dash — children don't orbit smoothly */
    const a = clock * 0.85 + Math.sin(clock * 0.4) * 1.4;
    const r = 2.1 + Math.sin(clock * 0.6) * 0.5;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const moving = Math.cos(clock * 0.4) > -0.55;
    this.rig.root.position.set(x, heightAt(x, z), z);
    const nx = cx + Math.cos(a + 0.3) * r, nz = cz + Math.sin(a + 0.3) * r;
    this.rig.root.rotation.y = lerpAngle(this.rig.root.rotation.y, Math.atan2(nx - x, nz - z), dt * 6);
    const ph = clock * 10;
    const sw = moving ? Math.sin(ph) * 0.8 : 0;
    this.rig.legL.rotation.x = sw; this.rig.legR.rotation.x = -sw;
    this.rig.armL.rotation.x = -2.2; this.rig.armR.rotation.x = -2.2;
    this.rig.armL.rotation.z = 0.3; this.rig.armR.rotation.z = -0.3;
  }
}

class Cat {
  root = new THREE.Group();
  tail!: THREE.Object3D;
  headG!: THREE.Object3D;
  constructor(scene: THREE.Scene, x: number, z: number) {
    const m = std(0xe8dcc8, 0.9);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), m);
    body.scale.set(1.25, 0.62, 0.8);
    body.position.y = 0.2;
    body.castShadow = true;
    this.headG = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), m);
    head.position.set(0.34, 0.1, 0);
    head.scale.set(1.1, 0.95, 0.95);
    const earG = new THREE.ConeGeometry(0.05, 0.09, 4);
    const e1 = new THREE.Mesh(earG, m); e1.position.set(0.3, 0.24, 0.07);
    const e2 = new THREE.Mesh(earG, m); e2.position.set(0.3, 0.24, -0.07);
    this.headG.add(head, e1, e2);
    this.tail = new THREE.Group();
    const tailM = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.5, 5), m);
    tailM.position.y = 0.25; tailM.rotation.x = 0.5;
    this.tail.add(tailM);
    this.tail.position.set(-0.34, 0.12, 0.1);
    this.root.add(body, this.headG, this.tail);
    this.root.position.set(x, heightAt(x, z), z);
    this.root.rotation.y = 2.4;
    scene.add(this.root);
  }
  update(clock: number) {
    /* asleep in the sun — tail flicks, ears track the visitor's pointer */
    this.tail.rotation.y = Math.sin(clock * 0.8) * 0.4 + (Math.sin(clock * 0.13) > 0.86 ? Math.sin(clock * 9) * 0.5 : 0);
    this.headG.rotation.y = lerp(this.headG.rotation.y, clamp(S.mx, -1, 1) * 0.5, 0.04);
    this.headG.rotation.x = Math.sin(clock * 0.6) * 0.03;
  }
}

class Bird {
  group = new THREE.Group();
  private wings: THREE.Object3D[] = [];
  constructor(scene: THREE.Scene, n: number, y: number, radius: number, speed: number, cx: number, cz: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3a4450 });
    for (let i = 0; i < n; i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 4), mat);
      body.rotation.x = Math.PI / 2;
      const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), mat);
      w1.position.x = 0.28;
      const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), mat);
      w2.position.x = -0.28;
      b.add(body, w1, w2);
      b.position.set((hash2(i, y) - 0.5) * 6, (hash2(i, 3) - 0.5) * 2.5, (hash2(i, 7) - 0.5) * 6);
      this.wings.push(w1, w2);
      this.group.add(b);
    }
    this.group.position.set(cx, y, cz);
    (this as any).rad = radius; (this as any).spd = speed; (this as any).cx = cx; (this as any).cz = cz;
    scene.add(this.group);
  }
  update(clock: number) {
    const r = (this as any).rad, sp = (this as any).spd;
    const a = clock * sp;
    this.group.position.x = (this as any).cx + Math.cos(a) * r;
    this.group.position.z = (this as any).cz + Math.sin(a) * r * 0.6;
    this.group.rotation.y = -a + Math.PI / 2;
    const f = Math.sin(clock * 9) * 0.6;
    for (let i = 0; i < this.wings.length; i++) {
      this.wings[i].rotation.y = (i % 2 ? -1 : 1) * f;
    }
  }
}

class Flutter {
  group = new THREE.Group();
  private w1!: THREE.Mesh; private w2!: THREE.Mesh;
  constructor(scene: THREE.Scene, x: number, y: number, z: number, color: number) {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this.w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.1), mat);
    this.w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.1), mat);
    this.w1.position.x = 0.07; this.w2.position.x = -0.07;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4),
      new THREE.MeshBasicMaterial({ color: 0x2c2c30 }));
    body.rotation.x = Math.PI / 2;
    this.group.add(this.w1, this.w2, body);
    (this as any).base = new THREE.Vector3(x, y, z);
    (this as any).ph = Math.random() * 9;
    this.group.position.set(x, y, z);
    scene.add(this.group);
  }
  update(clock: number, lead = 0, target?: THREE.Vector3) {
    const b = (this as any).base as THREE.Vector3;
    const ph = (this as any).ph as number;
    let x = b.x + Math.sin(clock * 0.9 + ph) * 1.6 + Math.sin(clock * 2.3 + ph) * 0.5;
    let z = b.z + Math.cos(clock * 0.7 + ph) * 1.4;
    let y = b.y + Math.sin(clock * 1.8 + ph) * 0.5;
    if (target) {
      x = target.x + Math.sin(clock * 2.1) * 1.1 + lead;
      z = target.z + Math.cos(clock * 1.9) * 1.0;
      y = target.y + 1.1 + Math.sin(clock * 2.6) * 0.3;
    }
    this.group.position.set(x, y, z);
    const f = Math.sin(clock * 16 + ph) * 0.9;
    this.w1.rotation.y = f; this.w2.rotation.y = -f;
  }
}

class Dragonfly {
  group = new THREE.Group();
  constructor(scene: THREE.Scene, x: number, z: number) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.4, 4),
      new THREE.MeshStandardMaterial({ color: 0x4a9db8, roughness: 0.3, metalness: 0.4 }));
    body.rotation.x = Math.PI / 2;
    const wm = new THREE.MeshBasicMaterial({ color: 0xdfeef2, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    for (const [wx, wz] of [[0.1, 0.08], [-0.1, 0.08], [0.1, -0.08], [-0.1, -0.08]] as [number, number][]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), wm);
      w.position.set(wx, 0.02, wz);
      this.group.add(w);
    }
    this.group.add(body);
    (this as any).base = new THREE.Vector3(x, 1.2, z);
    (this as any).ph = Math.random() * 9;
    scene.add(this.group);
  }
  update(clock: number) {
    const b = (this as any).base as THREE.Vector3;
    const ph = (this as any).ph as number;
    this.group.position.set(
      b.x + Math.sin(clock * 1.4 + ph) * 2.4,
      b.y + Math.sin(clock * 3.1 + ph) * 0.35,
      b.z + Math.cos(clock * 1.1 + ph) * 2.0
    );
    this.group.rotation.y = Math.cos(clock * 1.4 + ph) * 0.8;
  }
}

/* cyclist passing behind the shop during the square beat */
class Cyclist {
  rig: Rig; bike = new THREE.Group(); crank = new THREE.Group();
  constructor(scene: THREE.Scene) {
    this.rig = makeRig({ shirt: 0x3d5a80, pants: 0x2c2c34, scale: 0.95, hat: "cap" });
    const frameM = std(0x8a4a3c, 0.5);
    const darkM = std(0x2c2c2c, 0.9);
    /* wheels */
    for (const wx of [-0.62, 0.62]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 14), darkM);
      w.position.set(wx, 0.34, 0);
      this.bike.add(w);
    }
    /* frame tubes: seat tube, down tube, top tube */
    const tube = (ax: number, ay: number, bx: number, by: number) => {
      const len = Math.hypot(bx - ax, by - ay);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, len, 5), frameM);
      t.position.set((ax + bx) / 2, (ay + by) / 2, 0);
      t.rotation.z = Math.atan2(bx - ax, by - ay);
      this.bike.add(t);
    };
    tube(-0.05, 0.38, -0.3, 0.95);   // seat tube
    tube(-0.05, 0.38, 0.55, 0.85);   // down tube
    tube(-0.28, 0.9, 0.52, 0.88);    // top tube
    tube(-0.62, 0.34, -0.05, 0.38);  // chainstay
    tube(-0.62, 0.34, -0.28, 0.9);   // seatstay
    tube(0.62, 0.34, 0.55, 0.85);    // fork
    /* saddle + handlebars */
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.14), darkM);
    saddle.position.set(-0.3, 0.99, 0);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.28, 5), frameM);
    stem.position.set(0.55, 0.99, 0);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.52, 5), darkM);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0.55, 1.12, 0);
    this.bike.add(saddle, stem, grip);
    /* crank + pedals, spinning in the wheel plane */
    this.crank.position.set(-0.05, 0.38, 0);
    const pedalGeo = new THREE.BoxGeometry(0.09, 0.03, 0.16);
    for (const s of [1, -1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 4), darkM);
      arm.position.set(0, s * 0.075, s * 0.1);
      const pedal = new THREE.Mesh(pedalGeo, darkM);
      pedal.position.set(0, s * 0.15, s * 0.1);
      this.crank.add(arm, pedal);
    }
    this.bike.add(this.crank);
    /* wheelbase along the rider's forward axis, saddle under the hips */
    this.bike.rotation.y = -Math.PI / 2;
    this.bike.position.z = 0.3;
    this.rig.root.add(this.bike);
    /* seated on the saddle, leaning to the bars */
    this.rig.hip.position.y = 1.0;
    this.rig.torso.rotation.x = 0.42;
    this.rig.armL.rotation.x = -0.72; this.rig.armR.rotation.x = -0.72;
    this.rig.foreL.rotation.x = -0.35; this.rig.foreR.rotation.x = -0.35;
    this.rig.legL.rotation.x = -1.25; this.rig.legR.rotation.x = -1.25;
    scene.add(this.rig.root);
  }
  update(dt: number, clock: number) {
    /* rides the square road east→west, visible during the square chapter */
    const vis = bell(S.t, 0.83, 0.09);
    this.rig.root.visible = vis > 0.01;
    if (!this.rig.root.visible) return;
    const u = ((clock * 0.045) % 1);
    const x = lerp(52, 14, u), z = 32.8;
    this.rig.root.position.set(x, heightAt(x, z), z);
    this.rig.root.rotation.y = -Math.PI / 2;
    const ph = clock * 7;
    this.crank.rotation.z = ph * 1.6;
    this.rig.legL.rotation.x = -1.25 + Math.sin(ph) * 0.22;
    this.rig.legR.rotation.x = -1.25 - Math.sin(ph) * 0.22;
    this.rig.shinL.rotation.x = 0.95 - Math.sin(ph) * 0.18;
    this.rig.shinR.rotation.x = 0.95 + Math.sin(ph) * 0.18;
  }
}

/* ---------------- entity director ---------------- */
export class Entities {
  boy: Boy;
  haru: Villager; gen: Villager; kosaku: Villager; miyo: Villager; nana: Villager;
  elders: SeatedPair; child: ChildChase; grocer: Walker; biker: Walker;
  cat: Cat; cyclist: Cyclist;
  private petals: Pool; private riverPetals: Pool; private smoke: Pool[] = [];
  private birds: Bird[] = []; private flutters: Flutter[] = []; private flies: Dragonfly[] = [];
  private world: World;
  private petalAcc = 0;

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;
    this.boy = new Boy(scene, world);
    this.boy.onStep = (wood) => audio.step(wood ? "wood" : "grass");

    this.haru = new Villager(scene, -37.6, -29.6, 3.5, "water", { shirt: 0xb8685a, pants: 0x4a4a52, female: true, elder: true });
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.3, 8), std(0x708090, 0.5));
    can.position.y = -0.42;
    this.haru.rig.foreR.add(can);
    /* Gen works at the open front of the bicycle shop, road-side */
    this.gen = new Villager(scene, -11.4, -27.35, -2.77, "repair", { shirt: 0x708090, pants: 0x3d3a30, hat: "cap" });
    /* Kōsaku rests his basket by the paddy path, clear of the river */
    this.kosaku = new Villager(scene, 37.5, 13, -1.57, "basket", { shirt: 0x8a6f4d, pants: 0x37413c, hat: "straw" });
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.34, 8), std(0xc9a86a, 1));
    basket.position.y = -0.5;
    this.kosaku.rig.foreL.add(basket);
    /* Miyo stands under the shop awning, facing the road */
    this.miyo = new Villager(scene, 41.6, 38.9, -1.5, "shopkeep", { shirt: 0x41604a, pants: 0x3d3a30, female: true });
    this.nana = new Villager(scene, 30.4, 49.5, -0.73, "tend", { shirt: 0x9db8d2, pants: 0x4a4a52, female: true });
    const can2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.26, 8), std(0xb23a24, 0.5));
    can2.position.y = -0.46;
    this.nana.rig.foreR.add(can2);

    this.elders = new SeatedPair(scene, 27.5, 41.5, 0.5);
    this.child = new ChildChase(scene);
    this.grocer = new Walker(scene, { shirt: 0xc98a5a, pants: 0x37413c, female: true }, "grocery");
    this.biker = new Walker(scene, { shirt: 0x39506b, pants: 0x2c2c34, hat: "cap" });
    this.cat = new Cat(scene, 40.8, 50.6);
    this.cyclist = new Cyclist(scene);

    this.birds.push(new Bird(scene, 5, 34, 85, 0.12, 0, -10));
    this.birds.push(new Bird(scene, 4, 42, 120, -0.08, 10, 30));
    this.flutters.push(new Flutter(scene, 36.5, 1.4, 46.5, 0xf2e8c8));
    this.flutters.push(new Flutter(scene, 8, 2.2, -12, 0xf2b8c6));
    this.flutters.push(new Flutter(scene, -44, 1.6, -26, 0xdfeef2));
    for (const [fx, fz] of [[20, 24], [46, 23.5], [60, 22]] as [number, number][]) {
      this.flies.push(new Dragonfly(scene, fx, fz));
    }

    this.petals = new Pool(scene, 650, petalTex, { gravity: -0.55, wind: 1, turb: 0.9, size: 0.17, opacity: 0.95 });
    this.riverPetals = new Pool(scene, 90, petalTex, { gravity: 0, wind: 0, turb: 0.15, size: 0.14, opacity: 0.9 });
    for (const [sx, sy, sz] of world.smokeSpots) {
      const p = new Pool(scene, 30, smokeTex, { gravity: 0.5, wind: 0.6, turb: 0.5, size: 1.1, opacity: 0.5 });
      (p as any).spot = [sx, sy, sz];
      this.smoke.push(p);
    }
  }

  /* camera colliders for the cast — the lens must never pass through a person */
  private npcCols: { x: number; y: number; z: number; r: number }[] = [];
  getColliders(): { x: number; y: number; z: number; r: number }[] {
    this.npcCols.length = 0;
    const push = (o: THREE.Object3D, r: number, yOff = 1) => {
      const p = o.position;
      this.npcCols.push({ x: p.x, y: p.y + yOff, z: p.z, r });
    };
    push(this.haru.rig.root, 0.6); push(this.gen.rig.root, 0.6);
    push(this.kosaku.rig.root, 0.6); push(this.miyo.rig.root, 0.6);
    push(this.nana.rig.root, 0.6); push(this.grocer.rig.root, 0.6);
    push(this.biker.rig.root, 0.6); push(this.child.rig.root, 0.5, 0.7);
    push(this.elders.a.root, 0.55, 0.9); push(this.elders.b.root, 0.55, 0.9);
    push(this.cat.root, 0.45, 0.3);
    if (this.cyclist.rig.root.visible) push(this.cyclist.rig.root, 0.7);
    return this.npcCols;
  }

  update(dt: number, clock: number, boyT: number, camPos: THREE.Vector3) {
    const t = S.t;
    const gust = S.gust;

    this.boy.update(dt, clock, t, boyT);
    const bp = this.boy.rig.root.position;

    /* ---- interaction choreography (bell curves ⇒ reversible) ---- */
    this.haru.update(dt, clock, {
      look: bell(t, 0.283, 0.011) * (1 - bell(t, 0.30, 0.017) * 0.4),
      wave: bell(t, 0.30, 0.017),
    }, bp);
    this.gen.update(dt, clock, { look: bell(t, 0.39, 0.012), nod: bell(t, 0.40, 0.012) }, bp);
    this.kosaku.update(dt, clock, { nod: bell(t, 0.665, 0.013) }, bp);
    this.miyo.update(dt, clock, { bow: bell(t, 0.78, 0.014) }, bp);
    this.nana.update(dt, clock, { look: bell(t, 0.84, 0.03) * 0.6 }, bp);

    /* ---- square micro-stories (kept clear of the boy's path) ---- */
    this.elders.update(clock);
    this.child.update(dt, clock, 41.5, 45.5);
    this.grocer.walk(dt, clock, 33, 41.5, 31, 47.5, 11, 0.8);
    this.biker.walk(dt, clock, 24, 42.5, 27, 44.8, 13, 3.4);
    this.cat.update(clock);
    this.cyclist.update(dt, clock);

    /* ---- fauna ---- */
    for (const b of this.birds) b.update(clock);
    this.flutters[0].update(clock, 1.2, this.child.rig.root.position);
    this.flutters[1].update(clock);
    this.flutters[2].update(clock);
    for (const f of this.flies) f.update(clock);

    /* ---- petals: always breathing, exhaling in the gust ---- */
    const windX = 0.7 + gust * 4.2;
    this.petalAcc += dt * (26 + gust * 240);
    while (this.petalAcc > 1) {
      this.petalAcc -= 1;
      const spot = this.world.cherrySpots[Math.floor(Math.random() * this.world.cherrySpots.length)];
      const nearCam = gust > 0.25 && Math.random() < 0.3;
      const x = nearCam ? camPos.x + (Math.random() - 0.5) * 6 : spot[0] + (Math.random() - 0.5) * spot[3] * 2;
      const y = nearCam ? camPos.y + (Math.random() - 0.3) * 3 : spot[1] + (Math.random() - 0.5) * spot[3];
      const z = nearCam ? camPos.z + (Math.random() - 0.5) * 6 : spot[2] + (Math.random() - 0.5) * spot[3] * 2;
      this.petals.spawn(
        x, y, z,
        (Math.random() - 0.3) * 0.5 + gust * 2.2,
        -(0.25 + Math.random() * 0.4),
        (Math.random() - 0.5) * 0.5,
        4 + Math.random() * 5,
        0.7 + Math.random() * 0.7
      );
    }
    this.petals.update(dt, clock, windX, true);

    /* petals on the river, drifting downstream */
    if (Math.random() < dt * 7) {
      const x = 34 - 70 - Math.random() * 30;
      this.riverPetals.spawn(x, -0.93, riverZ(x) + (Math.random() - 0.5) * 6, 1.3 + Math.random() * 0.5, 0, 0, 30, 0.8);
    }
    this.riverPetals.update(dt, clock, 0);

    /* chimney smoke */
    for (const p of this.smoke) {
      const [sx, sy, sz] = (p as any).spot as [number, number, number];
      if (Math.random() < dt * 4) {
        p.spawn(sx + (Math.random() - 0.5) * 0.2, sy, sz + (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.15, 0.5 + Math.random() * 0.3, (Math.random() - 0.5) * 0.15,
          5 + Math.random() * 3, 0.8 + Math.random() * 0.8);
      }
      p.update(dt, clock, 0.5 + gust);
    }
  }
}
