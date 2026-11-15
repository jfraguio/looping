/**
 * Primitivas DSP de Looping. Todo ocurre en buffers Float32 estéreo a
 * 44,1 kHz: el mismo código alimenta la escucha y la exportación, así que lo
 * que suena es exactamente lo que se descarga.
 *
 * Las bases de filtros, ruido y reverberación están inspiradas en el motor de
 * sen (fraguio.com/sen), adaptadas aquí a un renderizador de un solo pase.
 */

import { noiseAt, unitAt } from './rng.js';

export const TAU = Math.PI * 2;
export const SR = 44100;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const dbToGain = (d) => Math.pow(10, d / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));
export const dbToAmp = dbToGain;

const SINE_SIZE = 4096;
const SINE = new Float32Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) SINE[i] = Math.sin((TAU * i) / SINE_SIZE);

/** Seno de una fase en ciclos. */
export function sineCycle(phase) {
  const p = phase - Math.floor(phase);
  const x = p * SINE_SIZE;
  const i = x | 0;
  return SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i);
}

export function sine(phase) {
  return Math.sin(TAU * phase);
}

/** Corrección polinómica de las discontinuidades de una sierra/squares. */
function polyBlep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export function saw(phase, dt = 0) {
  return 2 * (phase - Math.floor(phase)) - 1 - polyBlep(phase - Math.floor(phase), Math.min(0.45, dt));
}

export function square(phase, dt = 0) {
  const p = phase - Math.floor(phase);
  let y = p < 0.5 ? 1 : -1;
  y += polyBlep(p, Math.min(0.45, dt));
  y -= polyBlep((p + 0.5) % 1, Math.min(0.45, dt));
  return y;
}

export function triangle(phase) {
  const p = phase - Math.floor(phase);
  return 1 - 4 * Math.abs(p - 0.5);
}

/** Tabla de un ciclo a partir de amplitudes armónicas; acelera los coros. */
export function makeWavetable(amps) {
  const size = 2048;
  const table = new Float32Array(size + 1);
  for (let h = 1; h <= amps.length; h++) {
    const a = amps[h - 1];
    if (!a) continue;
    for (let i = 0; i < size; i++) table[i] += a * Math.sin((TAU * h * i) / size);
  }
  let peak = 0;
  for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(table[i]));
  if (peak > 0) for (let i = 0; i < size; i++) table[i] /= peak;
  table[size] = table[0];
  return table;
}

