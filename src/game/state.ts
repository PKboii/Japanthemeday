/* Shared mutable world state + tiny helpers. One persistent world, one state object. */

export type Season = "spring" | "summer" | "autumn" | "winter";
export type Weather = "clear" | "rain" | "snow";

export interface MemoryDef {
  id: string;
  kanji: string;
  title: string;
  note: string;
  season: Season | "any";
}

export const MEMORIES: MemoryDef[] = [
  { id: "valley", kanji: "谷", title: "The Valley Wakes", note: "Morning mist over Hinomori, seen from the lookout.", season: "any" },
  { id: "blossom", kanji: "桜", title: "First Blossom", note: "A gust carries sakura across the square.", season: "spring" },
  { id: "bridge", kanji: "橋", title: "The Old Bridge", note: "Water remembers every crossing.", season: "any" },
  { id: "shrine", kanji: "森", title: "Shrine in the Cedars", note: "Stone steps, quiet bells, bamboo wind.", season: "any" },
  { id: "train", kanji: "駅", title: "The Little Train", note: "It arrives, it waits, it hums away.", season: "any" },
  { id: "fields", kanji: "稲", title: "Golden Rows", note: "Harvest light standing in the terraces.", season: "autumn" },
  { id: "festival", kanji: "祭", title: "Lantern Night", note: "Paper light, warm voices, one small fireworks flower.", season: "summer" },
  { id: "snow", kanji: "雪", title: "First Snow", note: "The village wears white quietly.", season: "winter" },
  { id: "fireflies", kanji: "蛍", title: "River Lanterns", note: "Tiny lights drift above the water after dusk.", season: "summer" },
  { id: "cat", kanji: "猫", title: "Mochi the Cat", note: "Aiko's neighbor, sunbeam inspector.", season: "any" },
];

export const S = {
  /* time of day in hours, driven by scroll (5.5 → 22) */
  time: 5.6,
  progress: 0,
  season: "spring" as Season,
  weather: "clear" as Weather,
  snow: 0,        // 0..1 accumulation blend
  wet: 0,         // 0..1 rain wetness
  wind: 0.5,      // global wind strength
  night: 0,       // 0..1 darkness factor
  dusk: 0,        // 0..1 golden hour factor

  free: false,    // player took manual control
  intro: true,    // guided opening walk
  cinematic: 0,   // 0..1 cinematic camera blend

  rep: 0,         // village trust
  memories: [] as string[],

  questBread: 0,    // 0 none, 1 carrying, 2 delivered
  questUmbrella: 0, // 0 none, 1 found, 2 returned
  festivalOn: false,

  clock: 0, // elapsed sim seconds
};

export const SEASON_JP: Record<Season, string> = {
  spring: "春", summer: "夏", autumn: "秋", winter: "冬",
};

export const SEASON_EN: Record<Season, string> = {
  spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter",
};

export function hourLabel(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function dayPhase(h: number): string {
  if (h < 6.2) return "Dawn";
  if (h < 10.5) return "Morning";
  if (h < 13.5) return "Midday";
  if (h < 16.5) return "Afternoon";
  if (h < 18.6) return "Golden Hour";
  if (h < 20.2) return "Evening";
  return "Night";
}

/* deterministic pseudo-random */
export function hash2(x: number, y: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
