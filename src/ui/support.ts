// Apoiar o jogo: doação de qualquer valor, pacote Plus (extras; ativado por código) e créditos/licenças.
// O jogo é de graça. O Plus por enquanto libera os desenhos extras de capacete e macacão.
import { esc, storeGet, storeSet, toast } from "./common";
import { PLUS_HASHES, PREMIUM_HASHES } from "./plusCodes";

/** link da doação (PIX, Ko-fi, Mercado Pago...). Vazio = "em breve" */
export const DONATE_URL = "";

/** o Premium (tudo do Plus + CRIAR MEU CARRO com adesivos) está ativo neste navegador? */
export function isPremium(): boolean {
  return storeGet("pwm.premium") === "1";
}
/** o Plus está ativo neste navegador? (o Premium inclui o Plus) */
export function isPlus(): boolean {
  return storeGet("pwm.plus") === "1" || isPremium();
}

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** créditos e licenças do que o jogo usa */
const CREDITS: [string, string][] = [
  ["Mapas das pistas reais (mods)", "© colaboradores do OpenStreetMap — licença ODbL (openstreetmap.org/copyright)"],
  ["Traçados das pistas reais", "bacinger/f1-circuits — licença MIT"],
  ["Relevo das pistas reais", "SRTM (NASA), pelos AWS Terrain Tiles (Mapzen) — domínio público"],
  ["3D", "three.js — licença MIT"],
  ["Pilotos", "Nomes de pilotos reais usados só como homenagem; carros, equipes e marcas são inventados"],
  ["Pistas oficiais", "Os traçados das 40 pistas oficiais são inventados pelo jogo (montados com pedaços de curva no estilo das reais, nenhum copiado); os nomes são de cidades, sem ligação com autódromos ou eventos reais"],
];

export function showSupport(onChange: () => void = () => {}) {
  const m = document.createElement("div");
  m.className = "helpmodal";
  const render = () => {
    const plus = isPlus();
    m.innerHTML = `<div class="helpbox panel setbox">
      <div class="helphead"><b>❤ APOIAR O JOGO</b><button class="btn small" data-x>✕</button></div>
      <p>O Pit Wall Manager é de graça e vai continuar sendo. Se você curte, dá pra ajudar com qualquer valor: cada apoio vira mais pistas, mais carros e mais jogo.</p>
      <button class="m2btn hot" data-donate><b>DOAR QUALQUER VALOR</b><span>${DONATE_URL ? "Abre a página de doação" : "Em breve"}</span><i>▶</i></button>
      <h3 class="m2psub">PLUS ★ ${plus ? "✓ ATIVO" : ""}</h3>
      <p class="hint" style="margin:0 0 8px">10 pinturas extras (Bandeirada, Ondas, Raio, Tigre, Pixel, Anéis, Estrelas, Chamas, Camuflada, Retrô) e desenhos extras de capacete e macacão.</p>
      <h3 class="m2psub">PREMIUM ★★ ${isPremium() ? "✓ ATIVO" : ""}</h3>
      <p class="hint" style="margin:0 0 8px">Tudo do Plus + <b>CRIAR MEU CARRO</b>: adesivos (estrelas, raios, chamas, números, textos, formas...) onde você quiser no carro, de qualquer tamanho, cor e giro, espelhados ou não. Aparecem no 2D e no 3D, e no online todo mundo vê.</p>
      <p class="hint" style="margin:0 0 8px">Dá pra testar tudo antes (prévia). Só salvar precisa do código.</p>
      ${isPremium()
        ? `<p class="hint">Obrigado pelo apoio! O Premium está ativo neste navegador.</p>`
        : `<div class="m2join"><input class="txt" data-code maxlength="20" placeholder="PWM-… (Plus) ou PWP-… (Premium)" style="text-transform:uppercase;flex:1;min-width:230px;letter-spacing:1px"><button class="m2btn small" data-activate><b>ATIVAR</b><i>▶</i></button></div>`}
      <h3 class="m2psub">CRÉDITOS E LICENÇAS</h3>
      <div class="hint" style="margin:0">${CREDITS.map(([a, b]) => `<p style="margin:0 0 6px"><b>${esc(a)}:</b> ${esc(b)}</p>`).join("")}</div>
    </div>`;
  };
  render();
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-x]")) return close();
    if (t.closest("[data-donate]")) {
      if (DONATE_URL) window.open(DONATE_URL, "_blank", "noopener");
      else toast("A doação abre em breve. Obrigado pela vontade de ajudar!");
      return;
    }
    if (t.closest("[data-activate]")) {
      const code = (m.querySelector<HTMLInputElement>("[data-code]")?.value ?? "").trim().toUpperCase();
      const h = code ? await sha256(code) : "";
      if (PREMIUM_HASHES.has(h)) {
        storeSet("pwm.premium", "1");
        toast("Premium ativado! Obrigado pelo apoio.");
      } else if (PLUS_HASHES.has(h)) {
        storeSet("pwm.plus", "1");
        toast("Plus ativado! Obrigado pelo apoio.");
      } else return toast("Código inválido. Confira as letras e os traços.");
      render();
      onChange();
    }
  });
}