export function tableRead(table, phase) {
  const size = table.length - 1;
  const p = phase - Math.floor(phase);
  const x = p * size;
  const i = x | 0;
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

/* ---------------------------------------------------------------- filtros */

/** Filtro de estado variable TPT: 0 paso bajo, 1 paso alto, 2 banda. */
export class Svf {
  constructor(mode = 0) {
    this.mode = mode;
    this.ic1 = 0;
    this.ic2 = 0;
    this.a1 = 1;
    this.a2 = 0;
    this.a3 = 0;
    this.k = 1.414;
  }
  set(f, q, sr = SR) {
    const fc = clamp(f, 5, sr * 0.49);
    const g = Math.tan((Math.PI * fc) / sr);
    this.k = 1 / Math.max(0.05, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }
  tick(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (this.mode === 0) return v2;
    if (this.mode === 1) return x - this.k * v1 - v2;
    return this.k * v1;
  }
}

/** Paso bajo de un polo. */
export class OnePole {
  constructor() {
    this.y = 0;
    this.a = 1;
  }
  set(f, sr = SR) {
    this.a = 1 - Math.exp((-TAU * clamp(f, 1, sr * 0.49)) / sr);
    return this;
  }
  tick(x) {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/** Biquad RBJ. */
export class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }
  set(type, f, q = 0.707, gainDb = 0, sr = SR) {
    const A = Math.pow(10, gainDb / 40);
    const w = (TAU * clamp(f, 5, sr * 0.49)) / sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else if (type === 'highpass') {
      b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else if (type === 'bandpass') {
      b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    } else if (type === 'peak') {
      b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
    } else if (type === 'lowshelf') {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 - (A - 1) * cs + s); b1 = 2 * A * (A - 1 - (A + 1) * cs); b2 = A * (A + 1 - (A - 1) * cs - s);
      a0 = A + 1 + (A - 1) * cs + s; a1 = -2 * (A - 1 + (A + 1) * cs); a2 = A + 1 + (A - 1) * cs - s;
    } else {
      const s = 2 * Math.sqrt(A) * al;
      b0 = A * (A + 1 + (A - 1) * cs + s); b1 = -2 * A * (A - 1 + (A + 1) * cs); b2 = A * (A + 1 + (A - 1) * cs - s);
      a0 = A + 1 - (A - 1) * cs + s; a1 = 2 * (A - 1 - (A + 1) * cs); a2 = A + 1 - (A - 1) * cs - s;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Elimina la continua que dejan los golpes y las saturaciones. */
export class DCBlock {
  constructor(sr = SR, hz = 18) {
    this.r = 1 - (TAU * hz) / sr;
    this.x1 = 0;
    this.y1 = 0;
  }
  tick(x) {
    const y = x - this.x1 + this.r * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
}

/* ---------------------------------------------------------------- ruido */

export class PinkFilter {
  constructor() {
    this.b = new Float64Array(7);
  }
  tick(w) {
    const b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179;
    b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.969 * b[2] + w * 0.153852;
    b[3] = 0.8665 * b[3] + w * 0.3104856;
    b[4] = 0.55 * b[4] + w * 0.5329522;
    b[5] = -0.7616 * b[5] - w * 0.016898;
    const out = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return out * 0.11;
  }
}

export class BrownFilter {
  constructor() {
    this.y = 0;
  }
  tick(w) {
    this.y = this.y * 0.996 + w * 0.06;
    return this.y;
  }
}

export class ColoredNoise {
  constructor(seed, color = 'rosa', period = 0) {
    this.seed = seed;
    this.period = period;
    this.kind = color === 'blanco' ? 0 : color === 'marron' ? 2 : 1;
    this.pink = new PinkFilter();
    this.brown = new BrownFilter();
  }
  at(i) {
    const w = noiseAt(this.seed, this.period ? i % this.period : i);
    if (this.kind === 0) return w * 0.5;
    if (this.kind === 1) return this.pink.tick(w);
    return this.brown.tick(w);
  }
}

export function smoothRandom(seed, knots = 0) {
  let mean = 0;
  if (knots > 0) {
    for (let k = 0; k < knots; k++) mean += noiseAt(seed, k);
    mean /= knots;
  }
  return (x) => {
    const k = Math.floor(x);
    const f = x - k;
    const ka = knots ? ((k % knots) + knots) % knots : k;
    const kb = knots ? (ka + 1) % knots : k + 1;
    const a = noiseAt(seed, ka) - mean;
    const b = noiseAt(seed, kb) - mean;
    const s = (1 - Math.cos(Math.PI * f)) / 2;
    return a + (b - a) * s;
  };
}

/* ---------------------------------------------------------------- envolventes */

/** Ataque y caída exponencial; `attack` en segundos, `tau` de caída. */
export function pluckEnv(t, attack, tau) {
  if (t < 0) return 0;
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  return a * Math.exp(-t / tau);
}

/** Curva suave de subida y bajada para pads y texturas. */
export function smoothEnv(t, dur, attack, release) {
  if (t < 0 || t > dur) return 0;
  let g = 1;
  if (attack > 0 && t < attack) {
    const x = t / attack;
    g *= Math.sin((Math.PI / 2) * x) ** 2;
  }
  if (release > 0 && t > dur - release) {
    const x = (dur - t) / release;
    g *= Math.sin((Math.PI / 2) * clamp(x, 0, 1)) ** 2;
  }
  return g;
}

export const fadeCurve = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : (Math.pow(1000, x - 1) - 0.001) / 0.999);

export function panGains(pan) {
  const th = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.min(1, Math.SQRT2 * Math.cos(th)), Math.min(1, Math.SQRT2 * Math.sin(th))];
}

/* ---------------------------------------------------------------- color */

export function softClip(x, drive = 1) {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

export function asymSaturate(x, bias = 0.12, drive = 1.35) {
  const b = bias;
  const y = Math.tanh((x + b) * drive) - Math.tanh(b * drive);
  return y / Math.max(1e-6, 1 - Math.tanh(b * drive));
}

export function bitCrush(x, bits = 8, hold = 1) {
  const q = Math.pow(2, bits - 1);
  return Math.round(clamp(x, -1, 1) * q) / q;
}

/* ---------------------------------------------------------------- espacio */

const FDN_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1];
const FDN_L = [1, -1, 1, -1, 1, -1, 1, -1];
const FDN_R = [1, 1, -1, -1, 1, 1, -1, -1];
const DIFF_MS = [4.7, 3.6, 12.7, 9.3];

/**
 * Reverberación FDN de ocho líneas, estéreo y con amortiguación. Se usa por
 * sonido (cada familia tiene su propia habitación) y nunca en tiempo real.
 */
export class Freeverb {
  constructor(sr = SR, { size = 0.6, decay = 2.5, damping = 5200, predelay = 0.018, lowcut = 110 } = {}) {
    this.sr = sr;
    const scale = 0.5 + clamp(size, 0, 1);
    this.lines = FDN_MS.map((ms) => new Float32Array(Math.ceil((ms * 1.6 * sr) / 1000) + 4));
    this.w = new Int32Array(8);
    this.delay = new Float64Array(8);
    this.gain = new Float64Array(8);
    this.lp = new Float64Array(8);
    this.outs = new Float64Array(8);
    this.decay = clamp(decay, 0.1, 30);
    this.dampA = Math.exp((-TAU * clamp(damping, 200, sr * 0.45)) / sr);
    this.predelay = new Float32Array(Math.ceil(0.3 * sr) + 2);
    this.pw = 0;
    this.pd = Math.max(1, Math.round(predelay * sr));
    this.hp = 0;
    this.hpA = 1 - Math.exp((-TAU * lowcut) / sr);
    for (let k = 0; k < 8; k++) {
      this.delay[k] = Math.min(this.lines[k].length - 3, (FDN_MS[k] * scale * sr) / 1000);
      this.gain[k] = Math.pow(10, (-3 * this.delay[k]) / (this.decay * sr));
    }
    this.diff = DIFF_MS.map((ms) => ({ b: new Float32Array(Math.max(1, Math.round((ms * sr) / 1000))), i: 0 }));
  }

  /** Devuelve la señal húmeda en `outL/outR`, sumada (no sustituye). */
  process(inL, inR, outL, outR, n) {
    const { lines, w, delay, gain, lp, outs, diff, predelay } = this;
    const dampA = this.dampA;
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (inL) x += inL[i];
      if (inR) x += inR[i];
      x *= 0.5;
      this.hp += this.hpA * (x - this.hp);
      predelay[this.pw] = x - this.hp;
      let rp = this.pw - this.pd;
      if (rp < 0) rp += predelay.length;
      const ri = rp | 0;
      const rf = rp - ri;
      let s = predelay[ri] + (predelay[ri + 1 === predelay.length ? 0 : ri + 1] - predelay[ri]) * rf;
      if (++this.pw === predelay.length) this.pw = 0;
      for (let d = 0; d < 4; d++) {
        const ap = diff[d];
        const v = ap.b[ap.i];
        const y = -0.62 * s + v;
        ap.b[ap.i] = s + 0.62 * y;
        if (++ap.i === ap.b.length) ap.i = 0;
        s = y;
      }
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        const line = lines[k];
        let p = w[k] - delay[k];
        if (p < 0) p += line.length;
        const pi = p | 0;
        const pf = p - pi;
        const o = line[pi] + (line[pi + 1 === line.length ? 0 : pi + 1] - line[pi]) * pf;
        lp[k] = o + (lp[k] - o) * dampA;
        outs[k] = lp[k] * gain[k];
        sum += outs[k];
      }
      const h = 0.25 * sum;
      let yl = 0;
      let yr = 0;
      for (let k = 0; k < 8; k++) {
        const line = lines[k];
        line[w[k]] = outs[k] - h + s * 0.35;
        if (++w[k] === line.length) w[k] = 0;
        yl += outs[k] * FDN_L[k];
        yr += outs[k] * FDN_R[k];
      }
      if (outL) outL[i] += yl * 0.55;
      if (outR) outR[i] += yr * 0.55;
    }
  }
}

/** Añade una reverb a un sonido ya renderizado, con una cantidad lineal. */
export function addReverb(L, R, amount, opts = {}) {
  if (amount <= 0) return;
  const n = L.length;
  const dryL = L.slice();
  const dryR = R.slice();
  const wetL = new Float32Array(n);
  const wetR = new Float32Array(n);
  const rv = new Freeverb(SR, opts);
  rv.process(dryL, dryR, wetL, wetR, n);
  for (let i = 0; i < n; i++) {
    L[i] += wetL[i] * amount;
    R[i] += wetR[i] * amount;
  }
}

/* ---------------------------------------------------------------- cinta */

/**
 * Modulación lenta de retardo: el wow y flutter de una cinta. Se aplica a
 * buffers cortos; la profundidad se mide en cents aproximados.
 */
export function addWow(L, R, { depthCents = 7, rate = 0.33, flutter = 2.1, flutterDepth = 1.4 } = {}) {
  const n = L.length;
  const sr = SR;
  const maxDelay = 0.006 * sr + 4;
  const dl = new Float32Array(n);
  const dr = new Float32Array(n);
  const read = (buf, pos) => {
    const i = Math.floor(pos);
    const f = pos - i;
    return buf[i] + (buf[Math.min(n - 1, i + 1)] - buf[i]) * f;
  };
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const cents = depthCents * Math.sin(TAU * rate * t) + flutterDepth * Math.sin(TAU * (flutter + 0.37) * t + 1.7);
    const ms = 2.2 + cents * 0.04;
    dl[i] = read(L, Math.max(0, i - ms * sr / 1000));
    dr[i] = read(R, Math.max(0, i - (ms + 0.11) * sr / 1000));
  }
  L.set(dl);
  R.set(dr);
}

/** Paso bajo de cinta y un poco de saturación. */
export function tapeGlue(L, R, { cutoff = 11500, drive = 1.05, hiss = 0, seed = 1 } = {}) {
  const lpL = new OnePole().set(cutoff);
  const lpR = new OnePole().set(cutoff);
  const n = L.length;
  for (let i = 0; i < n; i++) {
    let l = softClip(lpL.tick(L[i]), drive);
    let r = softClip(lpR.tick(R[i]), drive);
    if (hiss > 0) {
      l += noiseAt(seed, i) * hiss;
      r += noiseAt(seed + 7, i) * hiss;
    }
    L[i] = l;
    R[i] = r;
  }
}

/** Vinilo: siseo, crujidos y polvo. Nivel pensado para ir por debajo de todo. */
export function addVinyl(L, R, {
  amount = 1,
  seed = 1,
  hiss = 0.008,
  crackle = 0.07,
  rumble = 0.004,
} = {}) {
  const n = L.length;
  const pinkL = new PinkFilter();
  const pinkR = new PinkFilter();
  const brownL = new BrownFilter();
  const brownR = new BrownFilter();
  const hpL = new Biquad().set('highpass', 900, 0.7, 0, SR);
  const hpR = new Biquad().set('highpass', 1100, 0.7, 0, SR);
  const cSeed = seed + 91;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const wl = noiseAt(seed, i);
    const wr = noiseAt(seed + 3, i);
    const hiL = hpL.tick(wl) * hiss * amount;
    const hiR = hpR.tick(wr) * hiss * amount;
    const loL = brownL.tick(noiseAt(seed + 11, i)) * rumble * amount;
    const loR = brownR.tick(noiseAt(seed + 13, i)) * rumble * amount;
    // Crujidos: impulsos raros, a veces en pareja, filtrados y con un pelín
    // de cola para que no sean simples clics digitales.
    let cl = 0;
    let cr = 0;
    if (unitAt(cSeed, i) < 0.000045) {
      const a = (0.3 + unitAt(cSeed + 1, i) * 0.7) * crackle * amount;
      cl = a;
      cr = a * (0.25 + unitAt(cSeed + 2, i) * 0.5);
      if (i + 2 < n) {
        L[i + 1] += -a * 0.45;
        R[i + 1] += -cr * 0.4;
        L[i + 2] += a * 0.2;
      }
    }
    // Un pop de superficie cada pocos segundos.
    const popRate = 0.6;
    if (unitAt(cSeed + 7, i) < popRate / SR) {
      cl += (0.6 + unitAt(cSeed + 8, i) * 0.5) * crackle * 1.4 * amount;
      cr += (0.6 + unitAt(cSeed + 9, i) * 0.5) * crackle * 1.4 * amount;
    }
    L[i] += hiL + loL + cl;
    R[i] += hiR + loR + cr;
    // Una pizca de trémolo de giro, casi imperceptible.
    if (i % 4410 === 0) {
      const m = 0.9 + 0.1 * Math.sin(t * 0.7);
      for (let j = i; j < Math.min(n, i + 4410); j++) {
        L[j] *= m;
        R[j] *= m;
      }
    }
  }
}

