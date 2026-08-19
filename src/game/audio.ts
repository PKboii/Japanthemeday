/* Generative spring-morning score + spatial ambience, all synthesized.
   The music evolves with the scroll timeline S.t:
   0.00 pad · 0.12 + koto · 0.45 + flute counter-melody · 0.88 the theme opens. */

import { S } from "./state";

function noiseBuffer(ctx: AudioContext, len = 2): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.2;
  }
  return b;
}

/* D major-ish pentatonic, spring and open */
const PENTA = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99];

class AudioEngine {
  private ctx?: AudioContext;
  private master?: GainNode;
  private started = false;
  private muted = false;
  private nextT = 0;
  private stepI = 0;
  private windGain?: GainNode;
  private birdGain?: GainNode;
  private riverGain?: GainNode;
  private padGain?: GainNode;
  private kotoGain?: GainNode;
  private fluteGain?: GainNode;
  private buf?: AudioBuffer;

  init() {
    if (this.started) { this.ctx?.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.started = true;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.buf = noiseBuffer(ctx);

    /* wind bed */
    const ws = ctx.createBufferSource(); ws.buffer = this.buf; ws.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 420; wf.Q.value = 0.4;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    ws.connect(wf).connect(this.windGain).connect(this.master);
    ws.start();

    /* river bed */
    const rs = ctx.createBufferSource(); rs.buffer = this.buf; rs.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = "bandpass"; rf.frequency.value = 900; rf.Q.value = 0.5;
    this.riverGain = ctx.createGain(); this.riverGain.gain.value = 0.0;
    rs.connect(rf).connect(this.riverGain).connect(this.master);
    rs.start();

    /* birds: short chirps on a slow random schedule */
    this.birdGain = ctx.createGain();
    this.birdGain.gain.value = 0.0;
    this.birdGain.connect(this.master);
    const chirpLoop = () => {
      if (!this.ctx) return;
      this.chirp();
      if (Math.random() < 0.4) setTimeout(chirpLoop, 140);
      setTimeout(chirpLoop, 900 + Math.random() * 2600);
    };
    setTimeout(chirpLoop, 800);

    this.padGain = ctx.createGain(); this.padGain.gain.value = 0; this.padGain.connect(this.master);
    this.kotoGain = ctx.createGain(); this.kotoGain.gain.value = 0; this.kotoGain.connect(this.master);
    this.fluteGain = ctx.createGain(); this.fluteGain.gain.value = 0; this.fluteGain.connect(this.master);

    this.nextT = ctx.currentTime + 0.1;
    this.schedule();
  }

  private chirp() {
    if (!this.ctx || !this.birdGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f0 = 2400 + Math.random() * 1600;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.7 + Math.random() * 0.5), t + 0.09);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(this.birdGain);
    o.start(t); o.stop(t + 0.14);
  }

  private pluck(freq: number, t: number, vol: number, dest: GainNode, bright = 1800) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = bright;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    o.connect(f).connect(g).connect(dest);
    o.start(t); o.stop(t + 2);
  }

  private tone(freq: number, t: number, dur: number, vol: number, dest: GainNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.padGain || !this.kotoGain || !this.fluteGain) return;
    const prog = S.t;
    const open = prog > 0.88;
    /* layer gains follow the journey */
    const now = ctx.currentTime;
    this.padGain.gain.setTargetAtTime(0.05, now, 1.2);
    this.kotoGain.gain.setTargetAtTime(prog > 0.12 ? (open ? 0.16 : 0.11) : 0, now, 1.0);
    this.fluteGain.gain.setTargetAtTime(prog > 0.45 ? (open ? 0.12 : 0.07) : 0, now, 1.0);

    while (this.nextT < ctx.currentTime + 0.6) {
      const t = this.nextT;
      /* pad: slow root + fifth, wider at the viewpoint */
      const root = open ? 146.83 : 146.83;
      this.tone(root, t, 5.6, 0.5, this.padGain);
      this.tone(root * 1.5, t, 5.6, 0.3, this.padGain);
      if (open) this.tone(root * 2, t, 5.6, 0.16, this.padGain);

      /* koto motif — sparser and lower at dawn, flowing in the lane, sparse again on the hill */
      const density = prog < 0.2 ? 0.35 : prog < 0.62 ? 0.8 : open ? 0.5 : 0.65;
      const beats = open ? 8 : 6;
      for (let i = 0; i < beats; i++) {
        if (Math.random() > density) continue;
        const idx = Math.floor(Math.pow(Math.random(), 1.4) * (open ? 8 : 6));
        const f = PENTA[idx] * (open && Math.random() < 0.3 ? 2 : 1);
        this.pluck(f, t + i * (open ? 0.75 : 0.55) + Math.random() * 0.08, 0.5 + Math.random() * 0.3, this.kotoGain, open ? 2600 : 1800);
      }
      /* flute answers in the second half */
      if (prog > 0.45 && Math.random() < (open ? 0.9 : 0.6)) {
        const idx = 3 + Math.floor(Math.random() * 4);
        const f = PENTA[idx];
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(f, t + 2);
        o.frequency.linearRampToValueAtTime(f * 1.02, t + 3.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + 2);
        g.gain.linearRampToValueAtTime(0.4, t + 2.7);
        g.gain.linearRampToValueAtTime(0, t + 4.4);
        o.connect(g).connect(this.fluteGain);
        o.start(t + 2); o.stop(t + 4.5);
      }
      this.nextT += open ? 6 : 4.4;
    }
    window.setTimeout(() => this.schedule(), 300);
  }

  /* ambient mix follows camera position + timeline */
  update(cam: { x: number; y: number; z: number }, riverZ: number, dt: number) {
    if (!this.ctx || !this.windGain || !this.birdGain || !this.riverGain) return;
    const t = this.ctx.currentTime;
    const gustBoost = S.gust * 0.14;
    const high = cam.y > 25 ? 0.2 : 0;
    this.windGain.gain.setTargetAtTime(0.045 + gustBoost + high, t, 0.4);
    this.birdGain.gain.setTargetAtTime(cam.y > 40 ? 0.25 : 0.6, t, 0.8);
    const dr = Math.abs(cam.z - riverZ);
    const rv = Math.max(0, 1 - dr / 45);
    this.riverGain.gain.setTargetAtTime(rv * 0.22, t, 0.5);
    void dt;
  }

  step(kind: "grass" | "dirt" | "stone" | "wood") {
    if (!this.ctx || !this.buf || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.buf;
    const f = ctx.createBiquadFilter();
    const cfg = { grass: [700, 0.05], dirt: [500, 0.07], stone: [1500, 0.08], wood: [950, 0.09] }[kind];
    f.type = "bandpass";
    f.frequency.value = cfg[0] * (0.85 + Math.random() * 0.3);
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(cfg[1], t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5, 0.12);
  }

  chime() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.pluck(1318.5, t, 0.25, this.master, 5000);
    this.pluck(1975.5, t + 0.12, 0.16, this.master, 5200);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.1);
    }
    return this.muted;
  }

  get isMuted() { return this.muted; }
}

export const audio = new AudioEngine();
