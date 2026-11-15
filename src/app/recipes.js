/**
 * Bases de arranque. Cada receta está pensada para sonar bien de una pieza:
 * un ritmo, un bajo, una armonía y una textura, con los niveles ya mezclados.
 */

import { uid } from './storage.js';
import { SOUND_BY_ID } from '../audio/catalog.js';

export const RECIPES = [
  {
    id: 'boom-bap',
    name: 'Boom bap',
    bpm: 86,
    layers: [
      { sound: 'vinilo', start: 0, volume: 0.62 },
      { sound: 'boom-bap', start: 0, volume: 0.93 },
      { sound: 'contrabajo', start: 0, volume: 0.88 },
      { sound: 'rhodes-lluvia', start: 0, volume: 0.78 },
      { sound: 'scratch', start: 6, volume: 0.5, repeat: false },
    ],
  },
  {
    id: 'noche-soul',
    name: 'Noche soul',
    bpm: 79,
    layers: [
      { sound: 'vinilo', start: 0, volume: 0.58 },
      { sound: 'neo-soul', start: 0, volume: 0.92 },
      { sound: 'bajo-caminante', start: 0, volume: 0.86 },
      { sound: 'wurli-calido', start: 0, volume: 0.8 },
      { sound: 'voz-cortada', start: 4, volume: 0.44, repeat: false },
    ],
  },
  {
    id: 'cinta',
    name: 'Cinta de madrugada',
    bpm: 82,
    layers: [
      { sound: 'lluvia', start: 0, volume: 0.55 },
      { sound: 'cinta-vieja', start: 0, volume: 0.94 },
      { sound: 'bajo-minimal', start: 0, volume: 0.9 },
      { sound: 'piano-fieltro', start: 0, volume: 0.82 },
      { sound: 'campanas', start: 4, volume: 0.4, repeat: false },
    ],
  },
  {
    id: 'trap',
    name: 'Trap de noche',
    bpm: 88,
    layers: [
      { sound: 'calle', start: 0, volume: 0.52 },
      { sound: 'trap-noche', start: 0, volume: 0.95 },
      { sound: 'sub-808', start: 0, volume: 0.72 },
      { sound: 'sinth-soul', start: 0, volume: 0.72 },
      { sound: 'voz-cortada', start: 4, volume: 0.4, repeat: false },
    ],
  },
  {
    id: 'callejon',
    name: 'Callejón',
    bpm: 90,
    layers: [
      { sound: 'calle', start: 0, volume: 0.5 },
      { sound: 'callejon', start: 0, volume: 0.94 },
      { sound: 'bajo-sucio', start: 0, volume: 0.86 },
      { sound: 'guitarra-suave', start: 0, volume: 0.8 },
      { sound: 'scratch', start: 6, volume: 0.42, repeat: false },
    ],
  },
  {
    id: 'cine',
    name: 'Cine negro',
    bpm: 74,
    layers: [
      { sound: 'lluvia', start: 0, volume: 0.5 },
      { sound: 'tambores', start: 0, volume: 0.9 },
      { sound: 'bajo-cine', start: 0, volume: 0.78 },
      { sound: 'cuerdas-vintage', start: 0, volume: 0.8 },
      { sound: 'campanas', start: 4, volume: 0.48, repeat: false },
    ],
  },
  {
    id: 'domingo',
    name: 'Domingo',
    bpm: 76,
    layers: [
      { sound: 'vinilo', start: 0, volume: 0.55 },
      { sound: 'medio-tiempo', start: 0, volume: 0.9 },
      { sound: 'bajo-redondo', start: 0, volume: 0.84 },
      { sound: 'vibrafono', start: 0, volume: 0.74 },
      { sound: 'flauta-nocturna', start: 4, volume: 0.42, repeat: false },
    ],
  },
  {
    id: 'polvo',
    name: 'Polvo de oro',
    bpm: 84,
    layers: [
      { sound: 'vinilo', start: 0, volume: 0.6 },
      { sound: 'cinta-vieja', start: 0, volume: 0.92 },
      { sound: 'cuerda-pulsada', start: 0, volume: 0.82 },
      { sound: 'caja-musica', start: 0, volume: 0.62 },
      { sound: 'coro-lejano', start: 0, volume: 0.62 },
    ],
  },
];

export function trackFromRecipe(recipe, name) {
  const target = (recipe.bars || 2) * 4;
  return {
    id: uid('tr'),
    name: name || recipe.name,
    bpm: recipe.bpm,
    layers: recipe.layers.map((l) => {
      const sound = SOUND_BY_ID[l.sound];
      const clips = [];
      const start = l.start || 0;
      if (sound && l.repeat !== false && sound.beats < target) {
        for (let at = start; at + sound.beats <= target; at += sound.beats) {
          clips.push({ id: uid('cl'), soundId: l.sound, start: at });
        }
      }
      if (!clips.length) clips.push({ id: uid('cl'), soundId: l.sound, start });
      return {
        id: uid('ly'),
        volume: l.volume,
        mute: false,
        solo: false,
        clips,
      };
    }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function pickRecipe(recent = []) {
  const pool = RECIPES.filter((r) => !recent.slice(0, 2).includes(r.id));
  const list = pool.length ? pool : RECIPES;
  return list[Math.floor(Math.random() * list.length)];
}
