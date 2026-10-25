// Formato leve das falas do rádio: WAV mono 8 kHz / 8 bits (o filtro de rádio do jogo corta
// acima de 3,4 kHz, então mais que isso é peso à toa). Usado pelo gen-radio e pra converter
// os arquivos que já existem: node scripts/radio-wav.mjs public/radio
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RATE = 8000;

/** lê um WAV PCM mono (8 ou 16 bits) -> amostras -1..1 e a taxa */
export function readWav(buf) {
  let off = 12, rate = 22050, bits = 16, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      rate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    }
    if (id === "data") data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!data) throw new Error("wav sem dados");
  const n = bits === 8 ? data.length : data.length >> 1;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = bits === 8 ? (data[i] - 128) / 128 : data.readInt16LE(i * 2) / 32768;
  return { s, rate };
}

/** amostras -> WAV 8 kHz / 8 bits (com filtro passa-baixa antes de reduzir, pra não chiar) */
export function toRadioWav(s, rate) {
  // passa-baixa simples (média móvel) perto de 3,6 kHz
  const k = Math.max(1, Math.round(rate / 7200));
  const lp = new Float32Array(s.length);
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    acc += s[i] - (i >= k ? s[i - k] : 0);
    lp[i] = acc / Math.min(i + 1, k);
  }
  const m = Math.floor((s.length * RATE) / rate);
  const pcm = Buffer.alloc(m);
  for (let i = 0; i < m; i++) {
    const t = (i * rate) / RATE, j = Math.floor(t), f = t - j;
    const v = (lp[j] ?? 0) * (1 - f) + (lp[j + 1] ?? lp[j] ?? 0) * f;
    pcm[i] = Math.max(0, Math.min(255, Math.round(128 + v * 127)));
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// converte uma pasta inteira (só os que ainda não estão no formato leve)
if (process.argv[2]) {
  const dir = process.argv[2];
  let before = 0, after = 0, n = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".wav"))) {
    const p = join(dir, f), b = readFileSync(p);
    before += b.length;
    const { s, rate } = readWav(b);
    if (rate === RATE && b.readUInt16LE(34) === 8) {
      after += b.length;
      continue;
    }
    const out = toRadioWav(s, rate);
    writeFileSync(p, out);
    after += out.length;
    n++;
  }
  console.log(`${n} convertidas: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
}
