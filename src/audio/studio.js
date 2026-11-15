/**
 * Estudio de sonidos propios.
 *
 * Define los instrumentos que se pueden tocar en el teclado, los acordes de Re
 * menor y la conversión de una toma (notas o golpes) en un sonido del catálogo.
 *
 * Una receta es datos puros y se guarda en el álbum:
 *   { id, name, category, beats, instrument, notes: [...], hits: [...] }
 * El sonido que consume el motor se reconstruye a partir de ella al abrir el
 * proyecto, de modo que viaja en el JSON sin guardar funciones ni audio.
 */

import { SOUND_BY_ID, makeContext } from './catalog.js';
import {
  analogPad, bell, brush, choirPad, clap, conga, cymbal, feltPiano, flute, hat,
  kick, musicBox, nylonGuitar, rhodes, rim, roundBass, scratch, shaker, snare,
  stringsPad, sub808, synthBass, uprightBass, vibraphone, vocalChop, wurli,
} from './instruments.js';
import { midiToFreq, peakOf, SR } from './dsp.js';

export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const D_MINOR_PCS = new Set([2, 4, 5, 7, 9, 10, 0]); // D E F G A Bb C

export const STUDIO_FAMILIES = [
  { id: 'teclas', name: 'Teclas', hint: 'Acordes y melodías' },
  { id: 'bajos', name: 'Bajos', hint: 'Graves y líneas' },
  { id: 'bateria', name: 'Batería', hint: 'Pads de percusión' },
  { id: 'texturas', name: 'Texturas', hint: 'Scratch, voz y campanas' },
];

export const STUDIO_CHORDS = [
  { id: 'dm', name: 'Dm', pc: 2, intervals: [0, 3, 7], hint: 'Re menor' },
  { id: 'dm7', name: 'Dm7', pc: 2, intervals: [0, 3, 7, 10], hint: 'Re menor séptima' },
  { id: 'dm9', name: 'Dm9', pc: 2, intervals: [0, 3, 7, 10, 14], hint: 'Re menor novena' },
  { id: 'bb', name: 'Bb', pc: 10, intervals: [0, 4, 7], hint: 'Si bemol mayor' },
  { id: 'bbmaj7', name: 'Bbmaj7', pc: 10, intervals: [0, 4, 7, 11], hint: 'Si bemol séptima' },
  { id: 'gm', name: 'Gm', pc: 7, intervals: [0, 3, 7], hint: 'Sol menor' },
  { id: 'gm7', name: 'Gm7', pc: 7, intervals: [0, 3, 7, 10], hint: 'Sol menor séptima' },
  { id: 'am7', name: 'Am7', pc: 9, intervals: [0, 3, 7, 10], hint: 'La menor séptima' },
  { id: 'a7', name: 'A7', pc: 9, intervals: [0, 4, 7, 10], hint: 'La séptima' },
  { id: 'f', name: 'F', pc: 5, intervals: [0, 4, 7], hint: 'Fa mayor' },
  { id: 'c', name: 'C', pc: 0, intervals: [0, 4, 7], hint: 'Do mayor' },
];

/** Notas de un acorde dentro de las dos octavas visibles (empiezan en C). */
export function chordMidis(chord, octaveStart = 60) {
  const root = octaveStart + chord.pc;
  return chord.intervals.map((i) => root + i);
}

