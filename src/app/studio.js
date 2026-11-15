/**
 * Teclado / estudio de sonidos propios.
 *
 * Sustituye el flujo del laboratorio de sen por uno más pequeño y directo:
 * eliges un instrumento, tocas, grabas un bucle de 1–8 tiempos, lo escuchas y
 * lo guardas en una sección del álbum. La toma se guarda como receta y el motor
 * la convierte en un sonido más del catálogo de ese proyecto.
 */

import { CATEGORIES, CATEGORY_BY_ID } from '../audio/catalog.js';
import {
  D_MINOR_PCS, INSTRUMENT_BY_ID, NOTE_NAMES_FLAT, STUDIO_CHORDS, STUDIO_FAMILIES,
  STUDIO_INSTRUMENTS, categoryForInstrument, chordMidis, defaultNameFor, midiName,
  noteNamesForMidis, renderPreviewBuffer, sanitizeCustomRecipe,
} from '../audio/studio.js';
import { $, $$, clamp, esc, icon, showToast } from './dom.js';
import { openModal } from './modals.js';
import { uid } from './storage.js';

const STEP = 0.25;
const LENGTHS = [1, 2, 4, 8];
const CATEGORY_ORDER = ['ritmos', 'bajos', 'armonias', 'texturas'];
const q = (v) => Math.round(v / STEP) * STEP;
const categoryOf = (id) => CATEGORY_BY_ID[id] || CATEGORY_BY_ID.armonias;

function quantizeStart(beat, length) {
  let s = q(beat);
  s %= length;
  if (s < 0) s += length;
  if (s >= length) s = 0;
  return clamp(s, 0, Math.max(0, length - STEP));
}

/**
 * Abre el estudio. `onSaved(recipe)` debe añadir la receta al álbum, registrarla
 * en el motor y persistir; el estudio se encarga del resto.
 */
