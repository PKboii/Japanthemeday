/* The director: one persistent world, a scroll-driven day, a game camera,
   interactions, quests, memories — scroll is the timeline, WASD is the body. */

import * as THREE from "three";
import { S, Season, Weather, MEMORIES, hourLabel, dayPhase, clamp, lerp, smooth, dist2 } from "./state";
import { World, heightAt, riverX } from "./world";
import { Entities, Rig } from "./entities";
import { audio } from "./audio";

export interface UIState {
  time: string; phase: string; season: Season; weather: Weather;
  rep: number; memories: number; totalMemories: number;
  prompt: string | null;
  dialogue: { name: string; role: string; text: string; last: boolean } | null;
  caption: { title: string; sub: string; o: number } | null;
  festival: boolean; intro: boolean; carrying: string | null;
  questHint: string | null; audioOn: boolean;
  journalOpen: boolean;
}

export interface Hooks {
  onUI: (s: UIState) => void;
  onToast: (text: string, kind?: "info" | "memory" | "quest") => void;
  onPhoto: () => void;
  onMemory: (id: string) => void;
}

const INTRO_PATH: [number, number][] = [[-101, -33], [-82, -24], [-58, -12], [-34, -4], [-10, 2], [4, 8]];
const INTRO_END = 0.13;

const CAPTIONS: [number, string, string][] = [
  [0.0, "HINOMORI 日ノ森", "A day in the valley — scroll to begin the morning"],
  [0.045, "The Hill Path", "Haru walks down toward waking roofs"],
  [0.14, "Morning Chores", "Bread fires, shutters open, the square stretches"],
  [0.26, "Errands & Neighbors", "Everyone has a place to be — walk with them"],
  [0.38, "Terraces at Midday", "Water, green rows, a heron standing guard"],
  [0.5, "The River Keeps Time", "Old bridge, cold water, patient reeds"],
  [0.62, "Golden Hour", "Long shadows lean on warm windows"],
  [0.74, "Lanterns Awake", "The village trades sunlight for paper light"],
  [0.86, "Night Falls Gently", "Stars over the valley, the last train humming home"],
  [0.965, "Home", "Not where he lives — where he belongs"],
];

const NOTICES = [
  "Lost: one red umbrella. Last seen walking toward the river. — Aiko",
  "Festival lanterns need steady hands at dusk. Bring your own thumbs.",
  "The 16:12 train runs on mountain time today. It apologizes.",
  "South farm pumpkins are ripening. Please do not compliment them; they blush.",
  "Bakery: yuzu bread on the first sunny day after rain.",
];

