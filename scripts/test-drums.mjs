import fs from 'node:fs';
import { makeContext } from '../src/audio/catalog.js';
import { kick, snare, hat, clap, rim, shaker, conga, cymbal, brush } from '../src/audio/instruments.js';
import { encodeWav } from '../src/audio/wav.js';
import { peakOf, rmsOf, gainToDb } from '../src/audio/dsp.js';

fs.mkdirSync('tmp/drums', { recursive: true });
const sr = 44100;
const items = [
  ['kick', 0.6, (c) => kick(c, 0.02, { vel: 1, decay: 0.34, pitch: 49, click: 0.55 })],
  ['kick-808', 1.2, (c) => kick(c, 0.02, { vel: 1, decay: 0.8, pitch: 43, click: 0.2, drive: 1.8 })],
  ['snare', 0.6, (c) => snare(c, 0.02, { vel: 1, decay: 0.17, tone: 190, bright: 1 })],
  ['hat', 0.3, (c) => hat(c, 0.02, { vel: 1, pan: 0 })],
  ['hat-open', 0.5, (c) => hat(c, 0.02, { vel: 1, open: true, pan: 0 })],
  ['clap', 0.5, (c) => clap(c, 0.02, { vel: 1, spread: 0.6, pan: 0 })],
  ['rim', 0.2, (c) => rim(c, 0.02, { vel: 1, pan: 0 })],
  ['shaker', 0.3, (c) => shaker(c, 0.02, { vel: 1, pan: 0 })],
  ['conga', 0.5, (c) => conga(c, 0.02, { vel: 1, freq: 196, pan: 0 })],
  ['cymbal', 1.5, (c) => cymbal(c, 0.02, { vel: 1, pan: 0 })],
  ['brush', 0.5, (c) => brush(c, 0.02, { vel: 1, pan: 0 })],
];
for (const [name, dur, fn] of items) {
  const ctx = makeContext(dur, 84);
  fn(ctx);
  const L = ctx.L;
  const R = ctx.R;
  fs.writeFileSync(`tmp/drums/${name}.wav`, Buffer.from(encodeWav(L, R, sr, 24)));
  console.log(name.padEnd(10), 'peak', gainToDb(peakOf(L, R)).toFixed(1), 'rms', gainToDb(rmsOf(L, R)).toFixed(1));
}

// Patrón seco sin reverb ni vinilo.
const ctx = makeContext(4 * 60 / 84, 84);
const step = (n) => (n * 0.25 + (n % 2 ? 0.028 : 0)) * 60 / 84;
for (const [type, n, v] of [['k', 0, 1], ['k', 6, .86], ['k', 10, .96], ['s', 4, .9], ['s', 12, 1], ['s', 7, .16], ['s', 15, .12], ['h', 0, .72], ['h', 2, .34], ['h', 4, .54], ['h', 6, .3], ['h', 8, .62], ['h', 10, .33], ['h', 12, .5], ['h', 14, .3], ['h', 15, .16]]) {
  if (type === 'k') kick(ctx, step(n), { vel: v, decay: 0.34, pitch: 49, click: 0.55 });
  if (type === 's') snare(ctx, step(n), { vel: v, decay: 0.17, tone: 190, bright: 1 });
  if (type === 'h') hat(ctx, step(n), { vel: v, pan: 0.16 });
}
fs.writeFileSync('tmp/drums/pattern.wav', Buffer.from(encodeWav(ctx.L, ctx.R, sr, 24)));
