/** Diálogos, foco atrapado y confirmaciones. */

import { $, esc, icon } from './dom.js';

let active = null;
let previousFocus = null;
const host = $('#modal-host');
const modal = $('#modal');
const titleEl = $('#modal-title');
const bodyEl = $('#modal-body');
const footEl = $('#modal-foot');
const closeBtn = $('#modal-close');
const scrim = $('#modal-scrim');

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables() {
  return Array.from(modal.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function onKey(e) {
  if (!active) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (active.dismissible) active.close();
    return;
  }
  if (e.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function trapKey(e) {
  onKey(e);
}

export function openModal({
  title = '',
  body = '',
  footer = '',
  wide = false,
  dismissible = true,
  onClose = null,
  initialFocus = null,
}) {
  if (active) active.close({ silent: true });
  previousFocus = document.activeElement;
  titleEl.textContent = title;
  bodyEl.innerHTML = body;
  footEl.innerHTML = footer;
  modal.classList.toggle('is-wide', !!wide);
  host.hidden = false;
  document.addEventListener('keydown', trapKey, true);
  const api = {
    body: bodyEl,
    foot: footEl,
    title: titleEl,
    dismissible,
    close(result) {
      if (!api.open) return;
      api.open = false;
      document.removeEventListener('keydown', trapKey, true);
      host.hidden = true;
      modal.classList.remove('is-wide');
      bodyEl.innerHTML = '';
      footEl.innerHTML = '';
      active = null;
      if (onClose) onClose(result);
      const back = previousFocus;
      previousFocus = null;
      if (back && back.isConnected) {
        setTimeout(() => { try { back.focus({ preventScroll: true }); } catch {} }, 0);
      }
    },
    setBody(html) { bodyEl.innerHTML = html; },
    setFooter(html) { footEl.innerHTML = html; },
    setTitle(t) { titleEl.textContent = t; },
    open: true,
  };
  active = api;
  // Foco: el control indicado, el primer enfocable o el diálogo.
  setTimeout(() => {
    const target = initialFocus && initialFocus() || focusables()[0] || modal;
    try { target.focus({ preventScroll: true }); } catch {}
  }, 20);
  return api;
}

closeBtn.addEventListener('click', () => {
  if (active && active.dismissible) active.close();
});
scrim.addEventListener('click', () => {
  if (active && active.dismissible) active.close();
});
modal.addEventListener('pointerdown', (e) => {
  // Evita que un clic dentro del diálogo cierre por el scrim.
  e.stopPropagation();
});

export function isModalOpen() {
  return !!active;
}

export function closeModal() {
  if (active) active.close();
}

/** Confirmación con una promesa. */
export function confirmDialog({
  title = '¿Seguro?',
  message = '',
  confirmLabel = 'Continuar',
  cancelLabel = 'Cancelar',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let done = false;
    let api = null;
    api = openModal({
      title,
      dismissible: true,
      body: `<p class="confirm-text">${message}</p>`,
      footer: `<button class="btn btn--outline" data-cancel>${esc(cancelLabel)}</button><span class="spacer"></span><button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${esc(confirmLabel)}</button>`,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(false);
        }
      },
      initialFocus: () => api && api.foot.querySelector('[data-cancel]'),
    });
    const finish = (value) => {
      if (done) return;
      done = true;
      api.close(value);
      resolve(value);
    };
    api.foot.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
    api.foot.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
  });
}

/** Cabecera común de formularios de modal. */
export function sectionHead(label) {
  return `<div class="project-section__head"><h3>${esc(label)}</h3><span class="line"></span></div>`;
}

export function iconButton(name, label, attrs = '') {
  return `<button class="icon-btn" type="button" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;
}
