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
  [0.155, 0.195, "朝", "A morning road"],
  [0.218, 0.262, "花", "Haru's flowers"],
  [0.330, 0.425, "桜", "Cherry-blossom lane"],
  [0.452, 0.505, "風", "A breath of wind"],
  [0.515, 0.555, "田", "The paddies wake"],
  [0.600, 0.645, "橋", "Crossing the river"],
  [0.700, 0.742, "店", "The little shop"],
  [0.762, 0.815, "広場", "Village square"],
  [0.893, 0.935, "丘", "The hill above"],
  [0.962, 1.001, "森", "A quiet morning in Hinomori"],
];

/* ---------------- camera choreography ---------------- */
interface Key { t: number; pos: [number, number, number]; look: [number, number, number]; fov: number }
const KEYS: Key[] = [
  { t: 0.000, pos: [-20, 82, 128], look: [14, 2, -8], fov: 38 },        // establishing aerial
  { t: 0.055, pos: [-46, 52, 84], look: [-26, 4, -18], fov: 40 },       // descending
  { t: 0.100, pos: [-64, 10, 10], look: [-70, 2.4, -34], fov: 46 },     // low approach
  { t: 0.128, pos: [-67, 4.4, -5], look: [-71, 2, -26], fov: 48 },      // blossom wipe
  { t: 0.160, pos: [-79, 2.6, -56.5], look: [-66, 1.4, -44], fov: 50 }, // the boy at his gate
  { t: 0.195, pos: [-50, 2.3, -38.5], look: [-38, 1.4, -33], fov: 50 }, // follow the road
  { t: 0.230, pos: [-33.5, 2.2, -28.5], look: [-38.5, 1.4, -31], fov: 48 },   // Haru
  { t: 0.275, pos: [-12.5, 2.2, -15.5], look: [-11.5, 1.35, -26], fov: 49 }, // Gen the repairman
  { t: 0.330, pos: [-16, 2.4, -10], look: [-2, 1.6, -20], fov: 50 },    // enter the lane
  { t: 0.400, pos: [3, 2.1, -14.5], look: [19, 1.6, -5], fov: 51 },     // side-track under blossoms
  { t: 0.455, pos: [21, 2.3, -1.5], look: [16.5, 4.2, -8], fov: 50 },   // gust — tilt up into canopy
  { t: 0.505, pos: [43, 5.6, -1], look: [13, 1.2, -22], fov: 46 },      // paddy reveal
  { t: 0.570, pos: [27, 2.3, 25], look: [40, 1.5, 14.5], fov: 50 },     // the farmer at the channel
  { t: 0.605, pos: [42, 2.4, 22], look: [33, 1.8, 21.5], fov: 50 },     // bridge, side angle
  { t: 0.655, pos: [38.5, 2.3, 26.5], look: [34, 1.5, 35], fov: 50 },   // toward the shop
  { t: 0.695, pos: [31, 2.3, 46], look: [40, 1.8, 40], fov: 50 },       // shop ahead over shoulder
  { t: 0.725, pos: [40.5, 2.1, 42.2], look: [44.2, 1.6, 40.6], fov: 47 }, // Miyo bows (close)
  { t: 0.775, pos: [27, 3.4, 50.5], look: [35, 1.5, 43], fov: 53 },     // square — wide, parallax
  { t: 0.830, pos: [31.5, 3, 47.5], look: [42, 2.5, 56], fov: 50 },     // leaving for the hill
  { t: 0.895, pos: [45.5, 5.8, 59], look: [53, 7.5, 68], fov: 48 },     // the climb
  { t: 0.945, pos: [67, 10, 82], look: [44, 5, 26], fov: 44 },          // orbit past him — reveal
  { t: 1.000, pos: [-10, 66, 130], look: [16, 2, 0], fov: 37 },         // grand pull-back
];

/* scroll → boy's arc-length position on the route (monotonic; plateaus = beats) */
const BOY_MAP: [number, number][] = [
  [0, 0], [0.115, 0], [0.155, 0.015], [0.21, 0.222], [0.255, 0.222],
  [0.27, 0.36], [0.305, 0.36], [0.44, 0.507], [0.505, 0.507],
  [0.545, 0.62], [0.575, 0.683], [0.60, 0.683], [0.65, 0.73],
  [0.69, 0.76], [0.705, 0.779], [0.735, 0.779], [0.80, 0.83],
  [0.86, 0.88], [0.93, 0.965], [1, 1],
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
    S.gust = bell(S.t, 0.477, 0.034);

    const boyT = piecewise(BOY_MAP, S.t);

    /* camera from keys + gentle pointer parallax (stronger in the square) */
    const fov = this.camAt(S.t, this.tmpPos, this.tmpLook);
    const minY = heightAt(this.tmpPos.x, this.tmpPos.z) + 0.9;
    if (this.tmpPos.y < minY) this.tmpPos.y = minY;

    const par = S.parallax * (0.55 + bell(S.t, 0.785, 0.07) * 1.7 + bell(S.t, 0.97, 0.05) * 1.2);
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
