/**
 * Looping · aplicación.
 *
 * Estado, biblioteca, línea de tiempo, reproductor y modales. Sin framework:
 * el navegador es suficiente.
 */

import {
  CATEGORIES, CATEGORY_BY_ID, SOUNDS, SOUND_BY_ID,
} from '../audio/catalog.js';
import { getActiveCustomSounds, registerAlbumCustomSounds } from '../audio/studio.js';
import {
  displayUnitsFor, hasSound, loopUnitsFor, renderSound, soundsInTrack,
} from '../audio/engine.js';
import { Player } from '../audio/player.js';
import { exportAudio } from '../audio/export.js';
import { trackFromRecipe, pickRecipe } from './recipes.js';
import {
  albumFile, currentAlbum, currentTrack, demoAlbum, duplicateAlbum, duplicateTrack,
  findTrack, importFile, loadState, newAlbumInState, newTrackInAlbum, saveState,
  saveStateNow, trackIsEmpty, uid, emptyLayer, emptyTrack, MAX_LAYERS,
} from './storage.js';
import {
  $, $$, clamp, debounce, downloadBlob, esc, formatBytes, fmtTime, icon,
  showToast, waitFrame, waveSvg,
} from './dom.js';
import { confirmDialog, isModalOpen, openModal, sectionHead } from './modals.js';
import { openStudio } from './studio.js';

/* ------------------------------------------------------------------ estado */

const loaded = loadState();
const player = new Player();
const app = {
  state: loaded.state,
  fresh: loaded.fresh,
  filter: 'all',
  selectedSound: null,
  selectedClip: null,
  stepW: 40,
  displayUnits: 16,
  history: [],
  future: [],
  dragging: false,
  preparing: false,
  prepareToken: 0,
  refreshSeq: 0,
  booted: false,
  sheetOpen: false,
  lastClock: '',
  status: '',
  pendingExport: null,
};

const isMobile = () => window.matchMedia('(max-width: 999px)').matches;
const album = () => currentAlbum(app.state);
const track = () => currentTrack(app.state);

function touch() {
  const t = track();
  if (t) t.updatedAt = Date.now();
  const a = album();
  if (a) a.updatedAt = Date.now();
}

function persist() {
  touch();
  saveState(app.state, () => showToast('No se pudo guardar en este navegador (almacenamiento lleno).', { error: true }));
}

function persistNow() {
  touch();
  saveStateNow(app.state);
}

/* ---------------------------------------------------------------- historial */

function snapshot() {
  app.history.push(JSON.stringify(track()));
  if (app.history.length > 50) app.history.shift();
  app.future.length = 0;
  renderHistory();
}

function restoreSnapshot(json) {
  const next = JSON.parse(json);
  const a = album();
  const idx = a.tracks.findIndex((t) => t.id === app.state.currentTrackId);
  if (idx < 0) return;
  next.id = app.state.currentTrackId;
  a.tracks[idx] = next;
  app.selectedClip = null;
  app.selectedSound = null;
  persist();
  renderAll();
  scheduleRefresh();
}

function undo() {
  if (!app.history.length) return;
  const current = JSON.stringify(track());
  const prev = app.history.pop();
  app.future.push(current);
  restoreSnapshot(prev);
  renderHistory();
  showToast('Deshecho');
}

function redo() {
  if (!app.future.length) return;
  const current = JSON.stringify(track());
  const next = app.future.pop();
  app.history.push(current);
  restoreSnapshot(next);
  renderHistory();
  showToast('Rehecho');
}

function renderHistory() {
  const u = $('#undo-btn');
  const r = $('#redo-btn');
  if (u) u.disabled = !app.history.length;
  if (r) r.disabled = !app.future.length;
}

/* ------------------------------------------------------------------ dom */

const soundList = $('#sound-list');
const timelineScroll = $('#timeline-scroll');
const timelineViewport = $('#timeline-viewport');

const getGutter = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 190;

function findLayer(layerId) {
  return track().layers.find((l) => l.id === layerId);
}

function findClip(layerId, clipId) {
  const layer = findLayer(layerId);
  if (!layer) return null;
  return layer.clips.find((c) => c.id === clipId) || null;
}

function selectedClipData() {
  if (!app.selectedClip) return null;
  const layer = findLayer(app.selectedClip.layerId);
  const clip = layer && layer.clips.find((c) => c.id === app.selectedClip.clipId);
  if (!layer || !clip) return null;
  return { layer, clip };
}

/* ------------------------------------------------------------------ render */

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function layerInfo(layer, index) {
  const cats = new Set();
  for (const c of layer.clips) {
    const s = SOUND_BY_ID[c.soundId];
    if (s) cats.add(s.category);
  }
  if (cats.size === 1) {
    const cat = CATEGORY_BY_ID[[...cats][0]];
    if (cat) return { name: capitalize(cat.short), color: cat.color };
  }
  if (cats.size > 1) return { name: 'Mezcla', color: 'var(--ink)' };
  return { name: `Capa ${index + 1}`, color: 'var(--line-strong)' };
}

function loopSummary(t) {
  const loop = loopUnitsFor(t);
  const sec = (loop * 60) / t.bpm;
  const bars = loop / 4;
  const barsText = `${bars} ${bars === 1 ? 'compás' : 'compases'}`;
  const secText = sec >= 60 ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : `${sec.toFixed(1).replace('.', ',')} s`;
  return { loop, sec, bars, barsText, secText };
}

function renderHeader() {
  const t = track();
  const a = album();
  if (!t || !a) return;
  $('#album-name').textContent = a.name || 'Sin título';
  $('#album-count').textContent = `${a.tracks.length} ${a.tracks.length === 1 ? 'tema' : 'temas'}`;
  const title = $('#track-title');
  if (document.activeElement !== title) title.value = t.name;
  const { barsText, secText, loop } = loopSummary(t);
  const clips = t.layers.reduce((n, l) => n + l.clips.length, 0);
  $('#track-meta').innerHTML = `<span class="track-meta__full">${barsText} · ${secText} · ${t.layers.length} ${t.layers.length === 1 ? 'capa' : 'capas'} · ${clips} ${clips === 1 ? 'sonido' : 'sonidos'}</span><span class="track-meta__short">${barsText} · ${secText}</span>`;
  $('#loop-bars').textContent = `${barsText} · ${secText}`;
  $('#bpm-input').value = t.bpm;
  $('#export-btn').disabled = trackIsEmpty(t);
  $('#clear-btn').disabled = trackIsEmpty(t);
  document.title = `${t.name} · Looping`;
  renderHistory();
}

function renderPlayState() {
  const btn = $('#play-btn');
  const playing = player.playing;
  btn.classList.toggle('is-playing', playing);
  btn.classList.toggle('is-preparing', app.preparing && !playing);
  btn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  btn.title = playing ? 'Pausar (espacio)' : 'Reproducir (espacio)';
  setStatus(app.preparing ? 'Preparando…' : (playing ? 'En directo' : ''));
}

function setStatus(text) {
  app.status = text || '';
  const el = $('#transport-status');
  if (el) el.textContent = app.status;
}