export function midiName(midi) {
  const m = Math.round(midi);
  return `${NOTE_NAMES_FLAT[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export function noteNamesForMidis(midis) {
  return midis.map((m) => NOTE_NAMES_FLAT[((m % 12) + 12) % 12]);
}

const NOTE_OPTS = {
  rhodes: (v) => ({ vel: v, seed: 701, index: 2.3, indexDecay: 0.42, ampDecay: 1.6, tine: 0.3, trem: 0.12, detune: 5 }),
  wurli: (v) => ({ vel: v, seed: 702, ampDecay: 0.95, trem: 0.26, drive: 1.5 }),
  felt: (v) => ({ vel: v, seed: 703, ampDecay: 2.2, brightness: 0.38, noise: 0.14 }),
  nylon: (v) => ({ vel: v, seed: 704, t60: 1.45, brightness: 0.52 }),
  vibes: (v) => ({ vel: v, seed: 705, decay: 1.9 }),
  box: (v) => ({ vel: v, seed: 706 }),
  flute: (v) => ({ vel: v, seed: 707, vibrato: 4.6 }),
  strings: (v) => ({ vel: v, seed: 708, attack: 0.22, release: 0.35, cutoff: 2400, width: 0.65 }),
  choir: (v) => ({ vel: v, seed: 709, attack: 0.3, release: 0.45, vowel: 0.42, width: 0.75 }),
  pad: (v) => ({ vel: v, seed: 710, attack: 0.14, release: 0.28, cutoff: 1650, width: 0.7 }),
  upright: (v) => ({ vel: v, seed: 711 }),
  sub: (v) => ({ vel: v, seed: 712, drive: 2.1, click: 0.07 }),
  round: (v) => ({ vel: v, seed: 713 }),
  synth: (v) => ({ vel: v, seed: 714, cutoff: 250, envAmt: 900, drive: 2, squareMix: 0.3 }),
  vocal: (v) => ({ vel: v, seed: 715, vowel: 0.6 }),
  bells: (v) => ({ vel: v, seed: 716, decay: 2.8 }),
};

const PAD_OPTS = {
  kick: { name: 'Bombo', render: (ctx, t, v) => kick(ctx, t, { vel: v, decay: 0.34, pitch: 49, click: 0.5 }) },
  snare: { name: 'Caja', render: (ctx, t, v) => snare(ctx, t, { vel: v, decay: 0.16, tone: 190, bright: 1 }) },
  hat: { name: 'Charles', render: (ctx, t, v) => hat(ctx, t, { vel: v, pan: 0.16 }) },
  openhat: { name: 'Charles abierto', render: (ctx, t, v) => hat(ctx, t, { vel: v, open: true, pan: 0.12 }) },
  clap: { name: 'Palmas', render: (ctx, t, v) => clap(ctx, t, { vel: v, spread: 0.65 }) },
  rim: { name: 'Aro', render: (ctx, t, v) => rim(ctx, t, { vel: v }) },
  shaker: { name: 'Shaker', render: (ctx, t, v) => shaker(ctx, t, { vel: v, pan: 0.22 }) },
  conga: { name: 'Conga', render: (ctx, t, v) => conga(ctx, t, { vel: v, freq: 196, pan: 0.2 }) },
  cymbal: { name: 'Plato', render: (ctx, t, v) => cymbal(ctx, t, { vel: v, decay: 0.7, pan: 0.16 }) },
  brush: { name: 'Escobillas', render: (ctx, t, v) => brush(ctx, t, { vel: v, pan: 0.1 }) },
};

const PADS = Object.entries(PAD_OPTS).map(([id, p]) => ({ id, name: p.name, render: p.render }));

export const STUDIO_INSTRUMENTS = [
  {
    id: 'rhodes', name: 'Rhodes', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 60, preview: 3.2, previewPeak: -9, ringOut: true,
    hint: 'Cálido, con trémolo',
    note: (ctx, t, f, d, v) => rhodes(ctx, t, f, d, NOTE_OPTS.rhodes(v)),
  },
  {
    id: 'wurli', name: 'Wurlitzer', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 60, preview: 2.6, previewPeak: -8.5, ringOut: true,
    hint: 'Madera y trémolo',
    note: (ctx, t, f, d, v) => wurli(ctx, t, f, d, NOTE_OPTS.wurli(v)),
  },
  {
    id: 'felt', name: 'Piano de fieltro', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 60, preview: 3.6, previewPeak: -8.5, ringOut: true,
    hint: 'Suave, de habitación',
    note: (ctx, t, f, d, v) => feltPiano(ctx, t, f, d, NOTE_OPTS.felt(v)),
  },
  {
    id: 'nylon', name: 'Guitarra de nailon', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 60, preview: 2.8, previewPeak: -8, ringOut: true,
    hint: 'Cuerda pulsada',
    note: (ctx, t, f, d, v) => nylonGuitar(ctx, t, f, d, NOTE_OPTS.nylon(v)),
  },
  {
    id: 'vibes', name: 'Vibráfono', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 72, preview: 3.2, previewPeak: -9, ringOut: true,
    hint: 'Metal dulce',
    note: (ctx, t, f, d, v) => vibraphone(ctx, t, f, d, NOTE_OPTS.vibes(v)),
  },
  {
    id: 'box', name: 'Caja de música', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 72, preview: 2.4, previewPeak: -9, ringOut: true,
    hint: 'Agujas y nostalgia',
    note: (ctx, t, f, d, v) => musicBox(ctx, t, f, d, NOTE_OPTS.box(v)),
  },
  {
    id: 'flute', name: 'Flauta', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 72, preview: 2.4, previewPeak: -8, ringOut: false,
    hint: 'Aire y madera',
    note: (ctx, t, f, d, v) => flute(ctx, t, f, d, NOTE_OPTS.flute(v)),
  },
  {
    id: 'strings', name: 'Cuerdas', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 60, preview: 3.2, previewPeak: -9, ringOut: false,
    hint: 'Pad de cuerda',
    note: (ctx, t, f, d, v) => stringsPad(ctx, t, [f], d, NOTE_OPTS.strings(v)),
  },
  {
    id: 'choir', name: 'Coro', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 60, preview: 3.4, previewPeak: -9, ringOut: false,
    hint: 'Voces sin palabras',
    note: (ctx, t, f, d, v) => choirPad(ctx, t, [f], d, NOTE_OPTS.choir(v)),
  },
  {
    id: 'pad', name: 'Sinth soul', family: 'teclas', audio: 'keys', kind: 'notes',
    category: 'armonias', defaultOctave: 60, preview: 3.0, previewPeak: -9, ringOut: false,
    hint: 'Poli de los 70',
    note: (ctx, t, f, d, v) => analogPad(ctx, t, [f], d, NOTE_OPTS.pad(v)),
  },
  {
    id: 'upright', name: 'Contrabajo', family: 'bajos', audio: 'bass', kind: 'notes',
    category: 'bajos', defaultOctave: 36, preview: 2.0, previewPeak: -7, ringOut: true,
    hint: 'Dedo y madera',
    note: (ctx, t, f, d, v) => uprightBass(ctx, t, f, d, NOTE_OPTS.upright(v)),
  },
  {
    id: 'sub', name: 'Sub 808', family: 'bajos', audio: 'bass', kind: 'notes',
    category: 'bajos', defaultOctave: 36, preview: 1.9, previewPeak: -6.5, ringOut: true,
    hint: 'Grave deslizante',
    note: (ctx, t, f, d, v) => sub808(ctx, t, f, d, NOTE_OPTS.sub(v)),
  },
  {
    id: 'round', name: 'Bajo redondo', family: 'bajos', audio: 'bass', kind: 'notes',
    category: 'bajos', defaultOctave: 36, preview: 1.8, previewPeak: -7, ringOut: true,
    hint: 'Pulso corto y gordo',
    note: (ctx, t, f, d, v) => roundBass(ctx, t, f, d, NOTE_OPTS.round(v)),
  },
  {
    id: 'synth', name: 'Bajo sucio', family: 'bajos', audio: 'bass', kind: 'notes',
    category: 'bajos', defaultOctave: 36, preview: 1.9, previewPeak: -7, ringOut: true,
    hint: 'Saturado, con filo',
    note: (ctx, t, f, d, v) => synthBass(ctx, t, f, d, NOTE_OPTS.synth(v)),
  },
  {
    id: 'kit', name: 'Batería', family: 'bateria', audio: 'drums', kind: 'pads',
    category: 'ritmos', preview: 1.2, previewPeak: -6,
    hint: 'Bombo, caja, charles…', pads: PADS,
  },
  {
    id: 'scratch', name: 'Scratch', family: 'texturas', audio: 'texture', kind: 'pads',
    category: 'texturas', preview: 2.0, previewPeak: -7,
    hint: 'Aguja sobre el surco',
    pads: [{
      id: 'scratch', name: 'Scratch', render: (ctx, t, v) => scratch(ctx, t, 0.82, { vel: v, seed: 801 }),
    }],
  },
  {
    id: 'vocal', name: 'Voz cortada', family: 'texturas', audio: 'texture', kind: 'notes',
    category: 'texturas', defaultOctave: 60, preview: 2.0, previewPeak: -7, ringOut: false,
    hint: 'Un «ooh» en trozos',
    note: (ctx, t, f, d, v) => vocalChop(ctx, t, f, d, NOTE_OPTS.vocal(v)),
  },
  {
    id: 'bells', name: 'Campanas', family: 'texturas', audio: 'texture', kind: 'notes',
    category: 'texturas', defaultOctave: 72, preview: 3.8, previewPeak: -8, ringOut: true,
    hint: 'Bronce lejano',
    note: (ctx, t, f, d, v) => bell(ctx, t, f, NOTE_OPTS.bells(v)),
  },
];

export const INSTRUMENT_BY_ID = Object.fromEntries(STUDIO_INSTRUMENTS.map((i) => [i.id, i]));

const TAIL_BY_AUDIO = { keys: 2.0, bass: 0.45, drums: 0.3, texture: 1.8 };

const META_BY_AUDIO = {
  keys: {
    peak: -7.2,
    room: { amount: 0.22, decay: 1.5, size: 0.55, damping: 5000, predelay: 0.018 },
  },
  bass: {
    peak: -4.6,
    room: { amount: 0.08, decay: 0.5, size: 0.35, damping: 3800, predelay: 0.008 },
  },
  drums: {
    peak: -3.5,
    room: { amount: 0.14, decay: 0.55, size: 0.4, damping: 4400, predelay: 0.012 },
  },
  texture: {
    peak: -8,
    room: { amount: 0.28, decay: 1.8, size: 0.6, damping: 4800, predelay: 0.02 },
  },
};

const BEATS_OK = new Set([1, 2, 4, 8]);
const CATEGORY_OK = new Set(['ritmos', 'bajos', 'armonias', 'texturas']);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function roundStep(v) { return Math.round(v * 4) / 4; }

/** Motor de una nota de estudio, usado tanto por la escucha como por el render final. */
export function renderInstrumentNote(instrument, ctx, t, midi, durSec, velocity = 0.8) {
  if (!instrument || instrument.kind !== 'notes' || !instrument.note) return;
  instrument.note(ctx, t, midiToFreq(midi), durSec, clamp(velocity, 0.1, 1));
}

export function renderInstrumentHit(instrument, ctx, t, padId, velocity = 0.8) {
  if (!instrument || instrument.kind !== 'pads') return;
  const pad = instrument.pads?.find((p) => p.id === padId);
  if (pad) pad.render(ctx, t, clamp(velocity, 0.1, 1));
}

/** Convierte una receta persistida en un sonido que entiende el motor. */
export function buildCustomSound(recipe) {
  if (!recipe || !INSTRUMENT_BY_ID[recipe.instrument]) return null;
  const inst = INSTRUMENT_BY_ID[recipe.instrument];
  const meta = META_BY_AUDIO[inst.audio] || META_BY_AUDIO.keys;
  const notes = Array.isArray(recipe.notes) ? recipe.notes : [];
  const hits = Array.isArray(recipe.hits) ? recipe.hits : [];
  if (!notes.length && !hits.length) return null;
  return {
    id: recipe.id,
    name: recipe.name || 'Sonido propio',
    category: CATEGORY_OK.has(recipe.category) ? recipe.category : inst.category,
    beats: BEATS_OK.has(recipe.beats) ? recipe.beats : 4,
    hint: `Propio · ${inst.name}`,
    custom: true,
    recipe,
    peak: meta.peak,
    room: meta.room,
    tail: TAIL_BY_AUDIO[inst.audio] ?? 1,
    level: 1,
    render(ctx) {
      const beatSec = ctx.beatSec || 60 / 84;
      if (inst.kind === 'notes') {
        for (const n of notes) {
          const start = clamp(Number(n.start) || 0, 0, recipe.beats);
          const length = clamp(Number(n.length) || 0.25, 0.05, recipe.beats - start);
          renderInstrumentNote(inst, ctx, start * beatSec, n.midi, length * beatSec, n.velocity);
        }
      } else {
        for (const h of hits) {
          const start = clamp(Number(h.start) || 0, 0, recipe.beats);
          renderInstrumentHit(inst, ctx, start * beatSec, h.pad, h.velocity);
        }
      }
    },
  };
}

let activeIds = new Set();
let activeCustoms = [];

export function getActiveCustomSounds() {
  return activeCustoms;
}

/** Registra los sonidos propios del álbum activo en el catálogo del motor. */
export function registerAlbumCustomSounds(album) {
  for (const id of activeIds) delete SOUND_BY_ID[id];
  activeIds = new Set();
  activeCustoms = [];
  const recipes = Array.isArray(album?.customSounds) ? album.customSounds : [];
  for (const recipe of recipes) {
    const sound = buildCustomSound(recipe);
    if (!sound || SOUND_BY_ID[sound.id]) continue;
    SOUND_BY_ID[sound.id] = sound;
    activeIds.add(sound.id);
    activeCustoms.push(sound);
  }
  return activeCustoms;
}

/* --------------------------------------------------------------- preview */

const previewCache = new Map();
const PREVIEW_CACHE_MAX = 80;

/**
 * Buffer de una nota o pad para escuchar mientras se toca. La escucha es seca
 * (la reverb se aplica al sonido final), pero el timbre es el mismo.
 */
export function renderPreviewBuffer(instrumentId, target, bpm) {
  const inst = INSTRUMENT_BY_ID[instrumentId];
  if (!inst) return null;
  const key = `${instrumentId}|${target.midi ?? target.pad}|${bpm}`;
  const hit = previewCache.get(key);
  if (hit) return hit;

  const seconds = inst.preview;
  const ctx = makeContext(seconds, bpm);
  if (inst.kind === 'notes') {
    inst.note(ctx, 0, midiToFreq(target.midi), Math.min(seconds * 0.55, 1.4), 0.82);
  } else {
    inst.pads.find((p) => p.id === target.pad)?.render(ctx, 0, 0.92);
  }
  const peak = peakOf(ctx.L, ctx.R);
  if (peak > 1e-8) {
    const g = Math.pow(10, inst.previewPeak / 20) / peak;
    for (let i = 0; i < ctx.n; i++) { ctx.L[i] *= g; ctx.R[i] *= g; }
  }
  // Un final muy corto evita chasquidos si el buffer se corta.
  const edge = Math.min(Math.round(0.004 * SR), Math.floor(ctx.n / 4));
  for (let i = 0; i < edge; i++) {
    const g = i / edge;
    ctx.L[ctx.n - 1 - i] *= g;
    ctx.R[ctx.n - 1 - i] *= g;
  }
  const out = { L: ctx.L, R: ctx.R, n: ctx.n, sr: SR, seconds: ctx.n / SR };
  previewCache.set(key, out);
  if (previewCache.size > PREVIEW_CACHE_MAX) previewCache.delete(previewCache.keys().next().value);
  return out;
}

/* -------------------------------------------------------------- sanitizar */

function cleanNotes(list, beats) {
  const out = [];
  const seen = new Map();
  for (const n of Array.isArray(list) ? list : []) {
    const midi = Math.round(Number(n?.midi));
    if (!Number.isFinite(midi) || midi < 21 || midi > 108) continue;
    const start = clamp(roundStep(Number(n.start) || 0), 0, Math.max(0, beats - 0.25));
    const length = clamp(roundStep(Number(n.length) || 0.25), 0.25, beats - start);
    const velocity = clamp(Number(n.velocity) || 0.8, 0.1, 1);
    seen.set(`${midi}@${start}`, { midi, start, length, velocity });
  }
  for (const n of seen.values()) out.push(n);
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi).slice(0, 128);
}

function cleanHits(list, beats, inst) {
  const out = [];
  const seen = new Set();
  const valid = new Set((inst.pads || []).map((p) => p.id));
  for (const h of Array.isArray(list) ? list : []) {
    if (!valid.has(h?.pad)) continue;
    const start = clamp(roundStep(Number(h.start) || 0), 0, Math.max(0, beats - 0.25));
    const key = `${h.pad}@${start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pad: h.pad, start, velocity: clamp(Number(h.velocity) || 0.85, 0.1, 1) });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, 128);
}

