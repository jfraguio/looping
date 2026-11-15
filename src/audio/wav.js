/**
 * Codificador WAV sin dependencias. 16 o 24 bits, estéreo o mono.
 * Devuelve un Uint8Array listo para descargar o para escribir desde Node.
 */

export function encodeWav(L, R, sampleRate = 44100, bitDepth = 16) {
  const channels = R ? 2 : 1;
  const frames = L.length;
  const bytes = bitDepth / 8;
  const dataBytes = frames * channels * bytes;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const writeStr = (at, s) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytes, true);
  view.setUint16(32, channels * bytes, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);
  let p = 44;
  if (bitDepth === 16) {
    for (let i = 0; i < frames; i++) {
      const l = Math.max(-1, Math.min(1, L[i]));
      const r = R ? Math.max(-1, Math.min(1, R[i])) : 0;
      view.setInt16(p, l < 0 ? Math.round(l * 0x8000) : Math.round(l * 0x7fff), true);
      p += 2;
      if (R) {
        view.setInt16(p, r < 0 ? Math.round(r * 0x8000) : Math.round(r * 0x7fff), true);
        p += 2;
      }
    }
  } else if (bitDepth === 24) {
    for (let i = 0; i < frames; i++) {
      const l = Math.max(-1, Math.min(1, L[i]));
      const r = R ? Math.max(-1, Math.min(1, R[i])) : 0;
      let v = l < 0 ? Math.round(l * 0x800000) : Math.round(l * 0x7fffff);
      out[p] = v & 0xff;
      out[p + 1] = (v >> 8) & 0xff;
      out[p + 2] = (v >> 16) & 0xff;
      p += 3;
      if (R) {
        v = r < 0 ? Math.round(r * 0x800000) : Math.round(r * 0x7fffff);
        out[p] = v & 0xff;
        out[p + 1] = (v >> 8) & 0xff;
        out[p + 2] = (v >> 16) & 0xff;
        p += 3;
      }
    }
  } else {
    throw new Error('Profundidad no soportada: ' + bitDepth);
  }
  return out;
}
