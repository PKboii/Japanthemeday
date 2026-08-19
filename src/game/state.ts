/* HINOMORI — cinematic spring morning. Shared state + tiny math helpers. */

export const S = {
  t: 0,        // smoothed cinematic progress 0..1 (the director)
  raw: 0,      // raw scroll progress
  clock: 0,    // wall seconds
  gust: 0,     // 0..1 cherry-blossom gust intensity
  parallax: 0.7,
  mx: 0, my: 0, // pointer -1..1
};

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
export function smooth5(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
/* bell curve centered at c with half-width w — used to scrub choreography both ways */
export function bell(x: number, c: number, w: number): number {
  const d = Math.abs(x - c) / w;
  return d >= 1 ? 0 : smooth(1 - d);
}
export function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
/* piecewise-linear curve evaluation through [x,y] pairs, monotonic in x */
export function piecewise(pts: [number, number][], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pts[pts.length - 1][1];
}
