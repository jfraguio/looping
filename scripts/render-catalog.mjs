import fs from 'node:fs';
import path from 'node:path';
import { SOUNDS, SOUND_BY_ID } from '../src/audio/catalog.js';
import { renderSound, renderMix } from '../src/audio/engine.js';
import { encodeWav } from '../src/audio/wav.js';
import { peakOf, rmsOf, gainToDb } from '../src/audio/dsp.js';
import { demoAlbum } from '../src/app/storage.js';

const bpm = Number(process.argv[2] || 84);
const outDir = path.resolve('tmp/catalog');
fs.mkdirSync(outDir, { recursive: true });

const rows = [];
const t0 = Date.now();
for (const sound of SOUNDS) {
  const a = performance.now();
  const buf = renderSound(sound, bpm);
  const ms = performance.now() - a;
  fs.writeFileSync(path.join(outDir, sound.id + '.wav'), Buffer.from(encodeWav(buf.L, buf.R, buf.sr, 24)));
  rows.push({
    id: sound.id,
    cat: sound.category,
    beats: sound.beats,
    nominal: +buf.nominal.toFixed(2),
    len: +buf.duration.toFixed(2),
    peak: +gainToDb(peakOf(buf.L, buf.R)).toFixed(1),
    rms: +gainToDb(rmsOf(buf.L, buf.R)).toFixed(1),
    ms: +ms.toFixed(0),
  });
}
console.log(rows.map((r) => [r.id.padEnd(16), r.cat.padEnd(9), String(r.beats).padStart(2), String(r.nominal).padStart(5), String(r.len).padStart(5), String(r.peak).padStart(6), String(r.rms).padStart(6), String(r.ms).padStart(5) + 'ms'].join(' ')).join('\n'));
console.log('total', Date.now() - t0, 'ms');

const state = demoAlbum();
const track = state.albums[0].tracks[0];
const mix = renderMix(track, bpm);
fs.writeFileSync(path.join(outDir, '..', 'demo.wav'), Buffer.from(encodeWav(mix.L, mix.R, mix.sr, 24)));
console.log('mix', { loopUnits: mix.loopUnits, loopSec: mix.loopSec.toFixed(2), peak: gainToDb(peakOf(mix.L, mix.R)).toFixed(1), rms: gainToDb(rmsOf(mix.L, mix.R)).toFixed(1) });