function renderTrackStrip() {
  const a = album();
  const current = app.state.currentTrackId;
  const html = a.tracks.map((t, i) => `
    <button class="track-tab ${t.id === current ? 'is-active' : ''}" type="button" data-track="${t.id}" title="${esc(t.name)}">
      <span class="track-tab__num">${String(i + 1).padStart(2, '0')}</span>
      <span class="track-tab__name">${esc(t.name)}</span>
    </button>`).join('');
  $('#trackstrip').innerHTML = html + `<button class="track-tab track-tab--add" type="button" data-add-track>+ Tema</button>`;
  const active = $('#trackstrip .track-tab.is-active');
  if (active) requestAnimationFrame(() => active.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
}

function albumSoundGroups() {
  const customs = getActiveCustomSounds().slice().reverse();
  return CATEGORIES.map((c) => ({
    ...c,
    sounds: [
      ...customs.filter((s) => s.category === c.id),
      ...SOUNDS.filter((s) => s.category === c.id),
    ],
  }));
}

function renderFilters() {
  const customs = getActiveCustomSounds();
  const counts = Object.fromEntries(CATEGORIES.map((c) => [
    c.id,
    SOUNDS.filter((s) => s.category === c.id).length + customs.filter((s) => s.category === c.id).length,
  ]));
  const total = SOUNDS.length + customs.length;
  const defs = [{ id: 'all', name: 'Todo', color: 'var(--ink)', count: total }, ...CATEGORIES.map((c) => ({ id: c.id, name: c.name, color: c.color, count: counts[c.id] }))];
  $('#filters').innerHTML = defs.map((f) => `
    <button class="filter ${app.filter === f.id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${app.filter === f.id}" data-filter="${f.id}">
      <span class="filter__dot" style="--c:${f.color}"></span>
      <span>${esc(f.name)}</span>
      <span class="filter__count">${f.count}</span>
    </button>`).join('');
}

function soundCard(s) {
  const cat = CATEGORY_BY_ID[s.category];
  const selected = app.selectedSound === s.id;
  return `
    <button class="sound-card ${selected ? 'is-selected' : ''}" type="button" data-sound="${s.id}"
      style="--c:${cat.color};--ct:${cat.ink}" aria-pressed="${selected}"
      title="${esc(s.name)} · ${s.beats} tiempos · ${esc(s.hint)}">
      <span class="sound-card__bar" aria-hidden="true"></span>
      <span class="sound-card__body">
        <span class="sound-card__top">
          <strong>${esc(s.name)}</strong>
          ${s.custom ? '<span class="sound-card__own">tuyo</span>' : ''}
          <span class="beats">${s.beats}<span> tiempos</span></span>
        </span>
        <span class="sound-card__hint">${esc(s.hint)}</span>
        <span class="sound-card__wave" aria-hidden="true">${waveSvg(s.id, 20)}</span>
      </span>
      <span class="sound-card__play" aria-hidden="true">${icon('play')}</span>
      <span class="sound-card__check" aria-hidden="true">${icon('check')}</span>
    </button>`;
}

function renderLibrary({ resetScroll = false } = {}) {
  const top = resetScroll ? 0 : soundList.scrollTop;
  const allGroups = albumSoundGroups();
  const groups = app.filter === 'all' ? allGroups : allGroups.filter((g) => g.id === app.filter);
  soundList.innerHTML = groups.map((cat) => `
    <section class="sound-group" aria-label="${esc(cat.name)}">
      <h3 class="sound-group__head" style="--c:${cat.color}">
        <span class="dot" aria-hidden="true"></span>
        <span>${esc(cat.name)}</span>
        <span class="count">${cat.sounds.length}</span>
      </h3>
      <div class="sound-group__list">${cat.sounds.map(soundCard).join('')}</div>
    </section>`).join('');
  soundList.scrollTop = top;
  const customCount = getActiveCustomSounds().length;
  $('#library-count').textContent = customCount
    ? `${SOUNDS.length + customCount} sonidos · ${customCount} ${customCount === 1 ? 'tuyo' : 'tuyos'}`
    : `${SOUNDS.length} sonidos · ${CATEGORIES.length} familias`;
}

function renderPlacing() {
  const bar = $('#placing-bar');
  const s = app.selectedSound ? SOUND_BY_ID[app.selectedSound] : null;
  if (!s) {
    bar.hidden = true;
    return;
  }
  const cat = CATEGORY_BY_ID[s.category];
  bar.hidden = false;
  $('#placing-dot').style.setProperty('--c', cat.color);
  $('#placing-text').textContent = `Colocando «${s.name}»`;
}

function renderSelection() {
  const el = $('#selection-info');
  const data = selectedClipData();
  if (!data) {
    el.innerHTML = '<span class="selection__dot" style="--c:var(--line-strong)"></span><span>Nada seleccionado</span>';
    return;
  }
  const s = SOUND_BY_ID[data.clip.soundId];
  const cat = CATEGORY_BY_ID[s.category];
  const layerIndex = track().layers.findIndex((l) => l.id === data.layer.id);
  const bar = Math.floor(data.clip.start / 4) + 1;
  const beat = (data.clip.start % 4) + 1;
  el.innerHTML = `
    <span class="selection__dot" style="--c:${cat.color}"></span>
    <span class="selection__label">${esc(s.name)} · capa ${layerIndex + 1} · compás ${bar}, tiempo ${beat}</span>
    <button type="button" data-duplicate-selected title="Duplicar este bloque justo después">Duplicar</button>
    <button type="button" data-remove-selected>Quitar</button>`;
}

function clipHtml(layer, clip, index) {
  const s = SOUND_BY_ID[clip.soundId];
  if (!s) return '';
  const cat = CATEGORY_BY_ID[s.category];
  const width = Math.max(4, s.beats * app.stepW - 3);
  const tiny = width < 42;
  const narrow = width < 86;
  const selected = app.selectedClip && app.selectedClip.layerId === layer.id && app.selectedClip.clipId === clip.id;
  const bar = Math.floor(clip.start / 4) + 1;
  const beat = (clip.start % 4) + 1;
  return `
    <div class="clip ${selected ? 'is-selected' : ''} ${tiny ? 'is-tiny' : ''} ${narrow ? 'is-narrow' : ''}"
      role="button" tabindex="0" data-layer="${layer.id}" data-clip="${clip.id}" data-sound="${s.id}"
      aria-label="${esc(s.name)}, ${s.beats} tiempos, capa ${index + 1}, compás ${bar}, tiempo ${beat}"
      title="${esc(s.name)} · ${s.beats} tiempos · arrastra para mover"
      style="left:${clip.start * app.stepW}px;width:${width}px;--c:${cat.color};--ct:${cat.ink}">
      <span class="clip__top">
        <span class="clip__name">${esc(s.name)}</span>
        <span class="clip__beats">${s.beats}</span>
      </span>
      <span class="clip__wave" aria-hidden="true">${waveSvg(s.id, 18)}</span>
      <button class="clip__remove" type="button" data-act="remove-clip" data-layer="${layer.id}" data-clip="${clip.id}" aria-label="Quitar ${esc(s.name)}">
        ${icon('close')}
      </button>
    </div>`;
}

function renderTimeline({ resetScroll = false } = {}) {
  const t = track();
  const loop = loopUnitsFor(t);
  const units = displayUnitsFor(t);
  app.displayUnits = units;
  const gutter = getGutter();
  const vpW = timelineViewport.clientWidth || window.innerWidth - 80;
  const available = Math.max(240, vpW - gutter - 2);
  const stepW = clamp(available / units, 24, 92);
  app.stepW = stepW;
  const content = $('#timeline-content');
  content.style.width = `${gutter + units * stepW}px`;
  content.style.setProperty('--step', `${stepW}px`);
  const scrollLeft = resetScroll ? 0 : timelineScroll.scrollLeft;

  // Regla superior: compases y pulsos.
  const bars = Math.ceil(units / 4);
  let ruler = '';
  for (let b = 0; b < bars; b++) {
    ruler += `<span class="bar-label" style="left:${b * 4 * stepW}px;width:${4 * stepW}px">${b + 1}</span>`;
  }
  for (let i = 0; i < units; i++) {
    ruler += `<span class="unit-tick ${i % 4 === 0 ? 'is-bar' : ''}" style="left:${i * stepW}px"></span>`;
  }
  if (loop <= units) {
    ruler += `<div class="loop-end" style="left:${loop * stepW}px"><span>fin · ${loop / 4} comp.</span></div>`;
  }
  const rulerTrack = $('#ruler-track');
  rulerTrack.style.width = `${units * stepW}px`;
  rulerTrack.innerHTML = ruler;

  // Capas.
  const anySolo = t.layers.some((l) => l.solo);
  const seenNames = {};
  const html = t.layers.map((layer, i) => {
    let info = layerInfo(layer, i);
    if (!info.name.startsWith('Capa') && info.name !== 'Mezcla') {
      const n = (seenNames[info.name] || 0) + 1;
      seenNames[info.name] = n;
      if (n > 1) info = { ...info, name: `${info.name} ${n}` };
    }
    const clips = layer.clips.slice().sort((a, b) => a.start - b.start).map((c) => clipHtml(layer, c, i)).join('');
    const dim = anySolo && !layer.solo;
    return `
      <div class="layer-row ${layer.mute ? 'is-muted' : ''} ${dim ? 'is-dim' : ''}" data-row="${layer.id}">
        <div class="layer-head">
          <div class="layer-head__top">
            <span class="layer-dot" style="--c:${info.color}" aria-hidden="true"></span>
            <span class="layer-name" title="${esc(info.name)}">${esc(info.name)}</span>
          </div>
          <div class="layer-head__bottom">
            <span class="layer-tools">
              <button class="layer-tool ${layer.mute ? 'is-on' : ''}" type="button" data-act="mute" data-layer="${layer.id}" aria-pressed="${layer.mute}" aria-label="Silenciar capa" title="Silenciar capa">M</button>
              <button class="layer-tool is-solo ${layer.solo ? 'is-on' : ''}" type="button" data-act="solo" data-layer="${layer.id}" aria-pressed="${layer.solo}" aria-label="Escuchar solo esta capa" title="Escuchar solo esta capa">S</button>
              <button class="layer-tool layer-tool--remove" type="button" data-act="remove-layer" data-layer="${layer.id}" title="Quitar capa" aria-label="Quitar capa">×</button>
            </span>
            ${icon('volume')}
            <input class="layer-vol" type="range" min="0" max="125" step="1" value="${Math.round((layer.volume ?? 0.84) * 100)}" data-act="volume" data-layer="${layer.id}" aria-label="Volumen de la capa" />
            <span class="layer-vol-value">${Math.round((layer.volume ?? 0.84) * 100)}</span>
          </div>
        </div>
        <div class="layer-lane ${app.selectedSound ? 'is-placing' : ''}" data-layer="${layer.id}" style="width:${units * stepW}px">
          ${loop < units ? `<div class="out-loop" style="left:${loop * stepW}px;right:0" aria-hidden="true"></div>` : ''}
          ${clips}
        </div>
      </div>`;
  }).join('');
  $('#layers').innerHTML = html;
  $('#add-layer').disabled = t.layers.length >= MAX_LAYERS;
  $('#add-layer').innerHTML = t.layers.length >= MAX_LAYERS
    ? `<span>Máximo de ${MAX_LAYERS} capas</span>`
    : `${icon('plus')}<span>Añadir capa</span>`;

  // Estado vacío.
  const empty = trackIsEmpty(t) && !app.selectedSound;
  const emptyEl = $('#empty-state');
  emptyEl.hidden = !empty;
  emptyEl.classList.toggle('is-hidden', !empty);
  emptyEl.setAttribute('aria-hidden', String(!empty));

  timelineScroll.scrollLeft = scrollLeft;
  renderSelection();
  renderPlacing();
}

function renderAll({ resetScroll = false } = {}) {
  renderHeader();
  renderTrackStrip();
  renderFilters();
  renderLibrary();
  renderTimeline({ resetScroll });
  renderPlacing();
  renderSelection();
  renderPlayState();
  renderHistory();
}

/* ------------------------------------------------------------------ sonido */

async function previewSound(id, card) {
  const s = SOUND_BY_ID[id];
  if (!s) return;
  try {
    await player.ensure();
  } catch {
    showToast('Este navegador no puede reproducir audio.', { error: true });
    return;
  }
  const bpm = track().bpm;
  if (!hasSound(id, bpm)) {
    card?.classList.add('is-loading');
    await waitFrame();
    renderSound(s, bpm);
    card?.classList.remove('is-loading');
  }
  player.preview(id, bpm);
}

function selectSound(id) {
  if (!SOUND_BY_ID[id]) return;
  app.selectedSound = id;
  app.selectedClip = null;
  renderLibrary();
  renderTimeline();
  renderSelection();
  if (isMobile()) closeLibrary();
  previewSound(id);
}

function clearPlacement() {
  if (!app.selectedSound) return;
  app.selectedSound = null;
  renderLibrary();
  renderTimeline();
}

function selectClip(layerId, clipId, { rerender = true, preview = true } = {}) {
  app.selectedClip = { layerId, clipId };
  app.selectedSound = null;
  renderLibrary();
  renderPlacing();
  renderSelection();
  if (preview && !player.playing) {
    const clip = findClip(layerId, clipId);
    if (clip) previewSound(clip.soundId);
  }
  if (rerender) renderTimeline();
  else {
    $$('.clip', timelineScroll).forEach((el) => el.classList.toggle('is-selected', el.dataset.layer === layerId && el.dataset.clip === clipId));
  }
}

function clearSelection() {
  if (!app.selectedClip && !app.selectedSound) return;
  app.selectedClip = null;
  app.selectedSound = null;
  renderLibrary();
  renderTimeline();
}

function canPlace(layer, start, beats, excludeId = null) {
  if (!layer) return false;
  if (start < 0) return false;
  for (const c of layer.clips) {
    if (c.id === excludeId) continue;
    const s = SOUND_BY_ID[c.soundId];
    if (!s) continue;
    if (start < c.start + s.beats && start + beats > c.start) return false;
  }
  return true;
}

function placeClip(layerId, start) {
  const s = SOUND_BY_ID[app.selectedSound];
  const layer = findLayer(layerId);
  if (!s || !layer) return;
  if (!canPlace(layer, start, s.beats)) {
    showToast('Ese hueco está ocupado. Prueba en otro tiempo.', { error: true });
    return;
  }
  const wasEmpty = trackIsEmpty(track());
  snapshot();
  layer.clips.push({ id: uid('cl'), soundId: s.id, start });
  layer.clips.sort((a, b) => a.start - b.start);
  persist();
  renderAll();
  if (wasEmpty && !player.playing) {
    startPlayback().catch(() => {});
  } else {
    scheduleRefresh();
  }
  const el = $$('.clip', timelineScroll).find((c) => c.dataset.sound === s.id && Number(c.style.left.replace('px', '')) === start * app.stepW);
  if (el) {
    const vp = timelineScroll;
    const left = start * app.stepW;
    const laneWidth = s.beats * app.stepW;
    const gutter = getGutter();
    const visibleW = vp.clientWidth - gutter;
    if (left + laneWidth > vp.scrollLeft + visibleW) vp.scrollLeft = left + laneWidth - visibleW + 24;
    else if (left < vp.scrollLeft) vp.scrollLeft = Math.max(0, left - 12);
  }
}

function removeClip(layerId, clipId) {
  const layer = findLayer(layerId);
  if (!layer) return;
  const idx = layer.clips.findIndex((c) => c.id === clipId);
  if (idx < 0) return;
  snapshot();
  layer.clips.splice(idx, 1);
  app.selectedClip = null;
  persist();
  renderAll();
  scheduleRefresh();
}

function removeSelectedClip() {
  if (!app.selectedClip) return;
  removeClip(app.selectedClip.layerId, app.selectedClip.clipId);
}

function duplicateSelectedClip() {
  const data = selectedClipData();
  if (!data) return;
  const s = SOUND_BY_ID[data.clip.soundId];
  if (!s) return;
  const nextStart = data.clip.start + s.beats;
  if (!canPlace(data.layer, nextStart, s.beats)) {
    showToast('No hay hueco justo después. Mueve el bloque o elige otro tiempo.', { error: true });
    return;
  }
  snapshot();
  const copy = { ...data.clip, id: uid('cl'), start: nextStart };
  data.layer.clips.push(copy);
  data.layer.clips.sort((a, b) => a.start - b.start);
  app.selectedClip = { layerId: data.layer.id, clipId: copy.id };
  persist();
  renderAll();
  scheduleRefresh();
  showToast('Bloque duplicado');
}

function nudgeSelected(dx, dLayer) {
  const data = selectedClipData();
  if (!data) return;
  const { layer, clip } = data;
  const s = SOUND_BY_ID[clip.soundId];
  if (!s) return;
  if (dLayer) {
    const idx = track().layers.findIndex((l) => l.id === layer.id);
    const target = track().layers[idx + dLayer];
    if (!target) return;
    if (!canPlace(target, clip.start, s.beats)) {
      showToast('No cabe en esa capa.', { error: true });
      return;
    }
    snapshot();
    layer.clips = layer.clips.filter((c) => c.id !== clip.id);
    target.clips.push(clip);
    app.selectedClip = { layerId: target.id, clipId: clip.id };
    persist();
    renderAll();
    scheduleRefresh();
    return;
  }
  const next = clamp(clip.start + dx, 0, 255);
  if (next === clip.start) return;
  if (!canPlace(layer, next, s.beats, clip.id)) {
    showToast('No cabe ahí.', { error: true });
    return;
  }
  snapshot();
  clip.start = next;
  layer.clips.sort((a, b) => a.start - b.start);
  persist();
  renderAll();
  scheduleRefresh();
}

/* ------------------------------------------------------------------ capas */

function toggleLayer(layerId, field) {
  const layer = findLayer(layerId);
  if (!layer) return;
  layer[field] = !layer[field];
  persist();
  renderTimeline();
  renderHeader();
  scheduleRefresh();
}

function setLayerVolume(layerId, value) {
  const layer = findLayer(layerId);
  if (!layer) return;
  layer.volume = clamp(value / 100, 0, 1.25);
  const label = $('.layer-vol-value', $(`[data-row="${layerId}"]`));
  if (label) label.textContent = String(Math.round(value));
  persist();
  scheduleRefresh();
}

function addLayer() {
  const t = track();
  if (t.layers.length >= MAX_LAYERS) {
    showToast(`Máximo de ${MAX_LAYERS} capas.`, { error: true });
    return;
  }
  snapshot();
  const layer = emptyLayer();
  t.layers.push(layer);
  persist();
  renderAll();
  requestAnimationFrame(() => {
    const row = $(`[data-row="${layer.id}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  showToast(`Capa ${t.layers.length} añadida`);
}

function removeLayer(layerId) {
  const t = track();
  if (t.layers.length <= 1) {
    showToast('Debe quedar al menos una capa.', { error: true });
    return;
  }
  const idx = t.layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return;
  snapshot();
  t.layers.splice(idx, 1);
  if (app.selectedClip && app.selectedClip.layerId === layerId) app.selectedClip = null;
  persist();
  renderAll();
  scheduleRefresh();
  showToast('Capa quitada');
}

/* ------------------------------------------------------------------ audio */

async function prepareCurrent({ onProgress = null } = {}) {
  const token = ++app.prepareToken;
  const t = track();
  const bpm = t.bpm;
  const ids = soundsInTrack(t);
  const missing = ids.filter((id) => !hasSound(id, bpm));
  if (!missing.length) {
    app.preparing = false;
    renderPlayState();
    return true;
  }
  app.preparing = true;
  renderPlayState();
  let done = 0;
  onProgress?.(0, missing[0]);
  for (const id of missing) {
    if (token !== app.prepareToken || track() !== t || track().bpm !== bpm) return false;
    app.preparing = true;
    setStatus(`Preparando ${done + 1}/${missing.length}…`);
    onProgress?.(done / missing.length, id);
    await waitFrame();
    if (token !== app.prepareToken || track() !== t || track().bpm !== bpm) return false;
    renderSound(SOUND_BY_ID[id], bpm);
    done++;
    onProgress?.(done / missing.length, id);
  }
  if (track() !== t || track().bpm !== bpm) return false;
  if (token === app.prepareToken) {
    app.preparing = false;
    app.status = '';
    renderPlayState();
  }
  return token === app.prepareToken;
}

let refreshTimer = 0;
function scheduleRefresh(delay = 70) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refreshAudio().catch(() => {}); }, delay);
}

async function refreshAudio() {
  if (!player.playing) return;
  const token = ++app.refreshSeq;
  const t = track();
  const bpm = t.bpm;
  const missing = soundsInTrack(t).filter((id) => !hasSound(id, bpm));
  if (missing.length) {
    app.preparing = true;
    renderPlayState();
    let done = 0;
    for (const id of missing) {
      if (token !== app.refreshSeq || !player.playing || track() !== t || track().bpm !== bpm) return;
      setStatus(`Afinando ${done + 1}/${missing.length}…`);
      await waitFrame();
      if (token !== app.refreshSeq || !player.playing || track() !== t || track().bpm !== bpm) return;
      renderSound(SOUND_BY_ID[id], bpm);
      done++;
    }
    app.preparing = false;
    renderPlayState();
  }
  if (token !== app.refreshSeq || !player.playing || track() !== t || track().bpm !== bpm) return;
  player.refresh(t, bpm);
  app.status = 'En directo';
  renderPlayState();
}

async function startPlayback() {
  if (player.playing) return;
  const t = track();
  if (trackIsEmpty(t)) {
    showToast('Añade un sonido para empezar.', { error: true });
    if (isMobile()) openLibrary();
    return;
  }
  try {
    await player.ensure();
    const ok = await prepareCurrent();
    if (!ok) return;
    player.stopPreview();
    await player.play(track(), track().bpm);
    app.status = '';
    renderPlayState();
  } catch (err) {
    console.error(err);
    showToast('No se pudo iniciar el audio.', { error: true });
  }
}

async function togglePlay() {
  if (player.playing) {
    player.pause();
    app.status = '';
    renderPlayState();
    return;
  }
  await startPlayback();
}

function setBpm(value) {
  const t = track();
  const bpm = clamp(Math.round(Number(value) || t.bpm), 55, 120);
  if (bpm === t.bpm) {
    $('#bpm-input').value = t.bpm;
    return;
  }
  t.bpm = bpm;
  persist();
  renderHeader();
  $('#bpm-input').value = bpm;
  if (player.playing) {
    renderPlayState();
    setStatus('Afinando…');
  }
  clearTimeout(app.bpmTimer);
  app.bpmTimer = setTimeout(() => {
    if (player.playing) refreshAudio().catch(() => {});
  }, 300);
}

/* ------------------------------------------------------------------ track */

function resetPlayback() {
  app.refreshSeq++;
  app.prepareToken++;
  try { player.stopAll(); } catch {}
  player.mix = null;
  player.pausedBeat = 0;
  app.status = '';
  renderPlayState();
}

function switchTrack(id, { focusTitle = false } = {}) {
  if (id === app.state.currentTrackId) return;
  const found = findTrack(app.state, id);
  if (!found) return;
  resetPlayback();
  app.state.currentAlbumId = found.album.id;
  app.state.currentTrackId = id;
  registerAlbumCustomSounds(found.album);
  app.selectedSound = null;
  app.selectedClip = null;
  app.history = [];
  app.future = [];
  persist();
  renderAll({ resetScroll: true });
  prepareCurrent().catch(() => {});
  if (focusTitle) setTimeout(() => { const input = $('#track-title'); input.focus(); input.select(); }, 30);
}

function switchAlbum(id) {
  const a = app.state.albums.find((x) => x.id === id);
  if (!a) return;
  if (a.id === app.state.currentAlbumId && a.tracks.some((t) => t.id === app.state.currentTrackId)) return;
  resetPlayback();
  app.state.currentAlbumId = a.id;
  app.state.currentTrackId = a.tracks[0].id;
  registerAlbumCustomSounds(a);
  app.selectedSound = null;
  app.selectedClip = null;
  app.history = [];
  app.future = [];
  persist();
  renderAll({ resetScroll: true });
  prepareCurrent().catch(() => {});
}

function addTrack({ focus = true } = {}) {
  const a = album();
  resetPlayback();
  const t = newTrackInAlbum(a);
  app.state.currentTrackId = t.id;
  app.selectedSound = null;
  app.selectedClip = null;
  app.history = [];
  app.future = [];
  persist();
  renderAll({ resetScroll: true });
  if (focus) {
    const input = $('#track-title');
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }
}

function clearTrackAction() {
  if (app.sheetOpen) closeLibrary();
  const t = track();
  if (trackIsEmpty(t)) {
    showToast('El tema ya está vacío.');
    return;
  }
  confirmDialog({
    title: 'Vaciar el tema',
    message: `Se quitarán todos los sonidos de <strong>${esc(t.name)}</strong>. Podrás deshacerlo.`,
    confirmLabel: 'Vaciar',
    danger: true,
  }).then((ok) => {
    if (!ok) return;
    snapshot();
    resetPlayback();
    t.layers = [emptyLayer()];
    app.selectedSound = null;
    app.selectedClip = null;
    persist();
    renderAll();
    showToast('Tema vacío');
  });
}

async function surprise() {
  if (app.sheetOpen) closeLibrary();
  const t = track();
  const recipe = pickRecipe(app.state.recentRecipes || []);
  const apply = () => {
    snapshot();
    const next = trackFromRecipe(recipe, t.name);
    const autoName = /^(Tema|Boom bap|Noche soul|Cinta de madrugada|Trap de noche|Callejón|Cine negro|Domingo|Polvo de oro)( \d+)?$/i.test(t.name);
    if (autoName) t.name = recipe.name;
    t.bpm = next.bpm;
    t.layers = next.layers.map((l) => ({ ...l, id: uid('ly'), clips: l.clips.map((c) => ({ ...c, id: uid('cl') })) }));
    t.updatedAt = Date.now();
    app.state.recentRecipes = [recipe.id, ...(app.state.recentRecipes || []).filter((x) => x !== recipe.id)].slice(0, 6);
    app.selectedSound = null;
    app.selectedClip = null;
    persist();
    renderAll({ resetScroll: true });
    if (player.playing) scheduleRefresh(20);
    else startPlayback().catch(() => {});
    showToast(`Base «${recipe.name}» creada`);
  };
  if (trackIsEmpty(t)) {
    apply();
    return;
  }
  const ok = await confirmDialog({
    title: '¿Cambiar la base?',
    message: `Vas a reemplazar los sonidos de <strong>${esc(t.name)}</strong> por una base nueva. Puedes deshacerlo.`,
    confirmLabel: 'Sorpréndeme',
  });
  if (ok) apply();
}

/* ------------------------------------------------------------------ proyectos */

function projectTrackRow(t, index, total) {
  const loop = loopUnitsFor(t);
  const clips = t.layers.reduce((n, l) => n + l.clips.length, 0);
  const current = t.id === app.state.currentTrackId;
  return `
    <div class="track-row ${current ? 'is-current' : ''}" data-track-row="${t.id}">
      <span class="track-row__num">${String(index + 1).padStart(2, '0')}</span>
      <div class="track-row__main">
        <input class="track-row__name" type="text" maxlength="80" value="${esc(t.name)}" data-track-name="${t.id}" aria-label="Nombre del tema" />
        <span class="track-row__meta">${loop / 4} ${loop / 4 === 1 ? 'compás' : 'compases'} · ${t.bpm} bpm · ${clips} ${clips === 1 ? 'sonido' : 'sonidos'} · ${t.layers.length} ${t.layers.length === 1 ? 'capa' : 'capas'}</span>
      </div>
      <div class="track-row__actions">
        <button class="btn btn--tiny track-row__open" type="button" data-open-track="${t.id}">Abrir</button>
        <button class="icon-btn" type="button" data-up-track="${t.id}" title="Subir" aria-label="Subir tema" ${index === 0 ? 'disabled' : ''}>${icon('chev-up')}</button>
        <button class="icon-btn" type="button" data-down-track="${t.id}" title="Bajar" aria-label="Bajar tema" ${index === total - 1 ? 'disabled' : ''}>${icon('chev-down')}</button>
        <button class="icon-btn" type="button" data-dup-track="${t.id}" title="Duplicar tema" aria-label="Duplicar tema">${icon('copy')}</button>
        <button class="icon-btn" type="button" data-del-track="${t.id}" title="Eliminar tema" aria-label="Eliminar tema">${icon('trash')}</button>
      </div>
    </div>`;
}

function projectsBody() {
  const a = album();
  const chips = app.state.albums.map((x) => `
    <button class="album-chip ${x.id === a.id ? 'is-active' : ''}" type="button" data-album="${x.id}">
      <span>${esc(x.name)}</span><span class="count">${x.tracks.length}</span>
    </button>`).join('');
  const rows = a.tracks.map((t, i) => projectTrackRow(t, i, a.tracks.length)).join('');
  return `
    <div class="album-chips">
      ${chips}
      <button class="album-chip album-chip--add" type="button" data-add-album>+ Nuevo álbum</button>
    </div>
    ${sectionHead('Álbum actual')}
    <input class="album-name-input" id="project-album-name" type="text" maxlength="80" value="${esc(a.name)}" aria-label="Nombre del álbum" />
    <div class="project-actions">
      <button class="btn btn--outline btn--tiny" type="button" data-download-project>${icon('download')} Descargar proyecto</button>
      <button class="btn btn--outline btn--tiny" type="button" data-import-project>${icon('upload')} Abrir archivo</button>
      <button class="btn btn--outline btn--tiny" type="button" data-dup-album>${icon('copy')} Duplicar álbum</button>
      <button class="btn btn--outline btn--tiny" type="button" data-del-album>${icon('trash')} Eliminar álbum</button>
    </div>
    ${sectionHead('Temas')}
    <div class="track-list">${rows}</div>
    <button class="btn btn--dark btn--wide" type="button" data-new-track style="margin-top:9px">${icon('plus')} Nuevo tema</button>
    <p class="project-note">Se guarda automáticamente en este navegador. Descarga el proyecto para llevarlo a otro sitio o abrirlo en otro equipo.</p>`;
}

function bindProjects(api) {
  api.setBody(projectsBody());
  api.setFooter('<span class="project-note" style="margin:0">Looping · proyecto local</span><span class="spacer"></span><button class="btn btn--dark" type="button" data-close-projects>Cerrar</button>');
  const root = api.body;

  $$('[data-album]', root).forEach((b) => b.addEventListener('click', () => {
    switchAlbum(b.dataset.album);
    bindProjects(api);
  }));
  $('[data-add-album]', root)?.addEventListener('click', () => {
    newAlbumInState(app.state);
    registerAlbumCustomSounds(album());
    app.selectedSound = null;
    app.selectedClip = null;
    app.history = [];
    app.future = [];
    resetPlayback();
    persist();
    renderAll({ resetScroll: true });
    prepareCurrent().catch(() => {});
    bindProjects(api);
    const input = $('#project-album-name');
    if (input) { input.focus(); input.select(); }
  });
  const nameInput = $('#project-album-name', root);
  nameInput?.addEventListener('input', () => {
    album().name = nameInput.value.slice(0, 80);
    persist();
    renderHeader();
    saveDebounced();
  });
  nameInput?.addEventListener('blur', () => {
    if (!nameInput.value.trim()) {
      nameInput.value = 'Álbum sin título';
      album().name = 'Álbum sin título';
      persist();
      renderHeader();
    }
    const chip = root.querySelector(`.album-chip[data-album="${album().id}"] span:first-child`);
    if (chip) chip.textContent = album().name;
  });

  $('[data-download-project]', root)?.addEventListener('click', downloadProject);
  $('[data-import-project]', root)?.addEventListener('click', () => {
    const input = $('#import-file');
    input.value = '';
    input.click();
  });
  $('[data-dup-album]', root)?.addEventListener('click', () => {
    const copy = duplicateAlbum(album());
    app.state.albums.push(copy);
    app.state.currentAlbumId = copy.id;
    app.state.currentTrackId = copy.tracks[0].id;
    registerAlbumCustomSounds(copy);
    app.selectedSound = null;
    app.selectedClip = null;
    app.history = [];
    app.future = [];
    resetPlayback();
    persist();
    renderAll({ resetScroll: true });
    prepareCurrent().catch(() => {});
    bindProjects(api);
    showToast('Álbum duplicado');
  });
  $('[data-del-album]', root)?.addEventListener('click', async () => {
    const a = album();
    if (app.state.albums.length <= 1) {
      showToast('No puedes eliminar el único álbum.', { error: true });
      return;
    }
    const ok = await confirmDialog({
      title: 'Eliminar álbum',
      message: `Se eliminará <strong>${esc(a.name)}</strong> y sus ${a.tracks.length} ${a.tracks.length === 1 ? 'tema' : 'temas'}.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) { openProjectsModal(); return; }
    app.state.albums = app.state.albums.filter((x) => x.id !== a.id);
    app.state.currentAlbumId = app.state.albums[0].id;
    app.state.currentTrackId = app.state.albums[0].tracks[0].id;
    registerAlbumCustomSounds(currentAlbum(app.state));
    app.selectedSound = null;
    app.selectedClip = null;
    app.history = [];
    app.future = [];
    resetPlayback();
    persistNow();
    renderAll({ resetScroll: true });
    prepareCurrent().catch(() => {});
    openProjectsModal();
  });

  $$('[data-open-track]', root).forEach((b) => b.addEventListener('click', () => {
    switchTrack(b.dataset.openTrack);
    api.close();
  }));
  $$('[data-up-track]', root).forEach((b) => b.addEventListener('click', () => moveTrack(b.dataset.upTrack, -1, api)));
  $$('[data-down-track]', root).forEach((b) => b.addEventListener('click', () => moveTrack(b.dataset.downTrack, 1, api)));
  $$('[data-dup-track]', root).forEach((b) => b.addEventListener('click', () => {
    const a = album();
    const idx = a.tracks.findIndex((t) => t.id === b.dataset.dupTrack);
    if (idx < 0) return;
    const copy = duplicateTrack(a.tracks[idx]);
    a.tracks.splice(idx + 1, 0, copy);
    persist();
    renderTrackStrip();
    bindProjects(api);
    showToast('Tema duplicado');
  }));
  $$('[data-del-track]', root).forEach((b) => b.addEventListener('click', async () => {
    const a = album();
    const idx = a.tracks.findIndex((t) => t.id === b.dataset.delTrack);
    if (idx < 0) return;
    const target = a.tracks[idx];
    const ok = await confirmDialog({
      title: 'Eliminar tema',
      message: `Se eliminará <strong>${esc(target.name)}</strong>.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) { openProjectsModal(); return; }
    const wasCurrent = target.id === app.state.currentTrackId;
    a.tracks.splice(idx, 1);
    if (!a.tracks.length) a.tracks.push(emptyTrack('Tema 1'));
    if (wasCurrent) {
      const next = a.tracks[Math.min(idx, a.tracks.length - 1)];
      app.state.currentTrackId = next.id;
      resetPlayback();
      renderAll({ resetScroll: true });
      prepareCurrent().catch(() => {});
    } else {
      renderTrackStrip();
    }
    persistNow();
    openProjectsModal();
    showToast('Tema eliminado');
  }));
  $$('[data-track-name]', root).forEach((input) => {
    input.addEventListener('input', () => {
      const found = findTrack(app.state, input.dataset.trackName);
      if (!found) return;
      found.track.name = input.value.slice(0, 80);
      persist();
      renderHeader();
      renderTrackStrip();
      saveDebounced();
    });
    input.addEventListener('blur', () => {
      if (!input.value.trim()) {
        const found = findTrack(app.state, input.dataset.trackName);
        if (found) found.track.name = 'Tema sin título';
        persist();
        renderTrackStrip();
        input.value = found ? found.track.name : 'Tema sin título';
      }
    });
  });
  $('[data-new-track]', root)?.addEventListener('click', () => {
    addTrack({ focus: false });
    bindProjects(api);
  });
  $('[data-close-projects]', api.foot)?.addEventListener('click', () => api.close());
}

function moveTrack(id, dir, api) {
  const a = album();
  const idx = a.tracks.findIndex((t) => t.id === id);
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= a.tracks.length) return;
  [a.tracks[idx], a.tracks[next]] = [a.tracks[next], a.tracks[idx]];
  persist();
  renderTrackStrip();
  bindProjects(api);
}

function openProjectsModal() {
  if (app.sheetOpen) closeLibrary();
  const api = openModal({
    title: 'Proyectos',
    body: '',
    footer: '',
    wide: true,
    onClose: () => {},
  });
  bindProjects(api);
}

const saveDebounced = debounce(() => persist(), 300);

function downloadProject() {
  const a = album();
  const data = albumFile(app.state);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const name = (a.name || 'looping').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'looping';
  downloadBlob(blob, `${name}.looping.json`);
  showToast('Proyecto descargado');
}

async function handleImport(file) {
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const albums = importFile(raw);
    app.state.albums.push(...albums);
    app.state.currentAlbumId = albums[0].id;
    app.state.currentTrackId = albums[0].tracks[0].id;
    registerAlbumCustomSounds(albums[0]);
    resetPlayback();
    persistNow();
    renderAll({ resetScroll: true });
    prepareCurrent().catch(() => {});
    if (isModalOpen()) openProjectsModal();
    showToast(`«${albums[0].name}» importado`);
  } catch (err) {
    console.error(err);
    showToast(err.message || 'No se pudo abrir el proyecto.', { error: true });
  }
}

/* ------------------------------------------------------------------ exportar */

const PREFS_KEY = 'looping.exportPrefs.v1';

function readExportPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      seconds: clamp(Number(raw.seconds) || 60, 15, 300),
      format: raw.format === 'wav' ? 'wav' : 'mp3',
      fade: raw.fade !== false,
    };
  } catch {
    return { seconds: 60, format: 'mp3', fade: true };
  }
}

function writeExportPrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function openExportModal() {
  const t = track();
  if (trackIsEmpty(t)) {
    showToast('Añade al menos un sonido antes de exportar.', { error: true });
    return;
  }
  if (app.sheetOpen) closeLibrary();
  const loopSec = (loopUnitsFor(t) * 60) / t.bpm;
  const prefs = readExportPrefs();
  let format = prefs.format;
  let seconds = prefs.seconds;
  let fade = prefs.fade;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  const api = openModal({
    title: 'Exportar tema',
    wide: false,
    body: `
      <div class="export-track"><strong>${esc(t.name)}</strong><span>${t.bpm} bpm · bucle de ${fmtTime(loopSec, true)}</span></div>
      <div class="field-label">Duración</div>
      <div class="duration-row">
        <div class="duration-box">
          <input id="exp-min" type="number" min="0" max="5" value="${mins}" aria-label="Minutos" />
          <span>:</span>
          <input id="exp-sec" type="number" min="0" max="59" value="${String(secs).padStart(2, '0')}" aria-label="Segundos" />
          <span class="small">min : seg</span>
        </div>
        <div class="preset-row" id="exp-presets">
          ${[30, 60, 120, 180, 300].map((s) => `<button class="preset ${s === seconds ? 'is-active' : ''}" type="button" data-preset="${s}">${fmtTime(s)}</button>`).join('')}
        </div>
      </div>
      <div class="field-label">Formato</div>
      <div class="segmented" id="exp-format">
        <button type="button" data-format="mp3" class="${format === 'mp3' ? 'is-active' : ''}">MP3 320</button>
        <button type="button" data-format="wav" class="${format === 'wav' ? 'is-active' : ''}">WAV 16 bits</button>
      </div>
      <label class="check-row"><input id="exp-fade" type="checkbox" ${fade ? 'checked' : ''} /> <span>Fundido final (2,2 s)</span></label>
      <div class="export-summary" id="exp-summary"></div>`,
    footer: `<button class="btn btn--outline" type="button" data-cancel-export>Cancelar</button><span class="spacer"></span><button class="btn btn--primary" type="button" data-do-export>${icon('download')} Exportar audio</button>`,
    initialFocus: () => api.foot.querySelector('[data-do-export]'),
  });

  const minInput = $('#exp-min', api.body);
  const secInput = $('#exp-sec', api.body);
  const summary = $('#exp-summary', api.body);
  const presets = $$('[data-preset]', api.body);
  const fmtButtons = $$('[data-format]', api.body);
  const fadeInput = $('#exp-fade', api.body);

  const currentSeconds = () => {
    const m = clamp(parseInt(minInput.value, 10) || 0, 0, 5);
    const s = clamp(parseInt(secInput.value, 10) || 0, 0, 59);
    return m * 60 + s;
  };
  const update = () => {
    seconds = clamp(currentSeconds(), 15, 300);
    minInput.value = Math.floor(seconds / 60);
    secInput.value = String(seconds % 60).padStart(2, '0');
    presets.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.preset) === seconds));
    fmtButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.format === format));
    const reps = Math.ceil(seconds / loopSec);
    const bytes = format === 'mp3' ? (320 * 1000 * seconds) / 8 : 44100 * 2 * 2 * seconds;
    summary.innerHTML = `El bucle se repetirá <strong>${reps}</strong> ${reps === 1 ? 'vez' : 'veces'}.<br>Formato <strong>${format === 'mp3' ? 'MP3 320 kbps' : 'WAV 44,1 kHz / 16 bits'}</strong> · tamaño aproximado <strong>${formatBytes(bytes)}</strong>.`;
    writeExportPrefs({ seconds, format, fade });
  };
  minInput.addEventListener('change', update);
  secInput.addEventListener('change', update);
  minInput.addEventListener('input', () => { if (minInput.value.length >= 1 && secInput.value !== '') update(); });
  secInput.addEventListener('input', () => { if (secInput.value.length >= 2) update(); });
  presets.forEach((b) => b.addEventListener('click', () => {
    seconds = Number(b.dataset.preset);
    minInput.value = Math.floor(seconds / 60);
    secInput.value = String(seconds % 60).padStart(2, '0');
    update();
  }));
  fmtButtons.forEach((b) => b.addEventListener('click', () => { format = b.dataset.format; update(); }));
  fadeInput.addEventListener('change', () => { fade = fadeInput.checked; update(); });
  update();

  let aborted = false;
  let controller = null;

  const showProgress = () => {
    api.setBody(`
      <div class="progress-view">
        <div class="progress-view__top"><span id="exp-stage">Preparando…</span><span id="exp-pct">0%</span></div>
        <div class="progress-view__bar"><span id="exp-bar"></span></div>
        <p class="progress-view__note" id="exp-note">Estamos mezclando y codificando en tu navegador. No cierres esta pestaña.</p>
      </div>`);
    api.setFooter('<span class="spacer"></span><button class="btn btn--outline" type="button" data-cancel-export>Cancelar</button>');
    api.foot.querySelector('[data-cancel-export]').addEventListener('click', () => {
      aborted = true;
      controller?.abort();
      api.close();
    });
    api.dismissible = false;
    setProgress(0, 'Preparando…');
  };

  const setProgress = (p, label) => {
    const bar = $('#exp-bar', api.body);
    const pct = $('#exp-pct', api.body);
    const stage = $('#exp-stage', api.body);
    if (bar) bar.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    if (pct) pct.textContent = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    if (stage && label) stage.textContent = label;
  };

  const doExport = async () => {
    if (aborted) return;
    seconds = clamp(currentSeconds(), 15, 300);
    writeExportPrefs({ seconds, format, fade });
    showProgress();
    controller = new AbortController();
    const signal = controller.signal;
    try {
      await prepareCurrent({
        onProgress: (p) => setProgress(p * 0.14, 'Preparando sonidos…'),
      });
      if (aborted) return;
      setProgress(0.15, 'Mezclando el tema…');
      const result = await exportAudio({
        track: track(),
        bpm: track().bpm,
        seconds,
        format,
        fadeOut: fade ? 2.2 : 0.02,
        title: track().name,
        album: album().name,
        signal,
        onProgress: (p, label) => setProgress(0.15 + p * 0.85, label),
      });
      if (aborted) return;
      downloadBlob(result.blob, result.filename);
      api.dismissible = true;
      api.setTitle('Listo');
      api.setBody(`
        <div class="success-view">
          <div class="success-view__check">${icon('check')}</div>
          <h3>${format === 'mp3' ? 'MP3 exportado' : 'WAV exportado'}</h3>
          <p>${esc(result.filename)}</p>
          <span class="bytes">${formatBytes(result.bytes)} · ${fmtTime(result.seconds, true)}</span>
        </div>`);
      api.setFooter(`<span class="spacer"></span><button class="btn btn--outline" type="button" data-again>Descargar otra vez</button><button class="btn btn--dark" type="button" data-close-export>Cerrar</button>`);
      api.foot.querySelector('[data-again]').addEventListener('click', () => downloadBlob(result.blob, result.filename));
      api.foot.querySelector('[data-close-export]').addEventListener('click', () => api.close());
    } catch (err) {
      if (aborted || err.name === 'AbortError') return;
      console.error(err);
      api.dismissible = true;
      api.setTitle('No se pudo exportar');
      api.setBody(`<p class="confirm-text">${esc(err.message || 'Ha ocurrido un error al crear el archivo.')}</p>`);
      api.setFooter(`<span class="spacer"></span><button class="btn btn--outline" type="button" data-close-export>Cerrar</button><button class="btn btn--primary" type="button" data-retry>Reintentar</button>`);
      api.foot.querySelector('[data-close-export]').addEventListener('click', () => api.close());
      api.foot.querySelector('[data-retry]').addEventListener('click', () => { api.dismissible = false; doExport(); });
    }
  };

  $('[data-cancel-export]', api.foot).addEventListener('click', () => api.close());
  $('[data-do-export]', api.foot).addEventListener('click', doExport);
}

/* ------------------------------------------------------------------ ayuda */

function openHelpModal() {
  if (app.sheetOpen) closeLibrary();
  const api = openModal({
    title: 'Cómo funciona',
    body: `
      <p class="help-lede">Looping es una máquina de bucles. Elige sonidos, colócalos en capas y deja que el cabezal los repita. No hace falta saber música: todo está afinado para encajar.</p>
      <div class="help-steps">
        <div class="help-step">
          <span class="help-step__num">1</span>
          <div><h3>Elige un sonido</h3><p>Toca una tarjeta de la biblioteca para escucharla y seleccionarla. Cada sonido ocupa unos tiempos.</p></div>
        </div>
        <div class="help-step">
          <span class="help-step__num">2</span>
          <div><h3>Colócalo en una capa</h3><p>Toca la línea de tiempo en el tiempo que quieras. Añade más capas y combina ritmo, bajo, armonía y textura. Pulsa play: el cabezal vuelve al principio cuando llega al final.</p></div>
        </div>
        <div class="help-step">
          <span class="help-step__num">3</span>
          <div><h3>Repite y exporta</h3><p>El bucle dura lo que la capa más larga, en compases. Cuando esté listo, expórtalo en MP3 con la duración que quieras o guarda el álbum como proyecto.</p></div>
        </div>
        <div class="help-step">
          <span class="help-step__num">4</span>
          <div><h3>Fabrica tu propio sonido</h3><p>El botón <strong>Teclado</strong>, junto a Sorpréndeme, abre un estudio: elige instrumento, toca teclas o pads, escucha acordes de Re menor, graba un bucle y guárdalo en una sección. Aparecerá en la biblioteca de este álbum y viajará con el proyecto.</p></div>
        </div>
      </div>
      <div class="help-shortcuts">
        <div><span>Reproducir / pausar</span><kbd>espacio</kbd></div>
        <div><span>Borrar el bloque elegido</span><kbd>supr</kbd></div>
        <div><span>Duplicar el bloque</span><kbd>⌘/Ctrl D</kbd></div>
        <div><span>Mover el bloque</span><kbd>← →</kbd></div>
        <div><span>Cambiar de capa</span><kbd>↑ ↓</kbd></div>
        <div><span>Deshacer</span><kbd>⌘/Ctrl Z</kbd></div>
        <div><span>Exportar</span><kbd>⌘/Ctrl E</kbd></div>
        <div><span>Guardar proyecto</span><kbd>⌘/Ctrl S</kbd></div>
      </div>
      <p class="help-note"><strong>Si un sonido dura menos que el bucle</strong>, selecciónalo y pulsa <strong>Duplicar</strong> para repetirlo en el resto de la línea. En el teclado, <strong>espacio</strong> escucha el bucle y <strong>R</strong> empieza o para la grabación. Los sonidos propios se guardan en el proyecto del álbum; un álbum nuevo empieza solo con el catálogo.</p>`,
    footer: '<span class="spacer"></span><button class="btn btn--dark" type="button" data-close-help>Entendido</button>',
  });
  api.foot.querySelector('[data-close-help]').addEventListener('click', () => api.close());
}

/* ------------------------------------------------------------------ biblioteca móvil */

function openLibrary() {
  if (!isMobile()) {
    soundList.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  app.sheetOpen = true;
  const lib = $('#library');
  lib.classList.add('is-open');
  lib.inert = false;
  lib.setAttribute('aria-hidden', 'false');
  const scrim = $('#sheet-scrim');
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add('is-on'));
  setTimeout(() => {
    const sel = $('.sound-card.is-selected', soundList);
    if (sel) sel.scrollIntoView({ block: 'nearest' });
    else soundList.scrollTop = 0;
  }, 200);
}

function closeLibrary() {
  if (!app.sheetOpen) return;
  app.sheetOpen = false;
  const lib = $('#library');
  lib.classList.remove('is-open');
  lib.inert = true;
  lib.setAttribute('aria-hidden', 'true');
  const scrim = $('#sheet-scrim');
  scrim.classList.remove('is-on');
  setTimeout(() => { if (!app.sheetOpen) scrim.hidden = true; }, 180);
}

/* ------------------------------------------------------------------ playhead */

function tick() {
  updatePlayhead();
  requestAnimationFrame(tick);
}

function updatePlayhead() {
  if (!app.booted) return;
  const t = track();
  const loop = loopUnitsFor(t);
  const beatSec = 60 / t.bpm;
  const pos = player.playing || player.mix ? player.getPositionBeats() : (player.pausedBeat || 0);
  const ph = $('#playhead');
  const gutter = getGutter();
  const scrollLeft = timelineScroll.scrollLeft;
  const x = gutter + pos * app.stepW - scrollLeft;
  const width = timelineViewport.clientWidth;
  if (!ph || x < gutter - 1 || x > width - 2) {
    ph?.classList.add('is-hidden');
  } else {
    ph.classList.remove('is-hidden');
    ph.style.transform = `translateX(${x}px)`;
  }
  const posSec = (pos % loop) * beatSec;
  const loopSec = loop * beatSec;
  const label = `${fmtTime(posSec, true)} / ${fmtTime(loopSec, true)}`;
  if (label !== app.lastClock) {
    app.lastClock = label;
    const el = $('#loop-time');
    if (el) el.textContent = label;
  }
}

/* ------------------------------------------------------------------ eventos */

async function openKeyboardStudio() {
  const t = track();
  if (!t) return;
  if (app.sheetOpen) closeLibrary();
  if (player.playing) {
    player.pause();
    app.status = '';
    renderPlayState();
  }
  player.stopPreview();
  try {
    await player.ensure();
  } catch {
    showToast('No se pudo activar el audio del teclado.', { error: true });
    return;
  }
  openStudio({
    player,
    album: album(),
    bpm: t.bpm,
    onSaved: (recipe) => {
      const a = album();
      if (!Array.isArray(a.customSounds)) a.customSounds = [];
      a.customSounds.push(recipe);
      registerAlbumCustomSounds(a);
      app.filter = recipe.category;
      app.selectedSound = recipe.id;
      app.selectedClip = null;
      persist();
      renderFilters();
      renderLibrary({ resetScroll: true });
      renderPlacing();
      renderSelection();
    },
  }).catch((err) => {
    console.error(err);
    showToast('No se pudo abrir el teclado.', { error: true });
  });
}

function bindEvents() {
  // Primer gesto: desbloquea el audio.
  let unlocked = false;
  document.addEventListener('pointerdown', () => {
    if (unlocked) return;
    unlocked = true;
    player.ensure().catch(() => {});
  }, { capture: true, once: true });

  // Biblioteca.
  soundList.addEventListener('click', (e) => {
    const card = e.target.closest('.sound-card');
    if (!card) return;
    selectSound(card.dataset.sound);
  });
  $('#filters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    app.filter = btn.dataset.filter;
    renderFilters();
    renderLibrary({ resetScroll: true });
  });
  $('#library-toggle').addEventListener('click', openLibrary);
  $('#library-close').addEventListener('click', closeLibrary);
  $('#sheet-scrim').addEventListener('click', closeLibrary);

  // Trackstrip.
  $('#trackstrip').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-track]');
    if (add) { addTrack(); return; }
    const tab = e.target.closest('[data-track]');
    if (tab) switchTrack(tab.dataset.track);
  });

  // Transporte.
  $('#play-btn').addEventListener('click', () => { togglePlay().catch(() => {}); });
  $('#restart-btn').addEventListener('click', () => {
    if (!player.ctx) return;
    if (player.playing) {
      player.restart(track(), track().bpm);
      app.status = 'En directo';
      renderPlayState();
    } else {
      player.pausedBeat = 0;
    }
  });
  $('#bpm-down').addEventListener('click', () => setBpm(track().bpm - 1));
  $('#bpm-up').addEventListener('click', () => setBpm(track().bpm + 1));
  const bpmInput = $('#bpm-input');
  bpmInput.addEventListener('change', () => setBpm(bpmInput.value));
  bpmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bpmInput.blur(); } });
  bpmInput.addEventListener('blur', () => setBpm(bpmInput.value));

  // Cabecera.
  $('#album-pill').addEventListener('click', openProjectsModal);
  $('#projects-btn').addEventListener('click', openProjectsModal);
  $('#help-btn').addEventListener('click', openHelpModal);
  $('#export-btn').addEventListener('click', openExportModal);
  $('#clear-btn').addEventListener('click', clearTrackAction);
  $('#undo-btn').addEventListener('click', undo);
  $('#redo-btn').addEventListener('click', redo);
  $('#studio-btn').addEventListener('click', () => { openKeyboardStudio(); });
  $('#surprise-btn').addEventListener('click', () => { surprise().catch(() => {}); });
  $('#empty-surprise').addEventListener('click', () => { surprise().catch(() => {}); });
  $('#empty-library').addEventListener('click', openLibrary);

  // Título del tema.
  const title = $('#track-title');
  title.addEventListener('input', () => {
    track().name = title.value.slice(0, 80);
    persist();
    renderTrackStrip();
    document.title = `${title.value || 'Tema'} · Looping`;
    saveDebounced();
  });
  title.addEventListener('blur', () => {
    if (!title.value.trim()) {
      title.value = 'Tema sin título';
      track().name = 'Tema sin título';
      persist();
      renderTrackStrip();
    }
    renderHeader();
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });

  // Capas y timeline: clics de controles.
  $('#layers').addEventListener('click', (e) => {
    const removeClipBtn = e.target.closest('[data-act="remove-clip"]');
    if (removeClipBtn) {
      e.preventDefault();
      e.stopPropagation();
      removeClip(removeClipBtn.dataset.layer, removeClipBtn.dataset.clip);
      return;
    }
    const tool = e.target.closest('[data-act]');
    if (!tool) return;
    const layerId = tool.dataset.layer;
    if (tool.dataset.act === 'mute') toggleLayer(layerId, 'mute');
    else if (tool.dataset.act === 'solo') toggleLayer(layerId, 'solo');
    else if (tool.dataset.act === 'remove-layer') removeLayer(layerId);
  });
  $('#layers').addEventListener('input', (e) => {
    const vol = e.target.closest('[data-act="volume"]');
    if (!vol) return;
    setLayerVolume(vol.dataset.layer, Number(vol.value));
  });
  $('#layers').addEventListener('keydown', (e) => {
    const clip = e.target.closest('.clip');
    if (!clip) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      selectClip(clip.dataset.layer, clip.dataset.clip);
    }
  });
  $('#selection-info').addEventListener('click', (e) => {
    if (e.target.closest('[data-remove-selected]')) removeSelectedClip();
    else if (e.target.closest('[data-duplicate-selected]')) duplicateSelectedClip();
  });
  $('#placing-done').addEventListener('click', clearPlacement);
  $('#add-layer').addEventListener('click', addLayer);

  // Timeline: selección, colocación y arrastre.
  bindTimelinePointer();

  // Importar.
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImport(file);
    e.target.value = '';
  });

  // Teclado.
  document.addEventListener('keydown', onKeyDown);

  // Guardar al salir.
  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow(); });

  // Redimensionado.
  const onResize = debounce(() => {
    if (app.dragging) return;
    if (!isMobile() && app.sheetOpen) closeLibrary();
    if (!isMobile()) {
      const lib = $('#library');
      lib.inert = false;
      lib.removeAttribute('aria-hidden');
    } else if (!app.sheetOpen) {
      const lib = $('#library');
      lib.inert = true;
      lib.setAttribute('aria-hidden', 'true');
    }
    renderTimeline();
  }, 100);
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(onResize);
    ro.observe(timelineViewport);
    ro.observe($('#timeline-panel'));
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href && href.startsWith('#')) e.preventDefault();
  });
}

let laneTap = null;

function bindTimelinePointer() {
  timelineScroll.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const clipEl = e.target.closest('.clip');
    if (clipEl) {
      startClipPointer(e, clipEl);
      return;
    }
    const lane = e.target.closest('.layer-lane');
    if (!lane) return;
    if (!app.selectedSound) {
      if (e.pointerType !== 'mouse') laneTap = { x: e.clientX, y: e.clientY, lane, id: e.pointerId };
      return;
    }
    laneTap = { x: e.clientX, y: e.clientY, lane, id: e.pointerId };
  });

  timelineScroll.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !app.selectedSound || app.dragging) return;
    const lane = e.target.closest('.layer-lane');
    if (!lane) {
      clearGhosts();
      return;
    }
    updateGhost(lane, e.clientX);
  });
  timelineScroll.addEventListener('pointerleave', clearGhosts);

  window.addEventListener('pointerup', (e) => {
    if (!laneTap || laneTap.id !== e.pointerId) return;
    const d = Math.hypot(e.clientX - laneTap.x, e.clientY - laneTap.y);
    const tap = laneTap;
    laneTap = null;
    if (d > 7) return;
    if (!document.body.contains(tap.lane)) return;
    if (app.selectedSound) {
      const unit = unitFromX(tap.lane, tap.x);
      placeClip(tap.lane.dataset.layer, unit);
    } else if (isMobile()) {
      openLibrary();
    }
  });
  window.addEventListener('pointercancel', () => { laneTap = null; clearGhosts(); });
}

function unitFromX(lane, clientX) {
  const rect = lane.getBoundingClientRect();
  return clamp(Math.floor((clientX - rect.left) / app.stepW), 0, Math.max(0, app.displayUnits - 1));
}

function clearGhosts() {
  $$('.ghost', timelineScroll).forEach((el) => el.remove());
}

function updateGhost(lane, clientX) {
  const s = SOUND_BY_ID[app.selectedSound];
  if (!s) return;
  const unit = unitFromX(lane, clientX);
  const layer = findLayer(lane.dataset.layer);
  if (!layer) return;
  const valid = canPlace(layer, unit, s.beats);
  let ghost = lane.querySelector('.ghost');
  for (const other of $$('.ghost', timelineScroll)) if (other !== ghost) other.remove();
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.className = 'ghost';
    lane.appendChild(ghost);
  }
  ghost.classList.toggle('is-invalid', !valid);
  ghost.style.left = `${unit * app.stepW}px`;
  ghost.style.width = `${Math.max(18, s.beats * app.stepW - 3)}px`;
  ghost.style.setProperty('--c', CATEGORY_BY_ID[s.category].color);
  ghost.textContent = valid ? '' : 'no cabe';
}

function startClipPointer(e, el) {
  if (e.target.closest('[data-act="remove-clip"]')) return;
  e.preventDefault();
  const layerId = el.dataset.layer;
  const clipId = el.dataset.clip;
  const clip = findClip(layerId, clipId);
  if (!clip) return;
  selectClip(layerId, clipId, { rerender: false, preview: !player.playing });
  const layer = findLayer(layerId);
  const sound = SOUND_BY_ID[clip.soundId];
  if (!layer || !sound) return;
  const startX = e.clientX;
  const startScroll = timelineScroll.scrollLeft;
  const origStart = clip.start;
  let dragging = false;
  let newStart = origStart;
  let valid = true;
  try { el.setPointerCapture(e.pointerId); } catch {}

  const onMove = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const dx = (ev.clientX - startX) + (timelineScroll.scrollLeft - startScroll);
    if (!dragging && Math.abs(dx) > 4) {
      dragging = true;
      app.dragging = true;
      el.classList.add('is-dragging');
      clearGhosts();
    }
    if (!dragging) return;
    const rect = timelineScroll.getBoundingClientRect();
    if (ev.clientX > rect.right - 36) timelineScroll.scrollLeft += 14;
    else if (ev.clientX < rect.left + getGutter() + 22) timelineScroll.scrollLeft = Math.max(0, timelineScroll.scrollLeft - 14);
    const delta = Math.round(dx / app.stepW);
    newStart = clamp(origStart + delta, 0, Math.max(0, app.displayUnits - 1));
    el.style.left = `${newStart * app.stepW}px`;
    valid = canPlace(layer, newStart, sound.beats, clip.id);
    el.classList.toggle('is-invalid', !valid);
  };
  const finish = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    try { el.releasePointerCapture(e.pointerId); } catch {}
    app.dragging = false;
    el.classList.remove('is-dragging', 'is-invalid');
    if (dragging) {
      if (valid && newStart !== origStart) {
        snapshot();
        clip.start = newStart;
        layer.clips.sort((a, b) => a.start - b.start);
        persist();
        renderAll();
        scheduleRefresh();
      } else if (!valid) {
        showToast('Ese hueco está ocupado.', { error: true });
        renderTimeline();
      } else {
        el.style.left = `${clip.start * app.stepW}px`;
      }
    } else {
      // Un toque sin arrastre deja el bloque seleccionado.
      renderSelection();
    }
  };
  const cancel = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    app.dragging = false;
    el.classList.remove('is-dragging', 'is-invalid');
    renderTimeline();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', cancel);
}

function onKeyDown(e) {
  if (isModalOpen()) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  const mod = e.metaKey || e.ctrlKey;
  const key = String(e.key).toLowerCase();

  // Los atajos de edición no deben pisar el deshacer nativo de un campo de texto.
  if (typing && mod && (key === 'z' || key === 'y' || key === 'd')) return;

  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (mod && key === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  if (mod && key === 'e') {
    e.preventDefault();
    openExportModal();
    return;
  }
  if (mod && key === 's') {
    e.preventDefault();
    downloadProject();
    return;
  }
  if (mod && key === 'd') {
    if (app.selectedClip) {
      e.preventDefault();
      duplicateSelectedClip();
    }
    return;
  }
  if (typing) return;
  if (e.key === ' ') {
    if (e.target.closest('button')) return;
    e.preventDefault();
    togglePlay().catch(() => {});
    return;
  }
  if (e.key === 'Escape') {
    if (app.sheetOpen) { closeLibrary(); return; }
    clearSelection();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (app.selectedClip) {
      e.preventDefault();
      removeSelectedClip();
    }
    return;
  }
  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault();
    openHelpModal();
    return;
  }
  if (app.selectedClip) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeSelected(-1, 0); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nudgeSelected(1, 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nudgeSelected(0, -1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nudgeSelected(0, 1); }
  }
}

/* ------------------------------------------------------------------ boot */

function bootProgress(p, text) {
  const bar = $('#boot-bar');
  const sub = $('#boot-sub');
  if (bar) bar.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
  if (sub && text) sub.textContent = text;
}

async function boot() {
  if (!window.AudioContext && !window.webkitAudioContext) {
    bootProgress(1, 'Este navegador no puede reproducir audio');
    showToast('Este navegador no soporta Web Audio.', { error: true });
  }
  // Asegura una pista válida tras una importación o un estado antiguo.
  if (!app.state.albums.length) app.state = demoAlbum();
  const a = currentAlbum(app.state);
  if (!a) app.state = demoAlbum();
  if (!app.state.currentTrackId || !currentTrack(app.state)) {
    app.state.currentTrackId = currentAlbum(app.state).tracks[0].id;
  }
  registerAlbumCustomSounds(currentAlbum(app.state));

  renderFilters();
  renderLibrary();
  renderHeader();
  renderTrackStrip();
  renderSelection();
  renderPlacing();
  renderPlayState();
  renderHistory();
  $('#app').hidden = false;
  if (isMobile()) {
    const lib = $('#library');
    lib.inert = true;
    lib.setAttribute('aria-hidden', 'true');
  }

  await waitFrame();
  renderTimeline({ resetScroll: true });
  updatePlayhead();

  player.onState = () => renderPlayState();

  const t = track();
  const ids = soundsInTrack(t);
  if (ids.length) {
    bootProgress(0.08, 'Afinando el estudio…');
    await prepareCurrent({
      onProgress: (p, id) => {
        const s = SOUND_BY_ID[id];
        bootProgress(0.08 + p * 0.86, s ? `Afinando «${s.name}»…` : 'Afinando el estudio…');
      },
    });
  }
  bootProgress(1, 'Todo listo');
  await new Promise((r) => setTimeout(r, 260));
  $('#boot').classList.add('is-done');
  app.booted = true;
  setStatus('');
  renderPlayState();
  setTimeout(() => { $('#boot')?.remove(); }, 700);
  requestAnimationFrame(tick);
  if (app.fresh) {
    setTimeout(() => {
      showToast('Tu primer bucle está listo. Pulsa ▶ o prueba «Sorpréndeme».', { duration: 4200 });
    }, 900);
  }
  bindEvents();
  window.Looping = { app, player, track, album };
}

boot().catch((err) => {
  console.error(err);
  bootProgress(1, 'Algo ha fallado');
  const sub = $('#boot-sub');
  if (sub) sub.textContent = 'No se pudo iniciar Looping. Recarga la página.';
  showToast('Error al iniciar la aplicación.', { error: true });
});

// Guarda el estado con el título definitivo al cerrar.
window.addEventListener('beforeunload', () => {
  try { persistNow(); } catch {}
});