/* ---------------------------------------------------------------- medidas */

export function peakOf(L, R) {
  let p = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]);
    const b = Math.abs(R[i]);
    if (a > p) p = a;
    if (b > p) p = b;
  }
  return p;
}

export function rmsOf(L, R) {
  let s = 0;
  for (let i = 0; i < L.length; i++) s += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(s / (L.length * 2));
}

export function dcOf(L, R) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < L.length; i++) { a += L[i]; b += R[i]; }
  return [(a / L.length), (b / R.length)];
}

/** Escala un buffer para que su pico quede en `peakDb`; devuelve la ganancia. */
export function normalizePeak(L, R, peakDb = -1) {
  const p = peakOf(L, R);
  if (p < 1e-9) return 1;
  const g = dbToGain(peakDb) / p;
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
  return g;
}

/** Escala a un RMS objetivo, sin pasar del techo de pico. */
export function normalizeRms(L, R, rmsDb = -18, ceilingDb = -1) {
  const r = rmsOf(L, R);
  if (r < 1e-9) return 1;
  const want = dbToGain(rmsDb);
  const peak = peakOf(L, R);
  const max = peak > 1e-9 ? dbToGain(ceilingDb) / peak : Infinity;
  const g = Math.min(want / r, max);
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
  return g;
}

