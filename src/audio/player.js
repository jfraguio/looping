/**
 * Reproductor en directo. Mantiene un único AudioContext, un bucle renderizado
 * y hace crossfades cortos cuando la línea de tiempo cambia, de modo que
 * colocar un sonido se escucha al instante sin cortar el pulso.
 */

import { renderMix, renderSound } from './engine.js';
import { SOUND_BY_ID } from './catalog.js';
import { clamp } from './dsp.js';

const FADE = 0.045;

export class Player {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.source = null;
    this.sourceGain = null;
    this.mix = null;
    this.playing = false;
    this.anchorTime = 0;
    this.anchorBeat = 0;
    this.pausedBeat = 0;
    this.track = null;
    this.bpm = 84;
    this.previewSource = null;
    this.previewGain = null;
    this.onState = null;
    this.renderVersion = 0;
  }

  async ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.previewGain = this.ctx.createGain();
      this.previewGain.gain.value = 0.95;
      this.previewGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch {}
    }
    return this.ctx;
  }

  setState(playing) {
    this.playing = playing;
    if (this.onState) this.onState(playing);
  }

  /** Crea un AudioBuffer a partir del mix ya renderizado. */
  makeBuffer(mix) {
    const buf = this.ctx.createBuffer(2, mix.n, mix.sr);
    buf.copyToChannel(mix.L, 0);
    buf.copyToChannel(mix.R, 1);
    return buf;
  }

  getPositionBeats() {
    if (!this.ctx) return this.pausedBeat || 0;
    if (!this.playing) return this.pausedBeat || 0;
    const loop = this.mix ? this.mix.loopUnits : 4;
    const t = this.ctx.currentTime - this.anchorTime;
    const beats = (this.anchorBeat + (t * this.bpm) / 60) % loop;
    return beats < 0 ? beats + loop : beats;
  }

  async play(track, bpm, { fromStart = false } = {}) {
    await this.ensure();
    this.track = track;
    this.bpm = bpm;
    if (this.playing) {
      if (fromStart) this.restart(track, bpm);
      else this.refresh(track, bpm);
      return;
    }
    const mix = renderMix(track, bpm);
    this.mix = mix;
    const startBeat = fromStart ? 0 : (this.pausedBeat || 0) % mix.loopUnits;
    this.startAt(startBeat);
    this.setState(true);
  }

  startAt(beat) {
    const now = this.ctx.currentTime;
    const when = now + 0.015;
    if (this.source) {
      try { this.source.stop(now); } catch {}
    }
    const loop = this.mix.loopUnits;
    const beatSec = 60 / this.bpm;
    const offsetBeat = ((beat % loop) + loop) % loop;
    const offsetSec = offsetBeat * beatSec;
    const buffer = this.makeBuffer(this.mix);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + FADE);
    src.connect(gain);
    gain.connect(this.master);
    src.start(when, offsetSec);
    this.anchorTime = when;
    this.anchorBeat = offsetBeat;
    this.source = src;
    this.sourceGain = gain;
    this.pausedBeat = offsetBeat;
  }

  /** Actualiza el mix conservando la posición del cabezal. */
  refresh(track, bpm) {
    this.track = track;
    if (!this.playing) {
      this.bpm = bpm;
      return;
    }
    const pos = this.getPositionBeats();
    this.bpm = bpm;
    const mix = renderMix(track, bpm);
    const oldSrc = this.source;
    const oldGain = this.sourceGain;
    this.mix = mix;
    const now = this.ctx.currentTime;
    // El nuevo bucle arranca en la misma fase, con un crossfade muy corto.
    const loop = mix.loopUnits;
    const beatSec = 60 / bpm;
    const offsetBeat = ((pos % loop) + loop) % loop;
    const offsetSec = offsetBeat * beatSec;
    const buffer = this.makeBuffer(mix);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    const when = now + 0.008;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + FADE);
    src.connect(gain);
    gain.connect(this.master);
    src.start(when, offsetSec);
    this.anchorTime = when;
    this.anchorBeat = offsetBeat;
    this.source = src;
    this.sourceGain = gain;
    if (oldSrc && oldGain) {
      try {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.linearRampToValueAtTime(0, now + FADE);
        oldSrc.stop(now + FADE + 0.02);
      } catch {}
    }
  }

  pause() {
    if (!this.playing) return;
    this.pausedBeat = this.getPositionBeats();
    const now = this.ctx.currentTime;
    const src = this.source;
    const gain = this.sourceGain;
    if (gain && src) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.07);
        src.stop(now + 0.09);
      } catch {}
    }
    this.source = null;
    this.sourceGain = null;
    this.setState(false);
  }

  restart(track, bpm) {
    this.pausedBeat = 0;
    if (!this.playing) {
      this.track = track;
      this.bpm = bpm;
      return;
    }
    const oldSrc = this.source;
    const oldGain = this.sourceGain;
    this.track = track;
    this.bpm = bpm;
    this.mix = renderMix(track, bpm);
    const now = this.ctx.currentTime;
    const buffer = this.makeBuffer(this.mix);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now + 0.005);
    gain.gain.linearRampToValueAtTime(1, now + 0.005 + FADE);
    src.connect(gain);
    gain.connect(this.master);
    src.start(now + 0.005, 0);
    this.anchorTime = now + 0.005;
    this.anchorBeat = 0;
    this.source = src;
    this.sourceGain = gain;
    if (oldSrc && oldGain) {
      try {
        oldGain.gain.linearRampToValueAtTime(0, now + FADE);
        oldSrc.stop(now + FADE + 0.02);
      } catch {}
    }
  }

  /** Escucha de una tarjeta de la biblioteca. */
  preview(soundId, bpm) {
    const sound = SOUND_BY_ID[soundId];
    if (!sound || !this.ctx) return;
    if (this.previewSource) {
      const oldSrc = this.previewSource;
      const oldGain = this.previewGainNode;
      const now = this.ctx.currentTime;
      if (oldGain) {
        try {
          oldGain.gain.cancelScheduledValues(now);
          oldGain.gain.setValueAtTime(oldGain.gain.value, now);
          oldGain.gain.linearRampToValueAtTime(0, now + 0.025);
          oldSrc.stop(now + 0.04);
        } catch { try { oldSrc.stop(); } catch {} }
      } else {
        try { oldSrc.stop(); } catch {}
      }
      this.previewSource = null;
      this.previewGainNode = null;
    }
    const buf = renderSound(sound, bpm);
    const audio = this.ctx.createBuffer(2, buf.n, buf.sr);
    audio.copyToChannel(buf.L, 0);
    audio.copyToChannel(buf.R, 1);
    const src = this.ctx.createBufferSource();
    src.buffer = audio;
    const gain = this.ctx.createGain();
    gain.gain.value = clamp(0.7 * buf.previewGain, 0.25, 1.25);
    src.connect(gain);
    gain.connect(this.previewGain);
    src.start();
    this.previewSource = src;
    this.previewGainNode = gain;
    src.onended = () => {
      if (this.previewSource === src) {
        this.previewSource = null;
        this.previewGainNode = null;
      }
      try { gain.disconnect(); } catch {}
    };
  }

  stopPreview() {
    if (!this.previewSource || !this.ctx) return;
    const src = this.previewSource;
    const gain = this.previewGainNode;
    const now = this.ctx.currentTime;
    if (gain) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.03);
        src.stop(now + 0.05);
      } catch { try { src.stop(); } catch {} }
    } else {
      try { src.stop(); } catch {}
    }
    this.previewSource = null;
    this.previewGainNode = null;
  }

  stopAll() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (this.sourceGain && this.source) {
      try {
        this.sourceGain.gain.cancelScheduledValues(now);
        this.sourceGain.gain.setValueAtTime(this.sourceGain.gain.value, now);
        this.sourceGain.gain.linearRampToValueAtTime(0, now + 0.035);
        this.source.stop(now + 0.05);
      } catch { try { this.source.stop(); } catch {} }
    }
    if (this.previewGainNode && this.previewSource) {
      try {
        this.previewGainNode.gain.cancelScheduledValues(now);
        this.previewGainNode.gain.setValueAtTime(this.previewGainNode.gain.value, now);
        this.previewGainNode.gain.linearRampToValueAtTime(0, now + 0.03);
        this.previewSource.stop(now + 0.05);
      } catch { try { this.previewSource.stop(); } catch {} }
    }
    this.source = null;
    this.sourceGain = null;
    this.previewSource = null;
    this.previewGainNode = null;
    this.pausedBeat = 0;
    this.setState(false);
  }
}

/** Crea un AudioBuffer de un mix; útil para pruebas o para otra salida. */
export function bufferFromMix(ctx, mix) {
  const buf = ctx.createBuffer(2, mix.n, mix.sr);
  buf.copyToChannel(mix.L, 0);
  buf.copyToChannel(mix.R, 1);
  return buf;
}
