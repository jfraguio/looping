/**
 * Catálogo de Looping.
 *
 * Todo está compuesto en Re menor. Los ritmos, bajos y armonías comparten la
 * misma escala y los mismos acentos para que cualquier combinación razonable
 * suene a una base y no a una colisión.
 *
 * Una unidad de la línea de tiempo es un tiempo (un cuarto de compás). Los
 * sonidos ocupan 1, 2, 4 u 8 tiempos.
 */

import {
  freqOf, noteToMidi,
} from './dsp.js';
import { createRng, seedFrom } from './rng.js';
import {
  analogPad, bell, brush, choirPad, clap, conga, cymbal, feltPiano, flute, hat,
  kick, musicBox, nylonGuitar, rainBed, rhodes, rim, roundBass, scratch, shaker,
  snare, streetBed, stringsPad, sub808, synthBass, uprightBass, vibraphone,
  vinylBed, vocalChop, wurli,
} from './instruments.js';

export const CATEGORIES = [
  { id: 'ritmos', name: 'Ritmos', short: 'ritmo', color: '#e64b2a', ink: '#1b1512' },
  { id: 'bajos', name: 'Bajos', short: 'bajo', color: '#2447d8', ink: '#f7f2e6' },
  { id: 'armonias', name: 'Armonías', short: 'armonía', color: '#f2b705', ink: '#1b1512' },
  { id: 'texturas', name: 'Texturas', short: 'textura', color: '#2e7d4f', ink: '#f7f2e6' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

const F = (n) => freqOf(n);
const H = (n) => noteToMidi(n);

/** Convierte un paso de 1/16 en segundos, con swing en los impares. */
function stepTime(ctx, step, swing = 0.028) {
  return (step * 0.25 + (step % 2 ? swing : 0)) * ctx.beatSec;
}

/** Desplazamiento humano determinista, en segundos. */
function jitter(ctx, amount = 0.002) {
  return ctx.rng.range(-amount, amount);
}

function vel(ctx, base, amount = 0.055) {
  return Math.max(0.05, Math.min(1, base + ctx.rng.range(-amount, amount)));
}

/** Patrón de batería: cada evento es [tipo, paso, velocidad, opciones]. */
function drums(ctx, events) {
  for (const ev of events) {
    const [type, step, v = 0.7, opts = {}] = ev;
    const t = stepTime(ctx, step) + jitter(ctx, opts.jitter ?? 0.0015);
    if (type === 'k') kick(ctx, t, { vel: v, ...opts });
    else if (type === 's') snare(ctx, t, { vel: v, ...opts });
    else if (type === 'h') hat(ctx, t, { vel: v, ...opts });
    else if (type === 'c') clap(ctx, t, { vel: v, ...opts });
    else if (type === 'r') rim(ctx, t, { vel: v, ...opts });
    else if (type === 'sh') shaker(ctx, t, { vel: v, ...opts });
    else if (type === 'g') conga(ctx, t, { vel: v, ...opts });
    else if (type === 'cy') cymbal(ctx, t, { vel: v, ...opts });
    else if (type === 'b') brush(ctx, t, { vel: v, ...opts });
  }
}

/* -------------------------------------------------------------- definiciones */

export const SOUNDS = [
  /* ============================================================== RITMOS */
  {
    id: 'boom-bap',
    name: 'Boom bap',
    category: 'ritmos',
    beats: 4,
    hint: 'Bombo redondo, caja con aire.',
    peak: -3.2,
    room: { amount: 0.16, decay: 0.55, size: 0.42, damping: 4800, predelay: 0.012 },
    render(ctx) {
      drums(ctx, [
        ['k', 0, 1, { decay: 0.34, pitch: 49, click: 0.55 }],
        ['k', 6, 0.86, { decay: 0.3, pitch: 47, click: 0.4 }],
        ['k', 10, 0.96, { decay: 0.36, pitch: 49, click: 0.45 }],
        ['k', 14, 0.32, { decay: 0.22, pitch: 52, click: 0.22 }],
        ['s', 4, 0.9, { decay: 0.16, tone: 196, bright: 1 }],
        ['s', 12, 1, { decay: 0.18, tone: 188, bright: 1.04 }],
        ['s', 7, 0.16, { decay: 0.08, tone: 220, bright: 0.8 }],
        ['s', 15, 0.12, { decay: 0.07, tone: 235, bright: 0.75 }],
        ['r', 11, 0.18, {}],
        ['h', 0, 0.72, { pan: 0.16 }],
        ['h', 2, 0.34, { pan: 0.12 }],
        ['h', 4, 0.54, { pan: 0.18 }],
        ['h', 6, 0.3, { pan: 0.11 }],
        ['h', 8, 0.62, { pan: 0.2 }],
        ['h', 10, 0.33, { pan: 0.12 }],
        ['h', 12, 0.5, { pan: 0.18 }],
        ['h', 14, 0.3, { pan: 0.1 }],
        ['h', 15, 0.16, { pan: 0.08 }],
      ]);
      // La aguja de un disco viejo, por debajo.
      vinylBed(ctx, ctx.duration, { amount: 0.2, seed: 7, crackle: 0.65, hiss: 0.7 });
    },
  },
  {
    id: 'cinta-vieja',
    name: 'Cinta vieja',
    category: 'ritmos',
    beats: 4,
    hint: 'Break gastado, polvo y wow.',
    peak: -3.5,
    room: { amount: 0.2, decay: 0.7, size: 0.5, damping: 3600, predelay: 0.018 },
    tape: { wow: 11, rate: 0.3, flutter: 2.4, cutoff: 3900, drive: 1.18, hiss: 0.0016 },
    render(ctx) {
      drums(ctx, [
        ['k', 0, 0.92, { decay: 0.3, pitch: 45, click: 0.32, drive: 1.3 }],
        ['k', 7, 0.7, { decay: 0.26, pitch: 44, click: 0.2, drive: 1.3 }],
        ['k', 10, 0.84, { decay: 0.32, pitch: 45, click: 0.28, drive: 1.3 }],
        ['s', 4, 0.78, { decay: 0.13, tone: 178, bright: 0.82 }],
        ['s', 12, 0.9, { decay: 0.15, tone: 174, bright: 0.85 }],
        ['s', 15, 0.11, { decay: 0.06, tone: 210, bright: 0.7 }],
        ['r', 6, 0.14, { pan: -0.16 }],
        ['h', 0, 0.5, { pan: 0.2 }],
        ['h', 3, 0.22, { pan: 0.1 }],
        ['h', 6, 0.36, { pan: 0.2 }],
        ['h', 10, 0.3, { pan: 0.12 }],
        ['h', 13, 0.24, { pan: 0.18 }],
        ['h', 14, 0.26, { open: true, pan: 0.14 }],
      ]);
      vinylBed(ctx, ctx.duration, { amount: 0.35, seed: 19, crackle: 1.1, hiss: 1 });
    },
  },
  {
    id: 'medio-tiempo',
    name: 'Medio tiempo',
    category: 'ritmos',
    beats: 4,
    hint: 'Caja a la mitad, charles brillantes.',
    peak: -3.4,
    room: { amount: 0.14, decay: 0.5, size: 0.4, damping: 5200, predelay: 0.01 },
    render(ctx) {
      drums(ctx, [
        ['k', 0, 1, { decay: 0.4, pitch: 46, click: 0.35, drive: 1.7 }],
        ['k', 7, 0.6, { decay: 0.28, pitch: 44, click: 0.2 }],
        ['k', 10, 0.9, { decay: 0.34, pitch: 46, click: 0.3 }],
        ['s', 8, 1, { decay: 0.19, tone: 185, bright: 1.08 }],
        ['s', 15, 0.14, { decay: 0.07, tone: 220, bright: 0.8 }],
        ['r', 5, 0.16, { pan: -0.2 }],
        ['h', 0, 0.55, { pan: 0.18 }],
        ['h', 1, 0.2, { pan: 0.12 }],
        ['h', 2, 0.44, { pan: 0.2 }],
        ['h', 3, 0.18, { pan: 0.11 }],
        ['h', 4, 0.48, { pan: 0.18 }],
        ['h', 5, 0.18, { pan: 0.1 }],
        ['h', 6, 0.4, { pan: 0.2 }],
        ['h', 7, 0.2, { pan: 0.12 }],
        ['h', 8, 0.5, { pan: 0.18 }],
        ['h', 9, 0.16, { pan: 0.1 }],
        ['h', 10, 0.4, { pan: 0.2 }],
        ['h', 11, 0.18, { pan: 0.12 }],
        ['h', 12, 0.46, { pan: 0.18 }],
        ['h', 13, 0.16, { pan: 0.1 }],
        ['h', 14, 0.3, { open: true, pan: 0.2 }],
      ]);
      vinylBed(ctx, ctx.duration, { amount: 0.16, seed: 31, crackle: 0.55, hiss: 0.6 });
    },
  },
  {
    id: 'callejon',
    name: 'Callejón',
    category: 'ritmos',
    beats: 8,
    hint: 'Dos compases, fantasmas y fills.',
    peak: -3.6,
    room: { amount: 0.18, decay: 0.75, size: 0.5, damping: 4400, predelay: 0.014 },
    render(ctx) {
      drums(ctx, [
        // compás 1
        ['k', 0, 0.98, { decay: 0.33, pitch: 48, click: 0.4 }],
        ['k', 6, 0.82, { decay: 0.28, pitch: 46, click: 0.3 }],
        ['k', 10, 0.9, { decay: 0.34, pitch: 48, click: 0.36 }],
        ['s', 4, 0.9, { decay: 0.15, tone: 192, bright: 0.96 }],
        ['s', 12, 0.98, { decay: 0.17, tone: 186, bright: 1 }],
        ['s', 7, 0.18, { decay: 0.07, tone: 220, bright: 0.7 }],
        ['s', 15, 0.2, { decay: 0.075, tone: 225, bright: 0.72 }],
        ['h', 0, 0.6, { pan: 0.18 }],
        ['h', 2, 0.3, { pan: 0.12 }],
        ['h', 4, 0.48, { pan: 0.2 }],
        ['h', 6, 0.32, { pan: 0.1 }],
        ['h', 8, 0.55, { pan: 0.18 }],
        ['h', 10, 0.3, { pan: 0.12 }],
        ['h', 12, 0.46, { pan: 0.2 }],
        ['h', 14, 0.34, { open: true, pan: 0.1 }],
        ['r', 13, 0.16, { pan: -0.16 }],
        // compás 2, con un pequeño fill al final
        ['k', 16, 0.98, { decay: 0.34, pitch: 48, click: 0.4 }],
        ['k', 22, 0.8, { decay: 0.28, pitch: 46, click: 0.28 }],
        ['k', 26, 0.9, { decay: 0.34, pitch: 48, click: 0.35 }],
        ['k', 30, 0.42, { decay: 0.24, pitch: 50, click: 0.2 }],
        ['s', 20, 0.9, { decay: 0.15, tone: 192, bright: 0.96 }],
        ['s', 28, 0.98, { decay: 0.17, tone: 186, bright: 1 }],
        ['s', 23, 0.2, { decay: 0.07, tone: 220, bright: 0.72 }],
        ['s', 31, 0.16, { decay: 0.06, tone: 230, bright: 0.7 }],
        ['h', 16, 0.55, { pan: 0.18 }],
        ['h', 18, 0.3, { pan: 0.12 }],
        ['h', 20, 0.46, { pan: 0.2 }],
        ['h', 22, 0.28, { pan: 0.1 }],
        ['h', 24, 0.52, { pan: 0.18 }],
        ['h', 26, 0.3, { pan: 0.12 }],
        ['h', 28, 0.44, { pan: 0.2 }],
        ['g', 29, 0.4, { freq: F('A3'), pan: -0.25, decay: 0.16 }],
        ['g', 30, 0.5, { freq: F('D3'), pan: 0.2, decay: 0.18 }],
        ['g', 31, 0.6, { freq: F('F3'), pan: 0.28, decay: 0.2 }],
        ['cy', 16, 0.2, { pan: 0.15, decay: 0.7 }],
      ]);
      vinylBed(ctx, ctx.duration, { amount: 0.22, seed: 44, crackle: 0.7, hiss: 0.8 });
    },
  },
  {
    id: 'palmas',
    name: 'Palmas',
    category: 'ritmos',
    beats: 2,
    hint: 'Claps y shaker, solo manos.',
    peak: -4.2,
    room: { amount: 0.22, decay: 0.65, size: 0.48, damping: 4200, predelay: 0.012 },
    render(ctx) {
      drums(ctx, [
        ['k', 0, 0.72, { decay: 0.24, pitch: 51, click: 0.18, sub: 0.1 }],
        ['c', 2, 0.75, { decay: 0.13, spread: 0.7, pan: -0.05 }],
        ['c', 5, 0.24, { decay: 0.07, spread: 0.4, pan: 0.18 }],
        ['c', 6, 0.62, { decay: 0.12, spread: 0.72, pan: 0.04 }],
        ['r', 7, 0.14, { pan: -0.18 }],
        ['sh', 0, 0.45, { pan: 0.24 }],
        ['sh', 1, 0.18, { pan: 0.1 }],
        ['sh', 2, 0.4, { pan: 0.28 }],
        ['sh', 3, 0.2, { pan: 0.12 }],
        ['sh', 4, 0.42, { pan: 0.24 }],
        ['sh', 5, 0.2, { pan: 0.1 }],
        ['sh', 6, 0.38, { pan: 0.26 }],
        ['sh', 7, 0.18, { pan: 0.12 }],
        ['g', 3, 0.25, { freq: F('A2'), pan: -0.28, decay: 0.18 }],
      ]);
    },
  },
  {
    id: 'tambores',
    name: 'Tambores',
    category: 'ritmos',
    beats: 4,
    hint: 'Congas y parches de madera.',
    peak: -3.8,
    room: { amount: 0.2, decay: 0.75, size: 0.5, damping: 4300, predelay: 0.015 },
    render(ctx) {
      drums(ctx, [
        ['k', 0, 0.9, { decay: 0.32, pitch: 47, click: 0.35 }],
        ['k', 10, 0.8, { decay: 0.3, pitch: 46, click: 0.28 }],
        ['s', 4, 0.72, { decay: 0.14, tone: 185, bright: 0.9 }],
        ['s', 12, 0.8, { decay: 0.15, tone: 180, bright: 0.92 }],
        ['g', 0, 0.5, { freq: F('A2'), pan: -0.32, decay: 0.24 }],
        ['g', 2, 0.32, { freq: F('D3'), pan: 0.25, decay: 0.18 }],
        ['g', 3, 0.22, { freq: F('F3'), pan: 0.35, decay: 0.14 }],
        ['g', 6, 0.48, { freq: F('D3'), pan: 0.3, decay: 0.22 }],
        ['g', 7, 0.3, { freq: F('A2'), pan: -0.25, decay: 0.2 }],
        ['g', 10, 0.36, { freq: F('F3'), pan: 0.36, decay: 0.15 }],
        ['g', 11, 0.2, { freq: F('D3'), pan: 0.2, decay: 0.12 }],
        ['g', 14, 0.4, { freq: F('A2'), pan: -0.3, decay: 0.2 }],
        ['sh', 1, 0.18, { pan: 0.3 }],
        ['sh', 3, 0.18, { pan: 0.2 }],
        ['sh', 5, 0.2, { pan: 0.3 }],
        ['sh', 7, 0.16, { pan: 0.22 }],
        ['sh', 9, 0.18, { pan: 0.3 }],
        ['sh', 11, 0.18, { pan: 0.2 }],
        ['sh', 13, 0.18, { pan: 0.3 }],
        ['sh', 15, 0.16, { pan: 0.22 }],
        ['r', 13, 0.12, { pan: 0.1 }],
      ]);
      vinylBed(ctx, ctx.duration, { amount: 0.12, seed: 52, crackle: 0.5, hiss: 0.4 });
    },
  },
  {
    id: 'trap-noche',
    name: 'Trap de noche',
    category: 'ritmos',
    beats: 4,
    hint: 'Sombras, charles y graves.',
    peak: -3.4,
    room: { amount: 0.09, decay: 0.45, size: 0.36, damping: 5600, predelay: 0.008 },
    render(ctx) {
      drums(ctx, [
        ['k', 0, 1, { decay: 0.5, pitch: 43, click: 0.24, drive: 1.9, sub: 0.26 }],
        ['k', 7, 0.6, { decay: 0.3, pitch: 45, click: 0.16 }],
        ['k', 10, 0.92, { decay: 0.44, pitch: 43, click: 0.22, drive: 1.8 }],
        ['s', 8, 1, { decay: 0.2, tone: 180, bright: 1.1 }],
        ['r', 14, 0.18, { pan: -0.2 }],
        ['h', 0, 0.55, { pan: 0.22 }],
        ['h', 1, 0.26, { pan: 0.1 }],
        ['h', 2, 0.42, { pan: 0.22 }],
        ['h', 3, 0.24, { pan: 0.1 }],
        ['h', 4, 0.48, { pan: 0.22 }],
        ['h', 5, 0.24, { pan: 0.1 }],
        ['h', 6, 0.58, { pan: 0.24 }],
        // un rollo de 32avos, muy de trap
        ['h', 6.5, 0.22, { pan: 0.08, open: false }],
        ['h', 7, 0.4, { pan: 0.14, open: false }],
        ['h', 8, 0.5, { pan: 0.22 }],
        ['h', 9, 0.22, { pan: 0.1 }],
        ['h', 10, 0.4, { pan: 0.22 }],
        ['h', 11, 0.24, { pan: 0.1 }],
        ['h', 12, 0.46, { pan: 0.22 }],
        ['h', 13, 0.22, { pan: 0.1 }],
        ['h', 14, 0.52, { open: true, pan: 0.24 }],
        ['h', 14.5, 0.2, { pan: 0.1 }],
        ['h', 15, 0.3, { pan: 0.12 }],
      ]);
      vinylBed(ctx, ctx.duration, { amount: 0.1, seed: 63, crackle: 0.4, hiss: 0.35 });
    },
  },
  {
    id: 'neo-soul',
    name: 'Neo soul',
    category: 'ritmos',
    beats: 4,
    hint: 'Cepillado, suave, de madrugada.',
    peak: -4,
    room: { amount: 0.26, decay: 0.85, size: 0.55, damping: 3800, predelay: 0.018 },
    tape: { wow: 4, rate: 0.22, cutoff: 7200, drive: 1.04, hiss: 0.0008 },
    render(ctx) {
      drums(ctx, [
        ['k', 0, 0.8, { decay: 0.3, pitch: 49, click: 0.18, sub: 0.16 }],
        ['k', 10, 0.66, { decay: 0.26, pitch: 47, click: 0.14, sub: 0.12 }],
        ['b', 4, 0.62, { decay: 0.18, pan: 0.14 }],
        ['b', 12, 0.7, { decay: 0.2, pan: -0.06 }],
        ['b', 7, 0.15, { decay: 0.1, pan: 0.08 }],
        ['c', 4, 0.2, { decay: 0.08, spread: 0.5, pan: -0.1 }],
        ['c', 12, 0.24, { decay: 0.09, spread: 0.55, pan: 0.1 }],
        ['sh', 0, 0.3, { pan: 0.24 }],
        ['sh', 1, 0.12, { pan: 0.1 }],
        ['sh', 2, 0.24, { pan: 0.26 }],
        ['sh', 3, 0.12, { pan: 0.1 }],
        ['sh', 4, 0.26, { pan: 0.24 }],
        ['sh', 5, 0.12, { pan: 0.1 }],
        ['sh', 6, 0.24, { pan: 0.26 }],
        ['sh', 7, 0.12, { pan: 0.1 }],
        ['sh', 8, 0.3, { pan: 0.24 }],
        ['sh', 9, 0.12, { pan: 0.1 }],
        ['sh', 10, 0.24, { pan: 0.26 }],
        ['sh', 11, 0.12, { pan: 0.1 }],
        ['sh', 12, 0.26, { pan: 0.24 }],
        ['sh', 13, 0.12, { pan: 0.1 }],
        ['sh', 14, 0.24, { pan: 0.26 }],
        ['sh', 15, 0.12, { pan: 0.1 }],
        ['r', 14, 0.1, { pan: -0.1 }],
      ]);
      vinylBed(ctx, ctx.duration, { amount: 0.12, seed: 77, crackle: 0.5, hiss: 0.5 });
    },
  },

  /* =============================================================== BAJOS */
  {
    id: 'contrabajo',
    name: 'Contrabajo',
    category: 'bajos',
    beats: 4,
    hint: 'Dedo, madera y una línea que camina.',
    peak: -4.6,
    room: { amount: 0.12, decay: 0.5, size: 0.42, damping: 4200, predelay: 0.01 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.016) + jitter(ctx, 0.0015);
      uprightBass(ctx, S(0), F('D2'), ctx.beatSec * 1.45, { vel: 0.9, seed: 101 });
      uprightBass(ctx, S(6), F('F2'), ctx.beatSec * 0.72, { vel: 0.66, seed: 102 });
      uprightBass(ctx, S(8), F('A2'), ctx.beatSec * 0.9, { vel: 0.78, seed: 103 });
      uprightBass(ctx, S(12), F('C3'), ctx.beatSec * 0.55, { vel: 0.62, seed: 104 });
      uprightBass(ctx, S(14), F('A2'), ctx.beatSec * 0.55, { vel: 0.56, seed: 105 });
    },
  },
  {
    id: 'sub-808',
    name: 'Sub 808',
    category: 'bajos',
    beats: 4,
    hint: 'Grave largo y deslizante.',
    peak: -4.2,
    level: 0.62,
    room: { amount: 0.04, decay: 0.4, size: 0.3, damping: 3000, predelay: 0.005 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0);
      sub808(ctx, S(0), F('D1'), ctx.beatSec * 1.8, { vel: 0.95, seed: 111, drive: 2.6, click: 0.14 });
      sub808(ctx, S(8), F('F1'), ctx.beatSec * 0.85, { vel: 0.84, seed: 112, glideFrom: F('D1'), glideTime: 0.06, drive: 2.4 });
      sub808(ctx, S(11), F('C2'), ctx.beatSec * 0.5, { vel: 0.7, seed: 113, drive: 2.2 });
      sub808(ctx, S(14), F('A1'), ctx.beatSec * 0.55, { vel: 0.72, seed: 114, drive: 2.3 });
    },
  },
  {
    id: 'bajo-redondo',
    name: 'Bajo redondo',
    category: 'bajos',
    beats: 2,
    hint: 'Pulso simple, gordo y corto.',
    peak: -4.4,
    level: 0.74,
    room: { amount: 0.05, decay: 0.35, size: 0.3, damping: 3500, predelay: 0.005 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.018);
      roundBass(ctx, S(0), F('D2'), ctx.beatSec * 0.82, { vel: 0.95, seed: 121 });
      roundBass(ctx, S(4), F('A1'), ctx.beatSec * 0.55, { vel: 0.72, seed: 122 });
      roundBass(ctx, S(6), F('D2'), ctx.beatSec * 0.45, { vel: 0.64, seed: 123 });
    },
  },
  {
    id: 'bajo-sucio',
    name: 'Bajo sucio',
    category: 'bajos',
    beats: 4,
    hint: 'Saturado, con filo.',
    peak: -4.4,
    level: 0.8,
    room: { amount: 0.06, decay: 0.4, size: 0.35, damping: 3200, predelay: 0.006 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.02);
      synthBass(ctx, S(0), F('D2'), ctx.beatSec * 0.6, { vel: 0.9, seed: 131, cutoff: 240, envAmt: 900, drive: 2.2, squareMix: 0.35 });
      synthBass(ctx, S(3), F('D2'), ctx.beatSec * 0.35, { vel: 0.58, seed: 132, cutoff: 220, envAmt: 600, drive: 2.4 });
      synthBass(ctx, S(6), F('F2'), ctx.beatSec * 0.55, { vel: 0.76, seed: 133, cutoff: 260, envAmt: 800, drive: 2.3 });
      synthBass(ctx, S(9), F('A2'), ctx.beatSec * 0.5, { vel: 0.68, seed: 134, cutoff: 300, envAmt: 700, drive: 2.1 });
      synthBass(ctx, S(12), F('C3'), ctx.beatSec * 0.45, { vel: 0.6, seed: 135, cutoff: 320, envAmt: 600, drive: 2 });
      synthBass(ctx, S(14), F('A2'), ctx.beatSec * 0.5, { vel: 0.55, seed: 136, cutoff: 280, envAmt: 500, drive: 2 });
    },
  },
  {
    id: 'cuerda-pulsada',
    name: 'Cuerda pulsada',
    category: 'bajos',
    beats: 4,
    hint: 'Púa seca, notas cortas.',
    peak: -4.6,
    level: 0.7,
    room: { amount: 0.1, decay: 0.5, size: 0.4, damping: 4500, predelay: 0.01 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.02);
      const notes = [
        [0, 'D2', 0.75, 0.9],
        [2, 'D3', 0.4, 0.6],
        [5, 'A2', 0.55, 0.75],
        [8, 'F2', 0.7, 0.8],
        [11, 'C3', 0.45, 0.6],
        [13, 'A2', 0.5, 0.58],
      ];
      for (const [step, note, beats, v] of notes) {
        uprightBass(ctx, S(step), F(note), ctx.beatSec * beats, { vel: v, seed: 140 + step });
      }
    },
  },
  {
    id: 'bajo-caminante',
    name: 'Bajo caminante',
    category: 'bajos',
    beats: 8,
    hint: 'Dos compases de jazz.',
    peak: -4.8,
    room: { amount: 0.14, decay: 0.6, size: 0.45, damping: 4000, predelay: 0.01 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.014) + jitter(ctx, 0.002);
      const notes = [
        [0, 'D2', 1.2, 0.88],
        [3, 'F2', 0.45, 0.66],
        [5, 'G2', 0.45, 0.62],
        [7, 'A2', 0.9, 0.78],
        [12, 'C3', 0.55, 0.64],
        [16, 'A2', 0.8, 0.72],
        [19, 'G2', 0.4, 0.56],
        [21, 'F2', 0.45, 0.6],
        [23, 'D2', 1.1, 0.82],
        [28, 'A2', 0.5, 0.6],
        [30, 'C3', 0.55, 0.56],
      ];
      for (const [step, note, beats, v] of notes) {
        uprightBass(ctx, S(step), F(note), ctx.beatSec * beats, { vel: v, seed: 160 + step });
      }
    },
  },
  {
    id: 'bajo-cine',
    name: 'Bajo cine',
    category: 'bajos',
    beats: 4,
    hint: 'Grave profundo y lento.',
    peak: -4.2,
    level: 0.5,
    room: { amount: 0.16, decay: 0.9, size: 0.55, damping: 2600, predelay: 0.02 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0);
      sub808(ctx, S(0), F('D1'), ctx.beatSec * 3.2, { vel: 0.9, seed: 171, drive: 1.8, click: 0.05, glideFrom: F('A0'), glideTime: 0.25 });
      sub808(ctx, S(12), F('A1'), ctx.beatSec * 0.9, { vel: 0.6, seed: 172, glideFrom: F('D1'), glideTime: 0.12, drive: 1.6, click: 0.03 });
    },
  },
  {
    id: 'bajo-minimal',
    name: 'Bajo minimal',
    category: 'bajos',
    beats: 2,
    hint: 'Una nota, mucho hueco.',
    peak: -4.6,
    level: 0.64,
    room: { amount: 0.06, decay: 0.45, size: 0.3, damping: 3500, predelay: 0.006 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0);
      roundBass(ctx, S(0), F('D1'), ctx.beatSec * 1.1, { vel: 0.95, seed: 181 });
      roundBass(ctx, S(6), F('D1'), ctx.beatSec * 0.35, { vel: 0.58, seed: 182 });
    },
  },

  /* ============================================================ ARMONÍAS */
  {
    id: 'rhodes-lluvia',
    name: 'Rhodes lluvia',
    category: 'armonias',
    beats: 4,
    hint: 'Acorde que brilla, con trémolo.',
    peak: -7.2,
    room: { amount: 0.28, decay: 1.7, size: 0.6, damping: 5000, predelay: 0.02 },
    tape: { wow: 5, rate: 0.27, cutoff: 10500, drive: 1.04, hiss: 0.0005 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.026);
      // Colchón armónico, casi imperceptible, debajo del arpegio.
      const pad = [['D3', 0.2], ['F3', 0.16], ['A3', 0.14], ['C4', 0.1]];
      for (const [n, v] of pad) {
        rhodes(ctx, S(0), F(n), ctx.beatSec * 3.7, {
          vel: v, seed: 200 + H(n), index: 1.6, indexDecay: 0.8, ampDecay: 2.4, tine: 0.1, trem: 0.05, detune: 4,
        });
      }
      const notes = [
        [0, 'D4', 0.7], [2, 'A4', 0.42], [4, 'F4', 0.48], [6, 'C5', 0.4],
        [8, 'E4', 0.42], [10, 'C5', 0.36], [12, 'A4', 0.42], [14, 'F4', 0.36],
      ];
      for (const [step, n, v] of notes) {
        rhodes(ctx, S(step) + jitter(ctx, 0.003), F(n), ctx.beatSec * 0.5, {
          vel: v, seed: 220 + step, index: 2.7, indexDecay: 0.35, ampDecay: 1.3, tine: 0.32, trem: 0.13, detune: 6,
        });
      }
    },
  },
  {
    id: 'wurli-calido',
    name: 'Wurli cálido',
    category: 'armonias',
    beats: 4,
    hint: 'Stabs de madera y trémolo.',
    peak: -6.8,
    room: { amount: 0.24, decay: 1.3, size: 0.55, damping: 4600, predelay: 0.016 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.03);
      const chords = [
        [0, ['D3', 'F3', 'A3', 'C4'], 0.9, 2.4],
        [10, ['Bb2', 'D3', 'F3', 'A3'], 0.78, 2.0],
        [14, ['D3', 'F3', 'A3', 'C4'], 0.55, 1.2],
      ];
      for (const [step, notes, v, beats] of chords) {
        for (const n of notes) {
          wurli(ctx, S(step) + jitter(ctx, 0.002), F(n), ctx.beatSec * beats, {
            vel: v * 0.8, seed: 300 + H(n) + step, ampDecay: 1.1, trem: 0.26, drive: 1.6,
          });
        }
      }
    },
  },
  {
    id: 'piano-fieltro',
    name: 'Piano de fieltro',
    category: 'armonias',
    beats: 8,
    hint: 'Teclas suaves, habitación vacía.',
    peak: -6.4,
    room: { amount: 0.36, decay: 2.4, size: 0.7, damping: 4300, predelay: 0.025 },
    tape: { wow: 4, rate: 0.2, cutoff: 9600, drive: 1.03, hiss: 0.0004 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.02);
      const roots = [
        [0, 'D2', 2], [8, 'Bb1', 2], [16, 'G2', 2], [24, 'D2', 2],
      ];
      for (const [step, n, beats] of roots) {
        feltPiano(ctx, S(step) + jitter(ctx, 0.003), F(n), ctx.beatSec * beats, {
          vel: 0.38, seed: 340 + step, ampDecay: 2.8, brightness: 0.3, noise: 0.13,
        });
      }
      const melody = [
        [0, 'D4', 0.6, 0.62], [2, 'F4', 0.4, 0.5], [4, 'A4', 0.7, 0.58], [6, 'C5', 0.5, 0.42],
        [9, 'Bb3', 0.7, 0.46], [11, 'D4', 0.4, 0.42], [13, 'F4', 0.6, 0.4], [15, 'A4', 0.5, 0.34],
        [16, 'G4', 0.7, 0.5], [18, 'Bb4', 0.5, 0.44], [20, 'D5', 0.7, 0.5], [22, 'C5', 0.4, 0.38],
        [25, 'A4', 0.6, 0.44], [27, 'F4', 0.4, 0.38], [29, 'D4', 0.8, 0.48],
      ];
      for (const [step, n, beats, v] of melody) {
        feltPiano(ctx, S(step) + jitter(ctx, 0.003), F(n), ctx.beatSec * beats, {
          vel: v, seed: 360 + step, ampDecay: 1.8 + (H(n) > 60 ? 0.4 : 0), brightness: 0.4, noise: 0.16,
        });
      }
      const chords = [
        [4, ['D3', 'F3', 'A3'], 0.18], [12, ['Bb2', 'D3', 'F3'], 0.16],
        [20, ['G2', 'Bb2', 'D3'], 0.16], [28, ['D3', 'F3', 'A3'], 0.18],
      ];
      for (const [step, notes, v] of chords) {
        for (const n of notes) {
          feltPiano(ctx, S(step) + jitter(ctx, 0.004), F(n), ctx.beatSec * 1.5, {
            vel: v, seed: 380 + H(n) + step, ampDecay: 2.2, brightness: 0.32, noise: 0.1,
          });
        }
      }
    },
  },
  {
    id: 'guitarra-suave',
    name: 'Guitarra suave',
    category: 'armonias',
    beats: 4,
    hint: 'Nylon, arpegio y cuerpo.',
    peak: -7,
    room: { amount: 0.24, decay: 1.3, size: 0.55, damping: 5000, predelay: 0.016 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.03);
      const notes = [
        [0, 'D3', 0.42], [2, 'A3', 0.36], [4, 'F3', 0.38], [6, 'C4', 0.34],
        [8, 'A3', 0.32], [10, 'F3', 0.34], [12, 'D3', 0.36], [14, 'A3', 0.28],
        [3, 'Bb3', 0.16], [11, 'Bb3', 0.14],
      ];
      for (const [step, n, v] of notes) {
        nylonGuitar(ctx, S(step) + jitter(ctx, 0.003), F(n), ctx.beatSec * 1.4, {
          vel: v, seed: 400 + H(n) + step, t60: 1.5, brightness: 0.52, pan: (step % 4 === 0 ? -0.12 : 0.1),
        });
      }
      uprightBass(ctx, S(0), F('D2'), ctx.beatSec * 1.7, { vel: 0.26, seed: 405 });
    },
  },
  {
    id: 'cuerdas-vintage',
    name: 'Cuerdas vintage',
    category: 'armonias',
    beats: 8,
    hint: 'Pad de cuerda, cine setentero.',
    peak: -7.4,
    room: { amount: 0.38, decay: 2.6, size: 0.75, damping: 4000, predelay: 0.03 },
    tape: { wow: 6, rate: 0.2, cutoff: 8200, drive: 1.05, hiss: 0.0006 },
    render(ctx) {
      const B = ctx.beatSec;
      const chords = [
        [0, ['D3', 'A3', 'D4', 'F4'], 2],
        [8, ['Bb2', 'F3', 'Bb3', 'D4'], 2],
        [16, ['G2', 'D3', 'G3', 'Bb3'], 2],
        [24, ['D3', 'A3', 'D4', 'F4'], 2],
      ];
      for (const [step, notes, beats] of chords) {
        stringsPad(ctx, stepTime(ctx, step, 0), notes.map(F), B * beats, {
          vel: 0.68, seed: 430 + step, attack: 0.35, release: 0.4, cutoff: 2200, width: 0.7,
        });
      }
      // Una octava alta muy tenue para que la cuerda brille.
      stringsPad(ctx, 0, [F('A4')], B * 8, { vel: 0.16, seed: 439, attack: 0.8, release: 0.9, cutoff: 3300, width: 0.9 });
    },
  },
  {
    id: 'vibrafono',
    name: 'Vibráfono',
    category: 'armonias',
    beats: 4,
    hint: 'Metal dulce, notas que flotan.',
    peak: -7.6,
    room: { amount: 0.32, decay: 2.1, size: 0.65, damping: 5400, predelay: 0.022 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.032);
      const notes = [
        [0, 'D5', 0.55], [2, 'F5', 0.42], [4, 'A5', 0.46], [6, 'C6', 0.36],
        [8, 'A5', 0.4], [10, 'F5', 0.34], [12, 'D5', 0.42], [14, 'A4', 0.28],
      ];
      for (const [step, n, v] of notes) {
        vibraphone(ctx, S(step) + jitter(ctx, 0.003), F(n), ctx.beatSec * 1.3, {
          vel: v, seed: 460 + H(n) + step, decay: 2.1, pan: (step % 4 === 0 ? -0.15 : 0.14),
        });
      }
    },
  },
  {
    id: 'flauta-nocturna',
    name: 'Flauta nocturna',
    category: 'armonias',
    beats: 4,
    hint: 'Aire y madera, melodía baja.',
    peak: -7.8,
    level: 0.82,
    room: { amount: 0.4, decay: 2.2, size: 0.7, damping: 5000, predelay: 0.03 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.018);
      const B = ctx.beatSec;
      const notes = [
        [0, 'D4', 1.05], [4, 'F4', 0.7], [7, 'G4', 0.5], [9, 'A4', 1.05],
        [13, 'C5', 0.55], [15, 'A4', 0.45],
      ];
      for (const [step, n, beats] of notes) {
        flute(ctx, S(step) + jitter(ctx, 0.005), F(n), B * beats, {
          vel: 0.55, seed: 480 + H(n) + step, vibrato: 4.7,
        });
        // Un eco muy bajo de la misma nota, como una sala grande.
        flute(ctx, S(step) + B * 0.38, F(n), B * beats * 0.7, {
          vel: 0.09, seed: 490 + H(n) + step, vibrato: 4.2,
        });
      }
    },
  },
  {
    id: 'coro-lejano',
    name: 'Coro lejano',
    category: 'armonias',
    beats: 8,
    hint: 'Voces sin palabras, al fondo.',
    peak: -8.2,
    room: { amount: 0.46, decay: 3, size: 0.85, damping: 4400, predelay: 0.04 },
    render(ctx) {
      const B = ctx.beatSec;
      const chords = [
        [0, ['D3', 'A3', 'D4', 'F4'], 2],
        [8, ['Bb2', 'F3', 'Bb3', 'D4'], 2],
        [16, ['G2', 'D3', 'G3', 'Bb3'], 2],
        [24, ['D3', 'A3', 'D4', 'F4'], 2],
      ];
      for (const [step, notes, beats] of chords) {
        choirPad(ctx, stepTime(ctx, step, 0), notes.map(F), B * beats, {
          vel: 0.5, seed: 510 + step, vowel: 0.42, attack: 0.4, release: 0.55, width: 0.8,
        });
      }
    },
  },
  {
    id: 'caja-musica',
    name: 'Caja de música',
    category: 'armonias',
    beats: 4,
    hint: 'Agujas y nostalgia.',
    peak: -7.8,
    room: { amount: 0.34, decay: 1.8, size: 0.6, damping: 5600, predelay: 0.02 },
    tape: { wow: 7, rate: 0.24, cutoff: 8800, drive: 1.04, hiss: 0.0006 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.028);
      const notes = [
        [0, 'D5', 0.5], [2, 'A4', 0.36], [4, 'F5', 0.46], [6, 'E5', 0.34],
        [8, 'D5', 0.42], [10, 'A4', 0.3], [12, 'C5', 0.38], [14, 'D5', 0.34],
      ];
      for (const [step, n, v] of notes) {
        musicBox(ctx, S(step) + jitter(ctx, 0.003), F(n), ctx.beatSec * 0.8, {
          vel: v, seed: 540 + H(n) + step, pan: (step % 4 === 0 ? -0.12 : 0.12),
        });
      }
      // Una nota grave de apoyo, casi un reloj.
      musicBox(ctx, S(0), F('D3'), ctx.beatSec * 3, { vel: 0.16, seed: 545, pan: 0 });
    },
  },
  {
    id: 'sinth-soul',
    name: 'Sinth soul',
    category: 'armonias',
    beats: 4,
    hint: 'Poli de los 70, filtro cálido.',
    peak: -7.3,
    room: { amount: 0.3, decay: 1.9, size: 0.65, damping: 4700, predelay: 0.022 },
    tape: { wow: 5, rate: 0.18, cutoff: 9800, drive: 1.05, hiss: 0.0004 },
    render(ctx) {
      const B = ctx.beatSec;
      analogPad(ctx, 0, [F('D3'), F('F3'), F('A3'), F('C4'), F('E4')], B * 2, {
        vel: 0.66, seed: 560, attack: 0.12, release: 0.25, cutoff: 1500, width: 0.7,
      });
      analogPad(ctx, stepTime(ctx, 8, 0), [F('Bb2'), F('D3'), F('F3'), F('A3')], B * 2, {
        vel: 0.6, seed: 570, attack: 0.16, release: 0.3, cutoff: 1700, width: 0.7,
      });
      // Un brillo de campana FM encima, muy breve.
      musicBox(ctx, stepTime(ctx, 4, 0), F('D5'), B * 0.6, { vel: 0.12, seed: 575, pan: 0.2 });
      musicBox(ctx, stepTime(ctx, 12, 0), F('A4'), B * 0.6, { vel: 0.1, seed: 576, pan: -0.15 });
    },
  },

  /* ============================================================ TEXTURAS */
  {
    id: 'vinilo',
    name: 'Vinilo',
    category: 'texturas',
    beats: 8,
    hint: 'Crujido, siseo y superficie.',
    peak: -19,
    rms: -36,
    loopSafe: 0.15,
    render(ctx) {
      vinylBed(ctx, ctx.duration, { amount: 0.9, seed: 601, crackle: 1.2, hiss: 1.1 });
    },
  },
  {
    id: 'lluvia',
    name: 'Lluvia',
    category: 'texturas',
    beats: 8,
    hint: 'Ventana empañada, gotas.',
    peak: -19,
    rms: -33.5,
    loopSafe: 0.25,
    render(ctx) {
      rainBed(ctx, ctx.duration, { amount: 0.9, seed: 611, drops: 1 });
    },
  },
  {
    id: 'calle',
    name: 'Calle',
    category: 'texturas',
    beats: 8,
    hint: 'Tráfico lejano, ciudad de noche.',
    peak: -19,
    rms: -34,
    loopSafe: 0.3,
    render(ctx) {
      streetBed(ctx, ctx.duration, { amount: 0.95, seed: 621 });
    },
  },
  {
    id: 'scratch',
    name: 'Scratch',
    category: 'texturas',
    beats: 2,
    hint: 'Aguja sobre el surco.',
    peak: -9,
    room: { amount: 0.1, decay: 0.35, size: 0.35, damping: 4200, predelay: 0.005 },
    render(ctx) {
      scratch(ctx, 0, ctx.beatSec * 0.92, { vel: 0.9, pan: -0.08, seed: 631 });
      scratch(ctx, stepTime(ctx, 4, 0.02), ctx.beatSec * 0.8, { vel: 0.62, pan: 0.16, seed: 632 });
      vinylBed(ctx, ctx.duration, { amount: 0.12, seed: 633, crackle: 0.8, hiss: 0.7 });
    },
  },
  {
    id: 'voz-cortada',
    name: 'Voz cortada',
    category: 'texturas',
    beats: 2,
    hint: 'Un «ooh» en trozos.',
    peak: -8.6,
    room: { amount: 0.22, decay: 1.1, size: 0.55, damping: 5000, predelay: 0.014 },
    render(ctx) {
      const B = ctx.beatSec;
      const chops = [
        [0, 'D4', 0.2, 0.7, -0.2], [2, 'F4', 0.16, 0.5, 0.16], [4, 'A4', 0.22, 0.6, -0.12],
        [6, 'C5', 0.18, 0.45, 0.2], [7.5, 'A4', 0.12, 0.3, 0.05],
      ];
      for (const [step, n, beats, v, pan] of chops) {
        vocalChop(ctx, stepTime(ctx, step, 0.02), F(n), B * beats, {
          vel: v, pan, seed: 650 + H(n) + step, vowel: 0.62, bend: step === 7.5 ? -1 : 0,
        });
      }
    },
  },
  {
    id: 'campanas',
    name: 'Campanas',
    category: 'texturas',
    beats: 4,
    hint: 'Bronce lejano en la niebla.',
    peak: -9,
    room: { amount: 0.5, decay: 3.4, size: 0.9, damping: 4300, predelay: 0.05 },
    render(ctx) {
      const S = (step) => stepTime(ctx, step, 0.02);
      const notes = [
        [0, 'D5', 0.52, -0.25], [5, 'A4', 0.36, 0.2], [9, 'F5', 0.32, -0.1], [13, 'E5', 0.24, 0.28],
      ];
      for (const [step, n, v, pan] of notes) {
        bell(ctx, S(step) + jitter(ctx, 0.004), F(n), { vel: v, pan, seed: 680 + H(n) + step, decay: 3.2 });
      }
    },
  },
];

export const SOUND_BY_ID = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));

/** Agrupados para la biblioteca. */
export const SOUND_GROUPS = CATEGORIES.map((c) => ({
  ...c,
  sounds: SOUNDS.filter((s) => s.category === c.id),
}));

export function makeContext(seconds, bpm) {
  const n = Math.ceil(seconds * 44100);
  const beatSec = 60 / bpm;
  const id = 'ctx';
  return {
    L: new Float32Array(n),
    R: new Float32Array(n),
    n,
    bpm,
    beatSec,
    duration: seconds,
    rng: createRng(seedFrom('looping', bpm, id)),
  };
}