/** Relleno de 2 ms al principio y al final para que ningún corte chasque. */
export function fadeEdges(L, R, ms = 2) {
  const n = Math.min(Math.floor((ms / 1000) * SR), Math.floor(L.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    L[i] *= g;
    R[i] *= g;
    L[L.length - 1 - i] *= g;
    R[R.length - 1 - i] *= g;
  }
}

/**
 * Convierte un buffer en bucle sin costura: renderiza `extra` muestras de más
 * y las funde con el comienzo. Devuelve nuevos arrays de la longitud nominal.
 */
export function loopCrossfade(L, R, nominal, extra) {
  const outL = new Float32Array(nominal);
  const outR = new Float32Array(nominal);
  outL.set(L.subarray(0, nominal));
  outR.set(R.subarray(0, nominal));
  const x = Math.min(extra, nominal);
  for (let i = 0; i < x; i++) {
    const f = i / x;
    const a = Math.sin((Math.PI / 2) * f);
    const b = Math.cos((Math.PI / 2) * f);
    outL[i] = outL[i] * a + L[nominal + i] * b;
    outR[i] = outR[i] * a + R[nominal + i] * b;
  }
  return [outL, outR];
}

/** Picos para dibujar la forma de onda. */
export function peaksOf(L, R, count = 64) {
  const out = new Float32Array(count);
  const step = Math.max(1, Math.floor(L.length / count));
  for (let k = 0; k < count; k++) {
    let p = 0;
    const start = k * step;
    const end = Math.min(L.length, start + step);
    for (let i = start; i < end; i++) {
      const a = Math.abs(L[i]);
      const b = Math.abs(R[i]);
      if (a > p) p = a;
      if (b > p) p = b;
    }
    out[k] = p;
  }
  let max = 0;
  for (let k = 0; k < count; k++) if (out[k] > max) max = out[k];
  if (max > 0) for (let k = 0; k < count; k++) out[k] /= max;
  return out;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteToMidi(note) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(String(note).trim());
  if (!m) return 60;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export function freqOf(note) {
  return typeof note === 'number' ? midiToFreq(note) : midiToFreq(noteToMidi(note));
}