export async function openStudio({ player, album, bpm, onSaved }) {
  try {
    await player.ensure();
  } catch {
    showToast('No se pudo activar el audio del teclado.', { error: true });
    return;
  }
  const ctx = player.ctx;
  if (!ctx) return;

  const gain = ctx.createGain();
  gain.gain.value = 0.6;
  gain.connect(player.master);

  const inst0 = INSTRUMENT_BY_ID.rhodes;
  const state = {
    alive: true,
    player,
    ctx,
    gain,
    album,
    bpm,
    onSaved,
    api: null,
    body: null,
    foot: null,
    family: 'teclas',
    instrumentId: 'rhodes',
    octaveStart: inst0.defaultOctave,
    length: 4,
    notes: [],
    hits: [],
    activeChordId: null,
    name: defaultNameFor('rhodes', album.customSounds || []),
    category: categoryForInstrument('rhodes'),
    nameTouched: false,
    categoryTouched: false,
    click: true,
    playing: false,
    recording: false,
    countInUntil: 0,
    loopStart: 0,
    recordStart: 0,
    nextLoop: 0,
    scheduleTimer: 0,
    raf: 0,
    sources: new Set(),
    pointers: new Map(),
    audioBuffers: new Map(),
    clickBuffer: null,
    pressedTimers: new Set(),
    success: false,
    saving: false,
    savedRecipe: null,
    lastBeat: -1,
  };

  const inst = () => INSTRUMENT_BY_ID[state.instrumentId] || inst0;
  const instrumentList = (family) => STUDIO_INSTRUMENTS.filter((i) => i.family === family);
  const activeNotes = () => (inst().kind === 'notes' ? state.notes : state.hits);
  const hasEvents = () => state.notes.length > 0 || state.hits.length > 0;
  const activeEvents = () => (inst().kind === 'notes' ? state.notes.length : state.hits.length);
  const topic = () => (inst().kind === 'notes' ? 'notas' : 'golpes');
  const categoryName = (id) => (CATEGORY_BY_ID[id]?.name || 'Sonidos');

  /* ------------------------------------------------------------- buffers */

  function makeClickBuffer() {
    const len = Math.max(32, Math.round(ctx.sampleRate * 0.045));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const env = Math.exp(-t / 0.008);
      data[i] = (Math.sin(2 * Math.PI * 1700 * t) * 0.65 + Math.sin(2 * Math.PI * 2500 * t) * 0.2) * env;
    }
    return buf;
  }

  function getAudioBuffer(instrumentId, target) {
    const key = `${instrumentId}|${target.midi ?? target.pad}`;
    const cached = state.audioBuffers.get(key);
    if (cached) return cached;
    const data = renderPreviewBuffer(instrumentId, target, state.bpm);
    if (!data) return null;
    const audio = ctx.createBuffer(2, data.n, data.sr);
    audio.copyToChannel(data.L, 0);
    audio.copyToChannel(data.R, 1);
    state.audioBuffers.set(key, audio);
    return audio;
  }

  function trackSource(src, gainNode) {
    const item = { src, gain: gainNode };
    state.sources.add(item);
    src.onended = () => state.sources.delete(item);
    return item;
  }

  function playBuffer(audio, velocity = 0.85, when = 0) {
    if (!audio) return null;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    const g = ctx.createGain();
    g.gain.value = clamp(0.5 + velocity * 0.45, 0.2, 1.05);
    src.connect(g);
    g.connect(gain);
    src.start(when || ctx.currentTime);
    return trackSource(src, g);
  }

  function stopSource(item, fade = 0.04) {
    if (!item || !item.src) return;
    const now = ctx.currentTime;
    try {
      item.gain.gain.cancelScheduledValues(now);
      item.gain.gain.setValueAtTime(item.gain.gain.value, now);
      item.gain.gain.linearRampToValueAtTime(0, now + fade);
      item.src.stop(now + fade + 0.01);
    } catch {
      try { item.src.stop(); } catch {}
    }
  }

  function stopAllSources() {
    for (const item of [...state.sources]) stopSource(item, 0.035);
    state.sources.clear();
  }

  /* ------------------------------------------------------------- toma */

  function addNote(note) {
    const start = clamp(note.start, 0, state.length - STEP);
    const length = clamp(note.length, STEP, state.length - start);
    const midi = Math.round(note.midi);
    state.notes = state.notes.filter((n) => !(n.midi === midi && Math.abs(n.start - start) < 0.001));
    state.notes.push({ midi, start, length, velocity: clamp(note.velocity, 0.1, 1) });
    state.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
    afterTakeChange();
  }

  function addHit(hit) {
    const start = clamp(hit.start, 0, state.length - STEP);
    state.hits = state.hits.filter((h) => !(h.pad === hit.pad && Math.abs(h.start - start) < 0.001));
    state.hits.push({ pad: hit.pad, start, velocity: clamp(hit.velocity, 0.1, 1) });
    state.hits.sort((a, b) => a.start - b.start);
    afterTakeChange();
  }

  function afterTakeChange() {
    renderLoopView();
    updateKeyHighlights();
    refreshSave();
    updateTransportLive();
  }

  /* ------------------------------------------------------------- voces */

  function addVoiceToPointer(pointerId, voice, keyEl = null) {
    let item = state.pointers.get(pointerId);
    if (!item) {
      item = { voices: [], keys: [] };
      state.pointers.set(pointerId, item);
    }
    item.voices.push(voice);
    if (keyEl) item.keys.push(keyEl);
  }

  function startVoice(midi, pointerId, { keyEl = null, velocity = 0.85, startedAt = 0 } = {}) {
    const audio = getAudioBuffer(state.instrumentId, { midi });
    const src = playBuffer(audio, velocity);
    if (!src) return null;
    const now = ctx.currentTime;
    const startAt = startedAt || now;
    let rec = null;
    if (state.recording && startAt >= state.recordStart) {
      const beat = ((startAt - state.recordStart) * state.bpm) / 60;
      rec = {
        midi,
        start: quantizeStart(beat, state.length),
        startedAt: startAt,
        velocity,
        finalized: false,
      };
    }
    const voice = { midi, src, startedAt: startAt, rec, velocity };
    addVoiceToPointer(pointerId, voice, keyEl);
    if (keyEl) keyEl.classList.add('is-active');
    return voice;
  }

  function finishVoice(voice, endAt = 0) {
    if (!voice?.rec || voice.rec.finalized) return;
    const at = endAt || ctx.currentTime;
    const raw = ((at - voice.rec.startedAt) * state.bpm) / 60;
    let length = q(raw);
    if (length < STEP) length = STEP;
    const max = state.length - voice.rec.start;
    length = clamp(length, STEP, Math.max(STEP, max));
    const rec = { ...voice.rec, finalized: true };
    voice.rec = rec;
    if (inst().kind === 'notes') addNote({ ...rec, length });
  }

  function finishRecording() {
    if (!state.recording) return;
    for (const item of state.pointers.values()) {
      for (const v of item.voices) finishVoice(v, ctx.currentTime);
    }
    state.recording = false;
    updateTransportLive();
  }

  function endPointer(pointerId, at = 0) {
    const item = state.pointers.get(pointerId);
    if (!item) return;
    state.pointers.delete(pointerId);
    for (const v of item.voices) {
      finishVoice(v, at || ctx.currentTime);
      if (!inst().ringOut) stopSource(v.src, 0.06);
    }
    for (const el of item.keys) el.classList.remove('is-active');
    updateTransportLive();
  }

  function endAllPointers() {
    for (const id of [...state.pointers.keys()]) endPointer(id);
  }

  function startKey(midi, pointerId, el) {
    if (state.pointers.has(pointerId)) endPointer(pointerId);
    startVoice(midi, pointerId, { keyEl: el, startedAt: ctx.currentTime, velocity: 0.86 });
  }

  function startChord(chord, pointerId, el) {
    if (state.pointers.has(pointerId)) endPointer(pointerId);
    state.activeChordId = chord.id;
    updateChordsActive();
    updateKeyHighlights();
    const midis = chordMidis(chord, state.octaveStart);
    const startedAt = ctx.currentTime;
    for (const midi of midis) {
      const keyEl = $(`.studio-key[data-midi="${midi}"]`, state.body);
      const voice = startVoice(midi, pointerId, { keyEl, startedAt, velocity: 0.78 });
      if (!voice) continue;
    }
    if (el) {
      el.classList.add('is-pressed');
      const item = state.pointers.get(pointerId);
      if (item) item.chordEl = el;
    }
    updateTransportLive();
  }

  function playPad(padId, velocity = 0.9) {
    const pad = inst().pads?.find((p) => p.id === padId);
    if (!pad) return;
    const audio = getAudioBuffer(state.instrumentId, { pad: padId });
    playBuffer(audio, velocity);
    if (state.recording && ctx.currentTime >= state.recordStart) {
      const beat = ((ctx.currentTime - state.recordStart) * state.bpm) / 60;
      addHit({ pad: padId, start: quantizeStart(beat, state.length), velocity });
    }
    const el = $(`.studio-pad[data-pad="${padId}"]`, state.body);
    if (el) {
      el.classList.add('is-pressed');
      const t = setTimeout(() => {
        el.classList.remove('is-pressed');
        state.pressedTimers.delete(t);
      }, 110);
      state.pressedTimers.add(t);
    }
    updateTransportLive();
  }

  /* ------------------------------------------------------------- bucle */

  function scheduleClick(when, accent = false) {
    if (!state.click || !state.clickBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = state.clickBuffer;
    const g = ctx.createGain();
    g.gain.value = accent ? 0.18 : 0.11;
    src.connect(g);
    g.connect(gain);
    src.start(when);
    trackSource(src, g);
  }

  function scheduleLoop(index) {
    if (!state.playing) return;
    const loopDur = (state.length * 60) / state.bpm;
    const when = state.loopStart + index * loopDur;
    const beatSec = 60 / state.bpm;
    if (state.click) {
      for (let b = 0; b < state.length; b++) scheduleClick(when + b * beatSec, b === 0);
    }
    if (inst().kind === 'notes') {
      for (const n of state.notes) {
        const audio = getAudioBuffer(state.instrumentId, { midi: n.midi });
        if (!audio) continue;
        const at = when + n.start * beatSec;
        const item = playBuffer(audio, n.velocity, at);
        if (item && !inst().ringOut) {
          const off = at + Math.max(0.08, n.length * beatSec);
          const now = ctx.currentTime;
          if (off > now + 0.05) {
            try {
              item.gain.gain.setValueAtTime(item.gain.gain.value, off - 0.045);
              item.gain.gain.linearRampToValueAtTime(0, off);
            } catch {}
          }
        }
      }
    } else {
      for (const h of state.hits) {
        const audio = getAudioBuffer(state.instrumentId, { pad: h.pad });
        if (audio) playBuffer(audio, h.velocity, when + h.start * beatSec);
      }
    }
  }

  function scheduleAhead() {
    if (!state.playing) return;
    const loopDur = (state.length * 60) / state.bpm;
    const horizon = ctx.currentTime + 0.9;
    let guard = 0;
    while (state.loopStart + state.nextLoop * loopDur < horizon && guard++ < 8) {
      scheduleLoop(state.nextLoop);
      state.nextLoop += 1;
    }
  }

  function startLoop(record = false) {
    stopAllSources();
    endAllPointers();
    state.playing = false;
    state.recording = false;
    clearInterval(state.scheduleTimer);
    const beatSec = 60 / state.bpm;
    const loopDur = state.length * beatSec;
    const now = ctx.currentTime;
    const count = record ? 4 : 0;
    const startAt = now + 0.12 + count * beatSec;
    state.loopStart = startAt;
    state.recordStart = startAt;
    state.countInUntil = record ? startAt : 0;
    state.nextLoop = 0;
    state.playing = true;
    state.recording = !!record;
    if (record) {
      for (let i = 0; i < 4; i++) scheduleClick(now + 0.12 + i * beatSec, i === 0);
    }
    scheduleLoop(0);
    state.nextLoop = 1;
    state.scheduleTimer = setInterval(scheduleAhead, 180);
    updateTransportLive();
  }

  function stopLoop({ finalize = true } = {}) {
    if (state.recording && finalize) finishRecording();
    state.playing = false;
    state.recording = false;
    state.countInUntil = 0;
    clearInterval(state.scheduleTimer);
    state.scheduleTimer = 0;
    stopAllSources();
    endAllPointers();
    updateTransportLive();
    updatePlayheadView();
  }

  function togglePlay() {
    if (state.playing) stopLoop();
    else startLoop(false);
  }

  function toggleRecord() {
    if (state.recording) {
      finishRecording();
      updateTransportLive();
      return;
    }
    if (!hasEvents()) {
      // Una toma vacía puede grabarse igualmente: el usuario puede empezar
      // por un golpe o una nota.
    }
    startLoop(true);
  }

  function clearTake() {
    stopLoop({ finalize: false });
    state.notes = [];
    state.hits = [];
    state.activeChordId = null;
    updateChordsActive();
    renderLoopView();
    updateKeyHighlights();
    refreshSave();
    updateTransportLive();
    showToast('Bucle vacío. Puedes grabar otra toma.');
  }

  /* ------------------------------------------------------------- UI */

  function familyTabsHtml() {
    return STUDIO_FAMILIES.map((f) => `
      <button class="studio-family ${state.family === f.id ? 'is-active' : ''}" type="button"
        role="tab" aria-selected="${state.family === f.id}" data-family="${f.id}" title="${esc(f.hint)}">
        ${esc(f.name)}
      </button>`).join('');
  }

  function instrumentsHtml() {
    return instrumentList(state.family).map((i) => `
      <button class="studio-inst ${state.instrumentId === i.id ? 'is-active' : ''}" type="button"
        data-instrument="${i.id}" aria-pressed="${state.instrumentId === i.id}" title="${esc(i.hint)}">
        ${esc(i.name)}
      </button>`).join('');
  }

  function chordsHtml() {
    if (inst().kind !== 'notes') return '';
    const cards = STUDIO_CHORDS.map((c) => {
      const midis = chordMidis(c, state.octaveStart);
      const notes = noteNamesForMidis(midis).join(' ');
      return `<button class="studio-chord ${state.activeChordId === c.id ? 'is-active' : ''}" type="button"
        data-chord="${c.id}" title="${esc(c.hint)} · ${esc(notes)}" aria-label="${esc(c.name)}: ${esc(notes)}">
        <span class="studio-chord__name">${esc(c.name)}</span>
        <span class="studio-chord__notes">${esc(notes)}</span>
      </button>`;
    }).join('');
    return `
      <div class="studio-chords__head">
        <span class="studio-label">Acordes en Re menor</span>
        <span class="studio-hint">Mantén para sostener · las teclas se iluminan</span>
      </div>
      <div class="studio-chords" role="group" aria-label="Acordes de Re menor">${cards}</div>`;
  }

  function pianoHtml() {
    const whites = [0, 2, 4, 5, 7, 9, 11];
    const W = 100 / 14;
    let wi = 0;
    let html = '';
    const chord = state.activeChordId ? STUDIO_CHORDS.find((c) => c.id === state.activeChordId) : null;
    const chordSet = new Set(chord ? chordMidis(chord, state.octaveStart) : []);
    const played = new Set(state.notes.map((n) => n.midi));
    for (let o = 0; o < 2; o++) {
      for (let s = 0; s < 12; s++) {
        const midi = state.octaveStart + o * 12 + s;
        const white = whites.includes(s);
        const cls = [
          'studio-key',
          white ? 'key-white' : 'key-black',
          D_MINOR_PCS.has(((midi % 12) + 12) % 12) ? 'is-scale' : '',
          chordSet.has(midi) ? 'is-chord' : '',
          played.has(midi) ? 'is-recorded' : '',
        ].filter(Boolean).join(' ');
        const left = white ? wi * W : wi * W - W * 0.32;
        const width = white ? W : W * 0.64;
        const label = NOTE_NAMES_FLAT[((midi % 12) + 12) % 12];
        html += `<button class="${cls}" type="button" data-midi="${midi}" aria-label="${esc(midiName(midi))}"
          title="${esc(midiName(midi))}" style="left:${left}%;width:${width}%">
          ${white ? `<span class="studio-key__label">${esc(label)}</span>` : `<span class="studio-key__label studio-key__label--black">${esc(label)}</span>`}
        </button>`;
        if (white) wi++;
      }
    }
    return `
      <div class="studio-octave">
        <button class="icon-btn icon-btn--square" type="button" data-oct="-1" aria-label="Octava más grave">${icon('chev-left')}</button>
        <span class="studio-octave__label">${esc(midiName(state.octaveStart))}–${esc(midiName(state.octaveStart + 23))}</span>
        <button class="icon-btn icon-btn--square" type="button" data-oct="1" aria-label="Octava más aguda">${icon('chev-right')}</button>
        <span class="studio-octave__hint">Las notas de Re menor llevan un punto</span>
      </div>
      <div class="studio-piano" id="studio-piano" role="group" aria-label="Teclado de dos octavas">${html}</div>`;
  }

  function padsHtml() {
    const pads = inst().pads || [];
    return `
      <div class="studio-pads ${pads.length === 1 ? 'is-single' : ''}" role="group" aria-label="Pads de percusión">
        ${pads.map((p, i) => `<button class="studio-pad" type="button" data-pad="${p.id}" aria-label="${esc(p.name)}">
          <span class="studio-pad__num">${i + 1}</span>
          <span class="studio-pad__name">${esc(p.name)}</span>
        </button>`).join('')}
      </div>
      <p class="studio-hint studio-pad-hint">Toca los pads en el bucle. Cada golpe es una pieza del ritmo.</p>`;
  }

  function instrumentAreaHtml() {
    return inst().kind === 'pads' ? padsHtml() : `
      ${chordsHtml()}
      <div class="studio-keys-area" id="studio-keys-area">${pianoHtml()}</div>`;
  }

  function transportHtml() {
    return `
      <div class="studio-transport">
        <button class="studio-play" id="studio-play" type="button" aria-label="Escuchar el bucle" title="Escuchar el bucle">
          ${icon('play')}<span>Escuchar</span>
        </button>
        <button class="studio-record" id="studio-record" type="button" aria-label="Grabar un bucle" title="Grabar un bucle">
          <span class="studio-record__dot" aria-hidden="true"></span><span>Grabar</span>
        </button>
        <button class="icon-btn icon-btn--square studio-clear" id="studio-clear" type="button" aria-label="Limpiar el bucle" title="Limpiar el bucle">
          ${icon('trash')}
        </button>
        <div class="studio-len" role="group" aria-label="Duración del bucle">
          <span class="studio-label">Bucle</span>
          ${LENGTHS.map((n) => `<button type="button" class="studio-len__btn ${state.length === n ? 'is-active' : ''}" data-len="${n}" aria-pressed="${state.length === n}">${n}</button>`).join('')}
          <span class="studio-len__unit">tiempos</span>
        </div>
        <span class="studio-tempo">${state.bpm} bpm</span>
        <label class="studio-click"><input type="checkbox" id="studio-click" ${state.click ? 'checked' : ''} /> <span>Clic</span></label>
        <span class="studio-status" id="studio-status" role="status" aria-live="polite"></span>
      </div>`;
  }

  function saveHtml() {
    return `
      <div class="studio-save" id="studio-save">
        <label class="studio-name">
          <span class="studio-label">Nombre</span>
          <input id="studio-name" type="text" maxlength="48" autocomplete="off" spellcheck="false" value="${esc(state.name)}" aria-label="Nombre del sonido" />
        </label>
        <div class="studio-cats" role="group" aria-label="Guardar en">
          ${CATEGORIES.map((c) => `<button type="button" class="studio-cat ${state.category === c.id ? 'is-active' : ''}" data-category="${c.id}" aria-pressed="${state.category === c.id}">
            <span class="studio-cat__dot" style="--c:${c.color}"></span>${esc(c.name)}
          </button>`).join('')}
        </div>
        <span class="studio-save__meta" id="studio-save-meta"></span>
      </div>`;
  }

  function buildBody() {
    return `
      <div class="studio">
        <p class="studio-lede">Elige un instrumento, toca y graba un bucle. Lo que guardes se queda en la biblioteca de <strong>${esc(state.album.name || 'este álbum')}</strong>.</p>
        <div class="studio-families" role="tablist" aria-label="Familias de instrumentos">${familyTabsHtml()}</div>
        <div class="studio-instruments" role="group" aria-label="Instrumentos">${instrumentsHtml()}</div>
        ${transportHtml()}
        ${instrumentAreaHtml()}
        <div class="studio-loop" id="studio-loop"></div>
      </div>`;
  }

  function buildFooter() {
    return `<div class="studio-foot">
      ${saveHtml()}
      <div class="studio-foot__actions">
        <span class="studio-foot-note">Se guarda en «${esc(state.album.name || 'este álbum')}»</span><span class="spacer"></span>
        <button class="btn btn--outline" type="button" data-studio-close>Cerrar</button>
        <button class="btn btn--primary" type="button" data-studio-save>${icon('check')} Guardar sonido</button>
      </div>
    </div>`;
  }

  function mountBody() {
    state.body.innerHTML = buildBody();
    renderLoopView();
    updateStudioUI();
    refreshSave();
    updateKeyHighlights();
  }

  /* ------------------------------------------------------------- loop view */

  function loopRows() {
    if (inst().kind === 'pads') {
      const used = new Set(state.hits.map((h) => h.pad));
      return {
        rows: (inst().pads || []).filter((p) => used.has(p.id)).map((p) => ({ key: p.id, label: p.name })),
        kind: 'pads',
      };
    }
    const notes = state.notes;
    const uniq = [...new Set(notes.map((n) => n.midi))].sort((a, b) => b - a);
    return { rows: uniq.map((m) => ({ key: m, label: midiName(m) })), kind: 'notes' };
  }

  function renderLoopView() {
    const host = $('#studio-loop', state.body);
    if (!host) return;
    const data = loopRows();
    const isPads = inst().kind === 'pads';
    const rows = data.rows;
    const rowH = 15;
    const contentH = isPads ? Math.max(rows.length * rowH, 70) : Math.max(rows.length * rowH, 30);
    const steps = state.length * 4;
    const title = `${state.length} ${state.length === 1 ? 'tiempo' : 'tiempos'} · ${isPads ? state.hits.length + ' golpes' : state.notes.length + ' notas'}`;
    if (!rows.length) {
      host.innerHTML = `
        <div class="studio-loop__head"><span class="studio-label">Bucle</span><span class="studio-loop__count">${esc(title)}</span></div>
        <div class="studio-loop__empty">${isPads ? 'Graba un golpe para verlo aquí.' : 'Graba una nota o un acorde para verlo aquí.'}</div>
        <div class="studio-loop__grid studio-loop__grid--empty" style="--steps:${steps};--beats:${state.length};height:${contentH}px">
          <div class="studio-playhead" id="studio-playhead" hidden></div>
          <div class="studio-countin" id="studio-countin" hidden></div>
        </div>`;
      return;
    }
    const labels = rows.map((r) => `<span class="studio-loop__label">${esc(r.label)}</span>`).join('');
    let blocks = '';
    if (isPads) {
      rows.forEach((row, i) => {
        for (const h of state.hits.filter((x) => x.pad === row.key)) {
          const left = (h.start / state.length) * 100;
          blocks += `<span class="studio-block" style="left:${left}%;top:${i * rowH + 3}px;width:max(3px,${(STEP / state.length) * 100}%);background:${categoryOf(state.category).color};opacity:${0.55 + h.velocity * 0.45}" title="${esc(row.label)} · ${(h.start + 1).toFixed(2)}"></span>`;
        }
      });
    } else {
      rows.forEach((row, i) => {
        for (const n of state.notes.filter((x) => x.midi === row.key)) {
          const left = (n.start / state.length) * 100;
          const width = Math.max(2.5, (n.length / state.length) * 100);
          blocks += `<span class="studio-block" style="left:${left}%;top:${i * rowH + 3}px;width:${width}%;background:${categoryOf(state.category).color};opacity:${0.55 + n.velocity * 0.45}" title="${esc(row.label)} · ${(n.start + 1).toFixed(2)}"></span>`;
        }
      });
    }
    host.innerHTML = `
      <div class="studio-loop__head"><span class="studio-label">Bucle</span><span class="studio-loop__count">${esc(title)}</span></div>
      <div class="studio-loop__scroll">
        <div class="studio-loop__labels" style="height:${contentH}px">${labels}</div>
        <div class="studio-loop__grid" style="--steps:${steps};--beats:${state.length};height:${contentH}px">
          ${blocks}
          <div class="studio-playhead" id="studio-playhead" hidden></div>
          <div class="studio-countin" id="studio-countin" hidden></div>
        </div>
      </div>`;
    updatePlayheadView();
  }

  function updatePlayheadView() {
    const ph = $('#studio-playhead', state.body);
    const count = $('#studio-countin', state.body);
    if (!ph) return;
    if (!state.playing) {
      ph.hidden = true;
      if (count) count.hidden = true;
      return;
    }
    const now = ctx.currentTime;
    if (now < state.loopStart) {
      ph.hidden = false;
      ph.style.left = '0%';
      if (count) {
        count.hidden = false;
        const remaining = Math.max(1, Math.ceil((state.loopStart - now) * (state.bpm / 60)));
        count.textContent = String(Math.min(4, remaining));
      }
      return;
    }
    if (count) count.hidden = true;
    const pos = (((now - state.loopStart) * state.bpm) / 60) % state.length;
    ph.hidden = false;
    ph.style.left = `${(pos / state.length) * 100}%`;
  }

  /* ------------------------------------------------------------- UI state */

  function updateKeyHighlights() {
    const chord = state.activeChordId ? STUDIO_CHORDS.find((c) => c.id === state.activeChordId) : null;
    const chordSet = new Set(chord ? chordMidis(chord, state.octaveStart) : []);
    const played = new Set(state.notes.map((n) => n.midi));
    $$('.studio-key', state.body).forEach((el) => {
      const midi = Number(el.dataset.midi);
      el.classList.toggle('is-chord', chordSet.has(midi));
      el.classList.toggle('is-recorded', played.has(midi));
    });
  }

  function updateChordsActive() {
    $$('.studio-chord', state.body).forEach((el) => el.classList.toggle('is-active', el.dataset.chord === state.activeChordId));
  }

  function updateTransportLive() {
    const play = $('#studio-play', state.body);
    const rec = $('#studio-record', state.body);
    const clear = $('#studio-clear', state.body);
    if (play) {
      play.classList.toggle('is-playing', state.playing);
      play.setAttribute('aria-label', state.playing ? 'Parar el bucle' : 'Escuchar el bucle');
      play.innerHTML = `${icon(state.playing ? 'stop' : 'play')}<span>${state.playing ? 'Parar' : 'Escuchar'}</span>`;
    }
    if (rec) {
      rec.classList.toggle('is-recording', state.recording);
      rec.setAttribute('aria-label', state.recording ? 'Dejar de grabar' : 'Grabar un bucle');
      rec.innerHTML = `<span class="studio-record__dot" aria-hidden="true"></span><span>${state.recording ? 'Grabando' : 'Grabar'}</span>`;
    }
    if (clear) clear.disabled = !hasEvents();
    $$('[data-len]', state.body).forEach((b) => {
      const on = Number(b.dataset.len) === state.length;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const click = $('#studio-click', state.body);
    if (click) click.checked = state.click;
    updateStatus();
    updatePlayheadView();
    const save = state.foot?.querySelector('[data-studio-save]');
    if (save) save.disabled = !activeEvents();
  }

  function updateStatus() {
    const el = $('#studio-status', state.body);
    if (!el) return;
    let text = '';
    if (state.recording && ctx.currentTime < state.loopStart) {
      text = 'Entrando…';
    } else if (state.recording) {
      text = `Grabando · ${activeEvents()} ${topic()}`;
    } else if (state.playing) {
      text = 'Escuchando';
    } else {
      text = `${activeEvents()} ${inst().kind === 'notes' ? 'notas' : 'golpes'} · ${state.length} ${state.length === 1 ? 'tiempo' : 'tiempos'}`;
    }
    if (el.textContent !== text) el.textContent = text;
    const count = $('.studio-loop__count', state.body);
    if (count) {
      const t = `${state.length} ${state.length === 1 ? 'tiempo' : 'tiempos'} · ${activeEvents()} ${topic()}`;
      if (count.textContent !== t) count.textContent = t;
    }
  }

  function updateStudioUI() {
    updateTransportLive();
    updateChordsActive();
    updateKeyHighlights();
    refreshSave();
  }

  function refreshSave() {
    const meta = $('#studio-save-meta', state.foot);
    if (meta) meta.textContent = `${state.length} ${state.length === 1 ? 'tiempo' : 'tiempos'} · ${inst().name} · ${categoryName(state.category)}`;
    $$('[data-category]', state.foot).forEach((b) => {
      const on = b.dataset.category === state.category;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const name = $('#studio-name', state.foot);
    if (name && document.activeElement !== name) name.value = state.name;
    const save = state.foot?.querySelector('[data-studio-save]');
    if (save) save.disabled = !activeEvents();
    const footNote = state.foot?.querySelector('.studio-foot-note');
    if (footNote) footNote.textContent = `Se guarda en «${state.album.name || 'este álbum'}»`;
  }

  /* ------------------------------------------------------------- cambios */

  function stopForChange() {
    stopLoop({ finalize: true });
    endAllPointers();
  }

  function setFamily(familyId) {
    if (state.family === familyId) return;
    stopForChange();
    state.family = familyId;
    const list = instrumentList(familyId);
    if (!list.length) return;
    setInstrument(list[0].id, { mount: false });
    mountBody();
  }

  function setInstrument(id, { mount = true } = {}) {
    const next = INSTRUMENT_BY_ID[id];
    if (!next) return;
    stopForChange();
    state.instrumentId = id;
    state.family = next.family;
    state.octaveStart = next.defaultOctave || 60;
    state.activeChordId = null;
    if (!state.nameTouched) state.name = defaultNameFor(id, state.album.customSounds || []);
    if (!state.categoryTouched) state.category = categoryForInstrument(id);
    if (mount) mountBody();
  }

  function setOctave(delta) {
    endAllPointers();
    const next = clamp(state.octaveStart + delta * 12, 24, 84);
    if (next === state.octaveStart) return;
    state.octaveStart = next;
    const area = $('#studio-keys-area', state.body);
    if (area) {
      area.innerHTML = pianoHtml();
      updateKeyHighlights();
    }
    const oldChords = state.body.querySelector('.studio-chords');
    const oldHead = state.body.querySelector('.studio-chords__head');
    const wrap = document.createElement('div');
    wrap.innerHTML = chordsHtml();
    const newHead = wrap.querySelector('.studio-chords__head');
    const newChords = wrap.querySelector('.studio-chords');
    if (oldHead && newHead) oldHead.replaceWith(newHead);
    if (oldChords && newChords) oldChords.replaceWith(newChords);
    updateChordsActive();
    updateKeyHighlights();
  }

  function setLength(next) {
    if (!LENGTHS.includes(next) || next === state.length) return;
    stopForChange();
    const clippedNotes = state.notes.filter((n) => n.start < next);
    const clippedHits = state.hits.filter((h) => h.start < next);
    const dropped = (state.notes.length - clippedNotes.length) + (state.hits.length - clippedHits.length);
    state.length = next;
    state.notes = clippedNotes.map((n) => ({ ...n, length: clamp(n.length, STEP, next - n.start) }));
    state.hits = clippedHits;
    renderLoopView();
    refreshSave();
    updateTransportLive();
    if (dropped) showToast('Se han quitado los eventos que quedaban fuera del nuevo bucle.');
  }

  /* ------------------------------------------------------------- guardar */

  function saveTake() {
    if (state.saving || state.success) return;
    if (!activeEvents()) {
      showToast('Graba al menos una nota o un golpe antes de guardar.', { error: true });
      return;
    }
    state.saving = true;
    stopForChange();
    const recipe = sanitizeCustomRecipe({
      id: uid('cs'),
      name: state.name.trim() || defaultNameFor(state.instrumentId, state.album.customSounds || []),
      category: state.category,
      beats: state.length,
      instrument: state.instrumentId,
      octaveStart: state.octaveStart,
      notes: state.notes,
      hits: state.hits,
      createdAt: Date.now(),
    });
    if (!recipe) {
      state.saving = false;
      showToast('No se pudo preparar el sonido.', { error: true });
      return;
    }
    try {
      onSaved(recipe);
    } catch (err) {
      state.saving = false;
      console.error(err);
      showToast('No se pudo guardar el sonido en el álbum.', { error: true });
      return;
    }
    state.saving = false;
    state.name = recipe.name;
    state.category = recipe.category;
    state.success = true;
    state.savedRecipe = recipe;
    showSuccess(recipe);
  }

  function showSuccess(recipe) {
    stopLoop({ finalize: false });
    state.api.setTitle('Sonido guardado');
    state.api.setBody(`
      <div class="studio-success">
        <div class="studio-success__mark">${icon('check')}</div>
        <span class="studio-kicker">Sonido propio</span>
        <h3>${esc(recipe.name)}</h3>
        <p>Ya está en <strong>${esc(categoryName(recipe.category))}</strong> y en la biblioteca de este álbum. Ciérralo y colócalo en la línea de tiempo como cualquier otro sonido.</p>
        <span class="studio-success__meta">${recipe.beats} ${recipe.beats === 1 ? 'tiempo' : 'tiempos'} · ${esc(INSTRUMENT_BY_ID[recipe.instrument]?.name || '')}</span>
      </div>`);
    state.api.setFooter(`<div class="studio-foot"><div class="studio-foot__actions">
      <span class="studio-foot-note">Guardado en «${esc(state.album.name || 'este álbum')}»</span><span class="spacer"></span>
      <button class="btn btn--outline" type="button" data-studio-again>Crear otro</button>
      <button class="btn btn--dark" type="button" data-studio-close>Cerrar</button>
    </div></div>`);
  }

  function resetForNew() {
    state.api.setTitle('Teclado');
    state.success = false;
    state.saving = false;
    state.savedRecipe = null;
    state.notes = [];
    state.hits = [];
    state.activeChordId = null;
    state.nameTouched = false;
    state.categoryTouched = false;
    state.name = defaultNameFor(state.instrumentId, state.album.customSounds || []);
    state.category = categoryForInstrument(state.instrumentId);
    state.api.setFooter(buildFooter());
    mountBody();
  }

  /* ------------------------------------------------------------- eventos */

  function isTypingTarget(el) {
    const tag = (el?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable;
  }

  function onBodyPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const key = e.target.closest('.studio-key');
    if (key) {
      e.preventDefault();
      startKey(Number(key.dataset.midi), e.pointerId, key);
      return;
    }
    const pad = e.target.closest('.studio-pad');
    if (pad) {
      e.preventDefault();
      playPad(pad.dataset.pad, 0.9);
      return;
    }
    const chord = e.target.closest('[data-chord]');
    if (chord) {
      e.preventDefault();
      const def = STUDIO_CHORDS.find((c) => c.id === chord.dataset.chord);
      if (def) startChord(def, e.pointerId, chord);
    }
  }

  function onBodyClick(e) {
    const family = e.target.closest('[data-family]');
    if (family) { setFamily(family.dataset.family); return; }
    const instBtn = e.target.closest('[data-instrument]');
    if (instBtn) { if (instBtn.dataset.instrument !== state.instrumentId) setInstrument(instBtn.dataset.instrument); return; }
    const oct = e.target.closest('[data-oct]');
    if (oct) { setOctave(Number(oct.dataset.oct)); return; }
    const len = e.target.closest('[data-len]');
    if (len) { setLength(Number(len.dataset.len)); return; }
    if (e.target.closest('#studio-play')) { togglePlay(); return; }
    if (e.target.closest('#studio-record')) { toggleRecord(); return; }
    if (e.target.closest('#studio-clear')) { clearTake(); return; }
    const cat = e.target.closest('[data-category]');
    if (cat) {
      state.category = cat.dataset.category;
      state.categoryTouched = true;
      refreshSave();
      renderLoopView();
      return;
    }
    // Activación por teclado de una tecla, un pad o un acorde.
    if (e.detail === 0) {
      const key = e.target.closest('.studio-key');
      if (key) { playBriefNote(Number(key.dataset.midi)); return; }
      const pad = e.target.closest('.studio-pad');
      if (pad) { playPad(pad.dataset.pad, 0.9); return; }
      const chord = e.target.closest('[data-chord]');
      if (chord) { playBriefChord(chord.dataset.chord); return; }
    }
  }

  function playBriefNote(midi) {
    const pointerId = `kbd-${midi}`;
    const keyEl = $(`.studio-key[data-midi="${midi}"]`, state.body);
    startKey(midi, pointerId, keyEl);
    const t = setTimeout(() => {
      endPointer(pointerId);
      state.pressedTimers.delete(t);
    }, 190);
    state.pressedTimers.add(t);
  }

  function playBriefChord(chordId) {
    const def = STUDIO_CHORDS.find((c) => c.id === chordId);
    if (!def) return;
    const pointerId = `chord-${chordId}`;
    const card = $(`[data-chord="${chordId}"]`, state.body);
    startChord(def, pointerId, card);
    const t = setTimeout(() => {
      endPointer(pointerId);
      card?.classList.remove('is-pressed');
      state.pressedTimers.delete(t);
    }, 260);
    state.pressedTimers.add(t);
  }

  function onBodyInput(e) {
    const name = e.target.closest('#studio-name');
    if (name) {
      state.name = name.value.slice(0, 48);
      state.nameTouched = true;
      return;
    }
    if (e.target.closest('#studio-click')) {
      state.click = e.target.checked;
      return;
    }
  }

  function onFooterClick(e) {
    const cat = e.target.closest('[data-category]');
    if (cat) {
      state.category = cat.dataset.category;
      state.categoryTouched = true;
      refreshSave();
      renderLoopView();
      return;
    }
    if (e.target.closest('[data-studio-close]')) { state.api.close(); return; }
    if (e.target.closest('[data-studio-save]')) { saveTake(); return; }
    if (e.target.closest('[data-studio-again]')) { resetForNew(); return; }
  }

  function onWindowPointerUp(e) {
    endPointer(e.pointerId);
    $$('.studio-chord.is-pressed', state.body).forEach((el) => el.classList.remove('is-pressed'));
  }

  function onWindowPointerCancel(e) {
    onWindowPointerUp(e);
  }

  function onKeyDown(e) {
    if (!state.alive) return;
    if (isTypingTarget(e.target)) return;
    const onButton = e.target.closest?.('button');
    if (e.code === 'Space') {
      if (onButton) return;
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      toggleRecord();
    }
  }

  function animate() {
    if (!state.alive) return;
    updatePlayheadView();
    updateStatus();
    // En grabación, el contador de compás se actualiza con el reloj.
    if (state.recording && ctx.currentTime < state.loopStart) {
      const remaining = Math.max(1, Math.ceil((state.loopStart - ctx.currentTime) * (state.bpm / 60)));
      const count = $('#studio-countin', state.body);
      if (count) count.textContent = String(Math.min(4, remaining));
    }
    state.raf = requestAnimationFrame(animate);
  }

  /* ------------------------------------------------------------- abrir */

  const bodyHtml = buildBody();
  const footerHtml = buildFooter();
  const bus = new AbortController();
  const api = openModal({
    title: 'Teclado',
    body: bodyHtml,
    footer: footerHtml,
    wide: true,
    onClose: () => {
      state.alive = false;
      clearInterval(state.scheduleTimer);
      for (const t of state.pressedTimers) clearTimeout(t);
      cancelAnimationFrame(state.raf);
      bus.abort();
      stopAllSources();
      for (const item of state.pointers.values()) {
        for (const el of item.keys) el.classList.remove('is-active');
      }
      state.pointers.clear();
      try { gain.disconnect(); } catch {}
    },
    initialFocus: () => document.querySelector('#studio-play'),
  });
  state.api = api;
  state.body = api.body;
  state.foot = api.foot;
  state.clickBuffer = makeClickBuffer();

  state.body.addEventListener('pointerdown', onBodyPointerDown, { signal: bus.signal });
  state.body.addEventListener('click', onBodyClick, { signal: bus.signal });
  state.body.addEventListener('input', onBodyInput, { signal: bus.signal });
  state.foot.addEventListener('input', onBodyInput, { signal: bus.signal });
  state.foot.addEventListener('click', onFooterClick, { signal: bus.signal });
  window.addEventListener('pointerup', onWindowPointerUp, { signal: bus.signal });
  window.addEventListener('pointercancel', onWindowPointerCancel, { signal: bus.signal });
  document.addEventListener('keydown', onKeyDown, { signal: bus.signal });

  renderLoopView();
  updateStudioUI();
  refreshSave();
  state.raf = requestAnimationFrame(animate);
}
