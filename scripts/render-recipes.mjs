import fs from 'node:fs';
import path from 'node:path';
import { RECIPES, trackFromRecipe } from '../src/app/recipes.js';
import { renderMix } from '../src/audio/engine.js';
import { encodeWav } from '../src/audio/wav.js';
import { gainToDb, peakOf, rmsOf } from '../src/audio/dsp.js';

const out = path.resolve('tmp/recipes');
fs.mkdirSync(out, { recursive: true });
for (const recipe of RECIPES) {
  const t = trackFromRecipe(recipe);
  const a = performance.now();
  const mix = renderMix(t, t.bpm);
  const ms = performance.now() - a;
  fs.writeFileSync(path.join(out, recipe.id + '.wav'), Buffer.from(encodeWav(mix.L, mix.R, mix.sr, 24)));
  console.log(recipe.id.padEnd(12), String(t.bpm).padStart(3), 'bpm', String(mix.loopUnits / 4).padStart(2), 'bars', 'peak', gainToDb(peakOf(mix.L, mix.R)).toFixed(1), 'rms', gainToDb(rmsOf(mix.L, mix.R)).toFixed(1), ms.toFixed(0) + 'ms');
}
