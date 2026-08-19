/* Fully procedural WebAudio: ambience beds, spatial-ish volumes, UI/world SFX,
   and a gentle generative koto/music-box score that follows season + time of day. */

import { S } from "./state";

export class AudioMan {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  enabled = true;

  private noiseBuf: AudioBuffer | null = null;
  private beds: Record<string, { gain: GainNode; src: AudioBufferSourceNode | null; filter?: BiquadFilterNode }> = {};
  private lastStep = 0;
  private lastPluck = 0;
  private lastBird = 0;
  private lastCicada = 0;
  private scaleBase = 220;

  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    this.makeBed("wind", 320, 0.0);
    this.makeBed("river", 900, 0.0);
    this.makeBed("village", 1400, 0.0);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.linearRampToValueAtTime(on ? 0.85 : 0, this.ctx.currentTime + 0.4);
    }
  }

  private makeBed(name: string, freq: number, vol: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 0.6;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    this.beds[name] = { gain: g, src, filter: f };
  }

  private bedVol(name: string, v: number) {
    const b = this.beds[name];
    if (!b || !this.ctx) return;
    b.gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(0.5, v)), this.ctx.currentTime + 0.5);
  }

  /* called each frame with listener distances 0..1 (1 = near) */
  update(d: { river: number; forest: number; village: number; rain: number; train: number }) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const h = S.time;
    const day = h > 6 && h < 18.5 ? 1 : 0.25;
    const windy = 0.045 + S.wind * 0.07 + d.forest * 0.03;
    this.bedVol("wind", windy * (S.weather === "clear" ? 1 : 1.4));
    this.bedVol("river", 0.02 + d.river * 0.22);
    this.bedVol("village", d.village * 0.03 * day + d.train * 0.06);
    if (this.beds.wind.filter) {
      this.beds.wind.filter.frequency.value = 260 + Math.sin(t * 0.13) * 120 + S.wind * 220;
    }

    /* birds — mornings, outdoors */
    if (h > 5.6 && h < 18 && day && Math.random() < 0.02 && t - this.lastBird > 2.2) {
      this.lastBird = t;
      this.bird(d.forest * 0.5 + 0.25);
    }
    /* cicadas — summer daytime */
    if (S.season === "summer" && h > 9 && h < 16.5 && t - this.lastCicada > 3.2 && Math.random() < 0.03) {
      this.lastCicada = t;
      this.cicada();
    }
    /* generative score */
    if (t - this.lastPluck > (S.festivalOn ? 1.1 : 2.6)) {
      this.lastPluck = t;
      this.pluckNote();
    }
  }

  private env(dur: number, peak: number): GainNode | null {
    if (!this.ctx || !this.master) return null;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  }

  private tone(freq: number, dur: number, peak: number, type: OscillatorType = "sine", glide = 0) {
    if (!this.ctx) return;
    const g = this.env(dur, peak); if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + glide), this.ctx.currentTime + dur);
    o.connect(g); o.start();
    o.stop(this.ctx.currentTime + dur + 0.05);
  }

  private bird(vol: number) {
    const base = 2100 + Math.random() * 900;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      setTimeout(() => this.tone(base + Math.random() * 500, 0.09, 0.028 * vol, "sine", 700), i * 110);
    }
  }

  private cicada() {
    if (!this.ctx) return;
    const g = this.env(1.6, 0.012); if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth"; o.frequency.value = 4300;
    const am = this.ctx.createGain(); am.gain.value = 0.5;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 42;
    const lg = this.ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(am.gain);
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 4300; f.Q.value = 8;
    o.connect(f); f.connect(am); am.connect(g);
    o.start(); lfo.start();
    o.stop(this.ctx.currentTime + 1.7); lfo.stop(this.ctx.currentTime + 1.7);
  }

  /* koto-ish plucked pentatonic; root drifts with season and hour */
  private pluckNote() {
    const h = S.time;
    const night = h < 6.5 || h > 19;
    const bases: Record<string, number> = { spring: 262, summer: 294, autumn: 220, winter: 196 };
    this.scaleBase = bases[S.season] * (night ? 0.5 : 1);
    const steps = [0, 2, 4, 7, 9, 12, 14, 16];
    const step = steps[Math.floor(Math.random() * steps.length)];
    const f = this.scaleBase * Math.pow(2, step / 12);
    if (Math.random() < 0.72 || S.festivalOn) {
      this.tone(f, night ? 2.6 : 1.8, night ? 0.05 : 0.045, "triangle");
      this.tone(f * 2.005, 1.1, 0.016, "sine");
    }
    if (S.festivalOn && Math.random() < 0.3) this.drum();
  }

  private drum() {
    if (!this.ctx) return;
    const g = this.env(0.3, 0.1); if (!g) return;
    const o = this.ctx.createOscillator();
    o.type = "sine"; o.frequency.setValueAtTime(150, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(55, this.ctx.currentTime + 0.22);
    o.connect(g); o.start(); o.stop(this.ctx.currentTime + 0.35);
  }

  /* ---------------- SFX ---------------- */

  step(surface: "grass" | "dirt" | "stone" | "wood") {
    const now = performance.now();
    if (now - this.lastStep < 190) return;
    this.lastStep = now;
    const cfg = { grass: [700, 0.03], dirt: [420, 0.045], stone: [1150, 0.04], wood: [880, 0.05] }[surface];
    if (!this.ctx || !this.noiseBuf) return;
    const g = this.env(0.09, cfg[1]); if (!g) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cfg[0];
    s.connect(f); f.connect(g); s.start();
    s.stop(this.ctx.currentTime + 0.1);
  }

  bell() { // shrine suzu
    this.tone(880, 2.4, 0.08, "sine");
    this.tone(1318, 1.8, 0.04, "sine");
    this.tone(1760, 1.2, 0.02, "sine");
  }
  chime() { this.tone(1320, 0.4, 0.05, "sine"); this.tone(1980, 0.3, 0.03, "sine"); }
  meow() { this.tone(620, 0.32, 0.05, "sine", 320); }
  quack() { this.tone(330, 0.16, 0.06, "square", -90); }
  shutter() { this.tone(2200, 0.05, 0.05, "square"); this.tone(1100, 0.08, 0.04, "square"); }
  pop() { this.tone(180 + Math.random() * 80, 0.5, 0.12, "sine", -120); }
  trainHorn() {
    this.tone(392, 1.1, 0.055, "sawtooth");
    this.tone(494, 1.1, 0.055, "sawtooth");
  }
  clack(v: number) { this.tone(140, 0.07, 0.03 * v, "square"); }
  uiTap() { this.tone(740, 0.07, 0.03, "sine"); }
}

export const audio = new AudioMan();
