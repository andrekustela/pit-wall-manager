// Gera imagens no ComfyUI local (Z-Image Turbo) pela API HTTP.
// uso: node art/gerar_imagem.mjs <saida.png> <largura> <altura> <seed> "<prompt>"
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [out, W = "1344", H = "768", SEED = "1", ...rest] = process.argv.slice(2);
const prompt = rest.join(" ");
const API = "http://127.0.0.1:8188";

const graph = {
  "28": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
  "30": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" } },
  "29": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
  "11": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["28", 0], shift: 3 } },
  "27": { class_type: "CLIPTextEncode", inputs: { clip: ["30", 0], text: prompt } },
  "33": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["27", 0] } },
  "13": { class_type: "EmptySD3LatentImage", inputs: { width: Number(W), height: Number(H), batch_size: 1 } },
  "3": {
    class_type: "KSampler",
    inputs: { model: ["11", 0], positive: ["27", 0], negative: ["33", 0], latent_image: ["13", 0], seed: Number(SEED), steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", denoise: 1 },
  },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["29", 0] } },
  "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "pwm" } },
};

const t0 = Date.now();
const r = await fetch(`${API}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph }) });
const { prompt_id, error, node_errors } = await r.json();
if (!prompt_id) {
  console.error("erro:", JSON.stringify(error ?? node_errors));
  process.exit(1);
}
for (;;) {
  await new Promise((res) => setTimeout(res, 1000));
  const h = await (await fetch(`${API}/history/${prompt_id}`)).json();
  const job = h[prompt_id];
  if (!job) continue;
  if (job.status?.status_str === "error") {
    console.error("falhou:", JSON.stringify(job.status.messages).slice(0, 800));
    process.exit(1);
  }
  const img = job.outputs?.["9"]?.images?.[0];
  if (!img) continue;
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
  const buf = Buffer.from(await (await fetch(`${API}/view?${q}`)).arrayBuffer());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buf);
  console.log(`ok ${out} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  break;
}
