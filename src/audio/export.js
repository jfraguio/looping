/**
 * Exportación de un tema: mezcla, repetición del bucle, fundido y codificación
 * MP3 (320 kbps) o WAV. Todo ocurre en el navegador.
 */

import { renderExport } from './engine.js';
import { encodeWav } from './wav.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

export function slugify(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'looping';
}

export function exportFilename(album, track, ext) {
  const a = String(album || '').trim();
  const t = String(track || '').trim() || 'Tema';
  if (!a || /^sin t[ií]tulo$/i.test(a)) return `${slugify(t)}.${ext}`;
  return `${slugify(a)}-${slugify(t)}.${ext}`;
}

/**
 * @param {object} opts
 * @param {object} opts.track
 * @param {number} opts.bpm
 * @param {number} opts.seconds
 * @param {'mp3'|'wav'} opts.format
 * @param {number} opts.fadeOut
 * @param {string} opts.title
 * @param {string} opts.album
 * @param {(p:number, label:string)=>void} opts.onProgress
 * @param {AbortSignal} [opts.signal]
 */
export async function exportAudio({
  track,
  bpm,
  seconds,
  format = 'mp3',
  bitrate = 320,
  fadeOut = 2.2,
  title,
  album,
  onProgress = () => {},
  signal,
}) {
  const aborted = () => signal && signal.aborted;
  onProgress(0.02, 'Mezclando el tema…');
  await nextFrame();
  if (aborted()) throw new DOMException('Cancelado', 'AbortError');
  const out = renderExport(track, bpm, seconds, { fadeOut });
  onProgress(0.2, format === 'mp3' ? 'Preparando el MP3…' : 'Preparando el WAV…');
  await nextFrame();
  if (aborted()) throw new DOMException('Cancelado', 'AbortError');

  if (format === 'wav') {
    onProgress(0.45, 'Escribiendo WAV…');
    await nextFrame();
    const bytes = encodeWav(out.L, out.R, out.sr, 16);
    if (aborted()) throw new DOMException('Cancelado', 'AbortError');
    onProgress(1, 'Listo');
    return {
      blob: new Blob([bytes], { type: 'audio/wav' }),
      filename: exportFilename(album, title, 'wav'),
      bytes: bytes.length,
      seconds: out.seconds,
    };
  }

  // MP3 en un worker clásico: lamejs hace el trabajo pesado.
  const worker = new Worker(new URL('./export-worker.js', import.meta.url));
  try {
    const data = await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        worker.terminate();
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('Cancelado', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onerror = (err) => {
        cleanup();
        reject(new Error('No se pudo codificar el MP3. ' + (err.message || '')));
      };
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'progress') {
          onProgress(0.2 + m.value * 0.78, 'Convirtiendo a MP3…');
        } else if (m.type === 'done') {
          cleanup();
          resolve(new Uint8Array(m.data));
        }
      };
      const l = out.L;
      const r = out.R;
      worker.postMessage({
        type: 'encode',
        left: l,
        right: r,
        sampleRate: out.sr,
        bitrate,
        title,
        album,
        artist: 'Looping',
      }, [l.buffer, r.buffer]);
    });
    if (aborted()) throw new DOMException('Cancelado', 'AbortError');
    onProgress(1, 'Listo');
    return {
      blob: new Blob([data], { type: 'audio/mpeg' }),
      filename: exportFilename(album, title, 'mp3'),
      bytes: data.length,
      seconds: out.seconds,
    };
  } catch (err) {
    try { worker.terminate(); } catch {}
    throw err;
  }
}
