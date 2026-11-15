/**
 * Estado, almacenamiento local y validación de proyectos.
 * No hay cuentas ni servidor: todo vive en este navegador. El archivo .json es
 * la copia portátil del álbum.
 */

import { SOUND_BY_ID, SOUNDS } from '../audio/catalog.js';
import { loopUnitsFor } from '../audio/engine.js';

export const STORAGE_KEY = 'looping.v1';
export const APP_ID = 'looping';
export const SCHEMA_VERSION = 1;
export const MAX_LAYERS = 8;

let seq = 0;
export function uid(prefix = 'id') {
  seq = (seq + 1) % 100000;
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${rnd}`;
}

export function emptyLayer(volume = 0.84) {
  return { id: uid('ly'), volume, mute: false, solo: false, clips: [] };
}

export function emptyTrack(name = 'Tema 1', bpm = 84) {
  return {
    id: uid('tr'),
    name,
    bpm,
    layers: [emptyLayer()],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function emptyAlbum(name = 'Sin título') {
  return {
    id: uid('al'),
    name,
    tracks: [emptyTrack('Tema 1')],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function demoAlbum() {
  const track = {
    id: uid('tr'),
    name: 'Boom bap 01',
    bpm: 86,
    layers: [
      { id: uid('ly'), volume: 0.62, mute: false, solo: false, clips: [{ id: uid('cl'), soundId: 'vinilo', start: 0 }] },
      { id: uid('ly'), volume: 0.93, mute: false, solo: false, clips: [{ id: uid('cl'), soundId: 'boom-bap', start: 0 }, { id: uid('cl'), soundId: 'boom-bap', start: 4 }] },
      { id: uid('ly'), volume: 0.86, mute: false, solo: false, clips: [{ id: uid('cl'), soundId: 'contrabajo', start: 0 }, { id: uid('cl'), soundId: 'contrabajo', start: 4 }] },
      { id: uid('ly'), volume: 0.78, mute: false, solo: false, clips: [{ id: uid('cl'), soundId: 'rhodes-lluvia', start: 0 }, { id: uid('cl'), soundId: 'rhodes-lluvia', start: 4 }] },
      { id: uid('ly'), volume: 0.5, mute: false, solo: false, clips: [{ id: uid('cl'), soundId: 'scratch', start: 6 }] },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const album = emptyAlbum('Sin título');
  album.id = uid('al');
  album.tracks = [track];
  album.createdAt = Date.now();
  album.updatedAt = Date.now();
  return {
    version: SCHEMA_VERSION,
    albums: [album],
    currentAlbumId: album.id,
    currentTrackId: track.id,
    recentRecipes: ['boom-bap'],
  };
}

function clampStart(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(256, Math.round(n)));
}

function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.84;
  return Math.max(0, Math.min(1.25, n));
}

/** Limpia una pista: sonidos válidos, sin solapes y con capas razonables. */
export function sanitizeTrack(raw, fallbackName = 'Tema') {
  const bpm = Math.max(55, Math.min(120, Math.round(Number(raw?.bpm) || 84)));
  const track = {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : uid('tr'),
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : fallbackName,
    bpm,
    layers: [],
    createdAt: Number(raw?.createdAt) || Date.now(),
    updatedAt: Number(raw?.updatedAt) || Date.now(),
  };
  const layers = Array.isArray(raw?.layers) ? raw.layers.slice(0, MAX_LAYERS) : [];
  for (const l of layers) {
    const layer = {
      id: typeof l?.id === 'string' && l.id ? l.id : uid('ly'),
      volume: clampVolume(l?.volume),
      mute: !!l?.mute,
      solo: !!l?.solo,
      clips: [],
    };
    const clips = Array.isArray(l?.clips) ? l.clips : [];
    const sorted = clips
      .filter((c) => c && SOUND_BY_ID[c.soundId])
      .map((c) => ({
        id: typeof c.id === 'string' && c.id ? c.id : uid('cl'),
        soundId: c.soundId,
        start: clampStart(c.start),
      }))
      .sort((a, b) => a.start - b.start);
    let lastEnd = -1;
    for (const c of sorted) {
      const beats = SOUND_BY_ID[c.soundId].beats;
      if (c.start < lastEnd) continue;
      layer.clips.push(c);
      lastEnd = c.start + beats;
    }
    track.layers.push(layer);
  }
  if (!track.layers.length) track.layers.push(emptyLayer());
  return track;
}

export function sanitizeAlbum(raw, fallbackName = 'Álbum') {
  const album = {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : uid('al'),
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : fallbackName,
    tracks: [],
    createdAt: Number(raw?.createdAt) || Date.now(),
    updatedAt: Number(raw?.updatedAt) || Date.now(),
  };
  const tracks = Array.isArray(raw?.tracks) ? raw.tracks.slice(0, 40) : [];
  for (const t of tracks) album.tracks.push(sanitizeTrack(t, `Tema ${album.tracks.length + 1}`));
  if (!album.tracks.length) album.tracks.push(emptyTrack('Tema 1'));
  return album;
}

export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return demoAlbum();
  const state = {
    version: SCHEMA_VERSION,
    albums: [],
    currentAlbumId: '',
    currentTrackId: '',
    recentRecipes: Array.isArray(raw.recentRecipes) ? raw.recentRecipes.slice(0, 8) : [],
  };
  const albums = Array.isArray(raw.albums) ? raw.albums.slice(0, 20) : [];
  for (const a of albums) state.albums.push(sanitizeAlbum(a, 'Álbum sin título'));
  if (!state.albums.length) return demoAlbum();
  state.currentAlbumId = state.albums.some((a) => a.id === raw.currentAlbumId)
    ? raw.currentAlbumId
    : state.albums[0].id;
  const album = state.albums.find((a) => a.id === state.currentAlbumId);
  state.currentTrackId = album.tracks.some((t) => t.id === raw.currentTrackId)
    ? raw.currentTrackId
    : album.tracks[0].id;
  return state;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: demoAlbum(), fresh: true };
    return { state: sanitizeState(JSON.parse(raw)), fresh: false };
  } catch {
    return { state: demoAlbum(), fresh: true };
  }
}

let saveTimer = 0;
export function saveState(state, onError) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      if (onError) onError(err);
    }
  }, 220);
}

export function saveStateNow(state) {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

export function currentAlbum(state) {
  return state.albums.find((a) => a.id === state.currentAlbumId) || state.albums[0];
}

export function currentTrack(state) {
  const album = currentAlbum(state);
  return (album && album.tracks.find((t) => t.id === state.currentTrackId)) || (album && album.tracks[0]);
}

export function findTrack(state, trackId) {
  for (const album of state.albums) {
    const t = album.tracks.find((x) => x.id === trackId);
    if (t) return { album, track: t };
  }
  return null;
}

export function newTrackInAlbum(album, name) {
  const t = emptyTrack(name || `Tema ${album.tracks.length + 1}`);
  album.tracks.push(t);
  album.updatedAt = Date.now();
  return t;
}

export function newAlbumInState(state, name = 'Álbum sin título') {
  const album = emptyAlbum(name);
  state.albums.push(album);
  state.currentAlbumId = album.id;
  state.currentTrackId = album.tracks[0].id;
  return album;
}

/** Copia profunda de una pista con identificadores nuevos. */
export function duplicateTrack(track, name) {
  const copy = JSON.parse(JSON.stringify(track));
  copy.id = uid('tr');
  copy.name = name || `${track.name} copia`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.layers = copy.layers.map((l) => ({
    ...l,
    id: uid('ly'),
    clips: l.clips.map((c) => ({ ...c, id: uid('cl') })),
  }));
  return copy;
}

export function duplicateAlbum(album, name) {
  const copy = JSON.parse(JSON.stringify(album));
  copy.id = uid('al');
  copy.name = name || `${album.name} copia`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  copy.tracks = copy.tracks.map((t) => duplicateTrack(t, t.name));
  return copy;
}

/** Exporta todo el estado como archivo portátil. */
export function albumFile(state) {
  return {
    app: APP_ID,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    albums: JSON.parse(JSON.stringify(state.albums)),
  };
}

/** Importa uno o varios álbumes con IDs nuevos. */
export function importFile(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('El archivo no es un proyecto de Looping.');
  const albumsRaw = Array.isArray(raw.albums) ? raw.albums : [raw.album || raw];
  const out = [];
  for (const a of albumsRaw) {
    if (!a || !Array.isArray(a.tracks)) continue;
    const album = sanitizeAlbum(a, 'Proyecto importado');
    album.id = uid('al');
    album.name = /importado/i.test(album.name) ? album.name : `${album.name} (importado)`;
    album.tracks = album.tracks.map((t) => {
      t.id = uid('tr');
      t.layers = t.layers.map((l) => ({ ...l, id: uid('ly'), clips: l.clips.map((c) => ({ ...c, id: uid('cl') })) }));
      return t;
    });
    out.push(album);
  }
  if (!out.length) throw new Error('No se encontró ningún álbum con temas.');
  return out;
}

/** ¿El tema está vacío? */
export function trackIsEmpty(track) {
  return !track.layers.some((l) => l.clips.length);
}

export function trackInfo(track) {
  let clips = 0;
  for (const l of track.layers) clips += l.clips.length;
  return { clips, layers: track.layers.length, loopUnits: loopUnitsFor(track) };
}

// Validación rápida del catálogo al importar (evita IDs desconocidos).
export const KNOWN_SOUNDS = new Set(SOUNDS.map((s) => s.id));
