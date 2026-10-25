// Gera as falas do rádio (public/radio/*.wav) com o Piper (TTS offline, MIT) e vozes pt-BR (CC0).
// uso: npx tsx scripts/gen-radio.ts          (só gera o que falta)
//      npx tsx scripts/gen-radio.ts --todas  (refaz tudo)
// O Piper e as vozes ficam em %LOCALAPPDATA%\pwm-piper (fora do projeto).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RADIO_LINES, type RadioWho } from "../src/audio/radioLines";

const TOOLS = join(process.env.LOCALAPPDATA ?? ".", "pwm-piper");
const PIPER_ZIP = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
const HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR";
/** cada voz: quem usa, sufixo do arquivo e ritmo (length menor = mais rápido) */
type VoiceKey = "driver" | "driver2" | "engineer";
const VOICES: Record<VoiceKey, { who: RadioWho; suffix: string; name: string; url: string; length: number }> = {
  driver: { who: "driver", suffix: "", name: "pt_BR-faber-medium", url: `${HF}/faber/medium/pt_BR-faber-medium`, length: 0.88 },
  // 2º piloto da equipe: voz própria, pra saber quem está falando
  driver2: { who: "driver", suffix: "_b", name: "pt_BR-jeff-medium", url: `${HF}/jeff/medium/pt_BR-jeff-medium`, length: 0.9 },
  engineer: { who: "engineer", suffix: "", name: "pt_BR-cadu-medium", url: `${HF}/cadu/medium/pt_BR-cadu-medium`, length: 0.98 },
};
const OUT = join(process.cwd(), "public", "radio");
const TMP = join(TOOLS, "tmp");
const all = process.argv.includes("--todas");

async function download(url: string, file: string) {
  if (existsSync(file)) return;
  console.log("baixando", url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`falhou ${r.status}: ${url}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

async function setup(): Promise<string> {
  mkdirSync(TOOLS, { recursive: true });
  const exe = join(TOOLS, "piper", "piper.exe");
  if (!existsSync(exe)) {
    const zip = join(TOOLS, "piper.zip");
    await download(PIPER_ZIP, zip);
    const r = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${TOOLS}'`], { stdio: "inherit" });
    if (r.status !== 0 || !existsSync(exe)) throw new Error("não consegui extrair o Piper");
  }
  for (const v of Object.values(VOICES)) {
    await download(`${v.url}.onnx`, join(TOOLS, `${v.name}.onnx`));
    await download(`${v.url}.onnx.json`, join(TOOLS, `${v.name}.onnx.json`));
  }
  return exe;
}

/** roda o Piper uma vez por voz, com todas as frases dela (json-input) */
function synth(exe: string, who: VoiceKey, jobs: { text: string; file: string }[]): Promise<void> {
  const v = VOICES[who];
  return new Promise((done, fail) => {
    const p = spawn(exe, ["--model", join(TOOLS, `${v.name}.onnx`), "--json-input", "--output_dir", TMP, "--length_scale", String(v.length), "--sentence_silence", "0.1"], {
      cwd: join(TOOLS, "piper"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    p.on("error", fail);
    p.on("exit", (code) => (code === 0 ? done() : fail(new Error(`piper saiu com ${code}`))));
    p.stdin.end(Buffer.from(jobs.map((j) => JSON.stringify({ text: j.text, output_file: j.file })).join("\n") + "\n", "utf8"));
  });
}

/** WAV 16-bit mono -> corta silêncio, normaliza, reduz pra 11 kHz (o filtro de rádio corta acima de 3,4 kHz) */
function post(src: string, dst: string) {
  const b = readFileSync(src);
  let off = 12, rate = 22050, data: Buffer | null = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "fmt ") rate = b.readUInt32LE(off + 12);
    if (id === "data") data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!data) throw new Error("wav sem dados: " + src);
  const n = data.length >> 1;
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = data.readInt16LE(i * 2) / 32768;
  // corta silêncio do começo/fim (com uma folguinha)
  let a = 0, z = n - 1;
  while (a < n && Math.abs(s[a]) < 0.02) a++;
  while (z > a && Math.abs(s[z]) < 0.02) z--;
  a = Math.max(0, a - Math.round(rate * 0.03));
  z = Math.min(n - 1, z + Math.round(rate * 0.08));
  const cut = s.subarray(a, z + 1);
  const peak = cut.reduce((m, x) => Math.max(m, Math.abs(x)), 1e-6);
  const k = 0.89 / peak;
  const step = rate >= 22050 ? 2 : 1;
  const outRate = rate / step;
  const m = Math.floor(cut.length / step);
  const pcm = Buffer.alloc(m * 2);
  for (let i = 0; i < m; i++) {
    let acc = 0;
    for (let j = 0; j < step; j++) acc += cut[i * step + j];
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round((acc / step) * k * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(outRate, 24);
  h.writeUInt32LE(outRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  writeFileSync(dst, Buffer.concat([h, pcm]));
}

const exe = await setup();
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
let count = 0;
for (const who of Object.keys(VOICES) as VoiceKey[]) {
  const v = VOICES[who];
  const jobs = RADIO_LINES.filter((l) => l.who === v.who).flatMap((l) =>
    l.lines.map((text, n) => ({ text, file: join(TMP, `${l.id}_${n}${v.suffix}.wav`), dst: join(OUT, `${l.id}_${n}${v.suffix}.wav`) })),
  ).filter((j) => all || !existsSync(j.dst));
  if (!jobs.length) continue;
  console.log(`${{ driver: "piloto 1", driver2: "piloto 2", engineer: "engenheiro" }[who]}: ${jobs.length} falas`);
  await synth(exe, who, jobs);
  for (const j of jobs) {
    post(j.file, j.dst);
    count++;
  }
}
writeFileSync(
  join(OUT, "CREDITOS.txt"),
  "Falas geradas com o Piper (https://github.com/rhasspy/piper, licença MIT).\nVozes pt_BR faber, jeff e cadu (rhasspy/piper-voices), dados OHF-Voice/voice-datasets, licença CC0.\n",
);
rmSync(TMP, { recursive: true, force: true });
console.log(`pronto: ${count} falas novas em public/radio`);
