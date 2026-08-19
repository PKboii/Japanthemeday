/* The Director: one persistent 3D world, one scroll-scrubbed cinematic
   timeline. Scroll → S.t → camera keys + boy path position + NPC cues.
   Scrolling backward reverses the film; nothing is ever a cut. */

import * as THREE from "three";
import { World, heightAt, riverZ } from "./world";
import { Entities } from "./entities";
import { S, bell, clamp, lerp, piecewise, smooth } from "./state";
import { audio } from "./audio";

interface Hooks {
  onProgress: (t: number) => void;
  onCaption: (idx: number) => void;
  onReady: () => void;
}

export const CAPTIONS: [number, number, string, string][] = [
  [0.04, 0.13, "日", "The village wakes"],
  [0.16, 0.25, "道", "A morning road"],
  [0.28, 0.345, "花", "Haru's flowers"],
  [0.385, 0.435, "輪", "The craftsman"],
  [0.455, 0.55, "桜", "Cherry-blossom lane"],
  [0.575, 0.65, "田", "The paddies wake"],
  [0.685, 0.735, "橋", "Crossing the river"],
  [0.755, 0.815, "店", "The little shop"],
  [0.82, 0.885, "広場", "Village square"],
  [0.90, 0.95, "丘", "The hill above"],
  [0.962, 1.001, "森", "A quiet morning in Hinomori"],
];

/* ---------------- camera choreography ---------------- */
interface Key { t: number; pos: [number, number, number]; look: [number, number, number]; fov: number }
const KEYS: Key[] = [
  { t: 0.000, pos: [-20, 82, 128], look: [14, 2, -8], fov: 38 },         // establishing aerial
  { t: 0.055, pos: [-46, 52, 84], look: [-26, 4, -18], fov: 40 },        // descending
  { t: 0.100, pos: [-54, 6, -2], look: [-70, 2.4, -34], fov: 46 },       // low approach — blossoms sweep the frame edge
  { t: 0.128, pos: [-67, 4.4, -5], look: [-71, 2, -26], fov: 48 },       // blossom wipe
  { t: 0.170, pos: [-72, 2.5, -44], look: [-80, 1.4, -52], fov: 50 },    // the boy at his gate
  { t: 0.210, pos: [-73.6, 2.3, -49.6], look: [-60, 1.4, -47], fov: 50 },// follow the road
  { t: 0.260, pos: [-54.6, 2.3, -43.7], look: [-43, 1.4, -37], fov: 50 },
  { t: 0.300, pos: [-33, 2.1, -24], look: [-41, 1.4, -30.5], fov: 48 },  // Haru
  { t: 0.345, pos: [-32.2, 2.2, -31.1], look: [-20, 1.4, -26], fov: 50 },
  { t: 0.400, pos: [-14, 2.1, -15], look: [-11, 1.3, -26], fov: 49 },    // Gen the repairman
  { t: 0.450, pos: [-2.7, 2.3, -16.3], look: [10, 1.5, -11], fov: 50 },  // enter the lane
  { t: 0.520, pos: [8.5, 2.2, -3.5], look: [17, 3.4, -9.5], fov: 50 },   // gust — tilt up into canopy
  { t: 0.575, pos: [16, 5, -1.5], look: [24, 1.2, -26], fov: 46 },       // paddy reveal
  { t: 0.630, pos: [28.5, 2.3, 4.2], look: [32, 1.6, 15], fov: 50 },     // toward the bridge
  { t: 0.665, pos: [26.5, 2.3, 13], look: [36, 1.5, 14], fov: 50 },      // the farmer
  { t: 0.705, pos: [27.5, 2.6, 22.5], look: [35, 1.3, 22], fov: 50 },    // bridge, low side angle
  { t: 0.745, pos: [33, 2.4, 30], look: [39, 1.7, 41], fov: 50 },        // shop ahead over shoulder
  { t: 0.785, pos: [35.5, 2.1, 44], look: [42.5, 1.6, 39.2], fov: 47 },  // Miyo bows
  { t: 0.830, pos: [26, 2.8, 49.5], look: [37.5, 1.4, 42.5], fov: 54 },  // square — wide, parallax
  { t: 0.875, pos: [28.5, 3, 46.5], look: [40, 2.4, 57], fov: 50 },      // leaving for the hill
  { t: 0.915, pos: [39.5, 3, 56.5], look: [51, 7, 65], fov: 48 },        // the climb
  { t: 0.945, pos: [46, 7.5, 60], look: [56, 8.6, 70], fov: 47 },
  { t: 0.975, pos: [50.5, 10.2, 62.5], look: [58, 8.8, 74], fov: 45 },   // summit orbit begins
  { t: 1.000, pos: [-10, 66, 130], look: [16, 2, 0], fov: 37 },          // grand pull-back
];