export function createGame(container: HTMLElement, hooks: Hooks) {
  /* ---------- renderer / scene ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xdfe8dc, 70, 360);

  const camera = new THREE.PerspectiveCamera(55, container.clientHeight ? container.clientWidth / container.clientHeight : 1, 0.1, 1000);
  camera.position.set(-112, 24, -20);

  /* ---------- lights ---------- */
  const hemi = new THREE.HemisphereLight(0xbfd8ea, 0x57624a, 0.65);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const moonLight = new THREE.DirectionalLight(0x8aa2cc, 0.0);
  scene.add(moonLight);

  /* ---------- world & entities ---------- */
  const world = new World(scene);
  const ent = new Entities(scene, world);

  /* place player at the hill path start */
  const player = ent.player;
  player.root.position.set(INTRO_PATH[0][0], 0, INTRO_PATH[0][1]);
  player.root.position.y = heightAt(INTRO_PATH[0][0], INTRO_PATH[0][1]);
  player.root.rotation.y = 1.25;

  /* ---------- state ---------- */
  const keys: Record<string, boolean> = {};
  let camYaw = 1.25 + Math.PI + 0.5;
  let camPitch = 0.42;
  const camPos = new THREE.Vector3().copy(camera.position);
  let dragging = false;
  let lastPX = 0, lastPY = 0;
  let moveTarget: THREE.Vector3 | null = null;
  let sitBench: { x: number; z: number } | null = null;
  let sp = 0;              // smoothed scroll progress
  let noticeIdx = 0;
  let uiT = 0;
  let dialog: { npcIdx: number; pages: string[]; page: number; effect?: () => void } | null = null;
  let prompt: { label: string; act: () => void } | null = null;
  let cin = { mode: "" as "" | "valley", t: 0 };
  let gustT = 14;
  let toastId = 0;
  let disposed = false;
  let journalOpen = false;
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpV = new THREE.Vector3();

  const seenCin = { valley: false, bridgeTrain: false, firstSnow: false, festival: false };

  /* ---------- input ---------- */
  const onKey = (e: KeyboardEvent, down: boolean) => {
    keys[e.code] = down;
    if (!down) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      if (S.intro || !S.free) { S.free = true; S.intro = false; moveTarget = null; }
      if (sitBench) { sitBench = null; }
      audio.ensure();
    }
    if (e.code === "KeyE") { doInteract(); }
    if (e.code === "KeyP") { takePhoto(); }
    if (e.code === "KeyJ") { journalOpen = !journalOpen; audio.uiTap(); pushUI(); }
    if (e.code === "Space") { e.preventDefault(); doInteract(); }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.shift = down;
  };
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);

  const el = renderer.domElement;
  el.style.touchAction = "pan-y";
  let downX = 0, downY = 0, downT = 0, moved = 0;
  const pd = (e: PointerEvent) => {
    dragging = true; moved = 0;
    lastPX = downX = e.clientX; lastPY = downY = e.clientY; downT = performance.now();
    audio.ensure();
    el.setPointerCapture(e.pointerId);
  };
  const pm = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
    lastPX = e.clientX; lastPY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    camYaw -= dx * 0.0052;
    camPitch = clamp(camPitch + dy * 0.004, 0.12, 1.15);
  };
  const pu = (e: PointerEvent) => {
    dragging = false;
    const quick = performance.now() - downT < 260 && moved < 8;
    if (quick) {
      if (prompt) { doInteract(); return; }
      /* tap-to-walk */
      const rect = el.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
      groundPlane.constant = -player.root.position.y;
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(groundPlane, hit)) {
        if (dist2(hit.x, hit.z, player.root.position.x, player.root.position.z) < 60) {
          moveTarget = hit;
          S.free = true; S.intro = false;
          if (sitBench) sitBench = null;
        }
      }
    }
  };
  el.addEventListener("pointerdown", pd);
  el.addEventListener("pointermove", pm);
  el.addEventListener("pointerup", pu);

  const onScroll = () => { /* read live in loop */ };
  window.addEventListener("scroll", onScroll, { passive: true });

  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  /* ---------- dialogue / quests ---------- */
  function npcDialogue(i: number) {
    const def = ent.npcs[i].def;
    const h = S.time;
    let pages: string[] = [];
    let effect: (() => void) | undefined;
    const greet = def.lines.find((l) => h >= l.min && h <= l.max)?.text ?? "Hello there.";
    if (def.name === "Hana" && S.questBread === 0 && h > 6.5 && h < 16.5) {
      pages = [greet, "Haru, dear — could you run this anpan to Kenji?", "He's down in the terraces. Tell him it's still warm."];
      effect = () => {
        S.questBread = 1;
        player.props.getObjectByName("bun")!.visible = true;
        hooks.onToast("Carrying a warm anpan to Kenji", "quest");
      };
    } else if (def.name === "Kenji" && S.questBread === 1) {
      pages = ["Oh — from Hana? I can smell the yuzu through the paper.", "You've saved my afternoon. Tell her the paddies are turning gold."];
      effect = () => {
        S.questBread = 2; S.rep += 1;
        player.props.getObjectByName("bun")!.visible = false;
        audio.chime();
        hooks.onToast("Village trust +1 — Kenji smiles into his tea", "quest");
      };
    } else if (def.name === "Aiko" && S.questUmbrella === 0) {
      pages = [greet, "My red umbrella has wandered off again — somewhere by the reeds, I'd wager.", "It likes the river. It always has."];
    } else if (def.name === "Aiko" && S.questUmbrella === 1) {
      pages = ["You found it! It always comes home smelling of river water.", "Thank you, Haru. Mochi seems to approve, and that is rare."];
      effect = () => {
        S.questUmbrella = 2; S.rep += 1;
        player.props.getObjectByName("umb")!.visible = false;
        audio.chime();
        hooks.onToast("Village trust +1 — Aiko laughs like wind chimes", "quest");
      };
    } else if (def.name === "Sato" && ent.train.visible) {
      pages = ["There she is — right on time, as the mountains insist.", "Mind the gap. It's a very small gap, but we respect it."];
    } else {
      pages = [greet];
      if (S.questBread === 1 && def.name !== "Kenji" && Math.random() < 0.4) pages.push("Smells like Hana's anpan. Lucky Kenji.");
      if (S.questUmbrella === 1 && def.name !== "Aiko" && Math.random() < 0.4) pages.push("Is that Aiko's umbrella? That thing travels more than I do.");
    }
    dialog = { npcIdx: i, pages, page: 0, effect };
    audio.uiTap();
    pushUI();
  }

  function doInteract() {
    audio.ensure();
    if (dialog) {
      dialog.page++;
      if (dialog.page >= dialog.pages.length) {
        dialog.effect?.();
        dialog = null;
      }
      audio.uiTap();
      pushUI();
      return;
    }
    prompt?.act();
    pushUI();
  }

  function addMemory(id: string) {
    if (S.memories.includes(id)) return;
    S.memories.push(id);
    hooks.onMemory(id);
    const def = MEMORIES.find((m) => m.id === id);
    if (def) hooks.onToast(`Memory kept — ${def.title}`, "memory");
    audio.chime();
  }

  function takePhoto() {
    audio.ensure();
    audio.shutter();
    hooks.onPhoto();
    const p = player.root.position;
    let got = false;
    for (const s of world.photoSpots) {
      if (dist2(p.x, p.z, s.x, s.z) < 10) {
        if (!S.memories.includes(s.id)) { addMemory(s.id); got = true; }
        else { hooks.onToast("You already keep this view."); got = true; }
        break;
      }
    }
    if (!got) {
      if (S.season === "spring") {
        for (const [cx, cz] of [[8, -15], [-6, -26], [-14, -62], [-33, -78], [118, 4], [62, 24], [-70, 44], [30, -52]] as [number, number][]) {
          if (dist2(p.x, p.z, cx, cz) < 8) { addMemory("blossom"); got = true; break; }
        }
      }
      if (!got && S.season === "winter") { addMemory("snow"); got = true; }
      if (!got && S.season === "autumn" && p.x > -18 && p.x < 52 && p.z > 56 && p.z < 118) { addMemory("fields"); got = true; }
      if (!got && S.season === "summer" && S.night > 0.5 && Math.abs(p.x - riverX(p.z)) < 24) { addMemory("fireflies"); got = true; }
      if (!got) hooks.onToast("A quiet moment — but somewhere special is waiting.");
    }
  }

  /* ---------- interaction scan ---------- */
  function scanInteractions() {
    prompt = null;
    const p = player.root.position;
    let best = 2.9, bestAct: (() => void) | null = null, bestLabel = "";

    if (dialog) { prompt = { label: "Keep listening…", act: doInteract }; return; }

    for (let i = 0; i < ent.npcs.length; i++) {
      const n = ent.npcs[i];
      if (!n.rig.root.visible) continue;
      const d = dist2(p.x, p.z, n.rig.root.position.x, n.rig.root.position.z);
      if (d < best) { best = d; bestLabel = `Talk with ${n.def.name} · ${n.def.role}`; bestAct = () => npcDialogue(i); }
    }
    const catP = ent.cat.position;
    const dCat = dist2(p.x, p.z, catP.x, catP.z);
    if (dCat < 2.1 && dCat < best) {
      best = dCat;
      bestLabel = "Pet Mochi the cat";
      bestAct = () => {
        audio.meow();
        if (S.rep >= 2 && !S.memories.includes("cat")) addMemory("cat");
        else hooks.onToast("Mochi allows exactly one pet. You used it wisely.");
      };
    }
    for (const s of world.interactables) {
      const d = dist2(p.x, p.z, s.x, s.z);
      if (d >= best) continue;
      if (s.kind === "umbrella") {
        if (S.questUmbrella !== 0 || true) {
          if (S.questUmbrella === 2) continue;
          if (d < 2.4) {
            best = d; bestLabel = "Pick up the red umbrella";
            bestAct = () => {
              S.questUmbrella = 1;
              world.umbrellaObj.visible = false;
              player.props.getObjectByName("umb")!.visible = true;
              audio.uiTap();
              hooks.onToast("A red umbrella, smelling faintly of rain", "quest");
            };
          }
        }
      } else if (d < 2.4) {
        best = d;
        if (s.kind === "bench") {
          bestLabel = sitBench ? "Stand up" : "Sit on the bench";
          const sx = s.x, sz = s.z;
          bestAct = () => {
            if (sitBench) { sitBench = null; return; }
            sitBench = { x: sx, z: sz };
            player.root.position.set(sx, heightAt(sx, sz) + 0.66, sz);
            audio.uiTap();
          };
        } else if (s.kind === "vending") {
          bestLabel = "Buy a cold ramune · ¥120";
          bestAct = () => { audio.chime(); hooks.onToast("A cold ramune rolls out. The machine hums, pleased."); };
        } else if (s.kind === "bell") {
          bestLabel = "Ring the shrine bell";
          bestAct = () => {
            audio.bell();
            hooks.onToast("Karan — the ring rolls over the cedars and keeps going.");
            if (S.season === "spring") addMemory("shrine");
          };
        } else if (s.kind === "board") {
          bestLabel = "Read the notices";
          bestAct = () => { noticeIdx = (noticeIdx + 1) % NOTICES.length; hooks.onToast(NOTICES[noticeIdx]); audio.uiTap(); };
        } else if (s.kind === "well") {
          bestLabel = "Peer into the old well";
          bestAct = () => hooks.onToast("Your face looks back, ten years younger and wobbly.");
        } else if (s.kind === "bike") {
          bestLabel = "Admire the bicycle";
          bestAct = () => hooks.onToast("Well-oiled. Satoshi keeps every wheel in the valley honest.");
        } else if (s.kind === "view" || s.kind === "photo") {
          bestLabel = s.label;
          bestAct = () => {
            if (s.id === "lookout") { cin.mode = "valley"; cin.t = 0; }
            else hooks.onToast(s.label + " — press P to keep the moment.");
          };
        }
      }
    }
    if (bestAct) prompt = { label: bestLabel, act: bestAct };
  }

  /* ---------- camera ---------- */
  const camTarget = new THREE.Vector3();
  const camDesired = new THREE.Vector3();
  function updateCamera(dt: number) {
    const p = player.root.position;
    const headY = p.y + 1.6;
    camTarget.set(p.x, headY, p.z);

    /* cinematic: valley reveal */
    let dist = 10.5, pitch = camPitch, yaw = camYaw;
    let blend = 0;
    if (cin.mode === "valley") {
      cin.t += dt / 6.5;
      if (cin.t >= 1) { cin.mode = ""; cin.t = 0; }
      else {
        const k = smooth(Math.min(1, cin.t * 1.4)) * (cin.t > 0.85 ? (1 - cin.t) / 0.15 : 1);
        blend = k;
        yaw = lerp(yaw, 1.25 + Math.PI + Math.sin(cin.t * Math.PI) * 0.55, k);
        pitch = lerp(pitch, 0.3, k);
        dist = lerp(dist, 12.5, k);
        S.cinematic = k;
      }
    } else S.cinematic = 0;

    if (S.intro && !S.free) {
      yaw = 1.25 + Math.PI + 0.55 + sp * 1.6;
      dist = 13;
      pitch = 0.42;
    }

    const cp = Math.cos(pitch);
    const off = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    camDesired.copy(camTarget).addScaledVector(off, dist);
    /* keep above terrain */
    const th = heightAt(camDesired.x, camDesired.z);
    if (camDesired.y < th + 0.8) camDesired.y = th + 0.8;
    /* obstacle clamp */
    for (const o of world.obstacles) {
      const ox = camDesired.x - o.x, oz = camDesired.z - o.z;
      const d2 = ox * ox + oz * oz;
      const rr = o.r + 1.2;
      if (d2 < rr * rr && Math.abs(camDesired.y - heightAt(o.x, o.z)) < 6) {
        const d = Math.sqrt(d2) || 0.001;
        camDesired.x = o.x + (ox / d) * rr;
        camDesired.z = o.z + (oz / d) * rr;
      }
    }
    const damp = 1 - Math.exp(-dt * (dragging ? 14 : 5.2));
    camPos.lerp(camDesired, damp);
    camera.position.copy(camPos);
    tmpV.copy(camTarget);
    tmpV.y += blend * 0.4;
    camera.lookAt(tmpV);
    void camTarget;
  }

  /* ---------- sky & light by hour ---------- */
  const skyTop = new THREE.Color(), skyBot = new THREE.Color(), fogCol = new THREE.Color();
  const DAY_TOP = new THREE.Color("#5f9fd0"), DAY_BOT = new THREE.Color("#dce8d8");
  const GOLD_TOP = new THREE.Color("#4f6f9e"), GOLD_BOT = new THREE.Color("#f2b578");
  const NIGHT_TOP = new THREE.Color("#0b1120"), NIGHT_BOT = new THREE.Color("#232f4a");
  const RAIN_TOP = new THREE.Color("#7d8ea0"), RAIN_BOT = new THREE.Color("#b9c2c4");
  const sunCol = new THREE.Color();

  function updateEnvironment(dt: number, t: number) {
    const h = S.time;
    const el = Math.sin(((h - 6) / 12) * Math.PI);
    const night = smooth(clamp((0.12 - el) / 0.3, 0, 1));
    const dusk = clamp(1 - Math.abs(el - 0.08) / 0.2, 0, 1) * (1 - night);
    S.night = night; S.dusk = dusk;

    const rainy = S.weather !== "clear";
    skyTop.copy(DAY_TOP).lerp(GOLD_TOP, dusk).lerp(NIGHT_TOP, night).lerp(RAIN_TOP, rainy ? 0.55 * (1 - night) : 0);
    skyBot.copy(DAY_BOT).lerp(GOLD_BOT, dusk).lerp(NIGHT_BOT, night).lerp(RAIN_BOT, rainy ? 0.5 * (1 - night) : 0);
    (world as any).skyUniforms.top.value.copy(skyTop);
    (world as any).skyUniforms.bottom.value.copy(skyBot);
    fogCol.copy(skyBot);
    scene.fog!.color.copy(fogCol);
    (scene.fog as THREE.Fog).near = rainy ? 50 : 70;
    (scene.fog as THREE.Fog).far = rainy ? 260 : 360;

    const p = player.root.position;
    const az = ((h - 6) / 12) * Math.PI * 2 + Math.PI * 0.5;
    const sel = Math.max(el, -0.25);
    sun.position.set(p.x + Math.cos(az) * 120 * (sel > 0 ? 1 : 0.4), p.y + 30 + sel * 130, p.z + Math.sin(az) * 120);
    sun.target.position.copy(p);
    sun.intensity = Math.max(0, el) * 1.25 * (rainy ? 0.55 : 1) + dusk * 0.25;
    sunCol.set("#fff4e0").lerp(new THREE.Color("#ffb066"), dusk).lerp(new THREE.Color("#ff8a5a"), dusk * 0.4);
    sun.color.copy(sunCol);
    moonLight.intensity = night * 0.22;
    moonLight.position.set(p.x - 60, p.y + 80, p.z - 40);
    moonLight.target = sun.target;
    hemi.intensity = 0.28 + (1 - night) * 0.42 * (rainy ? 0.7 : 1);
    hemi.color.copy(skyTop).lerp(new THREE.Color("#ffffff"), 0.35);
    ambient.intensity = 0.1 + night * 0.06;

    const sw = (world as any);
    sw.sun.position.set(Math.cos(az) * 330, 20 + sel * 300, Math.sin(az) * 330);
    (sw.sun.material as THREE.SpriteMaterial).opacity = clamp(1 - night * 1.4, 0, 1) * (rainy ? 0.35 : 1);
    sw.moon.position.set(-Math.cos(az) * 300, 40 + night * 220, -Math.sin(az) * 300);
    (sw.moon.material as THREE.SpriteMaterial).opacity = night * (rainy ? 0.3 : 0.9);

    /* weather blends */
    S.wet = lerp(S.wet, S.weather === "rain" ? 1 : 0, dt * 0.5);
    if (S.season !== "winter" && S.weather === "snow") S.snow = lerp(S.snow, 0.35, dt * 0.3);
    else S.snow = lerp(S.snow, S.season === "winter" ? 1 : 0, dt * 0.5);

    world.update(dt, t, night, dusk);
  }

  /* ---------- audio mix ---------- */
  function updateAudio() {
    const p = player.root.position;
    const rd = Math.abs(p.x - riverX(p.z));
    const forest = clamp(1 - dist2(p.x, p.z, -50, -80) / 40, 0, 1) + clamp(1 - dist2(p.x, p.z, -28, -104) / 45, 0, 1);
    const village = clamp(1 - Math.sqrt(p.x * p.x + p.z * p.z) / 65, 0, 1);
    const train = ent.train.visible ? clamp(1 - Math.abs(ent.train.position.x - p.x) / 150, 0, 1) : 0;
    audio.update({ river: clamp(1 - rd / 26, 0, 1), forest: clamp(forest, 0, 1), village, rain: S.weather === "rain" ? 1 : 0, train });
  }

  /* ---------- captions ---------- */
  function currentCaption(): UIState["caption"] {
    let cap: UIState["caption"] = null;
    for (let i = 0; i < CAPTIONS.length; i++) {
      const start = CAPTIONS[i][0];
      const d = sp - start;
      if (d >= 0 && d < 0.055) {
        const o = d < 0.012 ? d / 0.012 : d > 0.04 ? (0.055 - d) / 0.015 : 1;
        cap = { title: CAPTIONS[i][1], sub: CAPTIONS[i][2], o: clamp(o, 0, 1) };
        if (i > 0 || true) break;
      }
    }
    return cap;
  }

  function pushUI() {
    const p = player.root.position;
    let carrying: string | null = null;
    if (S.questBread === 1) carrying = "Warm anpan for Kenji";
    if (S.questUmbrella === 1) carrying = "Aiko's red umbrella";
    let questHint: string | null = null;
    if (S.questBread === 1) questHint = "Kenji is in the rice terraces, south of the square";
    else if (S.questUmbrella === 0 && S.rep === 0 && S.time > 8) questHint = "Aiko sits by her gate on the residential lane — say hello";
    else if (S.questUmbrella === 1) questHint = "Return the umbrella to Aiko";
    hooks.onUI({
      time: hourLabel(S.time), phase: dayPhase(S.time), season: S.season, weather: S.weather,
      rep: S.rep, memories: S.memories.length, totalMemories: MEMORIES.length,
      prompt: prompt?.label ?? null,
      dialogue: dialog ? {
        name: ent.npcs[dialog.npcIdx].def.name,
        role: ent.npcs[dialog.npcIdx].def.role,
        text: dialog.pages[dialog.page],
        last: dialog.page >= dialog.pages.length - 1,
      } : null,
      caption: currentCaption(),
      festival: S.festivalOn, intro: S.intro && !S.free,
      carrying, questHint, audioOn: audio.enabled, journalOpen,
    });
    void p;
  }

  /* ---------- main loop ---------- */
  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    S.clock += dt;

    /* scroll → time */
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const target = clamp(window.scrollY / max, 0, 1);
    sp = lerp(sp, target, 1 - Math.exp(-dt * 3.2));
    S.progress = sp;
    S.time = 6.0 + sp * 16.0;

    /* festival logic */
    const wantFestival = S.season === "summer" && S.time > 19 && S.time < 21.8;
    if (wantFestival && !S.festivalOn) {
      world.setFestival(true);
      if (!seenCin.festival) { seenCin.festival = true; hooks.onToast("Paper lanterns bloom over the square — festival night", "info"); }
    } else if (!wantFestival && S.festivalOn) world.setFestival(false);

    /* intro guidance */
    const input = { x: 0, z: 0, run: !!keys.shift || keys.ShiftLeft === true, sit: false };
    let ix = 0, iz = 0;
    if (keys.KeyW || keys.ArrowUp) iz += 1;
    if (keys.KeyS || keys.ArrowDown) iz -= 1;
    if (keys.KeyA || keys.ArrowLeft) ix -= 1;
    if (keys.KeyD || keys.ArrowRight) ix += 1;

    if (sitBench) {
      input.sit = true;
    } else if (!dialog && (ix !== 0 || iz !== 0)) {
      const cp = Math.cos(camYaw), sn = Math.sin(camYaw);
      const fx = -sn, fz = -cp, rx = cp, rz = -sn;
      let wx = fx * iz + rx * ix, wz = fz * iz + rz * ix;
      const wl = Math.sqrt(wx * wx + wz * wz) || 1;
      input.x = wx / wl; input.z = wz / wl;
      moveTarget = null;
    } else if (!dialog && moveTarget) {
      const p = player.root.position;
      const dx = moveTarget.x - p.x, dz = moveTarget.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.7) moveTarget = null;
      else { input.x = dx / d; input.z = dz / d; }
    } else if (!dialog && S.intro && !S.free) {
      /* guided walk down the hill, driven by scroll */
      const k = clamp(sp / INTRO_END, 0, 1);
      const seg = k * (INTRO_PATH.length - 1);
      const i0 = Math.floor(seg), i1 = Math.min(INTRO_PATH.length - 1, i0 + 1);
      const f = seg - i0;
      const gx = lerp(INTRO_PATH[i0][0], INTRO_PATH[i1][0], f);
      const gz = lerp(INTRO_PATH[i0][1], INTRO_PATH[i1][1], f);
      const p = player.root.position;
      const dx = gx - p.x, dz = gz - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 1.1) { input.x = dx / d; input.z = dz / d; input.run = d > 9; }
      if (sp >= INTRO_END + 0.01) { S.intro = false; S.free = true; }
    }
    if (dialog) { input.x = 0; input.z = 0; }

    const speed = ent.update(dt, t, input, S.night);
    void speed;

    /* cinematic triggers */
    const p = player.root.position;
    if (!seenCin.valley && p.x > -108 && p.x < -99 && p.z > -34 && p.z < -26) {
      seenCin.valley = true;
      cin.mode = "valley"; cin.t = 0;
      hooks.onToast("The lookout — the whole valley fits in one breath", "info");
    }
    if (S.season === "spring" && !S.intro) {
      gustT -= dt;
      if (gustT < 0) {
        gustT = 18 + Math.random() * 14;
        let near = false;
        for (const [cx, cz] of [[8, -15], [-6, -26], [-14, -62], [-33, -78], [118, 4], [62, 24], [-70, 44], [30, -52]] as [number, number][]) {
          if (dist2(p.x, p.z, cx, cz) < 9) { near = true; ent.pools.petal.burst(cx, heightAt(cx, cz) + 4, cz, 90, 2.2, 6); }
        }
        if (near) { S.wind = 1.6; if (!S.memories.includes("blossom")) hooks.onToast("A gust of blossoms — the whole canopy lets go", "info"); }
        else S.wind = 0.9;
      }
    }
    S.wind = lerp(S.wind, 0.5 + (S.weather === "rain" ? 0.4 : 0), dt * 0.4);

    updateEnvironment(dt, t);
    updateCamera(dt);
    scanInteractions();
    updateAudio();

    uiT -= dt;
    if (uiT < 0) { uiT = 0.12; pushUI(); }

    renderer.render(scene, camera);
  }
  frame();
  pushUI();

  /* ---------- public api ---------- */
  const api = {
    setSeason(s: Season) {
      S.season = s;
      world.setSeason(s);
      audio.uiTap();
      if (s === "winter" && !seenCin.firstSnow) {
        seenCin.firstSnow = true;
        hooks.onToast("Snow begins — the village puts on its white coat", "info");
        addMemory("snow");
      }
      if (s === "summer" && S.time > 19) world.setFestival(true);
      pushUI();
    },
    setWeather(w: Weather) {
      S.weather = w;
      audio.uiTap();
      if (w === "rain") hooks.onToast("Rain on the tiles — the village smells of cedar");
      if (w === "snow") hooks.onToast("Soft snow begins to fall");
      if (w === "clear") hooks.onToast("The sky clears over Hinomori");
      pushUI();
    },
    toggleAudio() {
      audio.ensure();
      audio.setEnabled(!audio.enabled);
      pushUI();
    },
    toggleJournal() {
      journalOpen = !journalOpen;
      audio.uiTap();
      pushUI();
    },
    interact: doInteract,
    photo: takePhoto,
    begin() { audio.ensure(); },
    state: S,
  };

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    el.removeEventListener("pointerdown", pd);
    el.removeEventListener("pointermove", pm);
    el.removeEventListener("pointerup", pu);
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
  }

  return { api, dispose };
}

export type GameAPI = ReturnType<typeof createGame>["api"];
export type { Rig };
