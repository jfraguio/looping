/** Utilidades de interfaz compartidas. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function icon(name, cls = 'i') {
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** 1:07,3 */
export function fmtTime(sec, tenths = false) {
  const s = Math.max(0, sec);
  if (tenths) {
    const total = Math.round(s * 10);
    const m = Math.floor(total / 600);
    const rem = total % 600;
    return `${m}:${String(Math.floor(rem / 10)).padStart(2, '0')},${rem % 10}`;
  }
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
}

/** 05:30 a partir de segundos. */
export function fmtClock(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 KB';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function debounce(fn, ms = 80) {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const waitFrame = () => new Promise((resolve) => {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    resolve();
  };
  const timer = setTimeout(finish, 30);
  requestAnimationFrame(finish);
});

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Onda decorativa determinista a partir de una cadena. */
export function waveSvg(seedText, count = 22) {
  let h = 2166136261 >>> 0;
  const text = String(seedText);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let state = h || 1;
  const rnd = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const widths = 100 / count;
  const bars = [];
  for (let i = 0; i < count; i++) {
    const x = i / (count - 1);
    const window = Math.sin(Math.PI * x) ** 0.55;
    let v = 0.18 + rnd() * 0.72;
    v *= 0.55 + 0.45 * window;
    if (i % 4 === 0) v = Math.min(1, v * 1.22);
    if (i % 8 === 3) v *= 0.45;
    const hgt = Math.max(2.5, v * 11);
    const y = (13 - hgt) / 2;
    bars.push(`<rect x="${(i * widths + widths * 0.16).toFixed(2)}" y="${y.toFixed(2)}" width="${(widths * 0.68).toFixed(2)}" height="${hgt.toFixed(2)}" fill="currentColor" rx="0.7"/>`);
  }
  return `<svg viewBox="0 0 100 13" preserveAspectRatio="none" aria-hidden="true">${bars.join('')}</svg>`;
}

let toastTimer = 0;
export function showToast(message, { error = false, duration = 2600 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-error', !!error);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-on'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-on');
    setTimeout(() => { el.hidden = true; }, 180);
  }, duration);
}