let fallbackSeq = 0;
function fallbackId() {
  fallbackSeq = (fallbackSeq + 1) % 100000;
  return `cs_${Date.now().toString(36)}${fallbackSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Limpia una receta leída de localStorage o de un proyecto importado. */
export function sanitizeCustomRecipe(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const inst = INSTRUMENT_BY_ID[raw.instrument];
  if (!inst) return null;
  const beats = BEATS_OK.has(Number(raw.beats)) ? Number(raw.beats) : 4;
  const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{3,80}$/.test(raw.id) ? raw.id : fallbackId();
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 48) : 'Sonido propio';
  const category = CATEGORY_OK.has(raw.category) ? raw.category : inst.category;
  const notes = cleanNotes(raw.notes, beats);
  const hits = cleanHits(raw.hits, beats, inst);
  if (!notes.length && !hits.length) return null;
  return {
    id,
    name,
    category,
    beats,
    instrument: inst.id,
    octaveStart: Number(raw.octaveStart) || inst.defaultOctave || 60,
    notes: inst.kind === 'notes' ? notes : [],
    hits: inst.kind === 'pads' ? hits : [],
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

export function categoryForInstrument(instrumentId) {
  return INSTRUMENT_BY_ID[instrumentId]?.category || 'armonias';
}

const NAME_BY_INSTRUMENT = {
  rhodes: 'Arpegio', wurli: 'Arpegio', felt: 'Melodía', nylon: 'Arpegio',
  vibes: 'Melodía', box: 'Melodía', flute: 'Melodía', strings: 'Acorde',
  choir: 'Coro', pad: 'Acorde', upright: 'Bajo', sub: 'Bajo', round: 'Bajo',
  synth: 'Bajo', kit: 'Ritmo', scratch: 'Scratch', vocal: 'Voz', bells: 'Campanas',
};

export function defaultNameFor(instrumentId, existing = []) {
  const base = NAME_BY_INSTRUMENT[instrumentId] || 'Sonido';
  const used = new Set(existing.map((s) => s.name));
  let n = 1;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
