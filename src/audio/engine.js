/**
 * Motor de Looping: renderiza cada sonido del catálogo y mezcla la línea de
 * tiempo en un bucle estéreo. La escucha y la exportación usan exactamente los
 * mismos buffers.
 */

import { SOUND_BY_ID, SOUNDS, makeContext } from './catalog.js';
import {
  Biquad, Freeverb, SR, addWow, clamp, dbToAmp, dbToGain, fadeEdges, gainToDb, loopCrossfade,
  normalizeRms, peaksOf, rmsOf, peakOf,
} from './dsp.js';
import { createRng, seedFrom } from './rng.js';

const cache = new Map();
const MAX_CACHE = 48;

const DRY_TAIL = {
  ritmos: 0.24,
  bajos: 0.32,
  armonias: 1.05,
  texturas: 0.04,
};

/**
 * Un sonido ocupa N tiempos; además guardamos una cola para que la reverb y
 * las notas no se corten al terminar el bloque.
 */
export function renderSound(sound, bpm, sr = SR) {
  const key = `${sound.id}@${bpm}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const beatSec = 60 / bpm;
  const nominal = sound.beats * beatSec;
  const room = sound.room;
  const roomTail = room ? Math.max(0.18, room.decay * 0.72 + (room.predelay || 0)) : 0;
  const tail = (sound.tail ?? DRY_TAIL[sound.category] ?? 0.5) + roomTail;
  const loopExtra = sound.loopSafe ? sound.loopSafe : 0;
  const total = nominal + tail + loopExtra + 0.03;

  const ctx = makeContext(total, bpm);
  ctx.rng = createRng(seedFrom('looping-sound', sound.id, bpm));
  ctx.soundId = sound.id;
  ctx.beats = sound.beats;
  ctx.nominal = nominal;
  sound.render(ctx);

  // Cinta: wow, paso bajo y un poco de siseo, siempre antes de la reverb para
  // que la habitación no se coma el efecto.
  if (sound.tape) {
    const t = sound.tape;
    if (t.wow) addWow(ctx.L, ctx.R, { depthCents: t.wow, rate: t.rate || 0.25, flutter: t.flutter || 2.1, flutterDepth: 1.1 });
    const lpL = new Biquad().set('lowpass', t.cutoff || 11000, 0.6, 0, SR);
    const lpR = new Biquad().set('lowpass', (t.cutoff || 11000) * 1.03, 0.6, 0, SR);
    const drive = t.drive || 1.05;
    const hiss = t.hiss || 0;
    const rng = createRng(seedFrom('tape', sound.id));
    for (let i = 0; i < ctx.n; i++) {
      let l = lpL.tick(ctx.L[i]);
      let r = lpR.tick(ctx.R[i]);
      l = Math.tanh(l * drive) / Math.tanh(drive);
      r = Math.tanh(r * drive) / Math.tanh(drive);
      if (hiss) {
        l += rng.range(-hiss, hiss);
        r += rng.range(-hiss, hiss);
      }
      ctx.L[i] = l;
      ctx.R[i] = r;
    }
  }

  let L = ctx.L;
  let R = ctx.R;

  // Las texturas se pliegan para que el bucle no tenga costura.
  if (sound.loopSafe) {
    const nominalSamples = Math.round(nominal * SR);
    const extra = Math.round(sound.loopSafe * SR);
    [L, R] = loopCrossfade(L, R, nominalSamples, extra);
  }

  // Reverb propia del sonido, con su tamaño y su cola.
  if (room) {
    const wetL = new Float32Array(L.length);
    const wetR = new Float32Array(R.length);
    const rv = new Freeverb(SR, room);
    rv.process(L.slice(), R.slice(), wetL, wetR, L.length);
    for (let i = 0; i < L.length; i++) {
      L[i] += wetL[i] * room.amount;
      R[i] += wetR[i] * room.amount;
    }
  }

  // Quita continua y un pelo de subgraves inaudibles.
  const hpL = new Biquad().set('highpass', 22, 0.7, 0, SR);
  const hpR = new Biquad().set('highpass', 22, 0.7, 0, SR);
  for (let i = 0; i < L.length; i++) {
    L[i] = hpL.tick(L[i]);
    R[i] = hpR.tick(R[i]);
  }

  // Un final suave para que la cola no termine en un Escalón.
  const edge = Math.min(Math.round(0.004 * SR), Math.floor(L.length / 4));
  for (let i = 0; i < edge; i++) {
    const g = i / edge;
    L[L.length - 1 - i] *= g;
    R[R.length - 1 - i] *= g;
  }

  const target = sound.peak ?? -8;
  if (sound.rms) {
    normalizeRms(L, R, sound.rms, -4);
  } else {
    const p = peakOf(L, R);
    if (p > 1e-9) {
      const g = dbToAmp(target) / p;
      for (let i = 0; i < L.length; i++) {
        L[i] *= g;
        R[i] *= g;
      }
    }
  }

  const actualPeakDb = gainToDb(peakOf(L, R));
  const out = {
    id: sound.id,
    sound,
    bpm,
    sr,
    beats: sound.beats,
    nominal,
    duration: L.length / sr,
    L,
    R,
    n: L.length,
    peaks: peaksOf(L, R, 80),
    peakDb: actualPeakDb,
    previewGain: clamp(dbToGain(-5 - actualPeakDb), 0.45, 5),
  };
  cache.set(key, out);
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  return out;
}

/** Longitud del bucle en tiempos: la capa más larga, redondeada al compás. */
export function loopUnitsFor(track) {
  let end = 0;
  for (const layer of track.layers || []) {
    for (const clip of layer.clips || []) {
      const s = SOUND_BY_ID[clip.soundId];
      if (!s) continue;
      end = Math.max(end, (clip.start || 0) + s.beats);
    }
  }
  return Math.max(4, Math.ceil(end / 4) * 4);
}

/** Unidades visibles: deja sitio para seguir colocando sonidos. */
export function displayUnitsFor(track) {
  const loop = loopUnitsFor(track);
  return Math.max(16, Math.ceil((loop + 8) / 4) * 4);
}

export function trackDuration(track, bpm) {
  return (loopUnitsFor(track) * 60) / bpm;
}

/** Suma un buffer de sonido dentro del bucle, plegando la cola. */
function addWrapped(dstL, dstR, srcL, srcR, start, gainL, gainR) {
  const n = dstL.length;
  const len = srcL.length;
  let pos = start % n;
  let i = 0;
  while (i < len) {
    const chunk = Math.min(n - pos, len - i);
    for (let k = 0; k < chunk; k++) {
      dstL[pos + k] += srcL[i + k] * gainL;
      dstR[pos + k] += srcR[i + k] * gainR;
    }
    i += chunk;
    pos += chunk;
    if (pos >= n) pos = 0;
  }
}

/** ¿Hay alguna capa en solo? */
function hasSolo(track) {
  return (track.layers || []).some((l) => l.solo);
}

/**
 * Mezcla el tema en un bucle. No normaliza a un pico fijo: normaliza por RMS
 * para que añadir capas no dispare ni desplome la escucha, y limita el pico.
 */
export function renderMix(track, bpm, sr = SR) {
  const loopUnits = loopUnitsFor(track);
  const beatSec = 60 / bpm;
  const loopSec = loopUnits * beatSec;
  const n = Math.round(loopSec * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const solo = hasSolo(track);

  for (const layer of track.layers || []) {
    if (layer.mute) continue;
    if (solo && !layer.solo) continue;
    const vol = clamp(layer.volume ?? 0.82, 0, 1.4);
    if (vol <= 0.0001) continue;
    for (const clip of layer.clips || []) {
      const sound = SOUND_BY_ID[clip.soundId];
      if (!sound) continue;
      const buf = renderSound(sound, bpm, sr);
      const start = Math.round((clip.start || 0) * beatSec * sr);
      const trim = sound.level ?? 1;
      addWrapped(L, R, buf.L, buf.R, start, vol * trim, vol * trim);
    }
  }

  // Bus maestro: quita continua, un toque de cinta y un límite de pico.
  const hpL = new Biquad().set('highpass', 24, 0.7, 0, sr);
  const hpR = new Biquad().set('highpass', 24, 0.7, 0, sr);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let l = hpL.tick(L[i]);
    let r = hpR.tick(R[i]);
    l = Math.tanh(l * 1.035) / Math.tanh(1.035);
    r = Math.tanh(r * 1.035) / Math.tanh(1.035);
    L[i] = l;
    R[i] = r;
    const al = Math.abs(l);
    const ar = Math.abs(r);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    sum += l * l + r * r;
  }

  const rms = Math.sqrt(sum / (n * 2));
  let gain = 1;
  if (rms > 1e-8) {
    const want = dbToAmp(-15.2);
    const ceiling = dbToAmp(-1.0);
    const maxByPeak = peak > 1e-8 ? ceiling / peak : 12;
    gain = Math.min(want / rms, maxByPeak, dbToAmp(18));
    gain = Math.max(gain, 0.0001);
  }
  for (let i = 0; i < n; i++) {
    L[i] *= gain;
    R[i] *= gain;
  }

  // 2,5 ms de fundido en la costura: imperceptible y sin chasquidos.
  fadeEdges(L, R, 2.5);

  return {
    L,
    R,
    n,
    sr,
    bpm,
    loopUnits,
    loopSec,
    peak: peakOf(L, R),
    rms: rmsOf(L, R),
    peaks: peaksOf(L, R, 160),
  };
}

export function clearSoundCache() {
  cache.clear();
}

export function warmSound(soundId, bpm, sr = SR) {
  const s = SOUND_BY_ID[soundId];
  if (!s) return null;
  return renderSound(s, bpm, sr);
}

export function hasSound(soundId, bpm) {
  return cache.has(`${soundId}@${bpm}`);
}

/** Sonidos con al menos un clip en el tema. */
export function soundsInTrack(track) {
  const ids = new Set();
  for (const layer of track.layers || []) {
    for (const clip of layer.clips || []) ids.add(clip.soundId);
  }
  return [...ids].filter((id) => SOUND_BY_ID[id]);
}

/**
 * Construye el audio de una exportación de `seconds` segundos. Repite el
 * bucle y aplica fundido de entrada y de salida.
 */
export function renderExport(track, bpm, seconds, { fadeOut = 2, fadeIn = 0.012, sr = SR } = {}) {
  const loop = renderMix(track, bpm, sr);
  const n = Math.max(1, Math.round(seconds * sr));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  // Copia por bloques; el último puede quedar cortado a propósito.
  let pos = 0;
  while (pos < n) {
    const chunk = Math.min(loop.n, n - pos);
    L.set(loop.L.subarray(0, chunk), pos);
    R.set(loop.R.subarray(0, chunk), pos);
    pos += chunk;
  }
  const fin = Math.min(Math.round(fadeIn * sr), n);
  for (let i = 0; i < fin; i++) {
    const g = i / fin;
    L[i] *= g;
    R[i] *= g;
  }
  if (fadeOut > 0) {
    const f = Math.min(Math.round(fadeOut * sr), n);
    for (let i = 0; i < f; i++) {
      const x = i / f;
      const g = 1 - Math.pow(x, 1.6);
      L[n - 1 - i] *= g;
      R[n - 1 - i] *= g;
    }
  }
  // Seguridad de pico después del fundido.
  let p = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]);
    const b = Math.abs(R[i]);
    if (a > p) p = a;
    if (b > p) p = b;
  }
  const cap = dbToAmp(-1.1);
  if (p > cap) {
    const g = cap / p;
    for (let i = 0; i < n; i++) {
      L[i] *= g;
      R[i] *= g;
    }
  }
  return { L, R, n, sr, seconds: n / sr, loop };
}

/** Para pruebas y para el arranque: renderiza todo el catálogo. */
export function renderCatalog(bpm, sr = SR) {
  return SOUNDS.map((s) => renderSound(s, bpm, sr));
}
