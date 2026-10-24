// Emblema da equipe em vetor (SVG): formato + símbolo ou iniciais, nas cores escolhidas.
import type { Emblem } from "../sim/livery";

const SHAPES: Record<Emblem["shape"], string> = {
  escudo: `<path d="M50 4 L92 17 L88 60 Q81 85 50 97 Q19 85 12 60 L8 17 Z"/>`,
  circulo: `<circle cx="50" cy="50" r="46"/>`,
  hexagono: `<polygon points="50,4 90,27 90,73 50,96 10,73 10,27"/>`,
  losango: `<polygon points="50,3 97,50 50,97 3,50"/>`,
  quadrado: `<rect x="7" y="7" width="86" height="86" rx="16"/>`,
};

function symbol(e: Emblem): string {
  const f = e.fg;
  switch (e.symbol) {
    case "raio":
      return `<path d="M57 16 L29 55 H47 L40 86 L71 43 H53 Z" fill="${f}"/>`;
    case "estrela":
      return `<polygon fill="${f}" points="50,16 59,40 85,40 64,55 72,80 50,65 28,80 36,55 15,40 41,40"/>`;
    case "chama":
      return `<path fill="${f}" d="M50 14 C58 30 74 38 72 60 C70 76 60 84 50 84 C38 84 28 75 28 62 C28 50 36 44 40 34 C42 44 46 48 50 50 C52 40 46 28 50 14 Z"/>`;
    case "coroa":
      return `<path fill="${f}" d="M22 66 L26 32 L39 47 L50 26 L61 47 L74 32 L78 66 Z"/><rect fill="${f}" x="22" y="70" width="56" height="9" rx="2"/>`;
    case "asa":
      return `<path fill="${f}" d="M14 58 C30 40 52 32 86 30 C74 38 66 40 58 42 C70 42 76 44 82 46 C68 50 60 52 52 53 C60 55 64 57 68 60 C52 64 34 64 14 58 Z"/>`;
    case "bandeira": {
      let sq = "";
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) if ((r + c) % 2 === 0) sq += `<rect x="${34 + c * 9}" y="${22 + r * 9}" width="9" height="9"/>`;
      return `<g fill="${f}"><rect x="26" y="18" width="6" height="66" rx="2"/><rect x="34" y="22" width="45" height="36" fill="none" stroke="${f}" stroke-width="2"/>${sq}</g>`;
    }
    case "volante":
      return `<g fill="none" stroke="${f}" stroke-width="7" stroke-linecap="round"><circle cx="50" cy="52" r="27"/><path d="M23 52 H40 M60 52 H77 M50 62 V79"/></g><circle cx="50" cy="52" r="9" fill="${f}"/>`;
    case "iniciais":
    default: {
      const t = e.initials || "PW";
      const size = t.length >= 3 ? 30 : t.length === 2 ? 38 : 48;
      return `<text x="50" y="${52 + size * 0.36}" text-anchor="middle" font-family="Oswald, Arial Black, sans-serif" font-weight="700" font-size="${size}" fill="${f}">${t.replace(/[<>&"]/g, "")}</text>`;
    }
  }
}

/** emblema como SVG (tamanho em px) */
export function emblemSvg(e: Emblem, size = 64): string {
  const shape = SHAPES[e.shape] ?? SHAPES.escudo;
  return `<svg class="emblem" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
    <g fill="${e.bg}" stroke="${e.border}" stroke-width="6" stroke-linejoin="round">${shape}</g>
    <g fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2" transform="translate(50 50) scale(.86) translate(-50 -50)">${shape}</g>
    ${symbol(e)}
  </svg>`;
}
