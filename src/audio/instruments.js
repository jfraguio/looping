/**
 * Instrumentos de Looping. Cada función escribe una voz dentro de un buffer
 * estéreo ya abierto; el catálogo decide qué voces suenan en cada compás.
 *
 * La batería es síntesis de transitorios y membranas; los teclados usan FM,
 * cuerdas pulsadas y bancos modales; las texturas se construyen con ruido
 * filtrado y crujidos deterministas.
 */

import {
  Biquad, BrownFilter, ColoredNoise, DCBlock, OnePole, PinkFilter, SR, Svf, TAU,
  clamp, makeWavetable, panGains, sineCycle, smoothEnv, smoothRandom, softClip, tableRead,
} from './dsp.js';
import { noiseAt, unitAt } from './rng.js';

function offOf(t) {
  return Math.max(0, Math.round(t * SR));
}

function limit(ctx, off, dur) {
  return Math.max(0, Math.min(ctx.n - off, dur));
}

/* =================================================================== batería */

/**
 * Bombo: cuerpo con caída de tono, sub, click de batidor y saturación.
 * Suena a madera y a cuero, no a un simple seno.
 */
export function kick(ctx, t, {
  vel = 0.9,
  decay = 0.32,
  pitch = 48,
  drive = 1.5,
  click = 0.5,
  sub = 0.22,
  pan = 0,
  seed = 1,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay * 5.2 + 0.025) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  let phase = 0;
  const hp = new Biquad().set('highpass', 1300, 0.7, 0, SR);
  const bp = new Biquad().set('bandpass', 2200, 0.8, 0, SR);
  const dc = new DCBlock();
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const f = pitch + 120 * Math.exp(-tt / 0.024) + 34 * Math.exp(-tt / 0.11);
    phase += f / SR;
    const attack = 1 - Math.exp(-tt / 0.0012);
    const body = Math.sin(TAU * phase) * Math.exp(-tt / decay) * attack;
    const harm = Math.sin(TAU * phase * 2 + 0.4) * Math.exp(-tt / (decay * 0.42)) * 0.2 * attack;
    const subTone = Math.sin(TAU * phase * 0.5) * Math.exp(-tt / (decay * 1.25)) * sub * attack;
    let y = body + harm + subTone;
    y = softClip(y * drive, drive) * 0.9;
    y += hp.tick(noiseAt(seed, i) * Math.exp(-tt / 0.005)) * click * 0.5;
    y += bp.tick(noiseAt(seed + 2, i) * Math.exp(-tt / 0.003)) * click * 0.18;
    y = dc.tick(y) * vel;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Caja: dos modos de membrana, ruido de bordón y un poco de aire. */
export function snare(ctx, t, {
  vel = 0.9,
  decay = 0.15,
  tone = 190,
  bright = 1,
  pan = 0,
  seed = 1,
  room = 1,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay * 4.6 + 0.06) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const bp = new Biquad().set('bandpass', 1750 * bright, 0.62, 0, SR);
  const hp = new Biquad().set('highpass', 420, 0.7, 0, SR);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const f1 = tone * (1 + 0.18 * Math.exp(-tt / 0.018));
    const f2 = tone * 1.83 * (1 + 0.1 * Math.exp(-tt / 0.012));
    p1 += f1 / SR;
    p2 += f2 / SR;
    const body = Math.sin(TAU * p1) * Math.exp(-tt / (decay * 0.42)) * 0.55
      + Math.sin(TAU * p2) * Math.exp(-tt / (decay * 0.3)) * 0.16;
    const noise = hp.tick(bp.tick(noiseAt(seed, i))) * Math.exp(-tt / decay);
    const sizzle = hp.tick(noiseAt(seed + 4, i)) * Math.exp(-tt / (decay * 1.45)) * 0.16;
    let y = body + noise * 1.05 + sizzle;
    y = softClip(y * 1.2, 1.2) * 0.8 * vel;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
  // Un golpe de aire corto, decorrelacionado, para que la caja respire.
  if (room > 0) {
    const nr = Math.min(n, Math.ceil(0.06 * SR));
    for (let i = 0; i < nr; i++) {
      const e = Math.exp(-i / (0.018 * SR));
      const l = noiseAt(seed + 21, i) * e * 0.045 * room;
      const r = noiseAt(seed + 29, i) * e * 0.045 * room;
      ctx.L[off + i] += l;
      ctx.R[off + i] += r;
    }
  }
}

/** Charles metálico: banco de parciales inarmónicos + aire. */
export function hat(ctx, t, {
  vel = 0.7,
  open = false,
  pedal = false,
  pan = 0.18,
  seed = 1,
  tone = 1,
} = {}) {
  const decay = open ? 0.26 : pedal ? 0.065 : 0.032;
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay * 5.2 + 0.01) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const hp = new Biquad().set('highpass', 6200, 0.7, 0, SR);
  const bp = new Biquad().set('bandpass', 10400, 0.55, 0, SR);
  const partials = [205.3, 304.4, 369.6, 522.7, 540, 800];
  const phases = partials.map((_, k) => unitAt(seed + 3, k));
  const incs = partials.map((f) => (f * tone) / SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    let metal = 0;
    for (let k = 0; k < 6; k++) {
      metal += squareSample(phases[k] + incs[k] * i, incs[k]);
      phases[k] += incs[k];
    }
    metal /= 6;
    const env = Math.exp(-tt / decay) * (1 - Math.exp(-tt / 0.0009));
    const noise = noiseAt(seed + 11, i) * Math.exp(-tt / (decay * 0.55)) * 0.55;
    let y = hp.tick(metal * 0.7 + bp.tick(noise) * 0.55) * env;
    y = softClip(y * 1.1, 1.1) * vel * 1.15;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Palmas: tres o cuatro ráfagas de ruido y una cola difusa. */
export function clap(ctx, t, {
  vel = 0.8,
  pan = 0.05,
  seed = 1,
  spread = 0.6,
  decay = 0.13,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay * 5 + 0.06) * SR));
  if (!n) return;
  const [cl, cr] = panGains(pan);
  const bpL = new Biquad().set('bandpass', 1350, 0.62, 0, SR);
  const bpR = new Biquad().set('bandpass', 1420, 0.62, 0, SR);
  const hp = new Biquad().set('highpass', 700, 0.7, 0, SR);
  const bursts = [0, 0.012, 0.024, 0.038];
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    let l = 0;
    let r = 0;
    for (let b = 0; b < bursts.length; b++) {
      const dt = tt - bursts[b];
      if (dt < 0 || dt > 0.07) continue;
      const e = Math.exp(-dt / 0.0075) * (1 - Math.exp(-dt / 0.0006));
      const q = (b === bursts.length - 1 ? 0.35 : 0.8) * e;
      const nl = noiseAt(seed + b * 7, i);
      const nr = noiseAt(seed + b * 7 + 3, i);
      l += bpL.tick(nl) * q;
      r += bpR.tick(nr) * q;
    }
    const tailL = bpL.tick(noiseAt(seed + 41, i)) * Math.exp(-tt / decay) * 0.33;
    const tailR = bpR.tick(noiseAt(seed + 43, i)) * Math.exp(-tt / decay) * 0.33;
    l = hp.tick(l * 0.9 + tailL);
    r = hp.tick(r * 0.9 + tailR);
    const sl = l * (1 - spread) + r * spread;
    const sr = r * (1 - spread) + l * spread;
    ctx.L[off + i] += sl * cl * vel * 0.95;
    ctx.R[off + i] += sr * cr * vel * 0.95;
  }
}

