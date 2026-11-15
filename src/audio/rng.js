/**
 * Azar determinista. Cada sonido se construye siempre igual para un mismo
 * tempo y una misma semilla, de modo que la escucha y la exportación coinciden.
 *
 * `unitAt` y `noiseAt` permiten pedir la muestra n de un ruido sin recorrer
 * las anteriores; es la base de los siseos, el vinilo y la lluvia.
 */

export function seedFrom(...parts) {
  const text = parts.map((p) => String(p)).join('/');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

export function mix32(x) {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function unitAt(seed, i) {
  return mix32((seed ^ mix32(Math.imul(i | 0, 0x9e3779b1) + 0x632be5ab)) >>> 0) / 4294967296;
}

/** Ruido uniforme en [-1, 1). */
export function noiseAt(seed, i) {
  return unitAt(seed, i) * 2 - 1;
}

export function subSeed(seed, k) {
  return mix32((seed + Math.imul(k + 1, 0x85ebca6b)) >>> 0) || 1;
}

export function createRng(seed) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a = 0, b = 1) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    logRange: (a, b) => a * Math.pow(b / a, next()),
    gauss: () => {
      const u = Math.max(1e-12, next());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}
