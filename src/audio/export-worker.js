/**
 * Worker de codificación MP3 (lamejs). Recibe PCM estéreo, devuelve los bytes
 * del MP3 con una etiqueta ID3 básica. El hilo principal sigue respondiendo
 * mientras se codifica.
 */

/* global lamejs */
importScripts('../../vendor/lame.min.js');

function utf16leFrame(id, text) {
  const t = String(text || '');
  const data = new Uint8Array(2 + t.length * 2);
  data[0] = 0xff;
  data[1] = 0xfe;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    data[2 + i * 2] = c & 0xff;
    data[3 + i * 2] = (c >> 8) & 0xff;
  }
  const content = new Uint8Array(1 + data.length);
  content[0] = 1; // UTF-16 con BOM
  content.set(data, 1);
  const frame = new Uint8Array(10 + content.length);
  frame[0] = id.charCodeAt(0);
  frame[1] = id.charCodeAt(1);
  frame[2] = id.charCodeAt(2);
  frame[3] = id.charCodeAt(3);
  const size = content.length;
  frame[4] = (size >>> 24) & 0xff;
  frame[5] = (size >>> 16) & 0xff;
  frame[6] = (size >>> 8) & 0xff;
  frame[7] = size & 0xff;
  frame.set(content, 10);
  return frame;
}

function syncsafe(n) {
  return [((n >>> 21) & 0x7f), ((n >>> 14) & 0x7f), ((n >>> 7) & 0x7f), (n & 0x7f)];
}

function makeId3({ title, album, artist }) {
  const frames = [
    utf16leFrame('TIT2', title || 'Tema'),
    utf16leFrame('TPE1', artist || 'Looping'),
    utf16leFrame('TALB', album || 'Looping'),
    utf16leFrame('TCON', 'Hip Hop'),
    utf16leFrame('TSSE', 'Looping / lamejs'),
  ];
  const bodySize = frames.reduce((s, f) => s + f.length, 0);
  const out = new Uint8Array(10 + bodySize);
  out[0] = 0x49; out[1] = 0x44; out[2] = 0x33; // ID3
  out[3] = 3; out[4] = 0; out[5] = 0;
  const ss = syncsafe(bodySize);
  out[6] = ss[0]; out[7] = ss[1]; out[8] = ss[2]; out[9] = ss[3];
  let p = 10;
  for (const f of frames) {
    out.set(f, p);
    p += f.length;
  }
  return out;
}

function floatTo16(src, from, to) {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i++) {
    const s = Math.max(-1, Math.min(1, src[i]));
    out[i - from] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== 'encode') return;
  const { left, right, sampleRate, bitrate, title, album, artist } = msg;
  const total = left.length;
  const encoder = new lamejs.Mp3Encoder(2, sampleRate, bitrate);
  const chunks = [];
  let totalBytes = 0;
  const STEP = 1152;
  let lastProgress = -1;
  for (let i = 0; i < total; i += STEP) {
    const end = Math.min(total, i + STEP);
    const l = floatTo16(left, i, end);
    const r = floatTo16(right, i, end);
    const buf = encoder.encodeBuffer(l, r);
    if (buf.length > 0) {
      chunks.push(buf);
      totalBytes += buf.length;
    }
    const p = i / total;
    if (p - lastProgress > 0.02) {
      lastProgress = p;
      self.postMessage({ type: 'progress', value: p });
    }
  }
  const tail = encoder.flush();
  if (tail.length > 0) {
    chunks.push(tail);
    totalBytes += tail.length;
  }
  const tag = makeId3({ title, album, artist });
  const out = new Uint8Array(tag.length + totalBytes);
  out.set(tag, 0);
  let p = tag.length;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  self.postMessage({ type: 'done', data: out.buffer }, [out.buffer]);
};