/** Aro / rimshot: un chasquido de madera con dos modos cortos. */
export function rim(ctx, t, { vel = 0.7, pan = -0.1, seed = 1 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil(0.075 * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const bp = new Biquad().set('bandpass', 3100, 1.1, 0, SR);
  let f1 = 0;
  let f2 = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    f1 += 1780 / SR;
    f2 += 2660 / SR;
    const body = Math.sin(TAU * f1) * Math.exp(-tt / 0.007) * 0.35
      + Math.sin(TAU * f2) * Math.exp(-tt / 0.004) * 0.2;
    const click = bp.tick(noiseAt(seed, i)) * Math.exp(-tt / 0.0035) * 0.7;
    const y = softClip((body + click) * 1.8, 1.8) * vel * 0.75;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Shaker: ruido de granos con un pequeño rebote. */
export function shaker(ctx, t, { vel = 0.5, pan = 0.22, seed = 1, decay = 0.055 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay * 5.2 + 0.01) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const hp = new Biquad().set('highpass', 4800, 0.7, 0, SR);
  const bp = new Biquad().set('bandpass', 7200, 0.8, 0, SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = Math.exp(-tt / decay) * (1 - Math.exp(-tt / 0.0015));
    const bounce = tt > 0.027 ? Math.exp(-(tt - 0.027) / 0.025) * 0.22 : 0;
    const y = hp.tick(bp.tick(noiseAt(seed, i))) * (env + bounce) * vel * 1.05;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Conga / bongó: membrana con caída de tono y mano. */
export function conga(ctx, t, {
  vel = 0.7,
  freq = 196,
  pan = 0.2,
  seed = 1,
  decay = 0.18,
  slap = 0.35,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay * 4.5 + 0.03) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const bp = new Biquad().set('bandpass', 2400, 0.8, 0, SR);
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const bend = 1 + 0.09 * Math.exp(-tt / 0.022);
    p1 += (freq * bend) / SR;
    p2 += (freq * 1.58 * bend) / SR;
    p3 += (freq * 2.14 * bend) / SR;
    const env = Math.exp(-tt / decay);
    const body = Math.sin(TAU * p1) * env
      + Math.sin(TAU * p2) * env * 0.36
      + Math.sin(TAU * p3) * env * 0.14;
    const hand = bp.tick(noiseAt(seed, i)) * Math.exp(-tt / 0.012) * slap;
    const y = softClip((body * 0.65 + hand) * 1.2, 1.2) * vel * 0.8;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Platillo / ride: metal largo para fills y acentos. */
export function cymbal(ctx, t, { vel = 0.5, pan = 0.2, seed = 1, decay = 0.9, ride = false } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay * 4.2 + 0.03) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const hp = new Biquad().set('highpass', 3800, 0.7, 0, SR);
  const bp = new Biquad().set('bandpass', 6900, 0.5, 0, SR);
  const partials = [245, 311, 402, 517, 602, 711, 830, 941, 1130];
  const phases = partials.map((_, k) => unitAt(seed + k, 5));
  const incs = partials.map((f) => f / SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    let metal = 0;
    for (let k = 0; k < partials.length; k++) {
      metal += squareSample(phases[k] + incs[k] * i, incs[k]);
      phases[k] += incs[k];
    }
    metal /= partials.length;
    const env = Math.exp(-tt / decay) * (1 - Math.exp(-tt / 0.002));
    const ping = ride ? Math.sin(TAU * (620 + 40 * Math.exp(-tt / 0.02)) * tt) * Math.exp(-tt / 0.055) * 0.3 : 0;
    const noise = noiseAt(seed + 23, i) * Math.exp(-tt / (decay * 0.4)) * 0.5;
    let y = hp.tick(metal * 0.8 + bp.tick(noise) + ping) * env;
    y = softClip(y * 1.15, 1.15) * vel * 0.7;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Escobillas: un siseo suave que barre la caja. */
export function brush(ctx, t, { vel = 0.5, pan = 0.05, seed = 1, decay = 0.22 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay * 4 + 0.04) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const lp = new Biquad().set('lowpass', 5200, 0.6, 0, SR);
  const hp = new Biquad().set('highpass', 900, 0.7, 0, SR);
  const bp = new Biquad().set('bandpass', 2600, 0.7, 0, SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = Math.exp(-tt / decay) * (1 - Math.exp(-tt / 0.015));
    const air = lp.tick(hp.tick(noiseAt(seed, i))) * env;
    const body = bp.tick(noiseAt(seed + 2, i)) * Math.exp(-tt / 0.08) * 0.25;
    const y = (air * 0.45 + body) * vel * 1.0;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/* ====================================================================== bajo */

/** Cuerda pulsada genérica (Karplus-Strong) con cuerpo y ruido de dedo. */
function pluckedString(ctx, off, freq, {
  amp = 0.5,
  t60 = 1.1,
  brightness = 0.45,
  hardness = 0.5,
  body = [],
  pan = 0,
  seed = 1,
  finger = 0.15,
  sub = 0,
} = {}) {
  const f = clamp(freq, 28, SR * 0.18);
  const N = SR / f - 0.5;
  const len = Math.ceil(N) + 6;
  const buf = new Float32Array(len);
  const lp1 = new OnePole().set(700 + 6200 * brightness * (0.4 + 0.6 * hardness));
  const lp2 = new OnePole().set(clamp(900 + 9000 * brightness, 1000, 12000));
  const ex = new Float32Array(len);
  let mean = 0;
  for (let k = 0; k < len; k++) {
    let v = lp2.tick(lp1.tick(noiseAt(seed, k)));
    // Un poco del fundamental en la excitación: la cuerda no nace solo de ruido.
    v += sineCycle((f * k) / SR) * 0.18 * (1 - brightness);
    ex[k] = v;
    mean += v;
  }
  mean /= len;
  const pos = Math.max(1, Math.round(len * (0.14 + 0.18 * (1 - hardness))));
  const shaped = new Float32Array(len);
  let power = 0;
  for (let k = 0; k < len; k++) {
    const v = (ex[k] - mean) - (k >= pos ? ex[k - pos] - mean : 0);
    shaped[k] = v;
    power += v * v;
  }
  const norm = 0.32 / Math.sqrt(Math.max(1e-9, power / len));
  const feedback = Math.exp(-6.9078 / (Math.max(0.08, t60) * SR));
  const blend = clamp(0.5 - 0.45 * brightness, 0.04, 0.7);
  for (let k = 0; k < len; k++) buf[k] = shaped[k] * norm;
  let w = Math.ceil(N);
  let prev = 0;
  let dc = 0;
  const [pl, pr] = panGains(pan);
  const bodyModes = body.map(([hz, a, t]) => ({ w: (TAU * hz) / SR, e: Math.exp(-1 / (t * SR)), re: 1, im: 0, a }));
  const n = limit(ctx, off, Math.ceil((Math.min(6, t60 * 1.2) + 0.02) * SR));
  const fingerLp = new Biquad().set('bandpass', 2200 + 2200 * hardness, 0.8, 0, SR);
  for (let i = 0; i < n; i++) {
    let p = w - N;
    if (p < 0) p += len;
    const pi = p | 0;
    const pf = p - pi;
    const x = buf[pi] + (buf[pi + 1 === len ? 0 : pi + 1] - buf[pi]) * pf;
    const y = feedback * ((1 - blend) * x + blend * prev);
    prev = x;
    buf[w] = y;
    if (++w === len) w = 0;
    dc += 0.0008 * (y - dc);
    let v = y - dc;
    for (let k = 0; k < bodyModes.length; k++) {
      const m = bodyModes[k];
      const re2 = m.re * Math.cos(m.w) - m.im * Math.sin(m.w);
      m.im = m.re * Math.sin(m.w) + m.im * Math.cos(m.w);
      m.re = re2 * m.e;
      v += m.re * m.a;
    }
    if (i < 0.006 * SR) v += fingerLp.tick(noiseAt(seed + 31, i)) * Math.exp(-i / (0.0025 * SR)) * finger;
    if (sub > 0) v += Math.sin(TAU * f * 0.5 * (i / SR)) * Math.exp(-i / 0.25) * sub;
    const attack = Math.min(1, i / (0.0012 * SR));
    v *= attack;
    ctx.L[off + i] += v * pl * amp;
    ctx.R[off + i] += v * pr * amp;
  }
}

/** Contrabajo de dedo: madera, púa blanda y una cola de cuerpo. */
export function uprightBass(ctx, t, freq, dur, { vel = 0.8, pan = 0, seed = 1, slideFrom = 0 } = {}) {
  const off = offOf(t);
  const n = Math.min(Math.ceil((dur + 0.5) * SR), ctx.n - off);
  if (n <= 0) return;
  const [pl, pr] = panGains(pan);
  const tmp = { L: new Float32Array(n), R: new Float32Array(n), n };
  pluckedString(tmp, 0, freq, {
    amp: 0.72 * vel,
    t60: 1.35,
    brightness: 0.28,
    hardness: 0.35,
    body: [[98, 0.06, 0.18], [185, 0.035, 0.12], [410, 0.02, 0.08]],
    pan: 0,
    seed,
    finger: 0.22,
    sub: 0.16,
  });
  for (let i = 0; i < n; i++) {
    ctx.L[off + i] += tmp.L[i] * pl;
    ctx.R[off + i] += tmp.R[i] * pr;
  }
}

/** 808: seno con deslizamiento, saturación y click. */
export function sub808(ctx, t, freq, dur, {
  vel = 0.85,
  pan = 0,
  seed = 1,
  glideFrom = 0,
  glideTime = 0.04,
  drive = 2.2,
  click = 0.2,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + 0.28) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  let phase = 0;
  const hp = new Biquad().set('highpass', 1400, 0.7, 0, SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const g = glideFrom && tt < glideTime ? glideFrom + (freq - glideFrom) * (tt / glideTime) : freq;
    // Un pequeño overshoot de tono al entrar: se siente el golpe del sub.
    const f = g + freq * 0.18 * Math.exp(-tt / 0.015);
    phase += f / SR;
    const env = (1 - Math.exp(-tt / 0.002)) * Math.exp(-tt / (dur * 0.75 + 0.18));
    let y = Math.sin(TAU * phase) * env;
    y = softClip(y * drive, drive) * 0.9;
    y += hp.tick(noiseAt(seed, i) * Math.exp(-tt / 0.003)) * click * 0.35;
    ctx.L[off + i] += y * vel * pl;
    ctx.R[off + i] += y * vel * pr;
  }
}

/** Bajo de sintetizador: sierras desafinadas, filtro con envolvente y drive. */
export function synthBass(ctx, t, freq, dur, {
  vel = 0.8,
  pan = 0,
  seed = 1,
  cutoff = 280,
  envAmt = 1000,
  drive = 1.6,
  detune = 7,
  squareMix = 0.25,
  t60 = 0.32,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + 0.18) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const fL = new Svf(0);
  const fR = new Svf(0);
  const dc = new DCBlock();
  const inc1 = freq / SR;
  const inc2 = (freq * Math.pow(2, detune / 1200)) / SR;
  const incQ = (freq * 0.5) / SR;
  let p1 = 0;
  let p2 = 0.13;
  let p3 = 0.31;
  const dt1 = inc1;
  const dt2 = inc2;
  const dtQ = incQ;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = (1 - Math.exp(-tt / 0.004)) * Math.exp(-tt / (t60 * 0.7 + 0.08));
    const filt = cutoff + envAmt * Math.exp(-tt / 0.07);
    fL.set(filt, 1.3, SR);
    fR.set(filt * 1.02, 1.3, SR);
    const sl = (1 - squareMix) * sawSample(p1, dt1) + squareMix * squareSample(p1 + 0.5, dt1);
    const sr = (1 - squareMix) * sawSample(p2, dt2) + squareMix * squareSample(p2 + 0.5, dt2);
    const sub = Math.sin(TAU * p3) * 0.35;
    let l = fL.tick(sl) * env + sub * env;
    let r = fR.tick(sr) * env + Math.sin(TAU * (p3 + 0.01)) * env * 0.35;
    l = softClip(l * drive, drive) * 0.55;
    r = softClip(r * drive, drive) * 0.55;
    l = dc.tick(l);
    r = dc.tick(r);
    ctx.L[off + i] += l * vel * pl;
    ctx.R[off + i] += r * vel * pr;
    p1 += inc1;
    if (p1 >= 1) p1 -= 1;
    p2 += inc2;
    if (p2 >= 1) p2 -= 1;
    p3 += incQ;
    if (p3 >= 1) p3 -= 1;
  }
}

function sawSample(phase, dt) {
  const p = phase - Math.floor(phase);
  let y = 2 * p - 1;
  // PolyBLEP mínimo, suficiente para un bajo filtrado.
  if (p < dt) {
    const x = p / dt;
    y -= x + x - x * x - 1;
  } else if (p > 1 - dt) {
    const x = (p - 1) / dt;
    y -= x * x + x + x + 1;
  }
  return y;
}

function squareSample(phase, dt) {
  return sawSample(phase, dt) - sawSample(phase + 0.5, dt);
}

/** Bajo redondo y corto: seno con armónico y un toque de madera. */
export function roundBass(ctx, t, freq, dur, { vel = 0.85, pan = 0, seed = 1 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + 0.16) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const lp = new Biquad().set('lowpass', 850, 0.8, 0, SR);
  const hp = new Biquad().set('highpass', 32, 0.7, 0, SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = (1 - Math.exp(-tt / 0.003)) * Math.exp(-tt / (dur * 0.55 + 0.06));
    const f = freq * (1 + 0.03 * Math.exp(-tt / 0.02));
    phase += f / SR;
    let y = Math.sin(TAU * phase) + Math.sin(TAU * phase * 2) * 0.15 + Math.sin(TAU * phase * 3) * 0.05;
    y = lp.tick(softClip(y * 1.4, 1.4));
    y = hp.tick(y) * env * 0.8;
    y += Math.sin(TAU * freq * 0.5 * tt) * Math.exp(-tt / 0.11) * 0.12;
    ctx.L[off + i] += y * vel * pl;
    ctx.R[off + i] += y * vel * pr;
  }
}

/* ================================================================== teclados */

/** Rhodes: FM de dos operadores con diente, trémolo y coro. */
export function rhodes(ctx, t, freq, dur, {
  vel = 0.75,
  pan = 0,
  seed = 1,
  index = 2.5,
  indexDecay = 0.45,
  ampDecay = 1.7,
  tine = 0.35,
  trem = 0.16,
  detune = 5,
  attack = 0.004,
  drive = 1.15,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + Math.min(2.2, ampDecay * 0.9)) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const lp = new Biquad().set('lowpass', 6400, 0.55, 0, SR);
  const bp = new Biquad().set('bandpass', 5200, 0.7, 0, SR);
  const incC = freq / SR;
  const incM = freq / SR;
  const incD = (freq * Math.pow(2, detune / 1200)) / SR;
  const phC = unitAt(seed, 1);
  const phM = unitAt(seed, 2);
  const phD = unitAt(seed, 3);
  const tremPh = unitAt(seed, 4) * TAU;
  let env = 0;
  const dc = new DCBlock();
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const a = 1 - Math.exp(-tt / attack);
    const decay = Math.exp(-tt / ampDecay);
    const modEnv = Math.exp(-tt / indexDecay);
    const mod = Math.sin(TAU * (phM + incM * i)) * index * modEnv;
    const carrier = Math.sin(TAU * (phC + incC * i) + mod);
    const det = Math.sin(TAU * (phD + incD * i) + mod * 0.9) * 0.28;
    let y = (carrier + det) * a * decay;
    y = lp.tick(softClip(y * drive, drive));
    y *= 1 - trem * (0.5 - 0.5 * Math.cos(TAU * 5.1 * tt + tremPh));
    if (i < 0.03 * SR) {
      y += bp.tick(noiseAt(seed + 7, i)) * Math.exp(-tt / 0.004) * tine;
    }
    y = dc.tick(y) * 0.5 * vel;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Wurlitzer: lengüeta con armónicos impares, trémolo y saturación. */
export function wurli(ctx, t, freq, dur, {
  vel = 0.75,
  pan = 0,
  seed = 1,
  ampDecay = 0.9,
  trem = 0.28,
  drive = 1.5,
  attack = 0.003,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + ampDecay * 0.8) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const lp = new Biquad().set('lowpass', 4200, 0.7, 0, SR);
  const ph = unitAt(seed, 1);
  const tremPh = unitAt(seed, 2) * TAU;
  const dc = new DCBlock();
  let p = ph;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const a = 1 - Math.exp(-tt / attack);
    const decay = Math.exp(-tt / ampDecay);
    const f = freq * (1 + 0.006 * Math.exp(-tt / 0.04));
    p += f / SR;
    let y = Math.sin(TAU * p)
      + Math.sin(TAU * p * 3) * 0.32
      + Math.sin(TAU * p * 5) * 0.14
      + Math.sin(TAU * p * 7) * 0.05;
    y *= a * decay;
    y = lp.tick(softClip(y * drive, drive));
    y *= 1 - trem * (0.5 - 0.5 * Math.cos(TAU * 6.1 * tt + tremPh));
    if (i < 0.012 * SR) y += noiseAt(seed + 5, i) * Math.exp(-tt / 0.0025) * 0.12;
    y = dc.tick(y) * 0.42 * vel;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Piano de fieltro: parciales con ataque de fieltro y aire de habitación. */
export function feltPiano(ctx, t, freq, dur, {
  vel = 0.7,
  pan = 0,
  seed = 1,
  ampDecay = 2.4,
  brightness = 0.38,
  noise = 0.18,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + Math.min(3.2, ampDecay * 1.1)) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const partials = [
    [1, 1, 1], [2, 0.5, 0.72], [3, 0.28, 0.55], [4, 0.16, 0.44],
    [5, 0.1, 0.35], [6, 0.065, 0.28], [7, 0.04, 0.22], [9, 0.022, 0.17],
  ];
  const inharm = 1 + 0.00018 * (brightness > 0.5 ? 1 : 0.7);
  const modes = partials.map(([ratio, a, ts], k) => {
    const f = freq * ratio * Math.pow(inharm, ratio * ratio - 1);
    return {
      inc: f / SR,
      ph: unitAt(seed + k, 3),
      a: a * Math.pow(ratio, -(1 - brightness) * 0.7),
      tau: ampDecay * ts,
      pan: pan + (k % 2 ? 0.04 : -0.04) * (k / partials.length),
    };
  });
  const lp = new Biquad().set('lowpass', 3800 + brightness * 4200, 0.55, 0, SR);
  const hammer = new Biquad().set('bandpass', 900 + 1600 * brightness, 0.8, 0, SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const attack = 1 - Math.exp(-tt / 0.0025);
    let l = 0;
    let r = 0;
    for (let k = 0; k < modes.length; k++) {
      const m = modes[k];
      const e = Math.exp(-tt / m.tau) * attack;
      const v = sineCycle(m.ph + m.inc * i) * m.a * e;
      const [gl, gr] = panGains(m.pan);
      l += v * gl;
      r += v * gr;
    }
    const felt = hammer.tick(noiseAt(seed + 41, i)) * Math.exp(-tt / 0.016) * noise;
    l = lp.tick(l + felt);
    r = lp.tick(r + felt);
    const fade = Math.exp(-tt / (ampDecay * 1.5));
    l *= fade * 0.36 * vel;
    r *= fade * 0.36 * vel;
    ctx.L[off + i] += l;
    ctx.R[off + i] += r;
  }
}

/** Guitarra de nailon: cuerda pulsada con cuerpo y uña. */
export function nylonGuitar(ctx, t, freq, dur, {
  vel = 0.7,
  pan = 0,
  seed = 1,
  t60 = 1.6,
  brightness = 0.52,
} = {}) {
  const off = offOf(t);
  pluckedString(ctx, off, freq, {
    amp: 0.62 * vel,
    t60,
    brightness,
    hardness: 0.55,
    body: [[96, 0.08, 0.1], [198, 0.055, 0.08], [412, 0.03, 0.05], [780, 0.015, 0.03]],
    pan,
    seed,
    finger: 0.2,
    sub: 0.02,
  });
}

/** Vibráfono: parciales 1, 4 y 10, trémolo de motor y cola larga. */
export function vibraphone(ctx, t, freq, dur, { vel = 0.65, pan = 0, seed = 1, decay = 2.2 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay + 0.2) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const modes = [[1, 1, 1], [4, 0.13, 0.38], [10, 0.035, 0.16], [2.02, 0.04, 0.5]];
  const ph = modes.map((_, k) => unitAt(seed + k, 2));
  const inc = modes.map(([r]) => (freq * r) / SR);
  const tremPh = unitAt(seed, 7) * TAU;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = (1 - Math.exp(-tt / 0.002)) * Math.exp(-tt / decay);
    let y = 0;
    for (let k = 0; k < modes.length; k++) {
      y += sineCycle(ph[k] + inc[k] * i) * modes[k][1] * Math.exp(-tt / (decay * modes[k][2]));
    }
    y *= env * (0.86 + 0.14 * Math.sin(TAU * 5 * tt + tremPh));
    y += noiseAt(seed + 3, i) * Math.exp(-tt / 0.003) * 0.08;
    y *= 0.34 * vel;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Caja de música: tine metálico, parciales inarmónicos y cinta. */
export function musicBox(ctx, t, freq, dur, { vel = 0.65, pan = 0, seed = 1 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil(1.6 * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const modes = [[1, 1, 1], [2.01, 0.18, 0.45], [3.9, 0.1, 0.22], [5.93, 0.18, 0.12], [9.4, 0.06, 0.05]];
  const ph = modes.map((_, k) => unitAt(seed + k, 3));
  const inc = modes.map(([r]) => (freq * r) / SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const attack = 1 - Math.exp(-tt / 0.0015);
    let y = 0;
    for (let k = 0; k < modes.length; k++) {
      y += sineCycle(ph[k] + inc[k] * i) * modes[k][1] * Math.exp(-tt / (0.7 * modes[k][2]));
    }
    y *= attack * Math.exp(-tt / 0.8);
    y += noiseAt(seed + 21, i) * Math.exp(-tt / 0.002) * 0.12;
    y *= 0.3 * vel;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Banco de cuerdas: sierras desafinadas, filtro lento y vibrato. */
export function stringsPad(ctx, t, notes, dur, {
  vel = 0.55,
  pan = 0,
  seed = 1,
  attack = 0.28,
  release = 0.35,
  cutoff = 2600,
  vibrato = 4.6,
  width = 0.55,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + release + 0.05) * SR));
  if (!n) return;
  const list = notes.slice(0, 8).map((freq, k) => {
    const panN = pan + (k % 2 ? width * 0.45 : -width * 0.45);
    const [pl, pr] = panGains(panN);
    return {
      freq,
      pl,
      pr,
      det: (unitAt(seed + k, 1) - 0.5) * 9,
      ph1: unitAt(seed + k, 2),
      ph2: unitAt(seed + k, 3),
      ph3: unitAt(seed + k, 4),
      vibPh: unitAt(seed + k, 5) * TAU,
      norm: 1 / Math.sqrt(notes.length),
    };
  });
  const lpL = new Svf(0).set(cutoff, 0.7, SR);
  const lpR = new Svf(0).set(cutoff * 1.03, 0.7, SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = smoothEnv(tt, dur + release, attack, release);
    if (env <= 0) continue;
    const vib = 1 + 0.0038 * Math.sin(TAU * vibrato * tt + 0.7);
    let l = 0;
    let r = 0;
    for (let k = 0; k < list.length; k++) {
      const v = list[k];
      const d = Math.pow(2, v.det / 1200) * vib;
      const inc = (v.freq * d) / SR;
      const a = 0.45;
      const b = 0.38;
      const c = 0.17;
      l += (sawSample(v.ph1 + inc * i, inc) * a + sawSample(v.ph2 + inc * 1.006 * i, inc) * b + sawSample(v.ph3 + inc * 0.994 * i, inc) * c) * v.pl * v.norm;
      r += (sawSample(v.ph1 + inc * 0.997 * i, inc) * b + sawSample(v.ph2 + inc * 1.009 * i, inc) * a + sawSample(v.ph3 + inc * 0.99 * i, inc) * c) * v.pr * v.norm;
    }
    l = lpL.tick(l) * env;
    r = lpR.tick(r) * env;
    ctx.L[off + i] += l * vel * 0.34;
    ctx.R[off + i] += r * vel * 0.34;
  }
}

/** Coro sin palabras: tabla de formantes, vibrato y aire. */
export function choirPad(ctx, t, notes, dur, {
  vel = 0.42,
  pan = 0,
  seed = 1,
  vowel = 0.35,
  attack = 0.35,
  release = 0.45,
  width = 0.7,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + release + 0.05) * SR));
  if (!n) return;
  const vowelForms = [
    [800, 1150, 2900],
    [450, 800, 2830],
    [325, 700, 2530],
  ];
  const v = clamp(vowel, 0, 1) * 2;
  const a = Math.min(1, Math.floor(v));
  const u = v - a;
  const formants = vowelForms[0].map((_, k) => vowelForms[a][k] + (vowelForms[Math.min(2, a + 1)][k] - vowelForms[a][k]) * u);
  const voices = notes.slice(0, 6).map((freq, k) => {
    const panN = pan + (k % 2 ? width * 0.5 : -width * 0.5);
    const [pl, pr] = panGains(panN);
    const amps = new Float32Array(48);
    for (let h = 1; h <= 48; h++) {
      const f = freq * h;
      let resp = 0;
      for (let q = 0; q < 3; q++) {
        const fk = formants[q];
        const Q = 8;
        const x = f / fk;
        resp += [1, 0.6, 0.32][q] / Math.sqrt(1 + Q * Q * (x - 1 / x) * (x - 1 / x));
      }
      amps[h - 1] = (Math.pow(h, -1.15) * resp) / (1 + (f / 5000) ** 2);
    }
    return { freq, pl, pr, amps, ph: unitAt(seed + k, 4), ph2: unitAt(seed + k, 6), vibPh: unitAt(seed + k, 5) * TAU, norm: 1 / Math.sqrt(notes.length) };
  });
  for (const vv of voices) vv.table = makeWavetable(vv.amps);
  const lpL = new OnePole().set(4500);
  const lpR = new OnePole().set(4300);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = smoothEnv(tt, dur + release, attack, release);
    if (env <= 0) continue;
    let l = 0;
    let r = 0;
    for (let k = 0; k < voices.length; k++) {
      const vv = voices[k];
      const vib = 1 + 0.005 * Math.sin(TAU * 4.4 * tt + vv.vibPh);
      const inc = (vv.freq * vib) / SR;
      const s1 = tableRead(vv.table, vv.ph + inc * i);
      const s2 = tableRead(vv.table, vv.ph2 + inc * i + 0.01);
      const breath = noiseAt(seed + 71 + k, i) * 0.012;
      l += (s1 + breath) * vv.pl * vv.norm;
      r += (s2 + breath) * vv.pr * vv.norm;
    }
    ctx.L[off + i] += lpL.tick(l) * env * vel * 0.42;
    ctx.R[off + i] += lpR.tick(r) * env * vel * 0.42;
  }
}

/** Flauta suave: seno con aire, vibrato y un pequeño ataque de lengua. */
export function flute(ctx, t, freq, dur, { vel = 0.55, pan = 0, seed = 1, vibrato = 4.8 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + 0.18) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const lp = new OnePole().set(6500);
  const bp = new Biquad().set('bandpass', 1200, 0.8, 0, SR);
  let ph = unitAt(seed, 2);
  const vibPh = unitAt(seed, 3) * TAU;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = smoothEnv(tt, dur, 0.045, 0.07);
    const vib = 1 + (tt > 0.12 ? 0.006 : 0.001) * Math.sin(TAU * vibrato * tt + vibPh);
    ph += (freq * vib) / SR;
    const tone = Math.sin(TAU * ph) + Math.sin(TAU * ph * 2) * 0.08 + Math.sin(TAU * ph * 3) * 0.025;
    const breath = lp.tick(noiseAt(seed, i)) * 0.09 + bp.tick(noiseAt(seed + 1, i)) * 0.03;
    const attack = tt < 0.02 ? noiseAt(seed + 4, i) * 0.04 * Math.exp(-tt / 0.003) : 0;
    const y = (tone * 0.4 + breath) * env * vel + attack;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}

/** Pad analógico: sierras redondas con filtro y movimiento lento. */
export function analogPad(ctx, t, notes, dur, {
  vel = 0.5,
  pan = 0,
  seed = 1,
  attack = 0.18,
  release = 0.3,
  cutoff = 1700,
  width = 0.65,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + release + 0.04) * SR));
  if (!n) return;
  const list = notes.slice(0, 8).map((freq, k) => {
    const [pl, pr] = panGains(pan + (k % 2 ? width * 0.4 : -width * 0.4));
    return {
      freq,
      pl,
      pr,
      ph1: unitAt(seed + k, 1),
      ph2: unitAt(seed + k, 2),
      ph3: unitAt(seed + k, 3),
      det: (unitAt(seed + k, 7) - 0.5) * 14,
      norm: 1 / Math.sqrt(notes.length),
    };
  });
  const lpL = new Svf(0).set(cutoff, 0.8, SR);
  const lpR = new Svf(0).set(cutoff * 1.05, 0.8, SR);
  const lfo = smoothRandom(seed + 8, 8);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = smoothEnv(tt, dur + release, attack, release);
    if (env <= 0) continue;
    const mod = 1 + 0.08 * lfo(tt * 2.3);
    let l = 0;
    let r = 0;
    for (let k = 0; k < list.length; k++) {
      const v = list[k];
      const inc = (v.freq * Math.pow(2, v.det / 1200) * mod) / SR;
      l += (sawSample(v.ph1 + inc * i, inc) + sawSample(v.ph2 + inc * 1.004 * i, inc) * 0.7) * v.pl * v.norm;
      r += (sawSample(v.ph2 + inc * 0.997 * i, inc) + sawSample(v.ph3 + inc * 1.007 * i, inc) * 0.7) * v.pr * v.norm;
    }
    l = lpL.tick(l) * env;
    r = lpR.tick(r) * env;
    ctx.L[off + i] += l * vel * 0.32;
    ctx.R[off + i] += r * vel * 0.32;
  }
}

/* ================================================================== texturas */

/** Lecho de vinilo: siseo, polvo y crujidos; siempre por debajo de la mezcla. */
export function vinylBed(ctx, dur, { amount = 0.55, seed = 1, crackle = 1, hiss = 1 } = {}) {
  const n = limit(ctx, 0, Math.ceil(dur * SR));
  const pinkL = new PinkFilter();
  const pinkR = new PinkFilter();
  const brownL = new BrownFilter();
  const brownR = new BrownFilter();
  const hpL = new Biquad().set('highpass', 800, 0.7, 0, SR);
  const hpR = new Biquad().set('highpass', 950, 0.7, 0, SR);
  const cs = seed + 91;
  for (let i = 0; i < n; i++) {
    const wl = noiseAt(seed, i);
    const wr = noiseAt(seed + 3, i);
    let l = hpL.tick(wl) * 0.009 * hiss;
    let r = hpR.tick(wr) * 0.009 * hiss;
    l += brownL.tick(noiseAt(seed + 11, i)) * 0.006;
    r += brownR.tick(noiseAt(seed + 13, i)) * 0.006;
    if (unitAt(cs, i) < 0.000055) {
      const a = (0.25 + unitAt(cs + 1, i) * 0.75) * 0.075 * crackle;
      l += a;
      r += a * (0.25 + unitAt(cs + 2, i) * 0.5);
      if (i + 1 < n) { l = l; ctx.L[i + 1] += -a * 0.4; ctx.R[i + 1] += -a * 0.3; }
      if (i + 2 < n) { ctx.L[i + 2] += a * 0.18; }
    }
    if (unitAt(cs + 7, i) < 0.55 / SR) {
      const a = (0.55 + unitAt(cs + 8, i) * 0.5) * 0.09 * crackle;
      l += a;
      r += a * 0.8;
    }
    ctx.L[i] += l * amount;
    ctx.R[i] += r * amount;
  }
}

/** Lluvia tras el cristal: ruido rosa filtrado, gotas y un rumor lejano. */
export function rainBed(ctx, dur, { amount = 0.5, seed = 1, drops = 1 } = {}) {
  const n = limit(ctx, 0, Math.ceil(dur * SR));
  const pinkL = new ColoredNoise(seed, 'rosa');
  const pinkR = new ColoredNoise(seed + 2, 'rosa');
  const hpL = new Biquad().set('highpass', 260, 0.7, 0, SR);
  const hpR = new Biquad().set('highpass', 220, 0.7, 0, SR);
  const lpL = new Biquad().set('lowpass', 6200, 0.6, 0, SR);
  const lpR = new Biquad().set('lowpass', 5600, 0.6, 0, SR);
  const swell = smoothRandom(seed + 5, 7);
  const dropL = new Biquad().set('bandpass', 2400, 1.2, 0, SR);
  const dropR = new Biquad().set('bandpass', 2700, 1.2, 0, SR);
  const brown = new BrownFilter();
  const dropSeed = seed + 17;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const s = 0.72 + 0.28 * swell(tt * 0.35);
    let l = lpL.tick(hpL.tick(pinkL.at(i))) * 0.26 * s;
    let r = lpR.tick(hpR.tick(pinkR.at(i))) * 0.26 * s;
    // Gotas: impulsos cortos filtrados, sin caer en un patrón audible.
    if (unitAt(dropSeed, i) < (6.5 * drops) / SR) {
      const a = (0.2 + unitAt(dropSeed + 1, i) * 0.8) * 0.12;
      const pan = unitAt(dropSeed + 2, i) * 2 - 1;
      const [pl, pr] = panGains(pan);
      const k = Math.min(n - i, Math.ceil(0.02 * SR));
      for (let j = 0; j < k; j++) {
        const e = Math.exp(-j / (0.0038 * SR));
        const q = noiseAt(dropSeed + 3 + i, j) * e * a;
        ctx.L[i + j] += dropL.tick(q) * pl;
        ctx.R[i + j] += dropR.tick(q) * pr;
      }
    }
    // Rumor de ventana.
    const room = brown.tick(noiseAt(seed + 31, i)) * 0.04;
    l += room;
    r += room * 0.9;
    ctx.L[i] += l * amount;
    ctx.R[i] += r * amount;
  }
}

/** Ciudad de noche: tráfico lejano, un coche que pasa y un eco de sirena. */
export function streetBed(ctx, dur, { amount = 0.45, seed = 1 } = {}) {
  const n = limit(ctx, 0, Math.ceil(dur * SR));
  const brownL = new BrownFilter();
  const brownR = new BrownFilter();
  const lpL = new Biquad().set('lowpass', 900, 0.6, 0, SR);
  const lpR = new Biquad().set('lowpass', 780, 0.6, 0, SR);
  const hp = new Biquad().set('highpass', 60, 0.7, 0, SR);
  const swell = smoothRandom(seed + 2, 6);
  const pass = smoothRandom(seed + 3, 4);
  const car = new Biquad().set('bandpass', 620, 0.8, 0, SR);
  const car2 = new Biquad().set('bandpass', 520, 0.8, 0, SR);
  let sirenPh = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const s = 0.65 + 0.35 * swell(tt * 0.18);
    let l = lpL.tick(hp.tick(brownL.tick(noiseAt(seed, i)))) * 0.22 * s;
    let r = lpR.tick(hp.tick(brownR.tick(noiseAt(seed + 5, i)))) * 0.22 * s;
    // Un coche pasa cada cierto tiempo, de izquierda a derecha.
    const p = pass(tt * 0.13);
    if (p > 0.18 && p < 0.9) {
      const pan = clamp((p - 0.54) * 2.4, -1, 1);
      const [pl, pr] = panGains(pan);
      const e = Math.sin(((p - 0.18) / 0.72) * Math.PI) ** 2;
      const q = car.tick(noiseAt(seed + 44, i)) * e * 0.16;
      l += q * pl;
      r += car2.tick(noiseAt(seed + 45, i)) * e * 0.16 * pr;
    }
    // Sirena muy lejana, casi un recuerdo.
    const sirenEnv = Math.max(0, Math.sin(TAU * 0.055 * tt)) ** 6;
    sirenPh += (640 + 80 * Math.sin(TAU * 0.72 * tt)) / SR;
    const siren = Math.sin(TAU * sirenPh) * sirenEnv * 0.012;
    l += siren;
    r += siren * 0.8;
    ctx.L[i] += l * amount;
    ctx.R[i] += r * amount;
  }
}

/** Scratch: un stab de metal resampleado con la mano. */
export function scratch(ctx, t, dur, { vel = 0.8, pan = 0, seed = 1 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil(dur * SR));
  if (!n) return;
  // Fuente: acorde de metal corto, como un sample de discoteca.
  const srcN = Math.ceil(0.9 * SR);
  const src = new Float32Array(srcN);
  const freqs = [220, 261.63, 329.63];
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    for (let i = 0; i < srcN; i++) {
      const tt = i / SR;
      const env = Math.exp(-tt / 0.28) * (1 - Math.exp(-tt / 0.008));
      src[i] += (sawSample((f * i) / SR, f / SR) * 0.55 + Math.sin(TAU * f * 2 * tt) * 0.12) * env;
    }
  }
  const srcLp = new Biquad().set('lowpass', 5200, 0.6, 0, SR);
  const srcHp = new Biquad().set('highpass', 220, 0.7, 0, SR);
  for (let i = 0; i < srcN; i++) src[i] = srcHp.tick(srcLp.tick(softClip(src[i] * 2, 2)));
  const [pl, pr] = panGains(pan);
  const outLp = new Biquad().set('lowpass', 6800, 0.7, 0, SR);
  const outHp = new Biquad().set('highpass', 160, 0.7, 0, SR);
  // Curva de velocidad: adelante, atrás, adelante y frenada.
  const moves = [
    [0.0, 0.08, 2.7], [0.08, 0.19, -1.9], [0.19, 0.3, 2.2], [0.3, 0.44, -0.8], [0.44, 0.56, 0.25],
  ];
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    let rate = 0;
    for (const [a, b, r] of moves) {
      if (tt >= a && tt < b) {
        const u = (tt - a) / (b - a);
        rate = r * (0.55 + 0.45 * Math.sin(Math.PI * u));
      }
    }
    if (tt > 0.56) rate = 0;
    pos += rate;
    pos = clamp(pos, 0, srcN - 2);
    const pi = pos | 0;
    const pf = pos - pi;
    let v = src[pi] + (src[pi + 1] - src[pi]) * pf;
    // La aguja corta en seco al final.
    const env = smoothEnv(tt, 0.66, 0.003, 0.035);
    v *= env;
    if (i < 0.004 * SR) v *= i / (0.004 * SR);
    v = outHp.tick(outLp.tick(v));
    const crack = noiseAt(seed + 9, i) * 0.025 * env;
    ctx.L[off + i] += (v + crack) * pl * vel * 0.8;
    ctx.R[off + i] += (v * 0.96 - crack) * pr * vel * 0.8;
  }
}

/** Voz cortada: un "ooh" de formantes, en frases cortas. */
export function vocalChop(ctx, t, freq, dur, {
  vel = 0.55,
  pan = 0,
  seed = 1,
  vowel = 0.6,
  bend = 0,
} = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((dur + 0.25) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const forms = [
    [800, 1150, 2900],
    [450, 800, 2830],
    [325, 700, 2530],
  ];
  const v = clamp(vowel, 0, 1) * 2;
  const a = Math.min(1, Math.floor(v));
  const u = v - a;
  const formants = forms[0].map((_, k) => forms[a][k] + (forms[Math.min(2, a + 1)][k] - forms[a][k]) * u);
  const amps = new Float32Array(40);
  for (let h = 1; h <= 40; h++) {
    const f = freq * h;
    let resp = 0;
    for (let q = 0; q < 3; q++) {
      const Q = 7;
      const x = f / formants[q];
      resp += [1, 0.55, 0.28][q] / Math.sqrt(1 + Q * Q * (x - 1 / x) * (x - 1 / x));
    }
    amps[h - 1] = (Math.pow(h, -1.1) * resp) / (1 + (f / 4800) ** 2);
  }
  const ph = unitAt(seed, 2);
  const ph2 = unitAt(seed, 3);
  const vibPh = unitAt(seed, 4) * TAU;
  const bp = new Biquad().set('bandpass', 1800, 1.1, 0, SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const env = smoothEnv(tt, dur, 0.025, 0.09);
    const vib = 1 + 0.007 * Math.sin(TAU * 5.2 * tt + vibPh);
    const glide = bend ? Math.pow(2, (bend * (1 - Math.min(1, tt / 0.12))) / 12) : 1;
    const inc = (freq * vib * glide) / SR;
    let s1 = 0;
    let s2 = 0;
    for (let h = 1; h <= 40; h++) {
      const amp = amps[h - 1];
      if (amp < 1e-5) continue;
      s1 += Math.sin(TAU * (ph + inc * h * i)) * amp;
      s2 += Math.sin(TAU * (ph2 + inc * h * i + 0.02)) * amp;
    }
    const breath = bp.tick(noiseAt(seed + 7, i)) * 0.03;
    const y1 = (s1 + breath) * env * vel * 0.5;
    const y2 = (s2 + breath) * env * vel * 0.5;
    ctx.L[off + i] += y1 * pl;
    ctx.R[off + i] += y2 * pr;
  }
}

/** Campanas lejanas: bronce modal, con una cola larga y aire. */
export function bell(ctx, t, freq, { vel = 0.5, pan = 0, seed = 1, decay = 3.5 } = {}) {
  const off = offOf(t);
  const n = limit(ctx, off, Math.ceil((decay + 0.2) * SR));
  if (!n) return;
  const [pl, pr] = panGains(pan);
  const modes = [[0.5, 0.22, 1.3], [1, 1, 1], [1.19, 0.42, 0.7], [1.51, 0.22, 0.55], [2.01, 0.48, 0.45], [2.53, 0.16, 0.3], [3.02, 0.2, 0.25], [4.07, 0.09, 0.18]];
  const ph = modes.map((_, k) => unitAt(seed + k, 3));
  const inc = modes.map(([r]) => (freq * r) / SR);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    const attack = 1 - Math.exp(-tt / 0.004);
    let y = 0;
    for (let k = 0; k < modes.length; k++) {
      y += sineCycle(ph[k] + inc[k] * i) * modes[k][1] * Math.exp(-tt / (decay * modes[k][2]));
    }
    y *= attack * 0.18 * vel;
    y += noiseAt(seed + 13, i) * Math.exp(-tt / 0.006) * 0.05;
    ctx.L[off + i] += y * pl;
    ctx.R[off + i] += y * pr;
  }
}