/* scroll → boy's arc-length position on the route (monotonic; plateaus = beats) */
const BOY_MAP: [number, number][] = [
  [0, 0], [0.175, 0], [0.24, 0.10], [0.30, 0.219], [0.345, 0.28],
  [0.40, 0.357], [0.445, 0.44], [0.50, 0.50], [0.565, 0.505],
  [0.63, 0.63], [0.665, 0.655], [0.71, 0.705], [0.76, 0.776],
  [0.815, 0.782], [0.86, 0.845], [0.93, 0.93], [1, 1],
];

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private ent: Entities;
  private hooks: Hooks;
  private raf = 0;
  private last = performance.now();
  private clock = 0;
  private lastCaption = -2;
  private lastSent = -1;
  private sun: THREE.DirectionalLight;
  private disposed = false;
  private sunSprite!: THREE.Sprite;

  constructor(canvas: HTMLCanvasElement, hooks: Hooks) {
    this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 700);
    this.camera.position.set(...KEYS[0].pos);

    /* morning light */
    this.scene.fog = new THREE.Fog(0xe3ecf0, 130, 470);
    const hemi = new THREE.HemisphereLight(0xcfe2f0, 0xb8c49c, 0.95);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffe9c2, 2.5);
    this.sun.position.set(85, 95, -55);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110;
    sc.near = 10; sc.far = 320;
    this.sun.shadow.bias = -0.0006;
    this.sun.target.position.set(0, 0, 10);
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xbcd4e8, 0.5);
    fill.position.set(-60, 40, 80);
    this.scene.add(fill);

    /* soft sun disc for the morning sky */
    const glowTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const c = cv.getContext("2d")!;
      const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
      g.addColorStop(0, "rgba(255,244,214,1)");
      g.addColorStop(0.4, "rgba(255,238,200,0.55)");
      g.addColorStop(1, "rgba(255,238,200,0)");
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(cv);
      return t;
    })();
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, fog: false, transparent: true, opacity: 0.95, depthWrite: false }));
    this.sunSprite.position.set(210, 185, -160);
    this.sunSprite.scale.setScalar(70);
    this.scene.add(this.sunSprite);

    this.world = new World(this.scene);
    this.ent = new Entities(this.scene, this.world);

    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointer, { passive: true });

    this.last = performance.now();
    this.loop();
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private onPointer = (e: PointerEvent) => {
    S.mx = (e.clientX / window.innerWidth) * 2 - 1;
    S.my = (e.clientY / window.innerHeight) * 2 - 1;
  };

  private readScroll(): number {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    return clamp(window.scrollY / max, 0, 1);
  }

  private camAt(t: number, outPos: THREE.Vector3, outLook: THREE.Vector3): number {
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const u = smooth(clamp((t - a.t) / (b.t - a.t), 0, 1));
    outPos.set(lerp(a.pos[0], b.pos[0], u), lerp(a.pos[1], b.pos[1], u), lerp(a.pos[2], b.pos[2], u));
    outLook.set(lerp(a.look[0], b.look[0], u), lerp(a.look[1], b.look[1], u), lerp(a.look[2], b.look[2], u));
    return lerp(a.fov, b.fov, u);
  }

  private tmpPos = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();
  private smoothPos = new THREE.Vector3(...KEYS[0].pos);
  private smoothLook = new THREE.Vector3(...KEYS[0].look);
  private fov = KEYS[0].fov;

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = clamp((now - this.last) / 1000, 0.001, 0.05);
    this.last = now;
    this.clock += dt;

    /* scroll is the director — damped so it glides, never jerks */
    S.raw = this.readScroll();
    S.t = lerp(S.t, S.raw, 1 - Math.exp(-3.6 * dt));
    if (Math.abs(S.t - S.raw) < 0.0004) S.t = S.raw;
    S.gust = bell(S.t, 0.52, 0.03);

    const boyT = piecewise(BOY_MAP, S.t);

    /* camera from keys + gentle pointer parallax (stronger in the square) */
    const fov = this.camAt(S.t, this.tmpPos, this.tmpLook);
    const minY = heightAt(this.tmpPos.x, this.tmpPos.z) + 0.9;
    if (this.tmpPos.y < minY) this.tmpPos.y = minY;

    /* the camera is a physical object: it may never travel through a trunk,
       a canopy, a wall — or a villager */
    {
      const cast = this.ent.getColliders();
      for (let pass = 0; pass < 2; pass++) {
        for (let ci = 0; ci < this.world.colliders.length + cast.length; ci++) {
          const c = ci < this.world.colliders.length ? this.world.colliders[ci] : cast[ci - this.world.colliders.length];
          const dx = this.tmpPos.x - c.x, dy = this.tmpPos.y - c.y, dz = this.tmpPos.z - c.z;
          const rr = c.r + 0.7;
          if (Math.abs(dx) > rr || Math.abs(dy) > rr || Math.abs(dz) > rr) continue;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(Math.max(d2, 1e-6));
            const push = (rr - d) / d;
            this.tmpPos.x += dx * push;
            this.tmpPos.y += dy * push;
            this.tmpPos.z += dz * push;
          }
        }
      }
      const minY2 = heightAt(this.tmpPos.x, this.tmpPos.z) + 0.7;
      if (this.tmpPos.y < minY2) this.tmpPos.y = minY2;
    }

    const par = S.parallax * (0.55 + bell(S.t, 0.83, 0.07) * 1.7 + bell(S.t, 0.97, 0.05) * 1.2);
    const dir = new THREE.Vector3().subVectors(this.tmpLook, this.tmpPos).normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    this.tmpLook.addScaledVector(right, -S.mx * par * 2.2);
    this.tmpLook.y += S.my * par * 0.9;

    const k = 1 - Math.exp(-6.5 * dt);
    this.smoothPos.lerp(this.tmpPos, k);
    this.smoothLook.lerp(this.tmpLook, k);
    this.fov = lerp(this.fov, fov, k);
    this.camera.position.copy(this.smoothPos);
    this.camera.lookAt(this.smoothLook);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    /* world + cast */
    this.ent.update(dt, this.clock, boyT, this.camera.position);
    this.world.update(dt, this.clock, S.gust);
    audio.update(this.camera.position, riverZ(this.camera.position.x), dt);

    this.renderer.render(this.scene, this.camera);

    /* UI sync */
    if (Math.abs(S.t - this.lastSent) > 0.0012) {
      this.lastSent = S.t;
      this.hooks.onProgress(S.t);
    }
    let cap = -1;
    for (let i = 0; i < CAPTIONS.length; i++) {
      if (S.t >= CAPTIONS[i][0] && S.t <= CAPTIONS[i][1]) { cap = i; break; }
    }
    if (cap !== this.lastCaption) {
      this.lastCaption = cap;
      this.hooks.onCaption(cap);
    }
    if (this.clock > 0.05 && this.clock - dt <= 0.05) this.hooks.onReady();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointer);
    this.renderer.dispose();
  }
}
