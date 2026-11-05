// Ícones do jogo (no lugar dos emojis): dois tons na cor do texto, contorno + preenchimento suave.
// Começou pelo card da corrida; o resto do jogo troca aos poucos.

/** preenchimento suave (o "segundo tom") */
const F = `fill="currentColor" fill-opacity=".22"`;
/** preenchimento cheio */
const S = `fill="currentColor" stroke="none"`;

const PATHS = {
  /** capacete de corrida com viseira (aba PILOTO) */
  piloto: `<path ${F} d="M3.5 15.3C3.5 9.4 7.7 5 13.1 5c4.5 0 7.9 3.3 7.9 7.5v3a1 1 0 0 1-1 1h-6.8l-2.3 2.6H5.6a2.1 2.1 0 0 1-2.1-2.1z"/><path ${S} d="M11.2 9.3h9.1c.4.9.6 1.9.6 2.9h-8.3c-.9 0-1.5-.6-1.5-1.4z"/><path d="M4 13.6h5.5"/>`,
  /** mostrador de telemetria (aba INFO) */
  info: `<path ${F} d="M3.5 16.5a8.5 8.5 0 0 1 17 0z"/><path d="M3.5 16.5a8.5 8.5 0 0 1 17 0M6.2 11.2l1.1 1M12 8v1.5M17.8 11.2l-1.1 1"/><path d="M12 16.5l4-4.6"/><circle ${S} cx="12" cy="16.5" r="1.7"/>`,
  /** F1 de frente: asa, rodas e cockpit (aba CARRO) */
  carro: `<rect ${F} x="2.5" y="9" width="4.5" height="8.5" rx="1.6"/><rect ${F} x="17" y="9" width="4.5" height="8.5" rx="1.6"/><rect x="2.5" y="9" width="4.5" height="8.5" rx="1.6"/><rect x="17" y="9" width="4.5" height="8.5" rx="1.6"/><path ${F} d="M8.6 15.5c0-3.4 1.5-6.5 3.4-6.5s3.4 3.1 3.4 6.5z"/><path d="M7 13.5h10M8.6 15.5c0-3.4 1.5-6.5 3.4-6.5s3.4 3.1 3.4 6.5M8 5.5h8M12 5.5V9M3 20.5h18"/>`,
  /** chave (aba BOX) */
  box: `<path d="M14.6 3.6a5 5 0 0 0-5.9 6.7L3 16l2.9 2.9 5.8-5.7a5 5 0 0 0 6.7-5.9l-3 3-2.6-.3-.3-2.6z"/>`,
  /** prancheta com lista (aba ESTRATÉGIA) */
  estrategia: `<rect ${F} x="5" y="4.5" width="14" height="16.5" rx="2"/><rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9zM8.5 11l1.3 1.3 2.2-2.6M8.5 16l1.3 1.3 2.2-2.6M14 11.5h2M14 16.5h2"/>`,
  /** gota de combustível */
  fuel: `<path ${F} d="M12 3.5s6.2 6.7 6.2 10.8a6.2 6.2 0 0 1-12.4 0C5.8 10.2 12 3.5 12 3.5z"/><path d="M12 3.5s6.2 6.7 6.2 10.8a6.2 6.2 0 0 1-12.4 0C5.8 10.2 12 3.5 12 3.5z"/><path d="M9.2 14.6a2.8 2.8 0 0 0 2.8 2.8"/>`,
  /** nuvem com chuva */
  chuva: `<path ${F} d="M7 15a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7z"/><path d="M7 15a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>`,
  /** cronômetro (janela de parada, ritmo) */
  tempo: `<circle ${F} cx="12" cy="13.5" r="7.5"/><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.6M10 2.8h4M12 2.8V6M18.2 7.3l1.4-1.4"/>`,
  /** termômetro (temperatura do pneu) */
  temp: `<path ${F} d="M10 4.5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0z"/><path d="M10 4.5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0zM12 9v7"/><circle ${S} cx="12" cy="16.8" r="1.6"/>`,
  /** vento (ar sujo) */
  vento: `<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7"/>`,
  /** humor do piloto */
  feliz: `<circle ${F} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8.3 13.6a4.6 4.6 0 0 0 7.4 0"/><circle ${S} cx="9.2" cy="9.6" r="1.1"/><circle ${S} cx="14.8" cy="9.6" r="1.1"/>`,
  normal: `<circle ${F} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8.6 15h6.8"/><circle ${S} cx="9.2" cy="9.8" r="1.1"/><circle ${S} cx="14.8" cy="9.8" r="1.1"/>`,
  bravo: `<circle ${F} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8.6 16.4a4.4 4.4 0 0 1 6.8 0M7.6 8.2l3 1.6M16.4 8.2l-3 1.6"/><circle ${S} cx="9.6" cy="11.4" r="1"/><circle ${S} cx="14.4" cy="11.4" r="1"/>`,
  /** rádio (reclamar) */
  radio: `<rect ${F} x="3.5" y="9" width="17" height="11" rx="2"/><rect x="3.5" y="9" width="17" height="11" rx="2"/><path d="M7 9l9-5M7.5 14.5h5"/><circle ${S} cx="16.2" cy="14.5" r="1.4"/>`,
} as const;

export type IconName = keyof typeof PATHS;

/** o SVG do ícone (herda a cor do texto) */
export function icon(name: IconName, title = ""): string {
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${title ? "" : ' aria-hidden="true"'}>${title ? `<title>${title}</title>` : ""}${PATHS[name]}</svg>`;
}
